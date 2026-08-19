import { describe, expect, it, vi } from "vitest";

// Fallback-vägen är API:ts robusthetslöfte: utan nyckel ska tolkningen
// degradera tyst till rå fråga — aldrig krascha, aldrig anropa nätet.
describe("interpretQuery utan API-nyckel", () => {
  it("returnerar frågan orörd som fallback-plan", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { interpretQuery } = await import("../src/query/interpret.js");

    const plan = await interpretQuery("pasta utan tomat");
    expect(plan).toEqual({
      description: "pasta utan tomat",
      include: [],
      exclude: [],
      interpretedBy: "fallback",
    });
  });
});
