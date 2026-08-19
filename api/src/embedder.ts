import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// multilingual-e5 är tränad med prefixen "query:" (sökfråga) och "passage:"
// (dokument) — utan dem hamnar frågor och dokument i fel del av vektorrummet
// och likheterna blir märkbart sämre.
export type TextRole = "query" | "passage";

export const MODEL = "Xenova/multilingual-e5-small";

let extractor: FeatureExtractionPipeline | undefined;

// Omtypningen behövs: pipeline() är överlastad på ~30 tasktyper och TS
// klarar inte att härleda returunionen (TS2590), trots konstant task.
const createPipeline = pipeline as unknown as (
  task: "feature-extraction",
  model: string,
) => Promise<FeatureExtractionPipeline>;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractor ??= await createPipeline("feature-extraction", MODEL);
  return extractor;
}

export async function embed(texts: string[], role: TextRole): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = await getExtractor();
  const prefixed = texts.map((t) => `${role}: ${t}`);
  // mean pooling: token-vektorer → en vektor per text.
  // normalize: längd 1, så att skalärprodukt = cosine similarity.
  const output = await model(prefixed, { pooling: "mean", normalize: true });
  const [count, dim] = output.dims;
  if (count !== texts.length || !dim) {
    throw new Error(`Oväntad embeddingform: ${output.dims.join("x")} för ${texts.length} texter`);
  }
  const flat = output.data as Float32Array;
  return Array.from({ length: count }, (_, i) => Array.from(flat.slice(i * dim, (i + 1) * dim)));
}
