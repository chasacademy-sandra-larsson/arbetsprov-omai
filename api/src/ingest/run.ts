import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { ChromaClient } from "chromadb";
import { config } from "../config.js";
import { embed } from "../embedder.js";
import { parseRecipeLine, toSearchText } from "./parse.js";

// Offline-pipelinen: streama NDJSON → validera/rensa → embedda → Chroma.
// Körs en gång (~1,5 h för alla 173 278 recept). Idempotent och resumbar:
// redan indexerade id:n hoppas över, så en avbruten körning fortsätter
// där den var — omstart kostar bara uppslag, inte omembedding.

const SOURCE = new URL("../../../20170107-061401-recipeitems.json", import.meta.url);
const CHROMA_BATCH = 512; // uppslag + skrivning per omgång
const EMBED_BATCH = 32; // modellens batchstorlek (minnesbegränsad)

// --limit=N för rökkörning på en delmängd innan fullkörningen
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

const client = new ChromaClient(config.chroma);
const collection = await client.getOrCreateCollection({
  name: config.chroma.collection,
  configuration: { hnsw: { space: "cosine" } },
  embeddingFunction: null, // vi embeddar själva med e5 (samma modell som frågorna)
});

interface PendingRecipe {
  id: string;
  searchText: string;
  metadata: { name: string; url: string; source: string; recipeJson: string };
}

const stats = { lines: 0, invalid: 0, existing: 0, added: 0 };
const seenIds = new Set<string>();
const started = Date.now();
let batch: PendingRecipe[] = [];

async function flush(): Promise<void> {
  if (batch.length === 0) return;
  const current = batch;
  batch = [];

  const existing = await collection.get({ ids: current.map((r) => r.id), include: [] });
  const existingIds = new Set(existing.ids);
  stats.existing += existingIds.size;

  const missing = current.filter((r) => !existingIds.has(r.id));
  if (missing.length > 0) {
    const embeddings: number[][] = [];
    for (let i = 0; i < missing.length; i += EMBED_BATCH) {
      const chunk = missing.slice(i, i + EMBED_BATCH);
      embeddings.push(...(await embed(chunk.map((r) => r.searchText), "passage")));
    }
    await collection.add({
      ids: missing.map((r) => r.id),
      embeddings,
      documents: missing.map((r) => r.searchText),
      metadatas: missing.map((r) => r.metadata),
    });
    stats.added += missing.length;
  }

  const minutes = (Date.now() - started) / 60_000;
  const rate = stats.added / Math.max(minutes, 0.01);
  process.stdout.write(
    `\r${stats.lines} rader | ${stats.added} embeddade (${Math.round(rate)}/min) | ` +
      `${stats.existing} fanns | ${stats.invalid} ogiltiga`,
  );
}

const lines = createInterface({ input: createReadStream(SOURCE) });
for await (const line of lines) {
  if (stats.lines >= limit) break;
  stats.lines++;

  const recipe = parseRecipeLine(line);
  if (!recipe) {
    stats.invalid++;
    continue;
  }
  // _id.$oid är stabilt mellan körningar (krävs för resume); raden i övrigt
  // sparas orörd som recipeJson så att API:t kan svara med hela receptet.
  const id = recipe._id?.$oid ?? `line-${stats.lines}`;
  if (seenIds.has(id)) continue;
  seenIds.add(id);

  batch.push({
    id,
    searchText: toSearchText(recipe),
    metadata: {
      name: recipe.name,
      url: recipe.url ?? "",
      source: recipe.source ?? "",
      recipeJson: line,
    },
  });
  if (batch.length >= CHROMA_BATCH) await flush();
}
await flush();

const total = await collection.count();
console.log(
  `\nKlart på ${((Date.now() - started) / 60_000).toFixed(1)} min. ` +
    `Kollektionen "${config.chroma.collection}" innehåller nu ${total} recept.`,
);
