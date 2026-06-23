import test from "node:test";
import assert from "node:assert/strict";
import {
  WorldBankProvider,
  resolveIndicator,
  resolveCountry
} from "./providers.mjs";

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

test("resolveIndicator maps known keywords", () => {
  assert.equal(resolveIndicator("italy population trend"), "SP.POP.TOTL");
  assert.equal(resolveIndicator("gdp of germany"), "NY.GDP.MKTP.CD");
  assert.equal(resolveIndicator("inflation rate"), "FP.CPI.TOTL.ZG");
  assert.equal(resolveIndicator("nothing relevant"), null);
});

test("resolveCountry detects a named country or defaults to world", () => {
  assert.equal(resolveCountry("italy population"), "IT");
  assert.equal(resolveCountry("global gdp"), "WLD");
});

test("worldbank builds a dataset source from the series", async () => {
  let captured;
  const provider = new WorldBankProvider({
    fetchImpl: async (url) => {
      captured = url;
      return json([
        { page: 1, total: 2 },
        [
          {
            indicator: { id: "SP.POP.TOTL", value: "Population, total" },
            country: { id: "IT", value: "Italy" },
            date: "2023",
            value: 58850000
          },
          {
            indicator: { id: "SP.POP.TOTL", value: "Population, total" },
            country: { id: "IT", value: "Italy" },
            date: "2022",
            value: 58940000
          }
        ]
      ]);
    }
  });
  const out = await provider.search("italy population", { maxResults: 5 });
  assert.match(captured, /country\/IT\/indicator\/SP\.POP\.TOTL/);
  assert.equal(out.results[0].sourceType, "dataset");
  assert.match(out.results[0].content, /2023/);
  assert.equal(out.results[0].raw.indicator, "SP.POP.TOTL");
});

test("worldbank returns a warning when no indicator matches", async () => {
  const provider = new WorldBankProvider({
    fetchImpl: async () => json([{}, []])
  });
  const out = await provider.search("opinion about cats", {});
  assert.equal(out.results.length, 0);
  assert.match(out.warnings[0], /no World Bank indicator/);
});
