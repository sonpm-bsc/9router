import { describe, expect, it } from "vitest";
import { sanitize } from "../../src/app/api/providers/client/route.js";

const futureIso = (ms) => new Date(Date.now() + ms).toISOString();
const pastIso = (ms) => new Date(Date.now() - ms).toISOString();

describe("providers/client sanitize: real cooldown lock surfacing", () => {
  // A provider id with no model registry entry keeps these cases focused on the
  // surfacing/redaction behavior itself, independent of any alias expansion.
  const NEUTRAL_PROVIDER = "not-a-registered-provider";

  it("surfaces an active modelLock_* key as activeModelLocks, stripped of the prefix", () => {
    const until = futureIso(30 * 60 * 1000);
    const conn = { id: "c1", provider: NEUTRAL_PROVIDER, [`modelLock_some-upstream-id`]: until };

    const safe = sanitize(conn);

    expect(safe.activeModelLocks).toEqual({ "some-upstream-id": until });
  });

  it("omits expired modelLock_* keys", () => {
    const conn = { id: "c1", provider: NEUTRAL_PROVIDER, [`modelLock_some-upstream-id`]: pastIso(60_000) };

    const safe = sanitize(conn);

    expect(safe.activeModelLocks).toBeUndefined();
  });

  it("omits activeModelLocks entirely when there are no lock keys", () => {
    const conn = { id: "c1", provider: NEUTRAL_PROVIDER, name: "acct@example.com" };

    const safe = sanitize(conn);

    expect(safe.activeModelLocks).toBeUndefined();
  });

  it("never leaks raw secret fields alongside the lock summary", () => {
    const conn = {
      id: "c1", provider: NEUTRAL_PROVIDER, accessToken: "secret-token", refreshToken: "secret-refresh",
      [`modelLock_some-upstream-id`]: futureIso(60_000),
    };

    const safe = sanitize(conn);

    expect(safe.accessToken).toBeUndefined();
    expect(safe.refreshToken).toBeUndefined();
    expect(safe.activeModelLocks).toEqual({ "some-upstream-id": conn[`modelLock_some-upstream-id`] });
  });

  it("expands a raw upstream lock to every antigravity friendly model id that shares it", () => {
    // gemini-3.8-flash and gemini-3.8-flash-medium both resolve to the same
    // upstreamModelId ("gemini-3.8-flash-medium(medium)") in the registry.
    const until = futureIso(30 * 60 * 1000);
    const conn = { id: "c1", provider: "antigravity", [`modelLock_gemini-3.8-flash-medium(medium)`]: until };

    const safe = sanitize(conn);

    expect(safe.activeModelLocks).toEqual({
      "gemini-3.8-flash-medium(medium)": until,
      "gemini-3.8-flash-medium": until,
      "gemini-3.8-flash": until,
    });
  });

  it("does not expand aliases for a non-antigravity provider", () => {
    const until = futureIso(30 * 60 * 1000);
    const conn = { id: "c1", provider: "codex", [`modelLock_some-upstream-id`]: until };

    const safe = sanitize(conn);

    expect(safe.activeModelLocks).toEqual({ "some-upstream-id": until });
  });

  it("surfaces multiple simultaneous locks, including the account-wide ___all key", () => {
    const untilTiered = futureIso(90_000);
    const untilAll = futureIso(120_000);
    const conn = {
      id: "c1", provider: NEUTRAL_PROVIDER,
      [`modelLock_some-upstream-id`]: untilTiered,
      modelLock___all: untilAll,
    };

    const safe = sanitize(conn);

    expect(safe.activeModelLocks).toEqual({
      "some-upstream-id": untilTiered,
      "__all": untilAll,
    });
  });
});
