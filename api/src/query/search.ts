import { ChromaClient, type Collection, type WhereDocument } from "chromadb";
import { config } from "../config.js";
import { embed } from "../embedder.js";
import { interpretQuery, type InterpretedQuery } from "./interpret.js";

// Online-pipelinen: tolka → embedda → vektorsök → filtrera/boosta → topp N.
// Semantiken (vad rätten handlar om) bärs av embeddingen; logiken (måste
// finnas / får inte finnas) bärs av filter och boost — se PROTOTYP.md, fynd 3.

export interface RecipeHit {
  /** Hela originalreceptet ur datasetet (kravet: svara med receptet). */
  recipe: Record<string, unknown>;
  /** Kosinuslikhet + ingrediensboost. Duger till rankning, inte som absolut relevans (fynd 4). */
  score: number;
  /** Vilka include-ingredienser som faktiskt hittades i receptet. */
  matchedIngredients: string[];
}

export interface SearchResponse {
  original: string;
  interpreted: InterpretedQuery;
  results: RecipeHit[];
}

// Översampling: hämta fler kandidater än vi returnerar, så att omrankningen
// (ingrediensboost) har något att jobba med.
const OVERSAMPLE = 10;
// Boost per matchad include-ingrediens. Kalibrerad med npm run eval:
// 0.03 gav 4/5 fullmatchade i topp 5, 0.10 gav 5/5 men riskerar att låta
// lexikala träffar köra över semantiken (3 träffar = +0.3, mer än hela
// poängspridningen). 0.05 är avvägningen.
const INGREDIENT_BOOST = 0.05;

let collectionPromise: Promise<Collection> | undefined;

function getCollection(): Promise<Collection> {
  collectionPromise ??= new ChromaClient(config.chroma)
    .getCollection({ name: config.chroma.collection })
    .catch((error: unknown) => {
      collectionPromise = undefined; // låt nästa anrop försöka igen
      throw new Error(
        `Hittar inte kollektionen "${config.chroma.collection}" i Chroma — ` +
          `är Chroma igång (docker compose up -d) och ingest körd (npm run ingest)?`,
        { cause: error },
      );
    });
  return collectionPromise;
}

// Serverfilter: Chroma slipper returnera uppenbart uteslutna recept.
// Matchningen är substring och case-känslig — ingredienserna i dokumentet är
// lowercase, så lowercase-termer träffar rätt där.
function buildExcludeFilter(exclude: string[]): WhereDocument | undefined {
  const clauses = exclude.map((term) => ({ $not_contains: term }));
  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

/** Antal indexerade recept — används av /health. */
export async function indexSize(): Promise<number> {
  return (await getCollection()).count();
}

export async function searchRecipes(query: string, maxResults = 5): Promise<SearchResponse> {
  return searchWithPlan(await interpretQuery(query), query, maxResults);
}

// Separat från tolkningen så att kalibreringen (npm run eval) kan hålla
// planen konstant och variera enbart boosten — annars jämför man LLM-brus.
export async function searchWithPlan(
  interpreted: InterpretedQuery,
  original: string,
  maxResults = 5,
  ingredientBoost = INGREDIENT_BOOST,
): Promise<SearchResponse> {
  const collection = await getCollection();

  const [queryVector] = await embed([interpreted.description], "query");
  if (!queryVector) throw new Error("Embeddingen gav ingen vektor");

  const result = await collection.query({
    queryEmbeddings: [queryVector],
    nResults: maxResults * OVERSAMPLE,
    whereDocument: buildExcludeFilter(interpreted.exclude),
    include: ["documents", "metadatas", "distances"],
  });

  const ids = result.ids[0] ?? [];
  const hits = ids
    .map((_, i) => {
      const document = (result.documents[0]?.[i] ?? "").toLowerCase();
      const metadata = result.metadatas[0]?.[i];
      const distance = result.distances[0]?.[i];
      if (!metadata || distance == null) return undefined;

      const recipe = JSON.parse(String(metadata.recipeJson)) as Record<string, unknown>;
      // Klientsidans exclude-koll granskar RÅ-receptet, inte bara det renade
      // dokumentet — serverfiltret missar case-skillnader ("Tomato" i namn)
      // och text som rensningen strippat (t.ex. "(milk, plain or white)"
      // i parentes). Dokumentkollen behålls för beskrivningsburna träffar.
      const rawText = `${recipe.name ?? ""} ${recipe.ingredients ?? ""}`.toLowerCase();
      if (interpreted.exclude.some((term) => rawText.includes(term) || document.includes(term))) {
        return undefined;
      }

      const matched = interpreted.include.filter((term) => document.includes(term));
      return {
        recipe,
        // Chroma returnerar kosinusavstånd; likhet = 1 − avstånd.
        score: 1 - distance + matched.length * ingredientBoost,
        matchedIngredients: matched,
      };
    })
    .filter((hit): hit is RecipeHit => hit !== undefined)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  return { original, interpreted, results: hits };
}
