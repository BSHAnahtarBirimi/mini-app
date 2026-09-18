/**
 * Discord Social SDK Lobby HTTP API — minimal typed client.
 *
 * These endpoints are documented in Discord's Lobby resource
 * (docs.discord.com/developers/resources/lobby). Two auth modes matter:
 *
 * - **User OAuth2 Bearer token** — REQUIRED for channel linking/unlinking and
 *   for invite generation. The bot token is rejected. The user token MUST
 *   carry the `openid sdk.social_layer` scope; `sdk.social_layer` is a
 *   LIMITED ACCESS scope that requires a Social SDK access request from
 *   Discord (see docs.discord.com/developers/discord-social-sdk/core-concepts/oauth2-scopes).
 * - **Bot token** — used for server-side lobby creation/membership only.
 *
 * Development rate limits (per APPLICATION, not per user):
 *   PATCH /lobbies/{id}/channel-linking  → 20 per 2 hours
 *   invite endpoints                     → 100 per 2 hours
 * Never retry a failed link in a loop — surface the error to the user instead.
 */

const API_BASE = "https://discord.com/api/v10";

/**
 * Lobby member flags bitfield. `CanLinkLobby` is bit 0 (1 << 0). Without it a
 * member can neither link nor unlink a channel for the lobby.
 */
export const LobbyMemberFlags = {
	CanLinkLobby: 1 << 0,
} as const;

/** Shape returned by the lobby endpoints (subset the app consumes). */
export interface LobbyPayload {
	id: string;
	application_id: string;
	linked_channel?: unknown;
}

/** Minimal lobby member object used when creating lobbies. */
export interface LobbyMemberInput {
	id: string;
	flags?: number;
}

/** Local structural types (do NOT import from discord-api-types/v10). */
export interface LobbyOverwrite {
	id: string;
	type: number;
	allow?: string;
	deny?: string;
}

/** Channel subset returned by GET /guilds/{id}/channels. */
export interface GuildChannel {
	id: string;
	name?: string;
	type: number;
	permission_overwrites?: LobbyOverwrite[];
}

export class LobbyApiError extends Error {
	readonly status: number;
	readonly code?: number;

	constructor(message: string, status: number, code?: number) {
		super(message);
		this.name = "LobbyApiError";
		this.status = status;
		this.code = code;
	}
}

async function request(
	path: string,
	init: { method: string; auth: string; body?: unknown },
): Promise<unknown> {
	const response = await fetch(`${API_BASE}${path}`, {
		method: init.method,
		headers: {
			Authorization: `Bearer ${init.auth}`,
			"Content-Type": "application/json",
		},
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});

	if (!response.ok) {
		let code: number | undefined;
		let message = `${response.status} ${response.statusText}`;
		try {
			const payload = (await response.json()) as { message?: string; code?: number };
			if (payload.message) message = `${response.status} — ${payload.message}`;
			code = payload.code;
		} catch {
			// keep the status-line message
		}
		throw new LobbyApiError(message, response.status, code);
	}

	if (response.status === 204) return {};
	return response.json();
}

/** Creates a lobby with the given members (bot auth). Returns the lobby. */
export async function createLobby(
	botToken: string,
	applicationId: string,
	members: LobbyMemberInput[],
): Promise<LobbyPayload> {
	return (await request("/lobbies", {
		method: "POST",
		auth: botToken,
		body: {
			application_id: applicationId,
			members,
		},
	})) as LobbyPayload;
}

/**
 * Links `channelId` to `lobbyId` (USER token). Requires `sdk.social_layer`
 * scope and CanLinkLobby. Cap: 20 calls / 2 h per application while the app
 * is unapproved — do not retry; let the caller show the error.
 */
export async function linkChannelToLobby(
	lobbyId: string,
	channelId: string,
	userToken: string,
): Promise<LobbyPayload> {
	return (await request(`/lobbies/${lobbyId}/channel-linking`, {
		method: "PATCH",
		auth: userToken,
		body: { channel_id: channelId },
	})) as LobbyPayload;
}

/** Unlinks any linked channel from `lobbyId` (USER token, empty body). */
export async function unlinkChannelFromLobby(
	lobbyId: string,
	userToken: string,
): Promise<LobbyPayload> {
	return (await request(`/lobbies/${lobbyId}/channel-linking`, {
		method: "PATCH",
		auth: userToken,
	})) as LobbyPayload;
}

/**
 * Creates a single-use invite (1 hour expiry) to the lobby's linked channel
 * for the calling user (USER token + `sdk.social_layer`).
 */
export async function createLobbyChannelInviteForSelf(
	lobbyId: string,
	userToken: string,
): Promise<{ code: string }> {
	return (await request(`/lobbies/${lobbyId}/members/@me/invites`, {
		method: "POST",
		auth: userToken,
	})) as { code: string };
}

/** Lists a guild's channels (bot auth) — used to build the channel menu. */
export async function listGuildChannels(
	guildId: string,
	botToken: string,
): Promise<GuildChannel[]> {
	return (await request(`/guilds/${guildId}/channels`, {
		method: "GET",
		auth: botToken,
	})) as GuildChannel[];
}
