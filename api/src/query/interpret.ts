import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config.js";

// LLM-frågetolkning: fritext på valfritt språk → strukturerad sökplan på
// engelska. Löser det embeddings inte kan (PROTOTYP.md):
//   fynd 3 — negationer blir hårda exclude-filter i stället för närhet
//   fynd 2 — description översätts till engelska, så e5:s svenska gap
//            träffar bara fallback-vägen
// Designprincip: LLM:en är ett *förbättringssteg*, aldrig en förutsättning.
// Saknad nyckel, timeout eller API-fel → frågan går rå till embeddingen.

export interface InterpretedQuery {
  /** Engelsk beskrivning av rätten — det som embeddas. */
  description: string;
  /** Ingredienser som ska finnas (gemener, engelska). */
  include: string[];
  /** Ingredienser som inte får finnas (gemener, engelska). */
  exclude: string[];
  /** Spårbarhet: tolkades frågan av LLM:en eller gick den rå? */
  interpretedBy: "llm" | "fallback";
}

const SYSTEM_PROMPT = `You interpret recipe search queries for a semantic search engine over an English-language recipe collection. The query may be in any language.

Produce a search plan:
- description: a short English description of the desired dish, written like a recipe title or summary, for embedding-based search. Never mention excluded ingredients here.
- include: ingredients that must be present. Lowercase English, one ingredient per entry.
- exclude: ingredients that must NOT be present — from negations ("without X", "utan X", "sans X"), allergies, or diets (e.g. vegetarian excludes meats). Lowercase English. Be conservative: exclude only what the user explicitly rules out or what a stated diet/allergy clearly implies — never guess additional exclusions, and translate the negated ingredient exactly (Swedish "mjölk" is milk, "mjöl" is flour).

Use empty arrays when nothing applies. Interpret the culinary intent; do not translate word for word.

Example: "pasta utan tomat" → {"description": "simple pasta dish", "include": ["pasta"], "exclude": ["tomato"]}
Note that the description must not contain "tomato" — it is used for semantic similarity search, where mentioning an ingredient attracts recipes containing it.`;

// strict: true + additionalProperties: false → API:t garanterar att
// tool-inputen validerar exakt mot schemat, ingen egen JSON-reparation behövs.
const searchPlanTool = {
  name: "search_plan",
  description: "Report the structured retrieval plan for the recipe search query.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      description: { type: "string", description: "English dish description for semantic search" },
      include: { type: "array", items: { type: "string" } },
      exclude: { type: "array", items: { type: "string" } },
    },
    required: ["description", "include", "exclude"],
    additionalProperties: false,
  },
};

// Zod-validering trots strict-garantin: LLM-utdata behandlas som opålitlig
// indata precis som allt annat, och normaliseras (gemener, dedup, tak).
const planSchema = z.object({
  description: z.string().min(1).max(500),
  include: z.array(z.string().min(1).max(80)).max(20),
  exclude: z.array(z.string().min(1).max(80)).max(20),
});

function normalize(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

function fallback(query: string): InterpretedQuery {
  return { description: query, include: [], exclude: [], interpretedBy: "fallback" };
}

let client: Anthropic | undefined;

export async function interpretQuery(query: string): Promise<InterpretedQuery> {
  if (!config.anthropicApiKey) return fallback(query);
  client ??= new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 1 });

  try {
    const response = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [searchPlanTool],
        // Forcerat verktygsval: svaret är alltid ett search_plan-anrop,
        // aldrig fritext som skulle behöva parsas.
        tool_choice: { type: "tool", name: "search_plan" },
        messages: [{ role: "user", content: query }],
      },
      // Latensbudget: varma anrop tar ~1,5 s, men första anropet (kall
      // TLS-anslutning) kan ta längre — hellre en långsam förstafråga än
      // att just den degraderar till fallback hos granskaren.
      // Värsta fall ≈ timeout × 2 (en retry) innan fallback tar över.
      { timeout: 10_000 },
    );

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse) return fallback(query);

    const plan = planSchema.parse(toolUse.input);
    return {
      description: plan.description,
      include: normalize(plan.include),
      exclude: normalize(plan.exclude),
      interpretedBy: "llm",
    };
  } catch (error) {
    // Graceful degradation oavsett orsak (nätfel, 429, ogiltig nyckel,
    // schemabrott) — sökningen fungerar alltid, bara med sämre tolkning.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Frågetolkning föll tillbaka på rå fråga: ${message}`);
    return fallback(query);
  }
}
