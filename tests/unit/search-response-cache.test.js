import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import { clearSearchCache } from "../../open-sse/handlers/search/responseCache.js";

const provider = {
  id: "searxng",
  searchConfig: {
    baseUrl: "http://searxng.test/search",
    method: "GET",
    authType: "none",
    defaultMaxResults: 5,
    maxMaxResults: 50,
    timeoutMs: 10000,
    responseCache: true,
    cacheTTLMs: 180000
  }
};

const body = {
  query: "  cache me   please ",
  max_results: 2,
  search_type: "web",
  language: "en"
};

function upstreamResponse(results = [{ title: "Result", url: "https://example.test" }]) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({ results })
  };
}

afterEach(() => {
  clearSearchCache();
  vi.restoreAllMocks();
});

describe("SearXNG response cache", () => {
  it("serves a repeated normalized query from cache and reports cache_hit", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(upstreamResponse());
    vi.stubGlobal("fetch", fetch);

    const first = await handleSearchCore({ body, provider, providerConfig: provider.searchConfig, credentials: null });
    const second = await handleSearchCore({ body: { ...body, query: "cache me please" }, provider, providerConfig: provider.searchConfig, credentials: null });

    expect(first.success).toBe(true);
    const firstPayload = await first.response.json();
    expect(firstPayload.metrics.cache_hit).toBe(false);
    expect(second.success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    const secondPayload = await second.response.json();
    expect(secondPayload.metrics.cache_hit).toBe(true);
    expect(secondPayload.metrics.upstream_latency_ms).toBe(0);
    expect(secondPayload.results).toHaveLength(1);
  });

  it("does not cache empty responses", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(upstreamResponse([]))
      .mockResolvedValueOnce(upstreamResponse([]));
    vi.stubGlobal("fetch", fetch);

    await handleSearchCore({ body, provider, providerConfig: provider.searchConfig, credentials: null });
    const second = await handleSearchCore({ body, provider, providerConfig: provider.searchConfig, credentials: null });

    expect(fetch).toHaveBeenCalledTimes(2);
    const payload = await second.response.json();
    expect(payload.metrics.cache_hit).toBe(false);
  });

  it("does not cache upstream errors", async () => {
    const upstreamError = {
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue("temporarily unavailable")
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(upstreamError)
      .mockResolvedValueOnce(upstreamError);
    vi.stubGlobal("fetch", fetch);

    const first = await handleSearchCore({ body, provider, providerConfig: provider.searchConfig, credentials: null });
    const second = await handleSearchCore({ body, provider, providerConfig: provider.searchConfig, credentials: null });

    expect(first.success).toBe(false);
    expect(second.success).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("expires entries at the configured TTL", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue(upstreamResponse());
    vi.stubGlobal("fetch", fetch);

    await handleSearchCore({ body, provider, providerConfig: provider.searchConfig, credentials: null });
    vi.advanceTimersByTime(provider.searchConfig.cacheTTLMs + 1);
    const second = await handleSearchCore({ body, provider, providerConfig: provider.searchConfig, credentials: null });

    expect(fetch).toHaveBeenCalledTimes(2);
    const payload = await second.response.json();
    expect(payload.metrics.cache_hit).toBe(false);
    vi.useRealTimers();
  });
});
