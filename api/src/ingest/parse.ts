import { z } from "zod";

// Zod-schema i stället för blind typcast: rådatat är scrapat och opålitligt
// (fynd 1 i PROTOTYP.md), så varje rad valideras innan den används.
// .passthrough() behåller okända fält — hela objektet ska kunna returneras.
export const rawRecipeSchema = z
  .object({
    _id: z.object({ $oid: z.string() }).optional(),
    name: z.string().min(1),
    ingredients: z.string().min(1),
    description: z.string().optional(),
    url: z.string().optional(),
    source: z.string().optional(),
  })
  .passthrough();

export type RawRecipe = z.infer<typeof rawRecipeSchema>;

/** En NDJSON-rad → validerat recept, eller undefined om raden är trasig. */
export function parseRecipeLine(line: string): RawRecipe | undefined {
  if (!line.trim()) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return undefined;
  }
  const result = rawRecipeSchema.safeParse(json);
  return result.success ? result.data : undefined;
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Grov destillering: "1-1/2 stick (3/4 Cup) Cold Butter, Cut Into Pieces" → "cold butter".
// Mängder, enheter och tillagningsord tillför inget semantiskt och späder ut vektorn.
export function cleanIngredientLine(line: string): string {
  return line
    .replace(/\([^)]*\)/g, " ")
    .replace(/\d+[\d\s\/.,-]*/g, " ")
    .replace(
      /\b(cups?|cup|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|pounds?|lbs?|grams?|g|kg|ml|l|liters?|sticks?|cloves?|pinch(es)?|dash(es)?|whole|large|medium|small|chopped|diced|minced|sliced|grated|fresh|dried|of|to|taste|weight|fluid|stalks?|cans?|packages?)\b/gi,
      " ",
    )
    .replace(/[^a-zA-Z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Rensade, unika ingrediensnamn — tom lista för de ~29 % trasiga (fynd 1). */
export function ingredientNames(recipe: RawRecipe): string[] {
  return [...new Set(recipe.ingredients.split("\n").map(cleanIngredientLine).filter(Boolean))];
}

/**
 * Texten som embeddas och lagras som Chroma-dokument. För recept med trasiga
 * ingredienslistor bär namn + beskrivning söktexten i stället (fynd 1).
 * Dokumentet används också för exclude-filtrering ($not_contains) i sökvägen.
 */
export function toSearchText(recipe: RawRecipe): string {
  const ingredients = ingredientNames(recipe);
  const description = decodeEntities(recipe.description ?? "").slice(0, 300);
  const ingredientPart = ingredients.length > 0 ? ` Ingredients: ${ingredients.join(", ")}.` : "";
  return `${decodeEntities(recipe.name)}.${ingredientPart} ${description}`.trim();
}
