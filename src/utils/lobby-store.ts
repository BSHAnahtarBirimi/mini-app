/**
 * Lobby storage on MiniDatabase, keyed per guild (`lc:${guildId}`) — the same
 * storage the OAuth callback (`api/discord-oauth-callback.ts`) uses for user
 * tokens (keyed by user id).
 *
 * Stores the Social SDK lobby id for this guild plus the id of the Discord
 * user who created it (the member who receives the CanLinkLobby flag).
 */

import { getDb } from "./database.ts";

export const lobbyKeyFor = (guildId: string) => `lc:${guildId}`;

/**
 * Index of the guilds this app has provisioned a lobby for.
 *
 * `MiniDatabase` can only read a key you already know, and the Webhook Events
 * handler has to start from a *user* id (Discord's `APPLICATION_DEAUTHORIZED`
 * payload carries the user and nothing else). Indexing the guilds on write is
 * what lets it walk the lobbies it manages and find the ones whose link belongs
 * to that user.
 */
export const LOBBY_GUILD_INDEX_KEY = "lc:guilds";

/** Adds a guild to the index, keeping the newest entries first. */
export function withGuild(list: string[], guildId: string, max = 200): string[] {
	if (guildId === "") return list;
	return [guildId, ...list.filter((id) => id !== guildId)].slice(0, max);
}

/**
 * Guilds to consider when looking for a stored lobby: both lists, no duplicates,
 * newest-signal-first order. Pure so the merge rule is unit testable.
 */
export function unionGuilds(...lists: string[][]): string[] {
	return [...new Set(lists.flat().filter((id) => id !== ""))];
}

/**
 * Records a guild in the index without touching its lobby record.
 *
 * Called wherever a stored lobby is read as well as written: records created
 * before the index existed (or by an older deployment) would otherwise be
 * invisible to the deauthorize webhook, which can only start from a user id.
 */
export async function indexLobbyGuild(guildId: string): Promise<void> {
	await getDb().set(LOBBY_GUILD_INDEX_KEY, { guilds: withGuild(await listLobbyGuilds(), guildId) });
}

/** Every guild with a stored lobby record. */
export async function listLobbyGuilds(): Promise<string[]> {
	const raw = await getDb().get(LOBBY_GUILD_INDEX_KEY);
	const guilds = raw?.guilds;
	return Array.isArray(guilds) ? guilds.filter((id): id is string => typeof id === "string") : [];
}

export type LobbyRecord = {
	/** Social SDK lobby id (snowflake as string — don't lose precision). */
	lobbyId: string;
	/** Discord user id of the member who created the lobby. */
	creatorId: string;
	/** ISO timestamp of creation. */
	createdAt: string;
};

/** Loads the lobby record for a guild, or null if none exists. */
export async function getLobbyRecord(guildId: string): Promise<LobbyRecord | null> {
	const raw = await getDb().get(lobbyKeyFor(guildId));
	if (!raw) return null;
	const lobbyId = typeof raw.lobbyId === "string" ? raw.lobbyId : null;
	const creatorId = typeof raw.creatorId === "string" ? raw.creatorId : null;
	if (!lobbyId || !creatorId) return null;
	return { lobbyId, creatorId, createdAt: String(raw.createdAt ?? "") };
}

/** Creates (or replaces) the guild's lobby record, indexing the guild. */
export async function setLobbyRecord(guildId: string, record: LobbyRecord): Promise<boolean> {
	const stored = await getDb().set(lobbyKeyFor(guildId), { ...record });
	try {
		await indexLobbyGuild(guildId);
	} catch (error) {
		// The lobby itself is stored; a stale index only means the deauthorize
		// webhook cannot find this guild. Never fail the caller for it.
		console.error("[lobby-store] could not index the guild:", error);
	}
	return stored;
}

/** Deletes the guild's lobby record. */
export function deleteLobbyRecord(guildId: string): Promise<boolean> {
	return getDb().delete(lobbyKeyFor(guildId));
}
