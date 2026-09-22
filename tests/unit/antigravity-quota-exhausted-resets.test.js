import { describe, expect, it } from "vitest";

// Real body captured from a live 9Router 429 against antigravity/gemini-3.8-flash-tiered
// (2026-09-22). Google wraps quota fields in the standard gRPC error-details array under
// an ErrorInfo detail, NOT as flat top-level fields.
function quotaExhaustedBody(quotaResetTimeStamp) {
  return JSON.stringify({
    error: {
      code: 429,
      message: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 100h31m12s.",
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "QUOTA_EXHAUSTED",
          domain: "cloudcode-pa.googleapis.com",
          metadata: {
            uiMessage: "true",
            model: "gemini-3.8-flash-tiered",
            quotaResetDelay: "100h31m12.70315926s",
            quotaResetTimeStamp,
          },
        },
        {
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay: "361872.703159260s",
        },
      ],
    },
  });
}

describe("Antigravity executor: real quota-exhausted reset time", () => {
  it("extracts resetsAtMs from the ErrorInfo detail's quotaResetTimeStamp on 429 QUOTA_EXHAUSTED", async () => {
    const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
    const executor = new AntigravityExecutor();

    const bodyText = quotaExhaustedBody("2026-09-26T10:52:27Z");
    const parsed = executor.parseError({ status: 429 }, bodyText);

    expect(parsed.resetsAtMs).toBe(Date.parse("2026-09-26T10:52:27Z"));
  });

  it("falls back to base parsing when the error has no ErrorInfo/QUOTA_EXHAUSTED detail", async () => {
    const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
    const executor = new AntigravityExecutor();

    const bodyText = JSON.stringify({
      error: {
        code: 429,
        message: "Some other transient error",
        details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "5s" }],
      },
    });
    const parsed = executor.parseError({ status: 429 }, bodyText);

    expect(parsed.resetsAtMs).toBeUndefined();
    expect(parsed.status).toBe(429);
  });

  it("falls back to base parsing when the body has no error.details array at all", async () => {
    const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
    const executor = new AntigravityExecutor();

    const bodyText = JSON.stringify({ error: { code: 429, message: "plain error, no details" } });
    const parsed = executor.parseError({ status: 429 }, bodyText);

    expect(parsed.resetsAtMs).toBeUndefined();
  });

  it("ignores a quotaResetTimeStamp that is already in the past", async () => {
    const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
    const executor = new AntigravityExecutor();

    const bodyText = quotaExhaustedBody("2020-01-01T00:00:00Z");
    const parsed = executor.parseError({ status: 429 }, bodyText);

    expect(parsed.resetsAtMs).toBeUndefined();
  });

  it("does not throw on malformed JSON and falls back to base parsing", async () => {
    const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
    const executor = new AntigravityExecutor();

    const parsed = executor.parseError({ status: 429 }, "not json {");

    expect(parsed.resetsAtMs).toBeUndefined();
    expect(parsed.status).toBe(429);
  });
});
