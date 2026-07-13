import { randomUUID } from "node:crypto";
import {
  appendProviderCredentialEntry,
  patchProviderCredentialEntry,
  readProviderCredentialEntry
} from "./config-store.mjs";

const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_OAUTH_ISSUER = "https://auth.openai.com";
const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models?client_version=1.0.0";
const sessions = new Map();

export async function startCodexOAuthLogin({ workspaceRoot, fetchImpl = fetch, startPolling = true, pollDelayMs = null } = {}) {
  if (!workspaceRoot) {
    throw Object.assign(new Error("workspaceRoot is required."), { status: 500 });
  }
  const response = await fetchImpl(`${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID })
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Codex device login failed: ${response.status}`), { status: 502 });
  }
  const payload = await response.json();
  const userCode = String(payload.user_code || "").trim();
  const deviceAuthId = String(payload.device_auth_id || "").trim();
  const intervalSeconds = Math.max(3, Number.parseInt(payload.interval || "5", 10) || 5);
  if (!userCode || !deviceAuthId) {
    throw Object.assign(new Error("Codex device login did not return a user code."), { status: 502 });
  }

  const id = randomUUID();
  const expiresIn = 15 * 60;
  const session = {
    id,
    provider: "openai-codex",
    status: "pending",
    userCode,
    verificationUrl: `${CODEX_OAUTH_ISSUER}/codex/device`,
    deviceAuthId,
    intervalSeconds,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    workspaceRoot,
    fetchImpl,
    pollDelayMs,
    canceled: false,
    credential: null,
    error: ""
  };
  sessions.set(id, session);
  if (startPolling) {
    pollCodexOAuthLogin(session).catch((error) => {
      const current = sessions.get(id);
      if (current) {
        current.status = "error";
        current.error = error?.message || String(error);
      }
    });
  }
  return publicCodexOAuthSession(session);
}

export function readCodexOAuthLogin(id) {
  const session = sessions.get(id);
  if (!session) {
    throw Object.assign(new Error(`Codex login session not found: ${id}`), { status: 404 });
  }
  return publicCodexOAuthSession(session);
}

export function cancelCodexOAuthLogin(id) {
  const session = sessions.get(id);
  if (!session) return { id, canceled: false };
  session.canceled = true;
  session.status = session.status === "approved" ? session.status : "canceled";
  return { id, canceled: true, status: session.status };
}

export async function discoverCodexModelIds({ workspaceRoot, fetchImpl = fetch, fallbackModels = [] } = {}) {
  if (!workspaceRoot) {
    throw Object.assign(new Error("workspaceRoot is required."), { status: 500 });
  }
  const fallback = dedupeStrings(fallbackModels);
  const entry = await readProviderCredentialEntry(workspaceRoot, "openai-codex");
  let accessToken = String(entry?.access_token || "").trim();
  const refreshToken = String(entry?.refresh_token || "").trim();

  if (accessToken && refreshToken && jwtExpiresSoon(accessToken, 120)) {
    try {
      const refreshed = await refreshCodexAccessToken({ refreshToken, fetchImpl });
      accessToken = refreshed.accessToken;
      await patchProviderCredentialEntry(workspaceRoot, "openai-codex", {
        access_token: refreshed.accessToken,
        refresh_token: refreshed.refreshToken || refreshToken,
        last_refresh: new Date().toISOString()
      });
    } catch {
      // Model discovery should not break the settings UI. Fall through to
      // cached/static models; chat execution will surface auth errors later.
    }
  }

  if (accessToken) {
    const liveModels = await fetchCodexModelsFromApi({ accessToken, fetchImpl });
    if (liveModels.length) {
      await patchProviderCredentialEntry(workspaceRoot, "openai-codex", {
        model_cache: {
          models: liveModels,
          cached_at: new Date().toISOString()
        }
      });
      return { provider: "openai-codex", source: "codex-live", models: liveModels };
    }
  }

  const cachedModels = dedupeStrings(entry?.model_cache?.models || []);
  if (cachedModels.length) {
    return { provider: "openai-codex", source: "codex-cache", models: cachedModels };
  }

  return { provider: "openai-codex", source: "registry", models: fallback };
}

