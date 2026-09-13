import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  handleChatCore: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));

vi.mock("@/sse/services/auth.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProviderCredentials: mocks.getProviderCredentials,
    extractApiKey: vi.fn(() => null),
    isValidApiKey: vi.fn(),
  };
});

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));

vi.mock("open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: vi.fn(),
}));

vi.mock("@/lib/headroom/detect", () => ({
  DEFAULT_HEADROOM_URL: "http://127.0.0.1:8787",
}));

vi.mock("@/lib/pxpipe/loader.js", () => ({
  getTransform: vi.fn(),
}));

vi.mock("@/lib/pxpipe/events.js", () => ({
  appendPxpipeEvent: vi.fn(),
}));

vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
  detectRequiredCapabilities: vi.fn(() => new Set()),
}));

vi.mock("open-sse/services/capacityAdapter.js", () => ({
  augmentModelsWithCapacityAdapter: vi.fn((models) => models),
  withCapacityAdapterStripping: vi.fn((handler) => handler),
  getActiveAdapterStrategy: vi.fn(() => "fallback"),
}));

vi.mock("open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  maskKey: vi.fn(() => "masked"),
}));

import { handleChat } from "@/sse/handlers/chat.js";

describe("chat account fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-test" });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getProviderCredentials.mockResolvedValue({
      connectionId: "account-1",
      connectionName: "Account One",
      accessToken: "provider-token",
      providerSpecificData: {},
    });
    mocks.getProviderConnections.mockResolvedValue([{
      id: "account-1",
      name: "Account One",
      testStatus: "active",
    }]);
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
  });

  it("returns the original 400 input-token overflow without marking or rotating the account", async () => {
    const originalResponse = new Response(JSON.stringify({
      error: {
        message: "Input token count exceeds the maximum number of tokens allowed",
      },
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 400,
      error: "Input token count exceeds the maximum number of tokens allowed",
      response: originalResponse,
    });

    const response = await handleChat(new Request("http://router.test/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-test",
        messages: [{ role: "user", content: "large context" }],
      }),
    }));

    expect(response).toBe(originalResponse);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message: "Input token count exceeds the maximum number of tokens allowed",
      },
    });
    expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(1);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});
