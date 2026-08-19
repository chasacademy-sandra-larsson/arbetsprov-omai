import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// multilingual-e5 är tränad med prefixen "query:" (sökfråga) och "passage:"
// (dokument) — utan dem hamnar frågor och dokument i fel del av vektorrummet
// och likheterna blir märkbart sämre.
export type TextRole = "query" | "passage";

let extractor: FeatureExtractionPipeline | undefined;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  extractor ??= await pipeline("feature-extraction", "Xenova/multilingual-e5-small");
  return extractor;
}

export async function embed(texts: string[], role: TextRole): Promise<Float32Array[]> {
  const model = await getExtractor();
  const prefixed = texts.map((t) => `${role}: ${t}`);
  // mean pooling: token-vektorer → en vektor per text.
  // normalize: längd 1, så att skalärprodukt = cosine similarity.
  const output = await model(prefixed, { pooling: "mean", normalize: true });
  const [count, dim] = output.dims;
  const flat = output.data as Float32Array;
  return Array.from({ length: count }, (_, i) => flat.slice(i * dim, (i + 1) * dim));
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vektorerna är normaliserade, så skalärprodukten räcker
}
