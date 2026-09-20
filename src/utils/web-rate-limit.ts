/**
 * The per-visitor quota on the web app's messages.
 *
 * `api/message.ts` is intentionally open — no account, no token — and a single
 * submission posts into **every** linked channel this app maintains. That makes
 * a limit mandatory rather than nice to have: without one, one script is enough
 * to flood every server the app is in.
 *
 * The window is per IP and lives in `MiniDatabase` (keyed `web-msg-rate:<ip>`),
 * because a serverless deployment serves consecutive requests from different
 * instances — an in-memory counter would be per instance and therefore useless.
 * Per-IP records also avoid the read-modify-write race a single shared counter
 * document would have.
 *
 * The decision itself is a pure function so the behaviour at the boundary (the
 * message that is refused, and what `Retry-After` should say) is testable
 * without a database.
 */

import { getDb, hasDatabaseConfig } from "./database.ts";

/** How long the quota window is. */
export const WINDOW_MS = 60_000;

/** How many messages one visitor may send inside one window. */
export const MAX_PER_WINDOW = 5;

/** MiniDatabase key prefix: one record per visitor IP. */
export const WEB_RATE_KEY_PREFIX = "web-msg-rate:";

export const rateKeyFor = (ip: string) => `${WEB_RATE_KEY_PREFIX}${ip}`;

/**
 * MiniDatabase key prefix: one record per **member** (the `/mesaj` command).
 *
 * A separate namespace on purpose. The web endpoint is limited per address
 * because it has no accounts; the command is limited per member because a member
 * is who it has. Sharing one prefix would let an address and a snowflake occupy
 * the same key, and the two limits would then interfere for no reason.
 */
export const COMMAND_RATE_KEY_PREFIX = "cmd-msg-rate:";

export const commandRateKeyFor = (userId: string) => `${COMMAND_RATE_KEY_PREFIX}${userId}`;

/**
 * MiniDatabase key prefix: the `/echo` command, keyed per member.
 *
 * A third namespace, for the same reason the second one exists: `/echo` posts
 * into every lobby as the member (`POST /lobbies/{id}/messages`), so it is
 * limited per person like `/mesaj` — but the two are different actions and
 * must not spend each other's budget. Sharing a prefix would mean a member who
 * echoed once could no longer broadcast, which is a limit nobody could explain.
 */
export const ECHO_RATE_KEY_PREFIX = "cmd-echo-rate:";

export const echoRateKeyFor = (userId: string) => `${ECHO_RATE_KEY_PREFIX}${userId}`;

/** Drops timestamps that have fallen out of the window. Pure. */
export function pruneTimestamps(
	timestamps: number[],
	now: number,
	windowMs: number = WINDOW_MS,
): number[] {
	return timestamps.filter((at) => typeof at === "number" && now - at < windowMs);
}

export type QuotaDecision = {
	allowed: boolean;
	/** How many further messages this window still allows. */
	remaining: number;
	/** Seconds until the window frees up, for `Retry-After`. */
	retryAfterSeconds: number;
};

/**
 * Whether one more message is allowed, given the recent ones. Pure.
 *
 * A refusal waits for the **oldest** timestamp in the window rather than the
 * window end, which is what makes the limit a sliding window instead of a fixed
 * one that lets a caller burst across a boundary.
 */
export function decideQuota(
	timestamps: number[],
	now: number,
	max: number = MAX_PER_WINDOW,
	windowMs: number = WINDOW_MS,
): QuotaDecision {
	const recent = pruneTimestamps(timestamps, now, windowMs);
	if (recent.length < max) {
		return { allowed: true, remaining: max - recent.length - 1, retryAfterSeconds: 0 };
	}
	const oldest = Math.min(...recent);
	return {
		allowed: false,
		remaining: 0,
		retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
	};
}

export type QuotaResult = QuotaDecision & {
	/**
	 * False when this deployment has no database, so nothing could be counted.
	 * Reported rather than pretended, and the caller still answers — a missing
	 * `MONGODB_URI` already means no channel is linked, so there is nothing to
	 * flood.
	 */
	enforced: boolean;
};

function isTimestampArray(value: unknown): value is number[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "number");
}

/**
 * Counts one attempt against `key`'s quota, or refuses it.
 *
 * A database failure is treated as "allow, not enforced": the point of the limit
 * is abuse, and a storage outage must not take the feature down with it.
 */
async function consume(key: string, what: string, now: number): Promise<QuotaResult> {
	if (!hasDatabaseConfig()) {
		return { allowed: true, remaining: MAX_PER_WINDOW - 1, retryAfterSeconds: 0, enforced: false };
	}

	try {
		const raw = await getDb().get(key);
		const timestamps = isTimestampArray(raw?.timestamps) ? raw.timestamps : [];
		const decision = decideQuota(timestamps, now);
		if (!decision.allowed) return { ...decision, enforced: true };

		await getDb().set(key, { timestamps: [...pruneTimestamps(timestamps, now), now] });
		return { ...decision, enforced: true };
	} catch (error) {
		console.error(`[web-rate-limit] could not record the ${what}:`, error);
		return { allowed: true, remaining: 0, retryAfterSeconds: 0, enforced: false };
	}
}

/** Counts this message against the visitor's (IP's) quota, or refuses it. */
export async function consumeQuota(ip: string, now: number = Date.now()): Promise<QuotaResult> {
	return await consume(rateKeyFor(ip), "message", now);
}

/**
 * The same window for a **member** running `/mesaj`.
 *
 * One invocation posts into every linked channel the app maintains, so a member
 * who repeats it is broadcasting to every server repeatedly — the limit exists
 * for the same reason the web app's does.
 */
export async function consumeCommandQuota(
	userId: string,
	now: number = Date.now(),
): Promise<QuotaResult> {
	return await consume(commandRateKeyFor(userId), "command", now);
}

/**
 * The same window for a **member** running `/echo`.
 *
 * It posts into the game's own message stream once per linked lobby, so it is
 * limited for the same reason the other two are — and in its own namespace, so
 * echoing does not consume the member's `/mesaj` budget.
 */
export async function consumeEchoQuota(
	userId: string,
	now: number = Date.now(),
): Promise<QuotaResult> {
	return await consume(echoRateKeyFor(userId), "echo", now);
}
