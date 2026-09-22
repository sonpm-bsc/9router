import { describe, it, expect, vi, afterEach } from "vitest";
import { compressWithHeadroom } from "../../open-sse/rtk/headroom.js";

describe("compressWithHeadroom antigravity format", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compresses Antigravity request.contents and systemInstruction in-place", async () => {
    let requestPayload;
    global.fetch = vi.fn(async (_url, init) => {
      requestPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({
        messages: [
          { role: "system", content: "compressed system prompt" },
          { role: "user", content: "compressed user query" },
          {
            role: "assistant",
            content: "compressed assistant reply",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "Read", arguments: "{\"path\":\"x.js\"}" },
            }],
          },
          { role: "tool", content: "compressed tool output", tool_call_id: "call_1" },
        ],
        tokens_before: 200,
        tokens_after: 80,
        tokens_saved: 120,
      }), { status: 200 });
    });

    const body = {
      project: "proj-123",
      model: "gemini-3.8-flash",
      userAgent: "antigravity",
      requestId: "agent-req-123",
      requestType: "agent",
      request: {
        sessionId: 99999,
        systemInstruction: { parts: [{ text: "native system prompt" }] },
        contents: [
          { role: "user", parts: [{ text: "original user query" }] },
          {
            role: "model",
            parts: [
              { thought: true, text: "thinking..." },
              { text: "assistant reply" },
              { functionCall: { id: "call_1", name: "Read", args: { path: "x.js" } } },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "call_1",
                  name: "Read",
                  response: { result: "long tool output" },
                },
              },
            ],
          },
        ],
        tools: [{ functionDeclarations: [{ name: "Read" }] }],
        toolConfig: { functionCallingConfig: { mode: "VALIDATED" } },
      },
    };

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "gemini-3.8-flash",
      format: "antigravity",
      compressUserMessages: true,
    });

    expect(stats).not.toBeNull();
    expect(stats.tokens_saved).toBe(120);

    // Verify outbound OpenAI messages payload to Headroom
    expect(requestPayload).toEqual({
      model: "gemini-3.8-flash",
      config: { compress_user_messages: true },
      messages: [
        { role: "system", content: "native system prompt" },
        { role: "user", content: "original user query" },
        {
          role: "assistant",
          content: "assistant reply",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "Read", arguments: "{\"path\":\"x.js\"}" },
          }],
        },
        { role: "tool", content: "long tool output", tool_call_id: "call_1" },
      ],
    });

    // In-place updates in body
    expect(body.request.systemInstruction.parts[0].text).toBe("compressed system prompt");
    expect(body.request.contents[0].parts[0].text).toBe("compressed user query");
    // Thought part must be completely untouched
    expect(body.request.contents[1].parts[0]).toEqual({ thought: true, text: "thinking..." });
    expect(body.request.contents[1].parts[1].text).toBe("compressed assistant reply");
    // Function call must be completely untouched
    expect(body.request.contents[1].parts[2]).toEqual({
      functionCall: { id: "call_1", name: "Read", args: { path: "x.js" } },
    });
    // Tool result must be updated in-place
    expect(body.request.contents[2].parts[0].functionResponse.response.result).toBe("compressed tool output");
    expect(body.request.contents[2].parts[0].functionResponse.id).toBe("call_1");
    expect(body.request.contents[2].parts[0].functionResponse.name).toBe("Read");

    // All envelope & metadata fields must remain untouched
    expect(body.project).toBe("proj-123");
    expect(body.model).toBe("gemini-3.8-flash");
    expect(body.userAgent).toBe("antigravity");
    expect(body.requestId).toBe("agent-req-123");
    expect(body.requestType).toBe("agent");
    expect(body.request.sessionId).toBe(99999);
    expect(body.request.tools).toEqual([{ functionDeclarations: [{ name: "Read" }] }]);
    expect(body.request.toolConfig).toEqual({ functionCallingConfig: { mode: "VALIDATED" } });
  });

  it("supports top-level body.contents and string systemInstruction", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [
        { role: "system", content: "compressed sys" },
        { role: "user", content: "compressed query" },
      ],
      tokens_saved: 30,
    }), { status: 200 }));

    const body = {
      systemInstruction: "system instruction string",
      contents: [
        { role: "user", parts: [{ text: "original user query" }] },
      ],
    };

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "gemini-3.8-flash",
      format: "antigravity",
    });

    expect(stats.tokens_saved).toBe(30);
    expect(body.systemInstruction).toBe("compressed sys");
    expect(body.contents[0].parts[0].text).toBe("compressed query");
  });

  it("handles assistant turn with functionCall but no text part", async () => {
    let requestPayload;
    global.fetch = vi.fn(async (_url, init) => {
      requestPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({
        messages: [
          { role: "user", content: "compressed user" },
          {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "call_2",
              type: "function",
              function: { name: "Bash", arguments: "{\"command\":\"pwd\"}" },
            }],
          },
          { role: "tool", content: "compressed bash result", tool_call_id: "call_2" },
        ],
        tokens_saved: 50,
      }), { status: 200 });
    });

    const body = {
      request: {
        contents: [
          { role: "user", parts: [{ text: "run bash" }] },
          {
            role: "model",
            parts: [
              { functionCall: { id: "call_2", name: "Bash", args: { command: "pwd" } } },
            ],
          },
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  id: "call_2",
                  name: "Bash",
                  response: { result: "/Users/sonpm/workspace" },
                },
              },
            ],
          },
        ],
      },
    };

    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      model: "gemini-3.8-flash",
      format: "antigravity",
    });

    expect(stats.tokens_saved).toBe(50);
    expect(requestPayload.messages[1]).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "call_2",
        type: "function",
        function: { name: "Bash", arguments: "{\"command\":\"pwd\"}" },
      }],
    });
    expect(body.request.contents[0].parts[0].text).toBe("compressed user");
    expect(body.request.contents[1].parts[0]).toEqual({
      functionCall: { id: "call_2", name: "Bash", args: { command: "pwd" } },
    });
    expect(body.request.contents[2].parts[0].functionResponse.response.result).toBe("compressed bash result");
  });

  it("fails open when proxy response does not match message count", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [
        { role: "user", content: "only one message" },
      ],
      tokens_saved: 10,
    }), { status: 200 }));

    const body = {
      request: {
        contents: [
          { role: "user", parts: [{ text: "first" }] },
          { role: "user", parts: [{ text: "second" }] },
        ],
      },
    };

    const diagnostics = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      format: "antigravity",
      diagnostics,
    });

    expect(stats).toBeNull();
    expect(body.request.contents[0].parts[0].text).toBe("first");
    expect(body.request.contents[1].parts[0].text).toBe("second");
    expect(diagnostics.reason).toBe("proxy response did not match Antigravity message count");
  });

  it("fails open when proxy response does not preserve role order", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [
        { role: "assistant", content: "wrong role" },
        { role: "user", content: "second" },
      ],
      tokens_saved: 10,
    }), { status: 200 }));

    const body = {
      request: {
        contents: [
          { role: "user", parts: [{ text: "user message" }] },
          { role: "model", parts: [{ text: "assistant message" }] },
        ],
      },
    };

    const diagnostics = {};
    const stats = await compressWithHeadroom(body, {
      enabled: true,
      url: "http://localhost:8787",
      format: "antigravity",
      diagnostics,
    });

    expect(stats).toBeNull();
    expect(body.request.contents[0].parts[0].text).toBe("user message");
    expect(diagnostics.reason).toBe("proxy response did not preserve Antigravity message order");
  });
});
