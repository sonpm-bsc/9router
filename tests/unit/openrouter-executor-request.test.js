import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { OpenRouterExecutor } = await import("../../open-sse/executors/openrouter.js");

function response(status = 200) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => "application/json" } };
}

describe("OpenRouterExecutor outbound request", () => {
  beforeEach(() => fetchMock.mockReset());

  it("sends the generated session_id per request without mutating shared credentials", async () => {
    fetchMock.mockResolvedValueOnce(response());
    const executor = new OpenRouterExecutor();
    const credentials = {
      apiKey: "test-key",
      _openrouterSessionId: "claude:550e8400-e29b-41d4-a716-446655440000",
    };

    const result = await executor.execute({
      model: "deepseek/deepseek-v4.1-flash",
      body: { model: "deepseek/deepseek-v4.1-flash", messages: [{ role: "user", content: "hello" }] },
      stream: false,
      credentials,
    });

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(result.response.status).toBe(200);
    expect(sent.session_id).toMatch(/^or:v1:[a-f0-9]{48}$/);
    expect(sent.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-key");
    expect(credentials._openrouterSessionId).toBe("claude:550e8400-e29b-41d4-a716-446655440000");
  });
});
