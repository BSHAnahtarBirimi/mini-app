/**
 * The outcome of the deploy-time command registration, kept where it can be read.
 *
 * Commands only become visible in Discord once a build has PUT them to
 * `/applications/{id}/commands` (`scripts/register-deploy.ts`), and that script
 * deliberately **never fails the build** — a Discord hiccup must not block a
 * deploy. The price of that is silence: the only trace of a failed registration
 * was a line in a Vercel build log, which needs dashboard access to read. This
 * is not hypothetical — the global command list sat three deploys behind the
 * code (it still held a `/launch` the app had deleted, and lacked `/mesaj`)
 * while every build "succeeded".
 *
 * Recording each attempt in MiniDatabase turns that silence into data: `GET
 * /api/diag` reports the last attempt, its scopes and each one's error, and
 * reports it as a problem when it did not complete. The same reason the
 * interaction failure log exists (`interaction-errors.ts`), applied to the
 * build instead of to an interaction.
 */

import { getDb, hasDatabaseConfig } from "./database.ts";

/** MiniDatabase key holding the most recent deploy-time registration outcome. */
export const REGISTRATION_LOG_KEY = "diag:registration";

/** One attempted registration scope and what Discord did with it. */
export type RegistrationScopeOutcome = {
	/** `global`, or `guild:<id>` for a guild-scoped registration. */
	scope: string;
	ok: boolean;
	/** Discord's reason, when the scope did not register. */
	error?: string;
};

/** The last registration attempt a deploy recorded. */
export type RegistrationRecord = {
	at: string;
	/** The commit the registering build was for, when the build knew it. */
	commit?: string;
	/** `false` when every scope failed, when none ran, or when the build skipped. */
	ok: boolean;
	/** What the build says about why nothing was attempted (e.g. no credentials). */
	reason?: string;
	scopes: RegistrationScopeOutcome[];
};

/**
 * Which scopes a deploy must register, in the order to attempt them.
 *
 * A configured `DISCORD_GUILD_ID` makes the guild-scoped PUT apply **instantly**
 * in that one server — but a guild list is not the app's command list: every
 * other server the bot is in only ever sees the **global** one. So a guild
 * configuration means *both*, guild first (fast feedback for the server being
 * developed against), global second (everywhere else). This is exactly what was
 * missing before: a guild-scoped registration alone left the global list
 * silently ageing, which is how `/mesaj` went missing outside the home server.
 *
 * Pure so the pairing is pinned by a test rather than by the build's good mood.
 */
export function deployRegistrationScopes(
	guildId: string | null | undefined,
): (string | null)[] {
	return guildId ? [guildId, null] : [null];
}

/** The label used in logs and in the recorded outcome for one scope. */
export function describeRegistrationScope(scope: string | null): string {
	return scope === null ? "global" : `guild:${scope}`;
}

/**
 * Runs `run` with `DISCORD_GUILD_ID` pinned to `scope`, restoring it afterwards.
 *
 * The library picks the registration route from this exact variable at call
 * time (`options.guildId ?? process.env.DISCORD_GUILD_ID`), and its option
 * cannot force the global route while the variable is set — `null` falls back to
 * it. So a deploy that must register **both** scopes swaps the variable per
 * call, and this helper makes that swap explicit, tested, and crash-safe: the
 * previous value is restored in a `finally`, because a build that leaks a guild
 * id into the next scope's PUT would silently re-register the wrong list.
 */
export async function withCommandScope<T>(scope: string | null, run: () => Promise<T>): Promise<T> {
	const had = "DISCORD_GUILD_ID" in process.env;
	const previous = process.env.DISCORD_GUILD_ID;
	if (scope === null) delete process.env.DISCORD_GUILD_ID;
	else process.env.DISCORD_GUILD_ID = scope;
	try {
		return await run();
	} finally {
		if (had) process.env.DISCORD_GUILD_ID = previous;
		else delete process.env.DISCORD_GUILD_ID;
	}
}

/**
 * The problem the last registration attempt describes, or null when there is
 * none. Pure so both the wording and the "what counts as a problem" rule are
 * unit tested and shared by `/api/diag`.
 */
export function describeRegistrationProblem(record: RegistrationRecord): string | null {
	if (record.ok) return null;

	const failed = record.scopes
		.filter((scope) => !scope.ok)
		.map((scope) => `${scope.scope}: ${scope.error ?? "failed"}`);
	const detail =
		failed.length > 0
			? failed.join("; ")
			: (record.reason ?? "no scope was attempted");

	return `The last deploy-time command registration did not complete (${record.at}${record.commit ? `, commit ${record.commit}` : ""}): ${detail} — Discord keeps the previous command list until a registration succeeds, so run \`npm run register\` (or re-deploy) to bring it in step.`;
}

function isScopeOutcome(value: unknown): value is RegistrationScopeOutcome {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Partial<RegistrationScopeOutcome>;
	return typeof record.scope === "string" && typeof record.ok === "boolean";
}

function isRegistrationRecord(value: unknown): value is RegistrationRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Partial<RegistrationRecord>;
	return typeof record.at === "string" && Array.isArray(record.scopes);
}

/** The last recorded attempt, or null when none exists yet. Never throws. */
export async function getRegistration(): Promise<RegistrationRecord | null> {
	if (!hasDatabaseConfig()) return null;
	try {
		const raw = await getDb().get(REGISTRATION_LOG_KEY);
		return isRegistrationRecord(raw) ? raw : null;
	} catch {
		return null;
	}
}

/** Stores one attempt's outcome. Best effort — a build must not fail on storage. */
export async function recordRegistration(record: RegistrationRecord): Promise<void> {
	if (!hasDatabaseConfig()) return;
	try {
		await getDb().set(REGISTRATION_LOG_KEY, record);
	} catch (error) {
		console.error("[register:deploy] could not record the registration outcome:", error);
	}
}
