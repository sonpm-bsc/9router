import { describe, expect, it } from "vitest";
import {
  BACKOFF_CONFIG,
  COOLDOWN_MS,
  TRANSIENT_COOLDOWN_MS,
} from "../../open-sse/config/errorConfig.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("checkFallbackError", () => {
  it.each([
    ["Input Token Count ExCeEdS: 100 > 50"],
    ["The MAXIMUM NUMBER OF TOKENS ALLOWED is 50"],
  ])("does not fallback for deterministic input token overflow: %s", (errorText) => {
    expect(checkFallbackError(400, errorText)).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });

  it("keeps other 400 errors on the default fallback path", () => {
    expect(checkFallbackError(400, "Malformed request body")).toEqual({
      shouldFallback: true,
      cooldownMs: TRANSIENT_COOLDOWN_MS,
    });
  });

  it.each([401, 403, 404])("preserves status fallback for %s", (status) => {
    expect(checkFallbackError(status, "upstream error")).toEqual({
      shouldFallback: true,
      cooldownMs: COOLDOWN_MS.unauthorized,
    });
  });

  it("preserves exponential fallback for 429", () => {
    expect(checkFallbackError(429, "upstream error")).toEqual({
      shouldFallback: true,
      cooldownMs: BACKOFF_CONFIG.base,
      newBackoffLevel: 1,
    });
  });

  it("preserves the default fallback for unmatched errors", () => {
    expect(checkFallbackError(418, "upstream error")).toEqual({
      shouldFallback: true,
      cooldownMs: TRANSIENT_COOLDOWN_MS,
    });
  });
});
