/**
 * Lobby HTTP API access, backed by `@minesa-org/mini-interaction`'s
 * `DiscordRestClient` (v0.14.0 adds the full Lobby surface:
 * `LobbyMemberFlags`, `canLinkLobby`, `linkChannelToLobby`, …).
 *
 * Auth rules (documented by the library):
 * - Channel linking/unlinking, self-invites and lobby messages need a **user**
 *   OAuth2 Bearer token carrying the `openid sdk.social_layer` scope —
 *   limited access; requires a Social SDK access request from Discord. The
 *   bot token is rejected on these endpoints.
 * - Lobby creation/administration uses the bot token.
 *
 * Two rules this module exists to enforce, both learned from a production
 * failure where the admin was left on "«bot» is thinking…" forever:
 *
 * 1. **One client per call.** `DiscordRestClient` remembers rate-limit buckets
 *    on the instance: `updateRateLimitState()` stores `remaining`/`resetAt`
 *    from every response and `waitForBucket()` *sleeps until the bucket resets*
 *    before the next call is even attempted. The channel-linking route's bucket
 *    is the application-wide cap (20 calls / 2 h while the app is unapproved),
 *    so a single `404 Unknown Lobby` — or a `429` — on a shared client makes the
 *    *next* link call sleep for up to two hours. In a serverless function the
 *    invocation is killed at `maxDuration` long before that: nothing is linked,
 *    nothing is reported, and no error is ever recorded. A client that carries
 *    no learned state cannot do that; Discord answers for real and a 429 is
 *    shown to the admin (see also rule 2).
 * 2. **No retries.** Channel linking is capped at 20 calls per 2 hours per
 *    application while the app is unapproved, so a rate limit must fail fast
 *    and be reported — never retried in a loop.
 *
 * Bot-token calls go through the same helper: they share the client's bucket
 * bookkeeping, so they can hang in exactly the same way.
 */

import { DiscordRestClient, DiscordRestApiError } from "@minesa-org/mini-interaction";
import type {
	APILobby,
	APILobbyInvite,
	LobbyMemberInput,
} from "@minesa-org/mini-interaction";

export { DiscordRestApiError };
export type { APILobby, APILobbyInvite, LobbyMemberInput };

/**
 * How long one Lobby/Discord call may take before it is given up on.
 *
 * Discord normally answers in well under a second. This exists so that *no*
 * library behaviour — a rate-limit sleep, a stalled connection — can leave the
 * deferred interaction unanswered: the call fails with a readable error while
 * there is still time to edit the message (the interaction function runs with
 * `maxDuration: 15`).
 */
export const LOBBY_CALL_TIMEOUT_MS = 5_000;

/**
 * Thrown when Discord did not answer within `LOBBY_CALL_TIMEOUT_MS`.
 *
 * Fields are assigned in the body rather than declared as constructor
 * parameters: this file is imported **by Node at runtime** (the handlers are
 * loaded by `MiniInteraction` from raw TypeScript), and Node's strip-only
 * loader rejects TypeScript that needs transforming — parameter properties,
 * enums, namespaces — with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, taking down
 * every handler that imports this module. `src/utils/module-specifiers.test.ts`
 * imports every runtime module under plain Node to keep that from returning.
 */
export class LobbyCallTimeoutError extends Error {
	readonly operation: string;
	readonly timeoutMs: number;

	constructor(operation: string, timeoutMs: number) {
		super(`Discord did not answer \`${operation}\` within ${timeoutMs / 1000}s.`);
		this.name = "LobbyCallTimeoutError";
		this.operation = operation;
		this.timeoutMs = timeoutMs;
	}
}

/**
 * Resolves/rejects with `promise`, or rejects with `LobbyCallTimeoutError`
 * after `timeoutMs`. The timer is always cleared, so a fast call leaves nothing
 * pending behind it.
 */
export function withTimeout<T>(
	operation: string,
	promise: Promise<T>,
	timeoutMs: number = LOBBY_CALL_TIMEOUT_MS,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new LobbyCallTimeoutError(operation, timeoutMs));
		}, timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/** Test seam: `fetch` used by every client this module builds. */
let fetchImplementation: ConstructorParameters<typeof DiscordRestClient>[0]["fetchImplementation"];
/** Test seam: lets tests exercise the timeout without waiting 5 seconds. */
let callTimeoutMs = LOBBY_CALL_TIMEOUT_MS;

/** Test seam — replaces the transport (and `null` restores the global `fetch`). */
export function setLobbyFetchImplementation(
	impl: ConstructorParameters<typeof DiscordRestClient>[0]["fetchImplementation"],
): void {
	fetchImplementation = impl;
}

/** Test seam — shortens `LOBBY_CALL_TIMEOUT_MS`. */
export function setLobbyCallTimeoutMs(ms: number): void {
	callTimeoutMs = ms;
}

/**
 * A brand-new client for one call — deliberately not a module singleton.
 *
 * See rule 1 at the top of this file: a shared client sleeps out the function
 * on a stale bucket instead of talking to Discord.
 */
function freshClient(): DiscordRestClient {
	return new DiscordRestClient({
		token: process.env.DISCORD_BOT_TOKEN ?? "",
		applicationId: process.env.DISCORD_APPLICATION_ID ?? "",
		// Fail fast on 429/5xx: never retry a rate-limited channel link.
		maxRetries: 0,
		...(fetchImplementation ? { fetchImplementation } : {}),
	});
}