async function pollCodexOAuthLogin(session) {
  const deadline = Date.parse(session.expiresAt);
  while (!session.canceled && Date.now() < deadline) {
    await sleep(Number.isFinite(session.pollDelayMs) ? session.pollDelayMs : session.intervalSeconds * 1000);
    const poll = await session.fetchImpl(`${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        device_auth_id: session.deviceAuthId,
        user_code: session.userCode
      })
    });
    if (poll.status === 403 || poll.status === 404) continue;
    if (!poll.ok) {
      throw new Error(`Codex device login poll failed: ${poll.status}`);
    }
    const codePayload = await poll.json();
    const authorizationCode = String(codePayload.authorization_code || "").trim();
    const codeVerifier = String(codePayload.code_verifier || "").trim();
    if (!authorizationCode || !codeVerifier) {
      throw new Error("Codex device login approval did not return authorization_code/code_verifier.");
    }
    const tokenResponse = await session.fetchImpl(CODEX_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        "user-agent": "codmes-server/0.0.0"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: authorizationCode,
        redirect_uri: `${CODEX_OAUTH_ISSUER}/deviceauth/callback`,
        client_id: CODEX_OAUTH_CLIENT_ID,
        code_verifier: codeVerifier
      })
    });
    if (!tokenResponse.ok) {
      throw new Error(`Codex OAuth token exchange failed: ${tokenResponse.status}`);
    }
    const tokens = await tokenResponse.json();
    const accessToken = String(tokens.access_token || "").trim();
    const refreshToken = String(tokens.refresh_token || "").trim();
    const idToken = String(tokens.id_token || "").trim();
    if (!accessToken) {
      throw new Error("Codex OAuth token exchange did not return access_token.");
    }
    const profile = extractTokenProfile(accessToken, idToken, tokens);
    session.credential = await appendProviderCredentialEntry(session.workspaceRoot, "openai-codex", {
      label: profile.email || profile.accountId || `OpenAI Codex ${new Date().toISOString().slice(0, 10)}`,
      auth_type: "oauth",
      source: "manual:device_code",
      access_token: accessToken,
      refresh_token: refreshToken,
      id_token: idToken,
      account_email: profile.email,
      account_id: profile.accountId,
      last_refresh: new Date().toISOString()
    });
    session.status = "approved";
    return;
  }
  if (!session.canceled && session.status === "pending") {
    session.status = "expired";
    session.error = "Device code expired before approval.";
  }
}

function publicCodexOAuthSession(session) {
  return {
    id: session.id,
    provider: session.provider,
    status: session.status,
    userCode: session.userCode,
    verificationUrl: session.verificationUrl,
    intervalSeconds: session.intervalSeconds,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    credential: session.credential,
    error: session.error
  };
}

async function fetchCodexModelsFromApi({ accessToken, fetchImpl }) {
  try {
    const response = await fetchImpl(CODEX_MODELS_URL, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        "user-agent": "codmes-server/0.0.0"
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const entries = Array.isArray(payload?.models) ? payload.models : [];
    const sortable = [];
    for (const item of entries) {
      if (!item || typeof item !== "object") continue;
      const slug = stringOrEmpty(item.slug);
      if (!slug) continue;
      const visibility = stringOrEmpty(item.visibility).toLowerCase();
      if (visibility === "hide" || visibility === "hidden") continue;
      const priority = Number.isFinite(Number(item.priority)) ? Number(item.priority) : 10000;
      sortable.push({ slug, priority });
    }
    sortable.sort((a, b) => a.priority - b.priority || a.slug.localeCompare(b.slug));
    return dedupeStrings(sortable.map((item) => item.slug));
  } catch {
    return [];
  }
}

async function refreshCodexAccessToken({ refreshToken, fetchImpl }) {
  const response = await fetchImpl(CODEX_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent": "codmes-server/0.0.0"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CODEX_OAUTH_CLIENT_ID
    })
  });
  if (!response.ok) {
    throw new Error(`Codex OAuth refresh failed: ${response.status}`);
  }
  const payload = await response.json();
  const accessToken = stringOrEmpty(payload.access_token);
  if (!accessToken) throw new Error("Codex OAuth refresh returned no access token.");
  return {
    accessToken,
    refreshToken: stringOrEmpty(payload.refresh_token)
  };
}

function extractTokenProfile(accessToken, idToken, tokens) {
  const accessClaims = decodeJwtPayload(accessToken) || {};
  const idClaims = decodeJwtPayload(idToken) || {};
  const openaiAuth = accessClaims["https://api.openai.com/auth"] || idClaims["https://api.openai.com/auth"] || {};
  return {
    email: stringOrEmpty(tokens.email)
      || stringOrEmpty(tokens.account_email)
      || stringOrEmpty(idClaims.email)
      || stringOrEmpty(accessClaims.email)
      || stringOrEmpty(idClaims.preferred_username)
      || stringOrEmpty(accessClaims.preferred_username),
    accountId: stringOrEmpty(tokens.account_id)
      || stringOrEmpty(openaiAuth.chatgpt_account_id)
      || stringOrEmpty(idClaims.chatgpt_account_id)
      || stringOrEmpty(accessClaims.chatgpt_account_id)
      || stringOrEmpty(idClaims.account_id)
      || stringOrEmpty(accessClaims.account_id)
  };
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function stringOrEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function dedupeStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    const item = stringOrEmpty(value);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function jwtExpiresSoon(token, leewaySeconds = 120) {
  const claims = decodeJwtPayload(token);
  const exp = Number(claims?.exp || 0);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  return exp * 1000 <= Date.now() + leewaySeconds * 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
