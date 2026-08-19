import { searchRecipes } from "./search.js";

// Manuellt testverktyg: npm run search -- "pasta utan tomat"
const query = process.argv.slice(2).join(" ");
if (!query) {
  console.error('Användning: npm run search -- "pasta utan tomat"');
  process.exit(1);
}

const started = performance.now();
const response = await searchRecipes(query);
const elapsed = ((performance.now() - started) / 1000).toFixed(1);

const { interpreted } = response;
console.log(`\nFråga: "${response.original}"  (${elapsed} s, tolkad av: ${interpreted.interpretedBy})`);
console.log(
  `Plan: "${interpreted.description}"` +
    (interpreted.include.length ? ` | include: ${interpreted.include.join(", ")}` : "") +
    (interpreted.exclude.length ? ` | exclude: ${interpreted.exclude.join(", ")}` : ""),
);
console.log();

for (const hit of response.results) {
  const r = hit.recipe as { name?: string; source?: string; ingredients?: string };
  const matched = hit.matchedIngredients.length ? `  [träffar: ${hit.matchedIngredients.join(", ")}]` : "";
  console.log(`${hit.score.toFixed(3)}  ${r.name}  (${r.source})${matched}`);
  console.log(`       ${(r.ingredients ?? "").split("\n").slice(0, 4).join(" | ").slice(0, 110)}...`);
}
