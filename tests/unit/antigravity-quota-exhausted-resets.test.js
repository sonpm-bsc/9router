import { describe, expect, it } from "vitest";

describe("Antigravity executor: real quota-exhausted reset time", () => {
  it("extracts resetsAtMs from Google's quotaResetTimeStamp on 429 QUOTA_EXHAUSTED", async () => {
    const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
    const executor = new AntigravityExecutor();

    const bodyText = JSON.stringify({
      code: 429,
      message: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 100h38m44s.",
      reason: "QUOTA_EXHAUSTED",
      quotaResetDelay: "100h38m44.45521204s",
      quotaResetTimeStamp: "2026-09-26T10:23:16Z",
    });
    const response = { status: 429 };

    const parsed = executor.parseError(response, bodyText);

    expect(parsed.resetsAtMs).toBe(Date.parse("2026-09-26T10:23:16Z"));
  });

  it("falls back to base parsing when body has no quota reset fields", async () => {
    const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
    const executor = new AntigravityExecutor();

    const bodyText = JSON.stringify({ code: 429, message: "Some other transient error", reason: "RATE_LIMITED" });
    const parsed = executor.parseError({ status: 429 }, bodyText);

    expect(parsed.resetsAtMs).toBeUndefined();
    expect(parsed.status).toBe(429);
  });

  it("ignores a quotaResetTimeStamp that is already in the past", async () => {
    const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
    const executor = new AntigravityExecutor();

    const bodyText = JSON.stringify({
      code: 429,
      message: "stale",
      reason: "QUOTA_EXHAUSTED",
      quotaResetTimeStamp: "2020-01-01T00:00:00Z",
    });
    const parsed = executor.parseError({ status: 429 }, bodyText);

    expect(parsed.resetsAtMs).toBeUndefined();
  });
});
