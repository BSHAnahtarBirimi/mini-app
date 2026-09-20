import { generateOAuthUrl } from "@minesa-org/mini-interaction";

import { activityPage } from "../src/utils/activity-page.js";
import { connectPage } from "../src/utils/oauth-pages.js";

/**
 * The root endpoint, which serves two different pages on purpose.
 *
 * - `/` is the `Connect Discord` start page: the linked-roles OAuth flow, which
 *   sets the `mini_oauth_state` cookie the callback compares against and
 *   redirects to Discord's consent screen.
 * - `/activity` (and `/` when Discord loads it in an Activity frame) is the
 *   Activity — the same "send to every linked channel" experience as the web app,
 *   inside Discord.
 *
 * They share an endpoint because Discord's URL mapping for an Activity is a
 * **prefix → target** pair, and the useful mapping is `/` → the deployment root:
 * the frame then sits at the root path, so the Activity's own assets
 * (`/activity.js`, `/vendor/…`) and API (`/api/…`) are all reachable at the paths
 * they already have. Mapping `/` to a sub-path instead would break every one of
 * them, which is the trap this arrangement avoids. The frame is recognised by the
 * parameters Discord always puts in it (`frame_id`/`instance_id`), so the plain
 * `/` a browser requests still gets the Connect page.
 *
 * Both pages are rendered from `src/utils/*` rather than read from disk: Vercel
 * ships `index.html` and `public/**` as static output but not inside the
 * function, so `readFile` there fails and the function returns
 * `FUNCTION_INVOCATION_FAILED`.
 *
 * Note the scopes: `openid sdk.social_layer` — the scope channel linking needs —
 * is deliberately **not** requested here. It is limited access, and asking for
 * it in a flow where it has not been granted would make Discord reject the whole
 * authorization. The `/linked-channel` panel's Reconnect button covers it, and
 * the Activity asks only for `identify`/`guilds` (`src/utils/activity-auth.ts`).
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

/**
 * Whether this request is the Activity rather than the Connect page.
 *
 * `?page=activity` is set by the `/activity` rewrite in `vercel.json` (a rewrite
 * may add a query parameter, and relying on the rewritten `req.url` to keep
 * `/activity` would be a guess about the platform). The frame parameters are
 * Discord's own: an Activity iframe is always loaded with `frame_id` and
 * `instance_id`, which is also how the SDK's examples read the instance.
 */
export function isActivityRequest(url: URL): boolean {
	if (url.searchParams.get("page") === "activity") return true;
	if (url.pathname === "/activity") return true;
	return url.searchParams.has("instance_id") || url.searchParams.has("frame_id");
}

function sendHtml(res: OAuthResponse, html: string): void {
	res.statusCode = 200;
	res.setHeader("Content-Type", "text/html; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(html);
}

export default async function handler(req: OAuthRequest, res: OAuthResponse): Promise<void> {
	if (isActivityRequest(new URL(req.url ?? "/", "http://localhost"))) {
		sendHtml(res, activityPage());
		return;
	}

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

	sendHtml(res, connectPage(oauthUrl));
}
