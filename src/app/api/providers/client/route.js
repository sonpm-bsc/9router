import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { backfillCodexEmails } from "@/lib/oauth/providers";
import { USAGE_APIKEY_PROVIDERS, USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";

const SAFE_FIELDS = [
  "id", "provider", "authType", "name", "email", "displayName",
  "priority", "globalPriority", "isActive", "defaultModel",
  "testStatus", "lastError", "lastErrorAt", "errorCode",
  "expiresAt", "lastUsedAt", "consecutiveUseCount",
  "createdAt", "updatedAt",
];

const SAFE_PSD_FIELDS = [
  "baseUrl", "azureEndpoint", "deployment", "apiVersion", "accountId",
  "region", "projectId", "resourceUrl", "proxyPoolId",
  "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy",
  "githubLogin", "githubName", "githubEmail", "githubUserId",
  "username", "firstName", "lastName", "authMethod", "authKind",
  "profileArn",
];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 500;

function maskName(name) {
  if (typeof name !== "string" || name.length <= 16) return name;
  if (/[a-zA-Z0-9_-]{32,}/.test(name)) return `${name.slice(0, 8)}***`;
  return name;
}

const MODEL_LOCK_PREFIX = "modelLock_";

// Surface active per-model rate-limit cooldowns (not raw secrets) so the usage
// dashboard can show the real routing-lock state instead of only the
// provider's own (sometimes non-live) quota-listing API.
function activeModelLocks(c) {
  const now = Date.now();
  const locks = {};
  for (const [key, value] of Object.entries(c)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !value) continue;
    const untilMs = new Date(value).getTime();
    if (Number.isFinite(untilMs) && untilMs > now) {
      locks[key.slice(MODEL_LOCK_PREFIX.length)] = value;
    }
  }
  if (Object.keys(locks).length === 0) return null;
  return expandModelLockAliases(c.provider, locks);
}

// The routing lock is keyed by the raw upstream model id (e.g. the single
// upstream tier several friendly display models share), not by the friendly
// model id shown in quota rows. Expand so a dashboard can look up a lock by
// either key without needing its own copy of the provider's model registry.
function expandModelLockAliases(provider, rawLocks) {
  const models = getModelsByProviderId(provider);
  if (!Array.isArray(models) || models.length === 0) return rawLocks;
  const expanded = { ...rawLocks };
  for (const m of models) {
    if (m?.upstreamModelId && m?.id && rawLocks[m.upstreamModelId] !== undefined && expanded[m.id] === undefined) {
      expanded[m.id] = rawLocks[m.upstreamModelId];
    }
  }
  return expanded;
}

export function sanitize(c) {
  const safe = {};
  for (const f of SAFE_FIELDS) if (c[f] !== undefined) safe[f] = c[f];
  if (safe.name) safe.name = maskName(safe.name);
  if (c.providerSpecificData) {
    const psd = {};
    for (const f of SAFE_PSD_FIELDS) {
      if (c.providerSpecificData[f] !== undefined) psd[f] = c.providerSpecificData[f];
    }
    safe.providerSpecificData = psd;
  }
  const locks = activeModelLocks(c);
  if (locks) safe.activeModelLocks = locks;
  return safe;
}

function isUsageEligible(connection) {
  return USAGE_SUPPORTED_PROVIDERS.includes(connection.provider) && (
    connection.authType === "oauth" || USAGE_APIKEY_PROVIDERS.includes(connection.provider)
  );
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sortConnections(connections, sort) {
  const list = [...connections];

  if (sort === "provider") {
    return list.sort((a, b) => {
      const orderA = USAGE_SUPPORTED_PROVIDERS.indexOf(a.provider);
      const orderB = USAGE_SUPPORTED_PROVIDERS.indexOf(b.provider);
      if (orderA !== orderB) return orderA - orderB;
      return a.provider.localeCompare(b.provider);
    });
  }

  return list.sort((a, b) => {
    const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
    const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return (a.provider || "").localeCompare(b.provider || "");
  });
}

export async function GET(request) {
  try {
    await backfillCodexEmails();

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || "all";
    const accountStatus = searchParams.get("accountStatus") || "all";
    const sort = searchParams.get("sort") || "priority";
    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = Math.min(parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

    const allConnections = await getProviderConnections();
    const eligibleConnections = allConnections.filter(isUsageEligible);
    const providerOptions = Array.from(new Set(eligibleConnections.map((conn) => conn.provider))).sort();

    const providerFilteredConnections = eligibleConnections.filter((conn) => (
      provider === "all" || conn.provider === provider
    ));

    const accountFilteredConnections = providerFilteredConnections.filter((conn) => {
      if (accountStatus === "active") return conn.isActive ?? true;
      if (accountStatus === "inactive") return !(conn.isActive ?? true);
      return true;
    });

    const sortedConnections = sortConnections(accountFilteredConnections, sort);
    const total = sortedConnections.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;
    const pageConnections = sortedConnections.slice(offset, offset + pageSize).map(sanitize);

    return NextResponse.json({
      connections: pageConnections,
      providerOptions,
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
      totals: {
        eligibleConnections: eligibleConnections.length,
        providerFilteredConnections: providerFilteredConnections.length,
      },
    });
  } catch (error) {
    console.log("Error fetching providers for client:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}
