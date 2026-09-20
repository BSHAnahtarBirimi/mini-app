/**
 * Authorization for the Activity (`/activity`, and the root when Discord loads
 * it in an Activity frame).
 *
 * A Discord Activity is an iframe served by Discord. Discord's client performs
 * the OAuth consent itself (`sdk.commands.authorize`) and hands the frame a
 * short-lived `code`; only the **server** may turn that code into an access
 * token, because the exchange needs the application's client secret. That
 * exchange is the whole reason `api/activity.ts` exists — the browser never sees
 * the secret, and the token it receives is scoped to the person using the
 * Activity.
 *
 * The scopes are deliberately minimal (`identify`, `guilds`). The Activity does
 * not post to a lobby with *its* token: delivery goes through
 * `POST /api/message`, which uses each server's own stored member connection
 * (`src/utils/lobby-broadcast.ts`). So the Activity itself needs no
 * `sdk.social_layer` — and asking for it would make authorization fail outright
 * on an app that has not been accepted into Discord's Social SDK program, even
 * though every linked channel would still work.
 *
 * The exchange follows Discord's own Activity sample exactly: an
 * `application/x-www-form-urlencoded` POST to `/oauth2/token` with
 * `grant_type=authorization_code`, and **no `redirect_uri`** — the SDK's
 * `authorize` command performs no redirect, so there is none to send, and
 * including one that does not match is a hard rejection.
 */

/** The scopes the Activity asks for. `identify` is what the client can grant. */
export const ACTIVITY_SCOPES = ["identify", "guilds"] as const;

/** Discord's token endpoint — the same host the SDK's client calls. */
export const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";

/** What the Activity needs to know before it can authorize at all. */
export type ActivityConfig = {
	/** The application's id, which the SDK needs to construct itself. */
	clientId: string | null;
	/** Whether the server-side code exchange can run. */
	tokenExchange: boolean;
};

/**
 * Reads the Activity's configuration from the environment.
 *
 * Deliberately returns no secret: the client id is public (it is in every OAuth
 * URL), and the secret is only reported as present-or-not. This is what
 * `/api/activity` answers with, so an Activity that cannot authorize says which
 * variable is missing instead of failing silently.
 */
export function activityConfig(): ActivityConfig {
	const clientId = process.env.DISCORD_APPLICATION_ID ?? process.env.DISCORD_APP_ID ?? null;
	return {
		clientId: clientId ?? null,
		tokenExchange: Boolean(clientId && process.env.DISCORD_CLIENT_SECRET),
	};
}

/** A code that has been turned into an access token. */
export type ActivityToken = {
	accessToken: string;
	/** Granted scopes, as Discord reports them. */
	scope: string | null;
	/** Lifetime in seconds, when Discord sends one. */
	expiresIn: number | null;
};

/**
 * A failed code exchange, with Discord's own status and reason.
 *
 * Fields are assigned in the body rather than declared as constructor
 * parameters: this file is imported by the API functions through the bundler,
 * but it is checked by `src/utils/module-specifiers.test.ts`, which imports
 * every runtime module under plain Node — and Node's strip-only TypeScript
 * loader rejects parameter properties with
 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
 */
export class ActivityAuthError extends Error {
	readonly status: number | null;
	readonly reason: string;

	constructor(message: string, options: { status?: number; reason?: string } = {}) {
		super(message);
		this.name = "ActivityAuthError";
		this.status = options.status ?? null;
		this.reason = options.reason ?? message;
	}
}

/** The shape of Discord's error body, both fields optional in practice. */
type DiscordTokenError = { error?: string; error_description?: string };

/** What Discord answers on success. */
type DiscordTokenResponse = {
	access_token?: string;
	scope?: string;
	expires_in?: number;
};

/** Checks the `code` the frame handed us before spending a request on it. */
export function checkActivityCode(
	raw: unknown,
): { ok: true; code: string } | { ok: false; status: number; error: string } {
	if (typeof raw !== "string" || raw.trim() === "") {
		return { ok: false, status: 400, error: "Send the `code` the Activity received from Discord." };
	}
	// A code is opaque, but it is always a single URL-safe token. A value with
	// whitespace or a newline is a sign the caller pasted something else, and it
	// would only produce an opaque rejection from Discord.
	if (!/^[A-Za-z0-9._-]+$/.test(raw)) {
		return {
			ok: false,
			status: 400,
			error: "That does not look like an authorization code.",
		};
	}
	return { ok: true, code: raw };
}

/**
 * Turns the Activity's authorization code into an access token.
 *
 * Throws `ActivityAuthError` for every failure — a missing client secret, a
 * refusal from Discord, or a 2xx without a token — because each of them needs a
 * different answer on the page and none of them should be retried blindly.
 */
export async function exchangeActivityCode(
	code: string,
	deps: { fetchImpl?: typeof fetch } = {},
): Promise<ActivityToken> {
	const config = activityConfig();
	if (!config.clientId || !config.tokenExchange) {
		throw new ActivityAuthError(
			"This deployment cannot exchange an Activity code: set DISCORD_CLIENT_SECRET (and DISCORD_APPLICATION_ID) in the project's environment.",
			{ reason: "missing configuration" },
		);
	}

	const body = new URLSearchParams({
		client_id: config.clientId,
		client_secret: process.env.DISCORD_CLIENT_SECRET ?? "",
		grant_type: "authorization_code",
		code,
	});

	let response: Response;
	try {
		response = await (deps.fetchImpl ?? fetch)(DISCORD_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
	} catch (error) {
		throw new ActivityAuthError(
			`Could not reach Discord to exchange the code: ${error instanceof Error ? error.message : String(error)}`,
			{ reason: "network" },
		);
	}

	const text = await response.text();
	let parsed: (DiscordTokenResponse & DiscordTokenError) | null = null;
	try {
		parsed = JSON.parse(text) as DiscordTokenResponse & DiscordTokenError;
	} catch {
		// Discord answers HTML for some proxy-level failures; fall through.
	}

	if (!response.ok) {
		const reason = parsed?.error_description ?? parsed?.error ?? text.slice(0, 200);
		throw new ActivityAuthError(
			`Discord refused the code: ${response.status}${reason ? ` — ${reason}` : ""}`,
			{ status: response.status, reason: reason ?? String(response.status) },
		);
	}

	if (!parsed?.access_token) {
		throw new ActivityAuthError("Discord accepted the code but returned no access token.", {
			reason: "no token in the response",
		});
	}

	return {
		accessToken: parsed.access_token,
		scope: parsed.scope ?? null,
		expiresIn: typeof parsed.expires_in === "number" ? parsed.expires_in : null,
	};
}
