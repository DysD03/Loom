import "server-only";

import { randomUUID } from "node:crypto";

import { GMAIL_SCOPE } from "./types";
import { getGmailAccount, updateGmailAccount } from "./store";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Raised when a Gmail call can't proceed for auth reasons. `code` lets routes
 * map it to a response the UI can act on (show setup card / reconnect banner).
 */
export class GmailAuthError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "not_connected" | "reconnect",
  ) {
    super(message);
    this.name = "GmailAuthError";
  }
}

/** The exact redirect URI that must be registered on the Google OAuth client. */
export function oauthRedirectUri(origin: string): string {
  return `${origin}/api/gmail/oauth/callback`;
}

/**
 * Starts the consent flow: stores a CSRF state on the account row and returns
 * the Google authorization URL to redirect the browser to. `prompt=consent` +
 * `access_type=offline` force a refresh token on every connect.
 */
export function beginOAuth(origin: string): string {
  const account = getGmailAccount();
  if (!account.clientId.trim() || !account.clientSecret.trim()) {
    throw new GmailAuthError(
      "Save a Google OAuth client id and secret first.",
      "not_configured",
    );
  }

  const state = `${randomUUID()}.${Date.now()}`;
  updateGmailAccount({ oauthState: state });

  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", account.clientId.trim());
  url.searchParams.set("redirect_uri", oauthRedirectUri(origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const account = getGmailAccount();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: account.clientId.trim(),
      client_secret: account.clientSecret.trim(),
      ...params,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Google token endpoint rejected the request: ${detail}`);
  }
  return data;
}

function stateIsValid(stored: string | null, received: string): boolean {
  if (!stored || stored !== received) {
    return false;
  }
  const ts = Number(stored.split(".")[1] ?? Number.NaN);
  return Number.isFinite(ts) && Date.now() - ts < STATE_TTL_MS;
}

/**
 * Finishes the consent flow: verifies the CSRF state, exchanges the code for
 * tokens, resolves the account's address, and persists everything. Returns the
 * connected email address.
 */
export async function completeOAuth(
  origin: string,
  code: string,
  receivedState: string,
): Promise<string> {
  const account = getGmailAccount();
  if (!stateIsValid(account.oauthState, receivedState)) {
    throw new Error("OAuth state mismatch or expired — start the connect flow again.");
  }

  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: oauthRedirectUri(origin),
  });
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove Loom's access at " +
        "myaccount.google.com/permissions, then connect again.",
    );
  }

  updateGmailAccount({
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? "",
    accessTokenExpiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    scope: tokens.scope ?? GMAIL_SCOPE,
    oauthState: null,
    connectedAt: new Date().toISOString(),
  });

  const email = await fetchProfileEmail(tokens.access_token ?? "");
  updateGmailAccount({ email });
  return email;
}

async function fetchProfileEmail(accessToken: string): Promise<string> {
  const res = await fetch(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Could not read the Gmail profile (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { emailAddress?: string };
  return data.emailAddress ?? "";
}

/**
 * Returns a valid access token, refreshing it when it is expired (or when
 * `force` is set after a 401). A revoked/expired refresh token clears the
 * connection and asks the user to reconnect.
 */
export async function getAccessToken(force = false): Promise<string> {
  const account = getGmailAccount();
  if (!account.clientId.trim() || !account.clientSecret.trim()) {
    throw new GmailAuthError("Gmail is not configured yet.", "not_configured");
  }
  if (!account.refreshToken) {
    throw new GmailAuthError("Gmail is not connected.", "not_connected");
  }
  if (!force && account.accessToken && account.accessTokenExpiresAt - 60_000 > Date.now()) {
    return account.accessToken;
  }

  try {
    const tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
    });
    updateGmailAccount({
      accessToken: tokens.access_token ?? "",
      accessTokenExpiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      // Google normally keeps the refresh token stable, but honor a rotation.
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    });
    return tokens.access_token ?? "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/invalid_grant|expired or revoked/i.test(message)) {
      updateGmailAccount({ refreshToken: "", accessToken: "", accessTokenExpiresAt: 0 });
      throw new GmailAuthError(
        "Google access expired or was revoked — reconnect Gmail. " +
          "(OAuth apps left in “Testing” status expire tokens after 7 days; " +
          "publish the app to Production to avoid this.)",
        "reconnect",
      );
    }
    throw err;
  }
}
