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
 * The client is constructed with `maxRetries: 0`: channel linking is capped
 * at **20 calls per 2 hours per application** while the app is unapproved
 * (see `LOBBY_DEVELOPMENT_RATE_LIMITS`), so a 429 must fail fast and be shown
 * to the user — never retried in a loop.
 */

import { DiscordRestClient, DiscordRestApiError } from "@minesa-org/mini-interaction";
import type {
	APILobby,
	APILobbyInvite,
	LobbyMemberInput,
} from "@minesa-org/mini-interaction";

export { DiscordRestApiError };
export type { APILobby, APILobbyInvite, LobbyMemberInput };

let client: DiscordRestClient | undefined;

function rest(): DiscordRestClient {
	client ??= new DiscordRestClient({
		token: process.env.DISCORD_BOT_TOKEN ?? "",
		applicationId: process.env.DISCORD_APPLICATION_ID ?? "",
		// Fail fast on 429/5xx: never retry a rate-limited channel link.
		maxRetries: 0,
	});
	return client;
}

/**
 * Creates a lobby with the given members (bot auth). Grant the creator
 * `flags: LobbyMemberFlags.CanLinkLobby` — without it a member can neither
 * link nor unlink channels.
 */
export async function createLobby(members: LobbyMemberInput[]): Promise<APILobby> {
	return rest().createLobby({ members });
}

/** Links `channelId` to `lobbyId` (USER token + `sdk.social_layer`). */
export async function linkChannelToLobby(
	lobbyId: string,
	channelId: string,
	userToken: string,
): Promise<APILobby> {
	return rest().linkChannelToLobby(lobbyId, channelId, userToken);
}

/** Unlinks any linked channel from `lobbyId` (USER token + `sdk.social_layer`). */
export async function unlinkChannelFromLobby(
	lobbyId: string,
	userToken: string,
): Promise<APILobby> {
	return rest().unlinkChannelFromLobby(lobbyId, userToken);
}

/**
 * Creates a single-use invite (1 hour expiry) to the lobby's linked channel
 * for the calling user (USER token + `sdk.social_layer`).
 */
export async function createLobbyChannelInviteForSelf(
	lobbyId: string,
	userToken: string,
): Promise<APILobbyInvite> {
	return rest().createLobbyChannelInviteForSelf(lobbyId, userToken);
}

/**
 * Reads a lobby (bot auth).
 *
 * Used to check whether the stored lobby still exists: lobbies are session
 * objects that Discord reaps when idle, and a stale id is answered with
 * `404 Unknown Lobby` on the next link attempt (`GET /api/diag?guild=…` reports
 * this).
 */
export async function getLobby(lobbyId: string): Promise<APILobby> {
	return rest().getLobby(lobbyId);
}

/** Lists a guild's channels (bot auth) — used to build the channel menu. */
export async function listGuildChannels(guildId: string) {
	return rest().listGuildChannels(guildId);
}

/**
 * Extracts Discord's human-readable error message from a `DiscordRestApiError`
 * body (`{"message": "...", "code": n}`), falling back to the raw status.
 */
export function describeLobbyError(error: DiscordRestApiError): string {
	try {
		const parsed = JSON.parse(error.body) as { message?: string };
		if (parsed.message) return `${error.status} — ${parsed.message}`;
	} catch {
		// body was not JSON — fall through
	}
	return `${error.status} ${error.body}`.trim() || `HTTP ${error.status}`;
}
