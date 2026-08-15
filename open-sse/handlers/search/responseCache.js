const MAX_ENTRIES = 256;
const entries = new Map();

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildSearchCacheKey({ providerId, baseUrl, params }) {
  return stableSerialize({ providerId, baseUrl, params });
}

export function getSearchCache(key, now = Date.now()) {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    entries.delete(key);
    return null;
  }

  // Keep callers from mutating the cached response shared by later requests.
  return structuredClone(entry.data);
}

export function setSearchCache(key, data, ttlMs, now = Date.now()) {
  if (!key || !Number.isFinite(ttlMs) || ttlMs <= 0) return;
  if (entries.size >= MAX_ENTRIES && !entries.has(key)) {
    entries.delete(entries.keys().next().value);
  }
  entries.set(key, { data: structuredClone(data), expiresAt: now + ttlMs });
}

export function clearSearchCache() {
  entries.clear();
}

export const SEARCH_CACHE_MAX_ENTRIES = MAX_ENTRIES;
