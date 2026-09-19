import { generateOAuthUrl } from "@minesa-org/mini-interaction";

import { connectPage } from "../src/utils/oauth-pages.js";

/**
 * `Connect Discord` start page (served at `/`).
 *
 * Starts the linked-roles OAuth flow: it sets the `mini_oauth_state` cookie the
 * callback compares against and redirects to Discord's consent screen.
 *
 * The page is rendered from `src/utils/oauth-pages.ts`, not read from a file:
 * Vercel ships `index.html` and `public/**` as static output but not inside the
 * function, so `readFile` there fails and the function returns
 * `FUNCTION_INVOCATION_FAILED`.
 *
 * Note the scopes: `openid sdk.social_layer` — the scope channel linking needs —
 * is deliberately **not** requested here. It is limited access, and asking for
 * it in a flow where it has not been granted would make Discord reject the whole
 * authorization. The `/linked-channel` panel's Reconnect button covers it.
 */

const LINKED_ROLES_SCOPES = [
	"applications.commands",
	"identify",
	"guilds",
	"role_connections.write",
];

type OAuthRequest = { url?: string };
type OAuthResponse = {
	statusCode?: number;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

export default async function handler(_req: OAuthRequest, res: OAuthResponse): Promise<void> {
	const appId = process.env.DISCORD_APPLICATION_ID ?? process.env.DISCORD_APP_ID;
	const appSecret = process.env.DISCORD_CLIENT_SECRET;
	const redirectUri = process.env.DISCORD_REDIRECT_URI;

	let oauthUrl: string | null = null;
	if (appId && appSecret && redirectUri) {
		const { url, state } = generateOAuthUrl(
			{ appId, appSecret, redirectUri },
			LINKED_ROLES_SCOPES,
		);
		res.setHeader(
			"Set-Cookie",
			`mini_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`,
		);
		oauthUrl = url;
	}

	res.statusCode = 200;
	res.setHeader("Content-Type", "text/html; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(connectPage(oauthUrl));
}
