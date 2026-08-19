import { interpretQuery } from "../query/interpret.js";
import { searchRecipes, searchWithPlan, type RecipeHit } from "../query/search.js";

// Golden-frågor mot den riktiga stacken (Chroma + LLM + embeddings).
// Kompletterar enhetstesterna: de testar delarna, detta testar helheten.
// Körs manuellt (npm run eval) — kräver stödsystemen igång, hör inte
// hemma i npm test.

function recipeText(hit: RecipeHit): string {
  const r = hit.recipe as { name?: string; ingredients?: string };
  return `${r.name ?? ""} ${r.ingredients ?? ""}`.toLowerCase();
}

let failures = 0;

function report(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!ok) failures++;
}

// 1. Negationer (fynd 3): inget returnerat recept får nämna tomat.
{
  const { results, interpreted } = await searchRecipes("pasta utan tomat");
  const leaks = results.filter((h) => recipeText(h).includes("tomato"));
  report(
    "Negation 'pasta utan tomat'",
    interpreted.exclude.includes("tomato") && leaks.length === 0,
    leaks.length ? `läckor: ${leaks.map((h) => (h.recipe as { name?: string }).name).join(", ")}` : `${results.length} träffar, alla tomatfria`,
  );
}

// 2. Samma sak på engelska — exclude ska vara språkoberoende.
{
  const { results } = await searchRecipes("chocolate cake without milk");
  const leaks = results.filter((h) => recipeText(h).includes("milk"));
  report("Negation 'chocolate cake without milk'", leaks.length === 0,
    leaks.length ? `läckor: ${leaks.length}` : `${results.length} träffar, alla mjölkfria`);
}

// 3. Flerspråkig konsistens (fynd 2): svensk och engelsk formulering av samma
// fråga ska ge väsentligen samma träffar när LLM:en normaliserar till engelska.
{
  const urls = (hits: RecipeHit[]) => new Set(hits.map((h) => (h.recipe as { url?: string }).url));
  const sv = await searchRecipes("krämig kycklinggryta med svamp");
  const en = await searchRecipes("creamy chicken stew with mushrooms");
  const overlap = [...urls(sv.results)].filter((u) => urls(en.results).has(u)).length;
  report("Flerspråkig konsistens sv/en", overlap >= 3, `${overlap}/5 gemensamma träffar`);
}

// 4. Ingrediensmatchning: alla angivna ingredienser ska finnas i förstaträffen.
{
  const { results } = await searchRecipes("Ingredients: chicken, lemon, garlic");
  const top = results[0];
  report(
    "Ingredienslista chicken/lemon/garlic",
    top !== undefined && top.matchedIngredients.length === 3,
    top ? `topp 1: "${(top.recipe as { name?: string }).name}" matchar ${top.matchedIngredients.length}/3` : "inga träffar",
  );
}

// 5. Boost-kalibrering: hur många av topp 5 matchar alla include-ingredienser,
// vid olika viktning? Planen tolkas EN gång och hålls konstant — annars
// jämför raderna LLM-brus i stället för boost-effekt.
{
  const query = "krämig kycklinggryta med svamp";
  const plan = await interpretQuery(query);
  console.log(`\nBoost-kalibrering ('${query}' → include: ${plan.include.join(", ")}):`);
  for (const boost of [0, 0.01, 0.03, 0.05, 0.1]) {
    const { results } = await searchWithPlan(plan, query, 5, boost);
    const full = results.filter((h) => h.matchedIngredients.length === plan.include.length).length;
    console.log(`  boost ${boost.toFixed(2)}: ${full}/5 fullmatchade`);
  }
}

console.log(failures === 0 ? "\nAlla utvärderingar passerade." : `\n${failures} utvärdering(ar) föll.`);
// exitCode i stället för process.exit(): transformers.js har arbetstrådar
// som kraschar med mutex-fel om processen dödas mitt i städningen.
process.exitCode = failures === 0 ? 0 : 1;
