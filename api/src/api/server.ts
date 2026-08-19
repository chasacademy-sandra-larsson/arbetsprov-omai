import { config } from "../config.js";
import { embed } from "../embedder.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`Recept-API:t lyssnar på http://localhost:${config.port}`);
  console.log(
    config.anthropicApiKey
      ? "Frågetolkning: LLM (Claude Haiku)"
      : "Frågetolkning: fallback — ingen ANTHROPIC_API_KEY satt, frågor går rakt till embeddingen",
  );
});

// Värm upp embeddingmodellen direkt (laddning tar ett par sekunder) så att
// första sökningen inte betalar kallstarten.
embed(["warmup"], "query")
  .then(() => console.log("Embeddingmodellen laddad"))
  .catch((error) => console.error(`Kunde inte ladda embeddingmodellen: ${error}`));
