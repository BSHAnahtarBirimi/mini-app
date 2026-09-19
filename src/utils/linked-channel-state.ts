/**
 * Pending-link state for the /linked-channel confirm step.
 *
 * Component handlers only receive the custom id and the loader matches
 * components by exact `customId`, so the picked channel cannot be encoded in
 * the id. It is stored in MiniDatabase instead, keyed by
 * `${userId}:${guildId}` with a short TTL.
 *
 * Why the database rather than a module-level Map: each interaction can be
 * served by a different serverless instance, so an in-memory pick is often
 * missing by the time the player presses "Link anyway" and the flow dies with
 * "this link request expired". The Map is kept only as a same-instance fast
 * path; the database is the source of truth.
 */

import { getDb } from "./database.ts";

export type PendingLink = {
	channelId: string;
	channelName?: string;
	/** "public" channels skip the warning; "private"/"unknown" show it. */
	privacy: "public" | "private" | "unknown";
	createdAt: number;
};

/** How long a picked channel stays confirmable. */
export const PENDING_LINK_TTL_MS = 10 * 60 * 1000;
const TTL_MS = PENDING_LINK_TTL_MS;

const pendingKey = (userId: string, guildId: string) => `lc-pending:${userId}:${guildId}`;

/** Same-instance cache — see the note above about serverless instances. */
const cache = new Map<string, PendingLink>();

/** True while a pending pick is inside its TTL. Pure so it is unit-testable. */
export function isFreshPendingLink(
	record: PendingLink | undefined,
	now: number = Date.now(),
): record is PendingLink {
	return record !== undefined && now - record.createdAt <= TTL_MS;
}

const isFresh = isFreshPendingLink;

/** Parses a stored pending-link record, rejecting anything malformed. */
export function parsePendingLink(raw: Record<string, unknown> | null): PendingLink | undefined {
	if (!raw || typeof raw.channelId !== "string" || raw.channelId === "") return undefined;
	const privacy =
		raw.privacy === "public" || raw.privacy === "private" || raw.privacy === "unknown"
			? raw.privacy
			: "unknown";
	return {
		channelId: raw.channelId,
		channelName: typeof raw.channelName === "string" ? raw.channelName : undefined,
		privacy,
		createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
	};
}

/**
 * Stores the user's pending channel pick, overwriting any previous one.
 * A database failure is logged, not thrown: the in-memory copy still lets the
 * flow finish when both interactions happen to hit the same instance.
 */
export async function setPendingLink(
	userId: string,
	guildId: string,
	pick: Omit<PendingLink, "createdAt">,
): Promise<void> {
	const record: PendingLink = { ...pick, createdAt: Date.now() };
	cache.set(pendingKey(userId, guildId), record);
	try {
		await getDb().set(pendingKey(userId, guildId), { ...record });
	} catch (error) {
		console.error("[linked-channel] could not persist the pending link:", error);
	}
}

/** Returns the user's pending pick, or undefined if none/expired. */
export async function getPendingLink(
	userId: string,
	guildId: string,
): Promise<PendingLink | undefined> {
	const key = pendingKey(userId, guildId);

	const cached = cache.get(key);
	if (isFresh(cached)) return cached;
	cache.delete(key);

	try {
		const stored = parsePendingLink(await getDb().get(key));
		if (isFresh(stored)) {
			cache.set(key, stored);
			return stored;
		}
	} catch (error) {
		console.error("[linked-channel] could not read the pending link:", error);
	}
	return undefined;
}

/** Clears the user's pending pick. */
export async function clearPendingLink(userId: string, guildId: string): Promise<void> {
	const key = pendingKey(userId, guildId);
	cache.delete(key);
	try {
		await getDb().delete(key);
	} catch (error) {
		console.error("[linked-channel] could not clear the pending link:", error);
	}
}
