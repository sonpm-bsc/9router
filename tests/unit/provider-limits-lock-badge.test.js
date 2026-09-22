import { describe, expect, it } from "vitest";
import { getActiveLockUntil } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const futureIso = (ms) => new Date(Date.now() + ms).toISOString();
const pastIso = (ms) => new Date(Date.now() - ms).toISOString();

describe("getActiveLockUntil: real routing-lock lookup for a quota row", () => {
  it("returns the until timestamp when the row's modelKey has an active lock", () => {
    const until = futureIso(30 * 60 * 1000);
    const activeModelLocks = { "gemini-3.8-flash-high": until };

    expect(getActiveLockUntil(activeModelLocks, "gemini-3.8-flash-high")).toBe(until);
  });

  it("returns null when the row's modelKey has no lock entry", () => {
    const activeModelLocks = { "gemini-3.8-flash-high": futureIso(60_000) };

    expect(getActiveLockUntil(activeModelLocks, "gemini-3.1-flash-image")).toBeNull();
  });

  it("returns null when activeModelLocks is missing entirely", () => {
    expect(getActiveLockUntil(undefined, "gemini-3.8-flash-high")).toBeNull();
    expect(getActiveLockUntil(null, "gemini-3.8-flash-high")).toBeNull();
  });

  it("returns null for a stale/expired lock timestamp", () => {
    const activeModelLocks = { "gemini-3.8-flash-high": pastIso(60_000) };

    expect(getActiveLockUntil(activeModelLocks, "gemini-3.8-flash-high")).toBeNull();
  });

  it("returns null when modelKey itself is missing", () => {
    expect(getActiveLockUntil({ "gemini-3.8-flash-high": futureIso(60_000) }, undefined)).toBeNull();
  });
});
