/**
 * Keeping the stored lobby usable.
 *
 * A Social SDK lobby is a *session* object, not durable state: Discord reaps it
 * when it goes idle (the create call even takes `idle_timeout_seconds`, and the
 * response carries `idle_timeout_seconds` back). The `/linked-channel` flow
 * stores one lobby per guild, so a link attempted a while after the panel
 * provisioned it is answered with **`404 Unknown Lobby`** — which surfaces to the
 * admin as "Discord rejected the link" with no hint about what to do.
 *
 * The recovery here is deliberately bounded: create one fresh lobby (the member
 * performing the operation gets `CanLinkLobby`) and let the caller retry that
 * operation **exactly once**. Channel linking is capped at 20 calls per 2 hours
 * per application while the app is unapproved, so a stale id must never become a
 * retry loop.
 */

import { DiscordRestApiError, LobbyMemberFlags } from "@minesa-org/mini-interaction";

import { createLobby } from "./lobby-api.ts";
import { setLobbyRecord } from "./lobby-store.ts";
import type { LobbyRecord } from "./lobby-store.ts";

/**
 * True when Discord answered "unknown lobby" — the stored id no longer exists.
 *
 * 404 is also what an unknown *route* returns, so this is only treated as
 * "expired" where a lobby id is already known to be well-formed (i.e. the id we
 * stored ourselves from a successful create).
 */
export function isUnknownLobbyError(error: unknown): boolean {
	return error instanceof DiscordRestApiError && error.status === 404;
}

/**
 * Creates a lobby for this guild and stores it. Every member listed gets
 * `CanLinkLobby` (`1 << 0`) — without that flag a member can neither link nor
 * unlink channels, and the creator is the first id given.
 */
export async function provisionLobby(
	guildId: string,
	memberIds: string[],
): Promise<LobbyRecord> {
	const members = [...new Set(memberIds)]
		.filter((id) => id.length > 0)
		.map((id) => ({ id, flags: LobbyMemberFlags.CanLinkLobby }));

	const lobby = await createLobby(members);
	const record: LobbyRecord = {
		lobbyId: lobby.id,
		creatorId: members[0]?.id ?? "",
		createdAt: new Date().toISOString(),
	};
	await setLobbyRecord(guildId, record);
	return record;
}
