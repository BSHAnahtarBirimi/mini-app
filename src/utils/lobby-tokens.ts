/**
 * Stored user OAuth tokens for the `/linked-channel` flow.
 *
 * User tokens are written by the OAuth callback
 * (`api/discord-oauth-callback.ts`) into MiniDatabase under the user's Discord
 * id. Channel linking requires a USER OAuth2 Bearer token carrying the
 * `openid sdk.social_layer` scope — the bot token is not accepted on the
 * channel-linking or invite endpoints.
 */

import { refreshAccessToken } from "@minesa-org/mini-interaction";

import { getDb } from "./database.js";

export type StoredUserToken = {
	accessToken: string;
	refreshToken?: string;
	/** Epoch milliseconds, as returned by Discord's `expires_at`. */
	expiresAt?: number;
	scope?: string;
};

/** Refresh a little before the token actually expires. */
const EXPIRY_MARGIN_MS = 60_000;

/** Loads the stored OAuth token record for a user, or null if not connected. */
export async function getStoredUserToken(userId: string): Promise<StoredUserToken | null> {
	const raw = await getDb().get(userId);
	if (!raw || typeof raw.accessToken !== "string" || raw.accessToken === "") return null;
	return {
		accessToken: raw.accessToken,
		refreshToken: typeof raw.refreshToken === "string" ? raw.refreshToken : undefined,
		expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : undefined,
		scope: typeof raw.scope === "string" ? raw.scope : undefined,
	};
}

/** Persists an OAuth token record for a user. */
export async function saveUserToken(userId: string, token: StoredUserToken): Promise<void> {
	await getDb().set(userId, {
		accessToken: token.accessToken,
		refreshToken: token.refreshToken,
		expiresAt: token.expiresAt,
		scope: token.scope,
	});
}

/**
 * Exchanges the stored refresh token for a new access token and persists it.
 * Returns null when refreshing is not possible (no refresh token / no client
 * credentials).
 */
async function refreshStoredToken(
	userId: string,
	token: StoredUserToken,
): Promise<StoredUserToken | null> {
	const appId = process.env.DISCORD_APPLICATION_ID;
	const appSecret = process.env.DISCORD_CLIENT_SECRET;
	const redirectUri = process.env.DISCORD_REDIRECT_URI;
	if (!token.refreshToken || !appId || !appSecret || !redirectUri) return null;

	const refreshed = await refreshAccessToken(token.refreshToken, {
		appId,
		appSecret,
		redirectUri,
	});

	const next: StoredUserToken = {
		accessToken: refreshed.access_token,
		// Discord rotates refresh tokens: keep the new one, fall back to the old.
		refreshToken: refreshed.refresh_token || token.refreshToken,
		expiresAt: refreshed.expires_at,
		scope: refreshed.scope,
	};
	await saveUserToken(userId, next);
	return next;
}

/**
 * The stored token, refreshed first when it has expired.
 *
 * Discord access tokens live ~7 days, so a lobby link attempted a week after
 * `Connect Discord` would otherwise fail with a 401 that looks like a scope or
 * permission problem. Refreshing here keeps the bearer token usable; if the
 * refresh fails the (possibly stale) stored token is returned so the caller can
 * still surface Discord's real error.
 */
export async function getFreshUserToken(userId: string): Promise<StoredUserToken | null> {
	const stored = await getStoredUserToken(userId);
	if (!stored) return null;
	if (!stored.expiresAt || Date.now() < stored.expiresAt - EXPIRY_MARGIN_MS) return stored;

	try {
		return (await refreshStoredToken(userId, stored)) ?? stored;
	} catch (error) {
		console.error("[lobby-tokens] token refresh failed:", error);
		return stored;
	}
}
