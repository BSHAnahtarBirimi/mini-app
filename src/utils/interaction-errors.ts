/**
 * Failure log for interaction handlers.
 *
 * A deferred interaction is completed in the background, and the framework
 * swallows failures on that path — it `console.error`s them, which needs Vercel
 * dashboard access. When the completion never arrives, the user is left looking
 * at "«bot» is thinking…" with nothing to inspect and no log to read.
 *
 * Recording the failures in MiniDatabase turns that silence into data: they are
 * returned by `GET /api/diag` and reported as a problem there, so the next
 * attempt explains itself.
 */

import { getDb, hasDatabaseConfig } from "./database.ts";

/** MiniDatabase key holding the most recent interaction failures. */
export const INTERACTION_ERRORS_KEY = "diag:interaction-errors";

/** Only the last few matter, and each one is truncated. */
const MAX_ENTRIES = 5;
const MAX_DETAIL = 700;

export type InteractionErrorRecord = {
	at: string;
	/** Where it happened, e.g. `linked-channel:panel`. */
	context: string;
	message: string;
	/** Head of the stack or Discord's response body, when available. */
	detail?: string;
};

/** One-line description of a thrown value, including Discord's API errors. */
export function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

/**
 * Prepends a failure to an existing log, keeping the newest `MAX_ENTRIES`.
 * Pure so the retention and truncation rules can be unit tested.
 */
export function appendInteractionError(
	existing: InteractionErrorRecord[],
	error: unknown,
	context: string,
	at: Date = new Date(),
): InteractionErrorRecord[] {
	const detail = error instanceof Error ? error.stack : undefined;
	return [
		{
			at: at.toISOString(),
			context,
			message: describeError(error).slice(0, MAX_DETAIL),
			detail: detail?.split("\n").slice(0, 4).join("\n").slice(0, MAX_DETAIL),
		},
		...existing,
	].slice(0, MAX_ENTRIES);
}

function isRecord(value: unknown): value is InteractionErrorRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Partial<InteractionErrorRecord>;
	return typeof record.message === "string" && typeof record.context === "string";
}

/** Newest first; never throws (a diagnostic must not break the request). */
export async function getInteractionErrors(): Promise<InteractionErrorRecord[]> {
	if (!hasDatabaseConfig()) return [];
	try {
		const raw = await getDb().get(INTERACTION_ERRORS_KEY);
		const entries = raw?.entries;
		return Array.isArray(entries) ? entries.filter(isRecord) : [];
	} catch {
		return [];
	}
}

/** Prepends a failure to the log, keeping the newest `MAX_ENTRIES`. */
export async function recordInteractionError(
	error: unknown,
	context: string,
): Promise<void> {
	if (!hasDatabaseConfig()) return;
	try {
		const entries = await getInteractionErrors();
		const next = appendInteractionError(entries, error, context);
		await getDb().set(INTERACTION_ERRORS_KEY, { entries: next });
	} catch {
		// Losing a diagnostic entry must never affect the interaction itself.
	}
}
