import test from "node:test";
import assert from "node:assert/strict";
import { TripAdvisorProvider } from "./tripAdvisorProvider.mjs";

test("tripadvisor is unconfigured without both key and endpoint", () => {
  assert.equal(new TripAdvisorProvider({}).isConfigured(), false);
  assert.equal(new TripAdvisorProvider({ apiKey: "k" }).isConfigured(), false);
  assert.equal(
    new TripAdvisorProvider({
      apiKey: "k",
      config: { endpoint: "https://api.x" }
    }).isConfigured(),
    true
  );
});

test("tripadvisor returns an explanatory warning instead of scraping", async () => {
  let fetched = false;
  const provider = new TripAdvisorProvider({
    fetchImpl: async () => {
      fetched = true;
      return new Response("{}");
    }
  });
  const out = await provider.search("hotels in Rome", {});
  assert.equal(out.results.length, 0);
  assert.match(out.warnings[0], /official API/);
  assert.equal(fetched, false, "must not fetch or scrape when unconfigured");
});

test("tripadvisor normalizes official Content API results when configured", async () => {
  let captured;
  const provider = new TripAdvisorProvider({
    apiKey: "k",
    config: {
      endpoint: "https://api.content.tripadvisor.com/api/v1/location/search"
    },
    fetchImpl: async (url) => {
      captured = url;
      return new Response(
        JSON.stringify({
          data: [
            {
              location_id: "1",
              name: "Hotel X",
              address_obj: { address_string: "Rome" }
            }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  });
  const out = await provider.search("hotels in Rome", {});
  assert.match(captured, /key=k/);
  assert.match(captured, /searchQuery=hotels%20in%20Rome/);
  assert.match(captured, /language=en/);
  assert.equal(out.results[0].title, "Hotel X");
  assert.equal(out.results[0].sourceType, "travel");
});
