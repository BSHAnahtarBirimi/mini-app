/**
 * OAuth URL builder for the user-token flows this app needs.
 *
 * `@minesa-org/mini-interaction` (v0.9.0) does not export an `OAuth2Builder`;
 * its `generateOAuthUrl` helper defaults to `identify email` and cannot carry
 * the Social SDK scope. So we build the URL directly here, mirroring what
 * `OAuth2Builder.communication({ clientId, clientSecret, redirectUri })
 * .toURL()` would produce: a Discord authorize URL requesting
 * `openid sdk.social_layer` with `prompt=consent` so re-consent is forced and
 * the new scope is actually granted.
 *
 * NOTE: `sdk.social_layer` is a LIMITED ACCESS scope — it is only granted to
 * apps accepted into Discord's Social SDK communication-features program.
 * Until the app is approved, Discord caps channel linking at 20 calls per
 * 2 hours per application and the token exchange will still work only if
 * Discord has allow-listed the app for this scope.
 */

/** Scopes required for Linked Channels: openid + sdk.social_layer. */
export const SOCIAL_SDK_SCOPES = ["openid", "sdk.social_layer"] as const;

/** Scopes of the app's existing connect flow (insufficient for linking). */
export const LEGACY_SCOPES = [
	"applications.commands",
	"identify",
	"guilds",
	"role_connections.write",
] as const;

/** True if a stored OAuth scope string grants the Social SDK scope. */
export function hasSocialLayerScope(scope: string | undefined | null): boolean {
	if (!scope) return false;
	return scope.split(/\s+/).includes("sdk.social_layer");
}

/** Builds the "Reconnect Discord" authorize URL for the Social SDK scopes. */
export function buildSocialSdkOAuthUrl(options: {
	clientId: string;
	clientSecret?: string;
	redirectUri: string;
	state?: string;
}): string {
	const url = new URL("https://discord.com/api/oauth2/authorize");
	url.searchParams.set("client_id", options.clientId);
	url.searchParams.set("redirect_uri", options.redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", SOCIAL_SDK_SCOPES.join(" "));
	// prompt=consent forces the consent screen so the added scope is granted.
	url.searchParams.set("prompt", "consent");
	if (options.state) url.searchParams.set("state", options.state);
	// clientSecret is intentionally NOT put in the URL; it is only needed when
	// exchanging the code server-side (the callback already has it via env).
	void options.clientSecret;
	return url.toString();
}
