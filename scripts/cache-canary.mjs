#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://127.0.0.1:20128";
const DEFAULT_MODEL = "openrouter/deepseek/deepseek-v4.1-flash";
const DEFAULT_ATTEMPTS = 2;
const DEFAULT_MIN_CACHE_TOKENS = 1;
const CACHE_KEY = "9router-cache-canary-v1";
const STABLE_PROMPT = [
  "This is a deterministic cache telemetry canary. Reply with exactly OK.",
  "The request is intentionally repeated so the upstream cache can be measured.",
  "Stable prefix: ",
  "cache-stability ".repeat(512),
].join(" ");

function printHelp() {
  console.log(`Usage: ROUTER_API_KEY=... npm run cache:canary [options]

Options:
  --base-url URL             9Router base URL (default: ROUTER_BASE_URL or ${DEFAULT_BASE_URL})
  --model MODEL              Model (default: ROUTER_MODEL or ${DEFAULT_MODEL})
  --attempts N               Repeated requests (default: CACHE_CANARY_ATTEMPTS or ${DEFAULT_ATTEMPTS})
  --min-cache-tokens N       Required read-cache tokens (default: CACHE_CANARY_MIN_TOKENS or ${DEFAULT_MIN_CACHE_TOKENS})
  --help                     Show this help

The API key is never printed. Exit 0 means at least one attempt met the cache threshold.
`);
}

function readOptions(argv) {
  const options = {
    baseUrl: process.env.ROUTER_BASE_URL || DEFAULT_BASE_URL,
    model: process.env.ROUTER_MODEL || DEFAULT_MODEL,
    attempts: Number(process.env.CACHE_CANARY_ATTEMPTS || DEFAULT_ATTEMPTS),
    minCacheTokens: Number(process.env.CACHE_CANARY_MIN_TOKENS || DEFAULT_MIN_CACHE_TOKENS),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") return { help: true };
    const next = argv[i + 1];
    if (arg === "--base-url") options.baseUrl = next, i += 1;
    else if (arg === "--model") options.model = next, i += 1;
    else if (arg === "--attempts") options.attempts = Number(next), i += 1;
    else if (arg === "--min-cache-tokens") options.minCacheTokens = Number(next), i += 1;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isInteger(options.attempts) || options.attempts < 2 || options.attempts > 10) {
    throw new Error("attempts must be an integer between 2 and 10");
  }
  if (!Number.isInteger(options.minCacheTokens) || options.minCacheTokens < 1) {
    throw new Error("min-cache-tokens must be a positive integer");
  }
  return options;
}

function usageValues(body, headers) {
  const usage = body?.usage || {};
  const cacheReadTokens = Number(
    usage.cache_read_input_tokens
      ?? usage.cached_tokens
      ?? usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens
      ?? 0,
  ) || 0;
  const cacheCreationTokens = Number(
    usage.cache_creation_input_tokens
      ?? usage.prompt_tokens_details?.cache_creation_tokens
      ?? 0,
  ) || 0;
  return {
    status: headers.status,
    cacheReadTokens,
    cacheCreationTokens,
    inputTokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0,
    upstreamProvider: headers.upstreamProvider || null,
  };
}

async function run() {
  const options = readOptions(process.argv.slice(2));
  if (options.help) return printHelp();

  const apiKey = process.env.ROUTER_API_KEY;
  if (!apiKey) throw new Error("ROUTER_API_KEY is required");

  const endpoint = `${String(options.baseUrl).replace(/\/+$/, "")}/v1/messages`;
  const attempts = [];
  for (let i = 0; i < options.attempts; i += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        max_tokens: 1,
        temperature: 0,
        stream: false,
        prompt_cache_key: CACHE_KEY,
        messages: [{ role: "user", content: STABLE_PROMPT }],
      }),
    });
    let body = null;
    try { body = await response.json(); } catch {}
    attempts.push(usageValues(body, {
      status: response.status,
      upstreamProvider: response.headers.get("x-openrouter-provider") || response.headers.get("x-provider-name"),
    }));
  }

  const warmup = attempts[0];
  const repeatAttempts = attempts.slice(1);
  const cacheReadTokens = Math.max(...attempts.map((item) => item.cacheReadTokens));
  const repeatCacheReadTokens = Math.max(...repeatAttempts.map((item) => item.cacheReadTokens));
  const cacheCreationTokens = Math.max(...attempts.map((item) => item.cacheCreationTokens));
  // The first request may be pre-warmed by an earlier run. Require a hit on
  // an attempt after warmup so this canary verifies repeat-cache behavior.
  const cacheHit = repeatCacheReadTokens >= options.minCacheTokens;
  console.log(JSON.stringify({
    ok: cacheHit,
    endpoint,
    model: options.model,
    warmup,
    attempts,
    cacheReadTokens,
    repeatCacheReadTokens,
    cacheCreationTokens,
    cacheHit,
    minCacheTokens: options.minCacheTokens,
  }));
  if (!cacheHit) process.exitCode = 1;
}

run().catch((error) => {
  console.error(`[cache-canary] ${error.message}`);
  process.exitCode = 2;
});
