---
name: 9router
description: Entry point for 9Router — local/remote AI gateway with OpenAI-compatible REST for chat, image, TTS, embeddings, web search, web fetch. Use when the user mentions 9Router, NINEROUTER_URL, or wants AI without writing provider boilerplate. This skill covers setup + indexes capability skills; fetch the relevant capability SKILL.md from the URLs below when needed.
---

# 9Router

Local/remote AI gateway exposing OpenAI-compatible REST. One key, many providers, auto-fallback.

## Setup

```bash
export NINEROUTER_URL="http://127.0.0.1:3000"       # local compose maps host :3000 -> container :20128
export NINEROUTER_KEY="sk-..."                      # from Dashboard → Keys (only if requireApiKey=true)
```

All requests: `${NINEROUTER_URL}/v1/...` with header `Authorization: Bearer ${NINEROUTER_KEY}` (omit if auth disabled).

Verify: `curl $NINEROUTER_URL/api/health` → `{"ok":true}`

For a direct container binding without the local compose override, use `http://127.0.0.1:20128` instead. Cache statistics are usage telemetry, not a billing guarantee; inspect the live usage endpoint/dashboard for the selected period and route.

## Operational verification

Use the published host port `3000` for Claude/DSF/DSP aliases; use `20128` when testing the direct container binding. Check both health endpoints after a restart or image change:

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:20128/api/health
```

For cache telemetry, query the selected period rather than relying on a single request:

```bash
curl -fsS "$NINEROUTER_URL/api/usage/stats?period=24h"
```

The response exposes `totalCacheHitRatio`, `totalCacheCreationTokens`, and corresponding provider/model/account/API-key/endpoint fields. A zero value can mean a cold or changed session, missing upstream usage fields, or no cache-bearing requests; it is not by itself proof that upstream caching is disabled.

Run the repeat-request canary from the repository when a live cache check is needed:

```bash
ROUTER_API_KEY="$NINEROUTER_KEY" npm run cache:canary
```

The canary sends identical non-stream requests and passes only when a request after warmup reports read-cache tokens. Override `ROUTER_BASE_URL`, `ROUTER_MODEL`, `CACHE_CANARY_ATTEMPTS`, or `CACHE_CANARY_MIN_TOKENS` when testing another route. It never prints the API key or response content.

Cache hit rate is meaningful only when session/model/provider and the prompt prefix are stable. Compare repeated requests over the same period and route; do not treat the first warmup request, a provider header of `null`, or estimated cost as billing/provider-resolution proof.

For the current local image lineage and rollback rule, read [`9ROUTER_RUNTIME_PROVENANCE.md`](../../9ROUTER_RUNTIME_PROVENANCE.md) before rebuilding. Preserve the data volume and the upstream base tag; rebuilding from an older repository Dockerfile can silently downgrade the live runtime.

## Discover models

```bash
curl $NINEROUTER_URL/v1/models                  # chat/LLM (default)
curl $NINEROUTER_URL/v1/models/image            # image-gen
curl $NINEROUTER_URL/v1/models/tts              # text-to-speech
curl $NINEROUTER_URL/v1/models/embedding        # embeddings
curl $NINEROUTER_URL/v1/models/web              # web search + fetch (entries have `kind` field)
curl $NINEROUTER_URL/v1/models/stt              # speech-to-text
curl $NINEROUTER_URL/v1/models/image-to-text    # vision
```

Use `data[].id` as `model` field in requests. Combos appear with `owned_by:"combo"`.

Response shape:
```json
{ "object": "list", "data": [
  { "id": "openai/gpt-5", "object": "model", "owned_by": "openai", "created": 1735000000 },
  { "id": "tavily/search", "object": "model", "kind": "webSearch", "owned_by": "tavily", "created": 1735000000 }
]}
```

## Capability skills

When the user needs a specific capability, fetch that skill's `SKILL.md` from its raw URL:

| Capability | Raw URL |
|---|---|
| Chat / code-gen | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-image/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router-web-fetch/SKILL.md |

## Errors

- 401 → set/refresh `NINEROUTER_KEY` (Dashboard → Keys)
- 400 `Invalid model format` → check `model` exists in `/v1/models/<kind>`
- 503 `All accounts unavailable` → wait `retry-after` or add another provider account
- 403/404 from `activeOAuth` → treat as provider/account entitlement or upstream availability first; verify the affected account/model directly. Re-auth only the affected account when authorized. Restarting 9Router or clearing a temporary lock is not a root-cause fix.
- 400 with `tool_use` IDs missing immediate `tool_result` blocks → repair the conversation/tool-result pairing before retrying; this is a protocol-history issue, not a cache issue.
- `Connection refused` → check both `/api/health` endpoints, the published port mapping, and local firewall/proxy state before changing provider accounts.
