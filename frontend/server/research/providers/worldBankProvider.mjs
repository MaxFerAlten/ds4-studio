import { BaseSearchProvider, timeoutSignal } from "./baseSearchProvider.mjs";

const DEFAULT_API = "https://api.worldbank.org/v2";

const INDICATORS = [
  [["population", "popolazione", "inhabitants"], "SP.POP.TOTL"],
  [["gdp", "pil", "gross domestic"], "NY.GDP.MKTP.CD"],
  [["inflation", "inflazione", "cpi"], "FP.CPI.TOTL.ZG"],
  [["life expectancy", "aspettativa di vita"], "SP.DYN.LE00.IN"],
  [["unemployment", "disoccupazione"], "SL.UEM.TOTL.ZS"],
  [["co2", "emissions", "emissioni"], "EN.ATM.CO2E.PC"]
];

const COUNTRIES = [
  [["italy", "italia"], "IT"],
  [["germany", "germania"], "DE"],
  [["france", "francia"], "FR"],
  [["spain", "spagna"], "ES"],
  [["united states", "usa", "u.s."], "US"],
  [["china", "cina"], "CN"],
  [["india"], "IN"],
  [["japan", "giappone"], "JP"],
  [["united kingdom", "uk"], "GB"],
  [["brazil", "brasile"], "BR"]
];

function matchTable(text, table, fallback) {
  const query = String(text || "").toLowerCase();
  for (const [terms, code] of table) {
    if (terms.some((term) => query.includes(term))) return code;
  }
  return fallback;
}

export function resolveIndicator(query) {
  return matchTable(query, INDICATORS, null);
}

export function resolveCountry(query) {
  return matchTable(query, COUNTRIES, "WLD");
}

export class WorldBankProvider extends BaseSearchProvider {
  name() {
    return "worldbank";
  }

  supports() {
    return ["DATA_ANALYSIS", "GENERAL_RESEARCH"];
  }

  async search(query, { maxResults = 10, signal, timeoutMs } = {}) {
    const indicator = resolveIndicator(query);
    if (!indicator) {
      return {
        provider: "worldbank",
        query,
        results: [],
        warnings: ["no World Bank indicator matched the query"]
      };
    }

    const country = resolveCountry(query);
    const api = this.config.endpoint || DEFAULT_API;
    const url = `${api}/country/${country}/indicator/${indicator}?format=json&per_page=${maxResults}`;
    const res = await this.fetchImpl(url, {
      signal: timeoutSignal(signal, timeoutMs)
    });
    if (!res.ok) throw new Error(`worldbank HTTP ${res.status}`);

    const data = await res.json();
    const series = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
    if (!series.length) {
      return {
        provider: "worldbank",
        query,
        results: [],
        warnings: ["no World Bank data returned"]
      };
    }

    const label = series[0].indicator?.value || indicator;
    const countryName = series[0].country?.value || country;
    const points = series
      .filter((point) => point.value !== null)
      .map((point) => `${point.date}: ${point.value}`)
      .join(", ");
    const result = {
      provider: "worldbank",
      platform: "DATA_ANALYSIS",
      sourceType: "dataset",
      title: `${label} - ${countryName} (World Bank)`,
      url: `https://data.worldbank.org/indicator/${indicator}?locations=${country}`,
      snippet: points.slice(0, 400),
      content: `${label} for ${countryName}: ${points}`,
      providerRank: 1,
      raw: { indicator, country, points: series.length }
    };
    return {
      provider: "worldbank",
      query,
      results: [result],
      warnings: []
    };
  }
}
