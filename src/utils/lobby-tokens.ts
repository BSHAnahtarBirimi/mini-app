/**
 * Shared helpers for the `/linked-channel` command flow.
 *
 * User tokens are stored by the OAuth callback (`api/discord-oauth-callback.ts`)
 * in MiniDatabase under the user's Discord id. Channel linking requires a USER
 * OAuth2 Bearer token carrying the `openid sdk.social_layer` scope — the bot
 * token is not accepted for channel-linking or invite endpoints.
 */

import type { MiniDatabase } from "@minesa-org/mini-interaction";

export type StoredUserToken = {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
	scope?: string;
};

/** Loads the stored OAuth token record for a user, or null if not connected. */
export async function getStoredUserToken(
	db: MiniDatabase,
	userId: string,
): Promise<StoredUserToken | null> {
	const raw = await db.get(userId);
	if (!raw || typeof raw.accessToken !== "string" || raw.accessToken === "") return null;
	return {
		accessToken: raw.accessToken,
		refreshToken: typeof raw.refreshToken === "string" ? raw.refreshToken : undefined,
		expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : undefined,
		scope: typeof raw.scope === "string" ? raw.scope : undefined,
	};
}

/** The OAuth callback route used by this app (see vercel.json). */
export const OAUTH_CALLBACK_PATH = "/api/discord-oauth-callback";

/** Derives the absolute OAuth redirect URI for this deployment. */
export function resolveRedirectUri(origin: string): string {
	return `${origin.replace(/\/$/, "")}${OAUTH_CALLBACK_PATH}`;
}
