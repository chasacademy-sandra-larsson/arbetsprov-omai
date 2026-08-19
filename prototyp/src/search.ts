import { readFile } from "node:fs/promises";
import { cosineSimilarity, embed } from "./embedder.js";

const INDEX = new URL("../data/index.json", import.meta.url);

interface IndexedRecipe {
  name: string;
  url: string;
  source: string;
  searchText: string;
  vector: number[];
}

const query = process.argv.slice(2).join(" ");
if (!query) {
  console.error('Användning: npm run search -- "krämig kycklinggryta"');
  process.exit(1);
}

const index: IndexedRecipe[] = JSON.parse(await readFile(INDEX, "utf8"));
const vectors = index.map((r) => Float32Array.from(r.vector));

const [queryVector] = await embed([query], "query");

const started = performance.now();
const scored = index
  .map((recipe, i) => ({ recipe, score: cosineSimilarity(queryVector, vectors[i]) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 5);
const elapsed = (performance.now() - started).toFixed(1);

console.log(`\nSökning: "${query}"  (${index.length} recept, ${elapsed} ms)\n`);
for (const { recipe, score } of scored) {
  console.log(`${score.toFixed(3)}  ${recipe.name}  [${recipe.source}]`);
  console.log(`       ${recipe.searchText.slice(0, 120)}...`);
}
