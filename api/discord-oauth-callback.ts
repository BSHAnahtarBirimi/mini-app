import { getDiscordUser, getOAuthTokens } from "@minesa-org/mini-interaction";

import { getDb, updateDiscordMetadata } from "../src/utils/database.js";
import { recordInteractionError, describeError } from "../src/utils/interaction-errors.js";
import { hasSocialLayerScope } from "../src/utils/lobby-oauth.js";
import { connectedPage, failedPage } from "../src/utils/oauth-pages.js";

/**
 * OAuth2 callback. Exchanges the code, stores tokens in MiniDatabase and writes
 * the `is_miniapp` role-connection metadata for the user.
 *
 * This is deliberately not `mini.discordOAuthCallback()`: that helper renders
 * every branch — including its own error path — by reading an HTML file at
 * request time, and those files are not in the function bundle, so the endpoint
 * answered `FUNCTION_INVOCATION_FAILED` for every request and could never report
 * why. The flow is the same, the pages come from `src/utils/oauth-pages.ts`, and
 * a failure now says what happened and is recorded for `GET /api/diag`.
 *
 * Tokens are stored under the user's Discord id with the shape
 * `src/utils/lobby-tokens.ts` reads (`accessToken`, `refreshToken`, `expiresAt`,
 * `scope`) — that record is what channel linking uses afterwards.
 */

const COOKIE_NAME = "mini_oauth_state";

type OAuthRequest = {
	url?: string;
	headers?: Record<string, string | string[] | undefined>;
};
type OAuthResponse = {
	statusCode?: number;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

function sendHtml(res: OAuthResponse, html: string): void {
	res.statusCode = 200;
	res.setHeader("Content-Type", "text/html; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(html);
}

/** Reads one cookie from the raw header (no cookie parser in the runtime). */
function readCookie(req: OAuthRequest, name: string): string | null {
	const header = req.headers?.cookie;
	const raw = Array.isArray(header) ? header.join("; ") : header;
	if (!raw) return null;
	for (const part of raw.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return decodeURIComponent(rest.join("="));
	}
	return null;
}

export default async function handler(req: OAuthRequest, res: OAuthResponse): Promise<void> {
	const redirectUri = process.env.DISCORD_REDIRECT_URI;
	const requestUrl = new URL(req.url ?? "/", redirectUri ?? "http://localhost");
	const error = requestUrl.searchParams.get("error");
	const code = requestUrl.searchParams.get("code");
	const state = requestUrl.searchParams.get("state");
	const cookieState = readCookie(req, COOKIE_NAME);

	// The cookie is single-use: clear it on every outcome so a stale state value
	// cannot make a later attempt look invalid.
	const clearStateCookie = () =>
		res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

	if (error) {
		clearStateCookie();
		sendHtml(
			res,
			failedPage({
				heading: "Authorization cancelled",
				message: `Discord returned \`${error}\`. Nothing was stored.`,
				detail: requestUrl.searchParams.get("error_description") ?? undefined,
			}),
		);
		return;
	}

	if (!code) {
		sendHtml(
			res,
			failedPage({
				message:
					"This page is the OAuth callback, so it needs a `code` parameter. Open the Connect Discord page and start the flow from there.",
			}),
		);
		return;
	}

	if (state && cookieState && state !== cookieState) {
		clearStateCookie();
		sendHtml(
			res,
			failedPage({
				message:
					"The OAuth state did not match the session cookie, so the response was rejected. Start the flow again from the Connect Discord page in the same browser.",
			}),
		);
		return;
	}

	const appId = process.env.DISCORD_APPLICATION_ID ?? process.env.DISCORD_APP_ID;
	const appSecret = process.env.DISCORD_CLIENT_SECRET;
	if (!appId || !appSecret || !redirectUri) {
		const missing = [
			!appId && "DISCORD_APPLICATION_ID",
			!appSecret && "DISCORD_CLIENT_SECRET",
			!redirectUri && "DISCORD_REDIRECT_URI",
		]
			.filter(Boolean)
			.join(", ");
		sendHtml(
			res,
			failedPage({
				message: `The deployment is missing ${missing}, so the authorization code cannot be exchanged.`,
			}),
		);
		return;
	}

	try {
		const tokens = await getOAuthTokens(code, { appId, appSecret, redirectUri });
		const user = await getDiscordUser(tokens.access_token);

		// Stored first: `/linked-channel` needs this record even if the
		// linked-roles call below is rejected.
		await getDb().set(user.id, {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: tokens.expires_at,
			scope: tokens.scope,
		});

		try {
			await updateDiscordMetadata(user.id, tokens.access_token);
		} catch (metadataError) {
			// A Social SDK authorization (`openid sdk.social_layer`) carries no
			// `role_connections.write`, so this PUT is rejected with 403. That
			// must not fail the connection — the token above is already stored
			// and it is the one channel linking needs.
			console.error("[oauth] linked-role metadata update failed:", metadataError);
		}

		clearStateCookie();
		sendHtml(
			res,
			connectedPage({
				scope: tokens.scope,
				hasSocialLayer: hasSocialLayerScope(tokens.scope),
			}),
		);
	} catch (exchangeError) {
		// Recorded so `/api/diag` can explain it: this is an interaction-visible
		// failure the user cannot otherwise diagnose.
		await recordInteractionError(exchangeError, "discord-oauth-callback");
		sendHtml(
			res,
			failedPage({
				message:
					"Discord rejected the authorization code. Codes are single-use and short-lived — start the flow again.",
				detail: describeError(exchangeError),
			}),
		);
	}
}
