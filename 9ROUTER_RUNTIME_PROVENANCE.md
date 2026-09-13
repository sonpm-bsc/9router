# 9Router runtime provenance

## Current local deployment

- Image: `9router:cachefix-openrouter-session-20260913-v075-r5`
- Runtime package line: `0.5.75`
- Build base: verified local r4 overlay from upstream tag `v0.5.75`
- Data volume: `9router-data` mounted at `/app/data`
- Compose source: `docker-compose.local.yml`

This is a local overlay image, not a registry release. The repository `main`
lineage is older (`0.5.55`) than the deployed upstream base; do not rebuild
from the repository Dockerfile and silently downgrade the live runtime.

## Rebuild rule

1. Start from the exact upstream tag `v0.5.75` in a separate worktree; the
   verified r3 image already contains that base plus the committed cache-
   telemetry overlay.
2. Apply the deterministic input-overflow fallback guard and the committed
   OpenRouter executor/session-key files as thin runtime overlays.
3. Run the focused usage tests and `node --check` before building.
4. Build a new date/revision image tag and update `docker-compose.local.yml`.
5. Preserve `9router-data`, keep the previous image/container as rollback, and
   verify `/api/health` plus `npm run cache:canary` after restart.

## Rollback

Keep the previous known-good images `9router:cachefix-claude-usage-20260913-v075-r4`,
`9router:cachefix-claude-usage-20260912-v075-r3`, and
`9router:cachefix-claude-usage-20260912-v075-r2` available locally. Roll back by
restoring any of them while preserving the
`9router-data` volume; do not change provider priorities or OAuth account state.
