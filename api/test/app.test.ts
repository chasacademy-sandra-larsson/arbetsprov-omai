import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";

// Validerings- och routinglagret testas utan Chroma/LLM — inga förfrågningar
// här ska nå searchRecipes(). (Sökvägen självt kräver stödsystemen och
// täcks av npm run eval.)
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Oväntad serveradress");
  baseUrl = `http://localhost:${address.port}`;
});

afterAll(() => server.close());

async function postSearch(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /search — validering", () => {
  it("avvisar tom body med 400 och begriplig text", async () => {
    const res = await postSearch({});
    expect(res.status).toBe(400);
    const json = (await res.json()) as { details: { message: string }[] };
    expect(json.details.some((d) => d.message.includes("query"))).toBe(true);
  });

  it.each([
    ["för lång query", { query: "x".repeat(501) }],
    ["för stor maxResults", { query: "pasta", maxResults: 99 }],
    ["tom ingredienslista", { ingredients: [] }],
    ["fel typ på query", { query: 42 }],
  ])("avvisar %s med 400", async (_label, body) => {
    expect((await postSearch(body)).status).toBe(400);
  });
});

describe("routing", () => {
  it("okänd route ger 404 med hjälptext", async () => {
    const res = await fetch(`${baseUrl}/foo`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("/search");
  });
});
