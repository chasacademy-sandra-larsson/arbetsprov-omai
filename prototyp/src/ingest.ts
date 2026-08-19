import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { embed } from "./embedder.js";

const SOURCE = new URL("../../20170107-061401-recipeitems.json", import.meta.url);
const OUTPUT = new URL("../data/index.json", import.meta.url);
const SAMPLE_EVERY = 173; // 173 278 recept / 173 ≈ 1 000, spridda över alla källor

interface Recipe {
  name: string;
  ingredients: string;
  description?: string;
  url: string;
  source: string;
}

// Grov destillering: "1-1/2 stick (3/4 Cup) Cold Butter, Cut Into Pieces" → "cold butter"
// Räcker för prototypen; i riktiga lösningen förtjänar detta egna tester.
function cleanIngredientLine(line: string): string {
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

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function toSearchText(r: Recipe): string {
  const ingredients = [...new Set(r.ingredients.split("\n").map(cleanIngredientLine).filter(Boolean))];
  const description = decodeEntities(r.description ?? "").slice(0, 300);
  // ~29 % av datasetet (främst tastykitchen/epicurious) har trasiga
  // ingredienslistor med enbart mängder — då bär namn + beskrivning söktexten.
  const ingredientPart = ingredients.length > 0 ? ` Ingredients: ${ingredients.join(", ")}.` : "";
  return `${decodeEntities(r.name)}.${ingredientPart} ${description}`;
}

const recipes: Recipe[] = [];
const lines = createInterface({ input: createReadStream(SOURCE) });
let lineNo = 0;
for await (const line of lines) {
  if (lineNo++ % SAMPLE_EVERY !== 0 || !line.trim()) continue;
  const r = JSON.parse(line) as Recipe;
  if (r.name && r.ingredients) recipes.push(r);
}
console.log(`Samplade ${recipes.length} recept, embeddar...`);

const started = Date.now();
const vectors: number[][] = [];
const BATCH = 32;
for (let i = 0; i < recipes.length; i += BATCH) {
  const batch = recipes.slice(i, i + BATCH).map(toSearchText);
  vectors.push(...(await embed(batch, "passage")).map((v) => Array.from(v)));
  process.stdout.write(`\r${Math.min(i + BATCH, recipes.length)}/${recipes.length}`);
}
console.log(`\nKlart på ${((Date.now() - started) / 1000).toFixed(0)}s`);

const index = recipes.map((r, i) => ({
  name: r.name,
  url: r.url,
  source: r.source,
  searchText: toSearchText(r),
  vector: vectors[i],
}));
await writeFile(OUTPUT, JSON.stringify(index));
console.log(`Sparade index till ${OUTPUT.pathname}`);
