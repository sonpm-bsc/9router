import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// INFRA-789: SearXNG must be fetched with the plain (non-SSRF-guarded) fetch
// ONLY for the operator-configured origin (e.g. compose's
// SEARXNG_URL=http://host.docker.internal:8888/search, which resolves to a
// private IP on purpose). Any client-supplied provider_options.baseUrl must
// keep going through fetchPublic (DNS-resolved private-IP check + manual,
// re-validated redirects), and the trusted path must never follow redirects.

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns", () => ({
  default: { promises: { lookup: lookupMock } },
  promises: { lookup: lookupMock },
}));

const { handleSearchCore } = await import("../../open-sse/handlers/search/index.js");
const { clearSearchCache } = await import("../../open-sse/handlers/search/responseCache.js");

const PRIVATE_IP = "10.0.0.5";
const PUBLIC_IP = "93.184.216.34";
const METADATA_HOST = "169.254.169.254";
const COMPOSE_BASE = "http://host.docker.internal:8888/search";
const CORP_BASE = "http://searxng.corp.test:8888/search";

const SEARX_JSON = { results: [{ title: "Hello", url: "https://example.test/a", content: "snip" }] };

function jsonRes(body) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) };
}
function redirectRes(location) {
  return { ok: false, status: 302, headers: new Headers({ location }), json: async () => ({}), text: async () => "" };
}

/** dnsMap: hostname -> IPv4 (default public). Everything unlisted resolves public. */
function setDns(dnsMap = {}) {
  lookupMock.mockImplementation(async (host) => {
    const ip = dnsMap[host] ?? PUBLIC_IP;
    return [{ address: ip, family: 4 }];
  });
}

/**
 * fetch stand-in that emulates the platform: redirect "follow" (the default
 * when the option is absent) chases Location, "error" throws on 3xx,
 * "manual" returns the 3xx untouched.
 */
function installFetch(route) {
  const calls = [];
  const fetchMock = vi.fn(async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, redirect: init.redirect });
    const res = route(u);
    const isRedirect = res.status >= 300 && res.status < 400;
    const mode = init.redirect ?? "follow";
    if (isRedirect && mode === "error") throw new TypeError("fetch failed: unexpected redirect");
    if (isRedirect && mode === "follow") return fetchMock(new URL(res.headers.get("location"), u).toString(), init);
    return res;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function searxngProvider(baseUrl) {
  return {
    provider: { id: "searxng" },
    providerConfig: {
      baseUrl,
      method: "GET",
      authType: "none",
      defaultMaxResults: 5,
      maxMaxResults: 50,
      timeoutMs: 10000,
    },
  };
}

async function search({ configBase, override, log }) {
  const { provider, providerConfig } = searxngProvider(configBase);
  const body = { query: "ssrf probe", max_results: 3, search_type: "web" };
  if (override !== undefined) body.provider_options = { baseUrl: override };
  return handleSearchCore({ body, provider, providerConfig, credentials: null, log });
}

const hostOf = (u) => new URL(u).hostname;

