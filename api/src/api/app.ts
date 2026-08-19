import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { indexSize, searchRecipes } from "../query/search.js";

// Kravet: sök på "ett antal ingredienser eller en beskrivning" — därför tar
// /search emot query (fritext) och/eller ingredients (lista), på valfritt
// språk. Båda går genom samma tolknings- och sökväg.
const searchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(500).optional(),
    ingredients: z.array(z.string().trim().min(1).max(100)).min(1).max(30).optional(),
    maxResults: z.coerce.number().int().min(1).max(20).default(5),
  })
  .refine((body) => body.query || body.ingredients, {
    message: "Provide 'query' (free text) and/or 'ingredients' (list)",
  });

export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", async (_req, res) => {
    res.json({
      status: "ok",
      recipes: await indexSize(),
      queryInterpretation: config.anthropicApiKey ? "llm" : "fallback (no ANTHROPIC_API_KEY)",
    });
  });

  app.post("/search", async (req, res) => {
    const parsed = searchRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request",
        details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
      return;
    }

    const { query, ingredients, maxResults } = parsed.data;
    const text = [query, ingredients?.length ? `Ingredients: ${ingredients.join(", ")}` : null]
      .filter(Boolean)
      .join(". ");

    res.json(await searchRecipes(text, maxResults));
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found. Available: GET /health, POST /search" });
  });

  // Express 5 skickar rejected promises från async-handlers hit automatiskt.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    // Chroma nere/ej ingestad är en miljöfråga, inte en klientfråga → 503
    // med åtgärdbar text; allt annat är en bugg → 500.
    const unavailable = message.includes("Chroma");
    console.error(`Fel i förfrågan: ${message}`);
    res.status(unavailable ? 503 : 500).json({ error: message });
  });

  return app;
}
