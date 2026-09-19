/**
 * Is this stored Discord connection still alive?
 *
 * A user token can die without the app being told. `APPLICATION_DEAUTHORIZED`
 * only reaches a configured Webhooks endpoint and Discord never replays an
 * event, so removing the app from **User Settings → Authorized Apps** leaves a
 * perfectly well-formed token in storage: `/linked-channel` (and
 * `/api/diag?user=…`) keep reporting `connected: true` while every call that
 * uses it fails with `401`. That is the state `/authorize` exists to fix, so it
 * must not trust the record — it asks Discord.
 *
 * The probe is `GET /oauth2/@me` via the package's
 * `OAuth2Builder.getAuthorizationInfo()`: it accepts a user Bearer token, needs
 * no `identify` scope (the `user` field is simply absent without it) and returns
 * the scopes that were **actually granted**, which is the thing that decides
 * whether channel linking works.
 *
 * Deliberately conservative: only a `401` means the connection is gone. A
 * timeout, a 429 or a 5xx means "could not check" and the record is kept, since
 * dropping a working connection because Discord hiccuped would be worse than
 * reporting a connection that turns out to be dead.
 *
 * Follows the Lobby rules (`src/utils/lobby-api.ts`): one client per call, no
 * retries, and a hard bound on the call so a stalled request cannot outlive the
 * interaction it is blocking.
 */

import { OAuth2Builder, OAuth2RequestError } from "@minesa-org/mini-interaction";

import { LOBBY_CALL_TIMEOUT_MS, LobbyCallTimeoutError, withTimeout } from "./lobby-api.ts";

/** What the probe learned about a stored user token. */
export type UserTokenCheck =
	| { state: "valid"; scopes: string[]; expiresAt: string | null }
	| { state: "revoked"; reason: string }
	| { state: "unknown"; reason: string };

/** The scopes `/oauth2/@me` reports, normalised to a string array. */
function scopesOf(info: unknown): string[] {
	const scopes = (info as { scopes?: unknown })?.scopes;
	if (!Array.isArray(scopes)) return [];
	return scopes.filter((scope): scope is string => typeof scope === "string" && scope !== "");
}

/** `expires` is an ISO8601 timestamp; anything else is dropped. */
function expiryOf(info: unknown): string | null {
	const expires = (info as { expires?: unknown })?.expires;
	return typeof expires === "string" && expires !== "" ? expires : null;
}

/**
 * Turns a probe failure into a verdict. Pure, so every branch is unit-testable
 * without a network.
 */
export function interpretTokenCheckError(error: unknown): UserTokenCheck {
	if (error instanceof OAuth2RequestError) {
		// 401 is what a revoked access token (and a removed app) answers. 403
		// and anything else are *not* treated as revocations: see the note at
		// the top of this file about not dropping a connection on an unrelated
		// failure.
		if (error.status === 401) {
			return {
				state: "revoked",
				reason: `Discord rejected the stored token (401${error.error ? ` ${error.error}` : ""}).`,
			};
		}
		return {
			state: "unknown",
			reason: `${error.status}${error.error ? ` ${error.error}` : ""} ${error.body}`.trim(),
		};
	}
	if (error instanceof LobbyCallTimeoutError) {
		return { state: "unknown", reason: `${error.message} The connection was not changed.` };
	}
	return {
		state: "unknown",
		reason: error instanceof Error ? error.message : String(error),
	};
}

/** Options for {@link checkUserToken} — the transport and the bound are injectable for tests. */
export type CheckUserTokenOptions = {
	/** Overrides the global `fetch`. */
	fetch?: typeof fetch;
	/** Overrides the 5 s bound. */
	timeoutMs?: number;
};

/**
 * Asks Discord whether `accessToken` still works, and which scopes it grants.
 *
 * Never throws: a failure is a verdict (`unknown`), because the caller has to
 * answer the interaction either way.
 */
export async function checkUserToken(
	accessToken: string,
	options: CheckUserTokenOptions = {},
): Promise<UserTokenCheck> {
	const clientId = process.env.DISCORD_APPLICATION_ID;
	if (!clientId) {
		return {
			state: "unknown",
			reason: "DISCORD_APPLICATION_ID is not set, so the connection cannot be verified.",
		};
	}

	// A fresh builder per call, like the Lobby clients: nothing learned from an
	// earlier response can be carried into this one.
	const oauth = new OAuth2Builder({
		clientId,
		clientSecret: process.env.DISCORD_CLIENT_SECRET,
		redirectUri: process.env.DISCORD_REDIRECT_URI,
		...(options.fetch ? { fetch: options.fetch } : {}),
	});

	try {
		const info = await withTimeout(
			"verify your connection",
			oauth.getAuthorizationInfo(accessToken),
			options.timeoutMs ?? LOBBY_CALL_TIMEOUT_MS,
		);
		return { state: "valid", scopes: scopesOf(info), expiresAt: expiryOf(info) };
	} catch (error) {
		return interpretTokenCheckError(error);
	}
}

/** One line describing a verdict, for the handlers and `/api/diag`. */
export function describeTokenCheck(check: UserTokenCheck): string {
	switch (check.state) {
		case "valid":
			return `confirmed by Discord — scopes: ${check.scopes.join(" ") || "none reported"}`;
		case "revoked":
			return check.reason;
		default:
			return `could not be verified (${check.reason})`;
	}
}