/** Runs one Lobby call on a fresh client, bounded by `callTimeoutMs`. */
function call<T>(operation: string, run: (client: DiscordRestClient) => Promise<T>): Promise<T> {
	let result: Promise<T>;
	try {
		result = run(freshClient());
	} catch (error) {
		return Promise.reject(error);
	}
	return withTimeout(operation, result, callTimeoutMs);
}

/**
 * Creates a lobby with the given members (bot auth). Grant the creator
 * `flags: LobbyMemberFlags.CanLinkLobby` — without it a member can neither
 * link nor unlink channels.
 */
export function createLobby(members: LobbyMemberInput[]): Promise<APILobby> {
	return call("create the lobby", (client) => client.createLobby({ members }));
}

/** Links `channelId` to `lobbyId` (USER token + `sdk.social_layer`). */
export function linkChannelToLobby(
	lobbyId: string,
	channelId: string,
	userToken: string,
): Promise<APILobby> {
	return call("link the channel", (client) =>
		client.linkChannelToLobby(lobbyId, channelId, userToken),
	);
}

/** Unlinks any linked channel from `lobbyId` (USER token + `sdk.social_layer`). */
export function unlinkChannelFromLobby(
	lobbyId: string,
	userToken: string,
): Promise<APILobby> {
	return call("unlink the channel", (client) =>
		client.unlinkChannelFromLobby(lobbyId, userToken),
	);
}

/**
 * Creates a single-use invite (1 hour expiry) to the lobby's linked channel
 * for the calling user (USER token + `sdk.social_layer`).
 */
export function createLobbyChannelInviteForSelf(
	lobbyId: string,
	userToken: string,
): Promise<APILobbyInvite> {
	return call("create your invite", (client) =>
		client.createLobbyChannelInviteForSelf(lobbyId, userToken),
	);
}

/**
 * Sends a message to a channel as the bot (bot auth).
 *
 * Used by the `APPLICATION_DEAUTHORIZED` webhook event to tell the linked
 * channel that the account which set the link up is gone. The bot needs View
 * Channel + Send Messages there, which the app's own invite URL already
 * requests.
 */
export function sendChannelMessage(
	channelId: string,
	content: string,
): Promise<{ id: string }> {
	return call("post to the linked channel", (client) =>
		client.sendMessage({ channelId, content }) as Promise<{ id: string }>,
	);
}

/**
 * Posts a message into the lobby from the calling user's account (USER token +
 * `sdk.social_layer`).
 *
 * This is the call a game makes from inside the Social SDK: the message lands
 * in the lobby's linked channel and is what the panel's "Send a test message"
 * button exercises, so the linked-channel path can be checked without a game
 * client. Requires a linked channel and a lobby membership carrying the Social
 * SDK flags.
 */
export function sendLobbyMessage(
	lobbyId: string,
	content: string,
	userToken: string,
): Promise<{ id: string }> {
	return call("post into the lobby", (client) =>
		client.sendLobbyMessage(lobbyId, { content }, userToken) as Promise<{ id: string }>,
	);
}

/** The channel a lobby currently links to, or null when it links none. */
export function linkedChannelIdOf(lobby: APILobby): string | null {
	return lobby.linked_channel?.id ?? null;
}

/**
 * Reads a lobby (bot auth).
 *
 * Used to check whether the stored lobby still exists: lobbies are session
 * objects that Discord reaps when idle, and a stale id is answered with
 * `404 Unknown Lobby` on the next link attempt (`GET /api/diag?guild=…` reports
 * this).
 */
export function getLobby(lobbyId: string): Promise<APILobby> {
	return call("read the lobby", (client) => client.getLobby(lobbyId));
}

/** Lists a guild's channels (bot auth) — used to build the channel menu. */
export function listGuildChannels(guildId: string) {
	return call("list the server's channels", (client) => client.listGuildChannels(guildId));
}

/**
 * Lists the servers the bot is a member of (bot auth).
 *
 * This is the app's own view of its servers, and the only way to enumerate the
 * guilds it may have a linked channel in: `MiniDatabase` can only read a key you
 * already know, so a stored index of guilds is blind to everything written
 * before it existed (or by an older deployment). Asking Discord, then reading
 * `lc:${guildId}` for each server, always sees every lobby the app manages.
 */
export function listBotGuilds(): Promise<{ id: string; name?: string }[]> {
	return call("list the bot's servers", (client) =>
		client.request<{ id: string; name?: string }[]>("/users/@me/guilds"),
	);
}

/**
 * Extracts Discord's human-readable error message from a `DiscordRestApiError`
 * body (`{"message": "...", "code": n}`), falling back to the raw status.
 */
export function describeLobbyError(error: unknown): string {
	if (error instanceof LobbyCallTimeoutError) {
		return `${error.message} Nothing was changed — the request was not retried.`;
	}
	if (!(error instanceof DiscordRestApiError)) {
		return error instanceof Error ? error.message : String(error);
	}
	try {
		const parsed = JSON.parse(error.body) as { message?: string };
		if (parsed.message) return `${error.status} — ${parsed.message}`;
	} catch {
		// body was not JSON — fall through
	}
	return `${error.status} ${error.body}`.trim() || `HTTP ${error.status}`;
}
