// All miljökonfiguration samlad på ett ställe, med körbara defaults —
// API:t ska gå att starta utan .env (då utan LLM-tolkning, se interpret.ts).
const chromaUrl = new URL(process.env.CHROMA_URL ?? "http://localhost:8000");

export const config = {
  chroma: {
    host: chromaUrl.hostname,
    port: Number(chromaUrl.port || 8000),
    ssl: chromaUrl.protocol === "https:",
    collection: "recipes",
  },
  // undefined = kör utan LLM-frågetolkning (graceful degradation)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  port: Number(process.env.PORT ?? 3000),
} as const;
