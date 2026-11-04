import { afterEach, describe, expect, it, vi } from "vitest";
import { compressWithHeadroom } from "../../open-sse/rtk/headroom.js";

// Antigravity shares the native tool-output path with gemini/gemini-cli/vertex
// (see headroom-tool-outputs.test.js for the cross-format baseline). These
// cases cover what is specific to Antigravity: the request envelope, thought
// parts, plain-string `functionResponse.response` leaves, and top-level contents.

afterEach(() => vi.unstubAllGlobals());

const outputA = "build log line: compiling module a without errors\n".repeat(80);
const outputB = "grep hit: src/index.js:42 matches pattern\n".repeat(80);
const options = { enabled: true, url: "http://headroom:8787", model: "gemini-3.8-flash", format: "antigravity" };

function antigravityBody() {
  return {
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
        { role: "model", parts: [
          { thought: true, text: "thinking..." },
          { text: "assistant reply" },
          { functionCall: { id: "call_1", name: "Bash", args: { command: "make" } }, thoughtSignature: "sig" },
          { functionCall: { id: "call_2", name: "Grep", args: { pattern: "x" } } },
        ] },
        { role: "user", parts: [
          { functionResponse: { id: "call_1", name: "Bash", response: outputA } },
          { functionResponse: { id: "call_2", name: "Grep", response: { result: outputB } } },
        ] },
      ],
      tools: [{ functionDeclarations: [{ name: "Bash" }, { name: "Grep" }] }],
      toolConfig: { functionCallingConfig: { mode: "VALIDATED" } },
    },
  };
}

function proxy(transform = (messages) => messages.map((message, i) => ({ ...message, content: `short-${i}` }))) {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => new Response(JSON.stringify({
    messages: transform(JSON.parse(init.body).messages), tokens_before: 2000, tokens_after: 20, tokens_saved: 1980,
  }))));
}

describe("compressWithHeadroom antigravity format", () => {
  it("compresses only plain-string functionResponse.response leaves and keeps everything else native", async () => {
    const body = antigravityBody();
    const expected = structuredClone(body);
    const expectedParts = expected.request.contents[2].parts;
    expectedParts[0].functionResponse.response = "short-0";
    expectedParts[1].functionResponse.response.result = "short-1";
    proxy();

    const stats = await compressWithHeadroom(body, { ...options, compressUserMessages: true });

    expect(stats?.tokens_saved).toBe(1980);
    // system/user/model text, thought, functionCall, envelope, tools and toolConfig are untouched.
    expect(body).toEqual(expected);

    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.messages).toEqual([
      { role: "tool", tool_call_id: "headroom-tool-0", content: outputA },
      { role: "tool", tool_call_id: "headroom-tool-1", content: outputB },
    ]);
    const sentText = JSON.stringify(payload.messages);
    for (const native of ["native system prompt", "original user query", "assistant reply", "thinking...", "call_1"]) {
      expect(sentText).not.toContain(native);
    }
  });

  it.each([
    ["message count", (messages) => messages.slice(1), "proxy response did not match tool-output count"],
    ["IDs/order", (messages) => [...messages].reverse(),
      "proxy response did not preserve tool-output IDs, order, roles or text"],
    ["roles", (messages) => messages.map((message) => ({ ...message, role: "user" })),
      "proxy response did not preserve tool-output IDs, order, roles or text"],
  ])("fails open atomically when the proxy changes %s", async (_name, transform, reason) => {
    const body = antigravityBody();
    const original = structuredClone(body);
    const diagnostics = {};
    proxy(transform);

    expect(await compressWithHeadroom(body, { ...options, diagnostics })).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toBe(reason);
  });

  it("supports a top-level body.contents without an envelope", async () => {
    const { request } = antigravityBody();
    const body = { systemInstruction: "system instruction string", contents: request.contents };
    const expected = structuredClone(body);
    expected.contents[2].parts[0].functionResponse.response = "short-0";
    expected.contents[2].parts[1].functionResponse.response.result = "short-1";
    proxy();

    expect(await compressWithHeadroom(body, options)).not.toBeNull();
    expect(body).toEqual(expected);
  });

  it("does not call the proxy when there is no plain-text tool output, even with long user/system text", async () => {
    const longPrompt = "please keep this prompt exactly as written\n".repeat(100);
    const body = {
      request: {
        systemInstruction: { parts: [{ text: longPrompt }] },
        contents: [
          { role: "user", parts: [{ text: longPrompt }] },
          { role: "model", parts: [{ text: longPrompt }] },
        ],
      },
    };
    const original = structuredClone(body);
    const diagnostics = {};
    vi.stubGlobal("fetch", vi.fn());

    expect(await compressWithHeadroom(body, { ...options, diagnostics })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toBe("no eligible plain-text tool output");
  });

  it("reports an unsupported shape instead of an Antigravity overlay failure when contents is missing", async () => {
    const body = { project: "proj-123", request: { sessionId: 1, systemInstruction: { parts: [{ text: longPromptForShape() }] } } };
    const original = structuredClone(body);
    const diagnostics = {};
    vi.stubGlobal("fetch", vi.fn());

    expect(await compressWithHeadroom(body, { ...options, diagnostics })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toBe("unsupported antigravity request shape");
  });
});

function longPromptForShape() {
  return "system prompt that must never be routed through the legacy overlay\n".repeat(50);
}
