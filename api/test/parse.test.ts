import { describe, expect, it } from "vitest";
import {
  cleanIngredientLine,
  ingredientNames,
  parseRecipeLine,
  toSearchText,
} from "../src/ingest/parse.js";

describe("parseRecipeLine", () => {
  it("accepterar en giltig rad och behåller okända fält", () => {
    const recipe = parseRecipeLine(
      '{"name":"Soup","ingredients":"1 onion","cookTime":"PT30M","_id":{"$oid":"abc"}}',
    );
    expect(recipe?.name).toBe("Soup");
    expect(recipe?._id?.$oid).toBe("abc");
    // .passthrough(): hela originalobjektet ska kunna returneras av API:t
    expect((recipe as Record<string, unknown>).cookTime).toBe("PT30M");
  });

  it.each([
    ["trasig JSON", "{inte json"],
    ["saknat namn", '{"ingredients":"1 onion"}'],
    ["tom ingredienssträng", '{"name":"Soup","ingredients":""}'],
    ["tom rad", "   "],
  ])("returnerar undefined för %s", (_label, line) => {
    expect(parseRecipeLine(line)).toBeUndefined();
  });
});

describe("cleanIngredientLine", () => {
  it("strippar mängder, enheter och parenteser", () => {
    expect(cleanIngredientLine("1-1/2 stick (3/4 Cup) Cold Butter, Cut Into Pieces")).toBe(
      "cold butter cut into pieces",
    );
  });

  it("reducerar trasiga scraping-rader (fynd 1) till tom sträng", () => {
    expect(cleanIngredientLine("2 whole 2 whole")).toBe("");
    expect(cleanIngredientLine("1 cup 1 cup")).toBe("");
  });
});

describe("ingredientNames", () => {
  it("deduplicerar och filtrerar tomma rader", () => {
    const recipe = { name: "X", ingredients: "1 cup flour\n2 cups flour\n2 whole 2 whole" };
    expect(ingredientNames(recipe)).toEqual(["flour"]);
  });
});

describe("toSearchText", () => {
  it("bygger namn + ingredienser + beskrivning", () => {
    const recipe = { name: "Soup", ingredients: "1 onion\n2 carrots", description: "Warm." };
    expect(toSearchText(recipe)).toBe("Soup. Ingredients: onion, carrots. Warm.");
  });

  it("faller tillbaka på namn + beskrivning när ingredienserna är trasiga (fynd 1)", () => {
    const recipe = { name: "Broken &amp; Sad", ingredients: "2 whole 2 whole\n1 cup 1 cup", description: "A test" };
    expect(toSearchText(recipe)).toBe("Broken & Sad. A test");
  });

  it("kapar beskrivningen vid 300 tecken", () => {
    const recipe = { name: "X", ingredients: "1 onion", description: "a".repeat(1000) };
    expect(toSearchText(recipe).length).toBeLessThan(350);
  });
});
