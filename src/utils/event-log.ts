/**
 * Log of the Webhook Events this deployment received.
 *
 * Webhook Events are the only out-of-game signal for several things this app
 * cares about (a user deauthorizing it, a message posted in a linked channel),
 * and reading them otherwise means either Vercel dashboard logs or nothing at
 * all. Keeping the last few in `MiniDatabase` puts them behind `GET /api/diag`
 * — which is also how the endpoint is verified after subscribing in the Discord
 * Developer Portal.
 *
 * The `key` doubles as the delivery-dedupe marker. Discord retries a delivery
 * with exponential backoff for up to 10 minutes and does not guarantee order, so
 * an entry is written **after** the handler succeeded: a retry of a *failed*
 * delivery must run the handler again, while a duplicate of a succeeded one is
 * recognised (`hasSeenDelivery`) and skipped.
 */

import { getDb, hasDatabaseConfig } from "./database.ts";

/** MiniDatabase key holding the recent Webhook Events. */
export const WEBHOOK_EVENT_LOG_KEY = "diag:webhook-events";

/** Enough to watch a test session; each entry is one line plus a short summary. */
const MAX_ENTRIES = 20;
const MAX_SUMMARY = 240;

export type WebhookEventRecord = {
	/** ISO timestamp of when this deployment received it. */
	at: string;
	/** Event name (`APPLICATION_DEAUTHORIZED`, `LOBBY_MESSAGE_CREATE`, `PING`, …). */
	type: string;
	/** One line describing what the event carried. */
	summary: string;
	/** Dedupe key — Discord redelivers the same payload on failure. */
	key?: string;
	/** What the handler did with it, for the ones that do something. */
	handled?: string;
};

/** Prepends an entry, keeping the newest `max`. Pure, so it is unit tested. */
export function appendEvent(
	existing: WebhookEventRecord[],
	record: WebhookEventRecord,
	max = MAX_ENTRIES,
): WebhookEventRecord[] {
	return [{ ...record, summary: record.summary.slice(0, MAX_SUMMARY) }, ...existing].slice(0, max);
}

/**
 * True when this exact delivery was already processed **successfully**.
 *
 * Only the retained window is searched, which covers the same 10-minute window
 * in which Discord retries; an older duplicate has expired from the log, and
 * handling it again only repeats the same notification.
 */
export function hasSeenEvent(existing: WebhookEventRecord[], key: string | undefined): boolean {
	if (!key) return false;
	return existing.some((entry) => entry.key === key);
}

function isRecord(value: unknown): value is WebhookEventRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Partial<WebhookEventRecord>;
	return typeof record.type === "string" && typeof record.at === "string";
}

/** Newest first; never throws (a diagnostic must not break the request). */
export async function getRecentEvents(): Promise<WebhookEventRecord[]> {
	if (!hasDatabaseConfig()) return [];
	try {
		const raw = await getDb().get(WEBHOOK_EVENT_LOG_KEY);
		const entries = raw?.events;
		return Array.isArray(entries) ? entries.filter(isRecord) : [];
	} catch {
		return [];
	}
}

/** True when this delivery already succeeded (see the note on `key`). */
export async function hasSeenDelivery(key: string | undefined): Promise<boolean> {
	if (!key) return false;
	return hasSeenEvent(await getRecentEvents(), key);
}

/** Appends an entry. Never throws: losing a log line must not fail a delivery. */
export async function recordWebhookEvent(record: WebhookEventRecord): Promise<void> {
	if (!hasDatabaseConfig()) return;
	try {
		await getDb().set(WEBHOOK_EVENT_LOG_KEY, {
			events: appendEvent(await getRecentEvents(), record),
		});
	} catch (error) {
		console.error("[webhook-events] could not record the event:", error);
	}
}
