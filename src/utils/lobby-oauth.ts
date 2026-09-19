/**
 * OAuth URL builder for the user-token flows this app needs.
 *
 * `sdk.social_layer` is a LIMITED ACCESS scope — it is only granted to apps
 * accepted into Discord's Social SDK communication-features program. Until
 * approval, the token exchange works only for allow-listed apps and channel
 * linking is capped at 20 calls per 2 hours per application.
 */

import { OAuth2Builder } from "@minesa-org/mini-interaction";

/**
 * The slash command that (re-)authorizes this app, for messages that tell the
 * user to restore their connection.
 */
export const AUTHORIZE_COMMAND = "/authorize";

/**
 * What to say when Discord answers a user-token call with `401`.
 *
 * A token can be revoked without the app being told (the deauthorization event
 * only reaches a configured Webhooks endpoint, and Discord never replays it),
 * so the stored record keeps looking valid while every call fails. The handlers
 * that see a 401 drop the record — this is the wording they use, so the next
 * step is the same everywhere.
 */
export const REVOKED_CONNECTION_HINT =
	"⚠️ **Your Discord connection was revoked.** Discord rejected the stored token (401), so it has been cleared — run `/authorize` to grant it again, then retry.";

/**
 * True if a stored OAuth scope string grants the Social SDK scope
 * (`openid sdk.social_layer` is what Linked Channels needs).
 */
export function hasSocialLayerScope(scope: string | undefined | null): boolean {
	if (!scope) return false;
	return scope.split(/\s+/).includes("sdk.social_layer");
}

/**
 * Builds the "Reconnect Discord" authorize URL via the package's
 * `OAuth2Builder.communication({ clientId, clientSecret, redirectUri })`
 * (`openid sdk.social_layer`), with `prompt=consent` so re-consent is forced
 * and the added scope is actually granted. `clientSecret` is not embedded in
 * the URL — it is only needed server-side when exchanging the code.
 */
export function buildSocialSdkOAuthUrl(options: {
	clientId: string;
	clientSecret?: string;
	redirectUri: string;
}): string {
	return OAuth2Builder.communication({
		clientId: options.clientId,
		clientSecret: options.clientSecret,
		redirectUri: options.redirectUri,
	}).toURL();
}