beforeEach(() => {
  lookupMock.mockReset();
  clearSearchCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("INFRA-789 exploit attempts via client-controlled provider_options.baseUrl (must be blocked)", () => {
  it("case 1: public hostname that resolves to a private IP is never fetched", async () => {
    setDns({ "rebind.evil.test": PRIVATE_IP });
    const { calls } = installFetch(() => jsonRes(SEARX_JSON));
    const r = await search({ configBase: COMPOSE_BASE, override: "http://rebind.evil.test/search" });
    expect(calls.filter((c) => hostOf(c.url) === "rebind.evil.test")).toEqual([]);
    expect(r.success).toBe(false);
  });

  it("case 2: wildcard-DNS metadata hostname (169.254.169.254.nip.io) is never fetched", async () => {
    setDns({ [`${METADATA_HOST}.nip.io`]: METADATA_HOST });
    const { calls } = installFetch(() => jsonRes(SEARX_JSON));
    const r = await search({ configBase: COMPOSE_BASE, override: `http://${METADATA_HOST}.nip.io/search` });
    expect(calls).toEqual([]);
    expect(r.success).toBe(false);
  });

  it("case 3: a public URL that 302s to the metadata service is not followed", async () => {
    setDns({});
    const { calls } = installFetch((u) =>
      hostOf(u) === METADATA_HOST
        ? jsonRes({ results: [{ title: "SECRET-METADATA", url: "https://x.test" }] })
        : redirectRes(`http://${METADATA_HOST}/latest/meta-data`)
    );
    const r = await search({ configBase: COMPOSE_BASE, override: "http://public.evil.test/search" });
    expect(calls.filter((c) => hostOf(c.url) === METADATA_HOST)).toEqual([]);
    expect(JSON.stringify(r.data ?? {})).not.toContain("SECRET-METADATA");
    expect(r.success).toBe(false);
  });
});

describe("INFRA-789 operator-configured SearXNG origin (must keep working)", () => {
  it("case A1: configured host.docker.internal (private IP) is fetched once with redirect:'error', fetchPublic unused", async () => {
    setDns({ "host.docker.internal": PRIVATE_IP });
    const { calls } = installFetch(() => jsonRes(SEARX_JSON));
    const r = await search({ configBase: COMPOSE_BASE });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith("http://host.docker.internal:8888/search?")).toBe(true);
    expect(calls[0].redirect).toBe("error");
    expect(lookupMock).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.data.results).toHaveLength(1);
    expect(r.data.results[0].title).toBe("Hello");
  });

  it("case A1b: a redirect from the trusted origin is rejected, not followed", async () => {
    setDns({ "host.docker.internal": PRIVATE_IP });
    const { calls } = installFetch((u) =>
      hostOf(u) === METADATA_HOST ? jsonRes(SEARX_JSON) : redirectRes(`http://${METADATA_HOST}/x`)
    );
    const r = await search({ configBase: COMPOSE_BASE });
    expect(calls.filter((c) => hostOf(c.url) === METADATA_HOST)).toEqual([]);
    expect(r.success).toBe(false);
  });

  it("case A2: a public override on a different origin goes through fetchPublic (DNS checked, redirect:'manual')", async () => {
    setDns({ "host.docker.internal": PRIVATE_IP });
    const { calls } = installFetch(() => jsonRes(SEARX_JSON));
    const r = await search({ configBase: COMPOSE_BASE, override: "https://searx.public.test/search" });
    expect(lookupMock).toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0].redirect).toBe("manual");
    expect(r.success).toBe(true);
  });

  it("case A3: an unparseable configured baseUrl falls back to fetchPublic and logs", async () => {
    setDns({});
    const { calls } = installFetch(() => jsonRes(SEARX_JSON));
    const log = { info: vi.fn(), error: vi.fn() };
    const r = await search({ configBase: "not a url", log });
    expect(calls).toEqual([]);
    expect(r.success).toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it("case A4: an override on the SAME origin as the configured one is trusted but still redirect:'error'", async () => {
    setDns({ "searxng.corp.test": PRIVATE_IP });
    const { calls } = installFetch(() => jsonRes(SEARX_JSON));
    const r = await search({ configBase: CORP_BASE, override: "http://searxng.corp.test:8888/alt" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.startsWith("http://searxng.corp.test:8888/alt/search?")).toBe(true);
    expect(calls[0].redirect).toBe("error");
    expect(lookupMock).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
  });
});

describe("INFRA-789 look-alike origins are not the operator origin (must be blocked)", () => {
  const privateDns = {
    "host.docker.internal.evil.test": PRIVATE_IP,
    "searxng.corp.test": PRIVATE_IP,
    "searxng.corp.test.evil.test": PRIVATE_IP,
  };

  const cases = [
    ["suffix host host.docker.internal.evil.test", COMPOSE_BASE, "http://host.docker.internal.evil.test:8888/search"],
    ["different port", CORP_BASE, "http://searxng.corp.test:9999/search"],
    ["different scheme", CORP_BASE, "https://searxng.corp.test:8888/search"],
    ["userinfo on the operator host", CORP_BASE, "http://user:pw@searxng.corp.test:8888/search"],
    ["trailing-dot FQDN", CORP_BASE, "http://searxng.corp.test.:8888/search"],
    ["operator host as a prefix of an attacker host (no port)", "http://searxng.corp.test/search", "http://searxng.corp.test.evil.test/search"],
    ["IPv6 literal (ULA) override", CORP_BASE, "http://[fd00::6]:8888/search"],
  ];

  for (const [name, configBase, override] of cases) {
    it(`blocks ${name}`, async () => {
      setDns(privateDns);
      const { calls } = installFetch(() => jsonRes(SEARX_JSON));
      const r = await search({ configBase, override });
      expect(calls).toEqual([]);
      expect(r.success).toBe(false);
    });
  }

  it("IPv6 operator origin is trusted only for exactly that origin", async () => {
    setDns({});
    const { calls } = installFetch(() => jsonRes(SEARX_JSON));
    const ok = await search({ configBase: "http://[fd00::5]:8888/search" });
    expect(ok.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].redirect).toBe("error");
    const bad = await search({ configBase: "http://[fd00::5]:8888/search", override: "http://[fd00::6]:8888/search" });
    expect(bad.success).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
