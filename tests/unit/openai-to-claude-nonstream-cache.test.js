import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { extractUsageFromResponse } = await import("../../open-sse/handlers/chatCore/requestDetail.js");

function translateUsage(usage) {
  const response = translateNonStreamingResponse(
    {
      id: "chatcmpl-cache-test",
      model: "test-model",
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage,
    },
    FORMATS.OPENAI,
    FORMATS.CLAUDE,
  );

  return response.usage;
}

describe("non-stream OpenAI-to-Claude cache usage", () => {
  it("subtracts cached and cache-creation tokens from input_tokens and preserves both fields", () => {
    expect(translateUsage({
      prompt_tokens: 100,
      completion_tokens: 7,
      prompt_tokens_details: { cached_tokens: 30, cache_creation_tokens: 20 },
    })).toEqual({
      input_tokens: 50,
      output_tokens: 7,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 20,
    });
  });

  it("subtracts cache-creation tokens when there is no cached read", () => {
    expect(translateUsage({
      prompt_tokens: 100,
      completion_tokens: 7,
      prompt_tokens_details: { cache_creation_tokens: 20 },
    })).toEqual({
      input_tokens: 80,
      output_tokens: 7,
      cache_creation_input_tokens: 20,
    });
  });

  it("preserves the existing usage shape when no cache fields are present", () => {
    expect(translateUsage({ prompt_tokens: 100, completion_tokens: 7 })).toEqual({
      input_tokens: 100,
      output_tokens: 7,
    });
  });

  it("does not subtract cache twice when only a cache-exclusive input_tokens fallback exists", () => {
    expect(translateUsage({
      input_tokens: 80,
      output_tokens: 7,
      prompt_tokens_details: { cached_tokens: 30, cache_creation_tokens: 20 },
    })).toEqual({
      input_tokens: 80,
      output_tokens: 7,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 20,
    });
  });

  it("extracts cache-creation tokens for usage persistence", () => {
    expect(extractUsageFromResponse({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 7,
        prompt_tokens_details: { cached_tokens: 30, cache_creation_tokens: 20 },
      },
    })).toEqual({
      prompt_tokens: 100,
      completion_tokens: 7,
      cached_tokens: 30,
      cache_creation_input_tokens: 20,
      reasoning_tokens: undefined,
    });
  });
});
