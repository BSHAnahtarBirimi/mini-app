/**
 * In-memory pending-link state for the /linked-channel confirm step.
 *
 * Component handlers only receive the custom id — Discord's channel select
 * menus have no per-option labels, and the interaction payload doesn't carry
 * arbitrary state between steps. The package loader matches components by
 * exact `customId` (modules.components.find(c => c.customId === custom_id)),
 * so instead of encoding the channel in the id, we persist the pending pick
 * keyed by `${userId}:${guildId}` for a short TTL.
 *
 * This is intentionally ephemeral (single serverless instance, seconds-long
 * flow). The durable per-guild lobby id lives in MiniDatabase (lobby-store).
 */

export type PendingLink = {
	channelId: string;
	channelName?: string;
	/** "public" channels skip the warning; "private"/"unknown" show it. */
	privacy: "public" | "private" | "unknown";
	createdAt: number;
};

const TTL_MS = 10 * 60 * 1000;

const pending = new Map<string, PendingLink>();

const keyOf = (userId: string, guildId: string) => `${userId}:${guildId}`;

/** Stores the user's pending channel pick, overwriting any previous one. */
export function setPendingLink(
	userId: string,
	guildId: string,
	pick: Omit<PendingLink, "createdAt">,
): void {
	pending.set(keyOf(userId, guildId), { ...pick, createdAt: Date.now() });
}

/** Returns the user's pending pick, or undefined if none/expired. */
export function getPendingLink(userId: string, guildId: string): PendingLink | undefined {
	const hit = pending.get(keyOf(userId, guildId));
	if (!hit) return undefined;
	if (Date.now() - hit.createdAt > TTL_MS) {
		pending.delete(keyOf(userId, guildId));
		return undefined;
	}
	return hit;
}

/** Clears the user's pending pick. */
export function clearPendingLink(userId: string, guildId: string): void {
	pending.delete(keyOf(userId, guildId));
}
