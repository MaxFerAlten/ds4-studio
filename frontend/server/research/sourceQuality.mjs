// Source quality classification for scientific bibliographies. Deterministic,
// dependency-free. Each source is placed in a tier and flagged citable:
//   tier 1 — scholarly/authoritative (peer-reviewed, DOI, .edu/.gov, academic
//            providers, uploaded files): always citable.
//   tier 2 — general/contextual (encyclopedias, news, org docs): usable as
//            background but NOT in a scientific bibliography.
//   tier 3 — unsuitable for a publication (social, forums, blogs, SEO tutorials,
//            marketing): never citable.
// In "scientific" mode only tier 1 is citable; in "general" mode tiers 1-2 are.

const ACADEMIC_PROVIDERS = new Set(["arxiv", "cnr", "openalex", "googlescholar"]);
const TIER1_SOURCE_TYPES = new Set(["paper", "dataset"]);
const TIER3_SOURCE_TYPES = new Set(["blog", "forum", "social"]);

// Scholarly / authoritative hosts (exact or as a parent suffix).
const TIER1_HOSTS = new Set([
  "doi.org", "dx.doi.org", "arxiv.org", "biorxiv.org", "medrxiv.org",
  "ncbi.nlm.nih.gov", "pubmed.ncbi.nlm.nih.gov", "pmc.ncbi.nlm.nih.gov",
  "nature.com", "science.org", "sciencedirect.com", "springer.com", "link.springer.com",
  "ieee.org", "ieeexplore.ieee.org", "acm.org", "dl.acm.org", "jstor.org",
  "semanticscholar.org", "aps.org", "journals.aps.org", "iop.org", "iopscience.iop.org",
  "mdpi.com", "plos.org", "journals.plos.org", "frontiersin.org", "wiley.com",
  "onlinelibrary.wiley.com", "tandfonline.com", "sagepub.com", "cambridge.org",
  "oup.com", "academic.oup.com", "royalsocietypublishing.org", "pnas.org", "cell.com",
  "thelancet.com", "bmj.com", "elsevier.com", "openalex.org", "publications.cnr.it",
  "w3.org", "rfc-editor.org", "ietf.org", "iso.org"
]);

// Unsuitable for a scientific reference list.
const TIER3_HOSTS = new Set([
  "twitter.com", "x.com", "facebook.com", "instagram.com", "tiktok.com",
  "youtube.com", "youtu.be", "linkedin.com", "reddit.com", "pinterest.com", "t.me",
  "quora.com", "stackoverflow.com", "stackexchange.com", "superuser.com", "serverfault.com",
  "medium.com", "substack.com", "dev.to", "hashnode.com", "blogspot.com",
  "wordpress.com", "tumblr.com", "wixsite.com",
  "w3schools.com", "geeksforgeeks.org", "tutorialspoint.com", "javatpoint.com", "programiz.com",
  "slideshare.net", "scribd.com", "coursehero.com", "studocu.com"
]);

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// True if host equals or is a subdomain of any host in the set.
function hostInSet(host, set) {
  if (!host) return false;
  if (set.has(host)) return true;
  for (const h of set) if (host.endsWith(`.${h}`)) return true;
  return false;
}

function isTier1Host(host) {
  if (!host) return false;
  if (host.endsWith(".edu") || host.endsWith(".gov") || host.endsWith(".int")) return true;
  if (/\.ac\.[a-z]{2,}$/.test(host)) return true; // .ac.uk, .ac.jp, ...
  return hostInSet(host, TIER1_HOSTS);
}

export function classifySource(source = {}, config = {}) {
  const mode = config.mode === "general" ? "general" : "scientific";
  const allow = new Set((config.allowDomains || []).map((d) => String(d).toLowerCase()));
  const deny = new Set((config.denyDomains || []).map((d) => String(d).toLowerCase()));
  const url = source.url || "";
  const host = domainOf(url);
  const sourceType = String(source.sourceType || "").toLowerCase();
  const hasDoi = /(^|\/\/|\.)doi\.org\//.test(url) || /\bdoi\.org\b/.test(url);
  const academicProvider =
    ACADEMIC_PROVIDERS.has(source.provider) ||
    (Array.isArray(source.providers) && source.providers.some((p) => ACADEMIC_PROVIDERS.has(p)));

  let tier;
  if (
    source.kind === "file" || // user-provided documents are trusted references
    academicProvider ||
    TIER1_SOURCE_TYPES.has(sourceType) ||
    hasDoi ||
    (host && (isTier1Host(host) || allow.has(host)))
  ) {
    tier = 1;
  } else if (TIER3_SOURCE_TYPES.has(sourceType) || (host && (hostInSet(host, deny) || hostInSet(host, TIER3_HOSTS)))) {
    tier = 3;
  } else {
    tier = 2;
  }

  const citable = tier === 1 || (mode === "general" && tier === 2);
  return { tier, citable };
}
