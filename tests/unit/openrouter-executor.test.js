import { describe, expect, it } from "vitest";
import { getExecutor } from "../../open-sse/executors/index.js";
import { OpenRouterExecutor } from "../../open-sse/executors/openrouter.js";

const BODY = {
  model: "deepseek/deepseek-v4.1-flash",
  messages: [{ role: "user", content: "hello" }],
};

describe("OpenRouterExecutor sticky session hint", () => {
  it("is registered only for OpenRouter", () => {
    expect(getExecutor("openrouter")).toBeInstanceOf(OpenRouterExecutor);
    expect(getExecutor("openai")).not.toBeInstanceOf(OpenRouterExecutor);
  });

  it("adds an opaque per-request session_id from a reliable translated identity", () => {
    const executor = new OpenRouterExecutor();
    const out = executor.transformRequest("deepseek/deepseek-v4.1-flash", { ...BODY }, false, {
      _openrouterSessionId: "claude:550e8400-e29b-41d4-a716-446655440000",
    });

    expect(out.session_id).toMatch(/^or:v1:[a-f0-9]{48}$/);
    expect(out.session_id).not.toContain("550e8400");
  });

  it("preserves client session_id and prompt_cache_key", () => {
    const executor = new OpenRouterExecutor();
    const session = executor.transformRequest("m", { ...BODY, session_id: "client-session" }, false, {});
    const cache = executor.transformRequest("m", { ...BODY, prompt_cache_key: "client-cache" }, false, {});
    const explicitEmpty = executor.transformRequest("m", { ...BODY, session_id: "" }, false, {});
    const explicitNull = executor.transformRequest("m", { ...BODY, prompt_cache_key: null }, false, {});

    expect(session.session_id).toBe("client-session");
    expect(session.prompt_cache_key).toBeUndefined();
    expect(cache.prompt_cache_key).toBe("client-cache");
    expect(cache.session_id).toBeUndefined();
    expect(explicitEmpty.session_id).toBe("");
    expect(explicitNull.prompt_cache_key).toBeNull();
  });

  it("does not invent a key for a request-scoped or account-only identity", () => {
    const executor = new OpenRouterExecutor();
    const requestScoped = executor.transformRequest("m", { ...BODY }, false, {
      connectionId: "account-1",
      rawHeaders: { "x-client-request-id": "request-1" },
    });
    const accountOnly = executor.transformRequest("m", { ...BODY }, false, {
      connectionId: "account-1",
    });

    expect(requestScoped.session_id).toBeUndefined();
    expect(accountOnly.session_id).toBeUndefined();
  });

  it("derives the same hint for the same conversation header", () => {
    const executor = new OpenRouterExecutor();
    const first = executor.transformRequest("m", { ...BODY }, false, {
      rawHeaders: { "x-session-id": "550e8400-e29b-41d4-a716-446655440000" },
    });
    const second = executor.transformRequest("m", { ...BODY }, false, {
      rawHeaders: { "x-session-id": "550e8400-e29b-41d4-a716-446655440000" },
    });
    const other = executor.transformRequest("m", { ...BODY }, false, {
      rawHeaders: { "x-session-id": "550e8400-e29b-41d4-a716-446655440001" },
    });

    expect(first.session_id).toBe(second.session_id);
    expect(first.session_id).not.toBe(other.session_id);
  });
});
