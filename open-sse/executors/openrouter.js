import { DefaultExecutor } from "./default.js";
import {
  deriveOpenRouterSessionId,
  resolveOpenRouterSessionId,
} from "../utils/sessionManager.js";

/**
 * OpenRouter-specific request behavior.
 *
 * OpenRouter uses session_id/x-session-id as a sticky provider-routing hint.
 * Keep this provider-specific so generic OpenAI-compatible traffic is not
 * changed, and inject into the per-request body to avoid shared-credential
 * state races across concurrent conversations.
 */
export class OpenRouterExecutor extends DefaultExecutor {
  constructor() {
    super("openrouter");
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (!transformed || typeof transformed !== "object") return transformed;

    // Respect either client-controlled sticky/cache hint exactly as sent,
    // including an explicit null/empty value (do not silently overwrite it).
    if (Object.prototype.hasOwnProperty.call(transformed, "session_id")
      || Object.prototype.hasOwnProperty.call(transformed, "prompt_cache_key")) return transformed;

    const sessionId = credentials?._openrouterSessionId || resolveOpenRouterSessionId({
        headers: credentials?.rawHeaders,
        body: transformed,
        connectionId: credentials?.connectionId,
        workspaceId: credentials?.providerSpecificData?.workspaceId,
      });
    const routingHint = deriveOpenRouterSessionId(sessionId);
    if (routingHint) transformed.session_id = routingHint;
    return transformed;
  }
}
