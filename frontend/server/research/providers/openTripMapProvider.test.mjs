import test from "node:test";
import assert from "node:assert/strict";
import { OpenTripMapProvider } from "./providers.mjs";

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

test("opentripmap requires a key", () => {
  assert.equal(
    new OpenTripMapProvider({ fetchImpl: async () => json({}) }).isConfigured(),
    false
  );
});

test("opentripmap geocodes then lists nearby places", async () => {
  const urls = [];
  const provider = new OpenTripMapProvider({
    apiKey: "k",
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("/geoname")) {
        return json({ name: "Rome", lat: 41.9, lon: 12.5, country: "IT" });
      }
      return json({
        features: [
          {
            properties: {
              xid: "X1",
              name: "Colosseum",
              kinds: "historic,architecture",
              rate: 7
            },
            geometry: { coordinates: [12.49, 41.89] }
          },
          {
            properties: {
              xid: "X2",
              name: "",
              kinds: "tourist",
              rate: 1
            },
            geometry: { coordinates: [12.5, 41.9] }
          }
        ]
      });
    }
  });
  const out = await provider.search("attractions in Rome", { maxResults: 5 });
  assert.ok(urls[0].includes("/geoname"));
  assert.ok(urls[1].includes("/radius"));
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].title, "Colosseum");
  assert.equal(out.results[0].sourceType, "travel");
  assert.equal(out.results[0].raw.xid, "X1");
});

test("opentripmap warns when the location cannot be geocoded", async () => {
  const provider = new OpenTripMapProvider({
    apiKey: "k",
    fetchImpl: async () => json({ error: "not found" })
  });
  const out = await provider.search("attractions in Atlantis", {});
  assert.equal(out.results.length, 0);
  assert.match(out.warnings[0], /could not geocode/);
});
