/**
 * Lobby storage on MiniDatabase, keyed per guild (`lc:${guildId}`) — the same
 * storage the OAuth callback (`api/discord-oauth-callback.ts`) uses for user
 * tokens (keyed by user id).
 *
 * Stores the Social SDK lobby id for this guild plus the id of the Discord
 * user who created it (the member who receives the CanLinkLobby flag).
 */

import type { MiniDatabase } from "@minesa-org/mini-interaction";

export const lobbyKeyFor = (guildId: string) => `lc:${guildId}`;

export type LobbyRecord = {
	/** Social SDK lobby id (snowflake as string — don't lose precision). */
	lobbyId: string;
	/** Discord user id of the member who created the lobby. */
	creatorId: string;
	/** ISO timestamp of creation. */
	createdAt: string;
};

/** Loads the lobby record for a guild, or null if none exists. */
export async function getLobbyRecord(
	db: MiniDatabase,
	guildId: string,
): Promise<LobbyRecord | null> {
	const raw = await db.get(lobbyKeyFor(guildId));
	if (!raw) return null;
	const lobbyId = typeof raw.lobbyId === "string" ? raw.lobbyId : null;
	const creatorId = typeof raw.creatorId === "string" ? raw.creatorId : null;
	if (!lobbyId || !creatorId) return null;
	return { lobbyId, creatorId, createdAt: String(raw.createdAt ?? "") };
}

/** Creates (or replaces) the guild's lobby record. */
export function setLobbyRecord(
	db: MiniDatabase,
	guildId: string,
	record: LobbyRecord,
): Promise<boolean> {
	return db.set(lobbyKeyFor(guildId), { ...record });
}

/** Deletes the guild's lobby record. */
export function deleteLobbyRecord(db: MiniDatabase, guildId: string): Promise<boolean> {
	return db.delete(lobbyKeyFor(guildId));
}
