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
