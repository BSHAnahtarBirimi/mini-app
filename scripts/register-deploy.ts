/**
 * Registers the discovered commands during a Vercel **production** build.
 *
 * Commands only become visible in Discord once they have been PUT to
 * `/applications/{id}/commands`. Nothing in this project did that
 * automatically — it was a manual `npm run register` that also needs a local
 * `.env` — so a deployment could ship with *zero* registered commands and
 * Discord simply showed nothing when typing `/`. The build already has the
 * deployment's own credentials, so registering here keeps the registered list
 * in step with the code and needs nothing from the machine that pushed.
 *
 * Safety rules:
 * - production deployments only (a preview built from a stale branch must never
 *   overwrite the live command list, which is replaced as a whole);
 * - never register an empty discovery result (a PUT of `[]` would *delete*
 *   every command);
 * - never fail the build: problems are recorded where `/api/diag` reports them
 *   (see `src/utils/registration-log.ts`).
 *
 * The last rule is also why this file grew a companion: "never fail the build"
 * used to mean "log and vanish", and the global command list then sat three
 * deploys behind the code while every build looked green. Every scope's outcome
 * is now written to MiniDatabase, and `/api/diag` reports a failed attempt —
 * with Discord's own reason — as a deployment problem.
 */

import { MiniInteraction } from "@minesa-org/mini-interaction";

import {
	commandNames,
	loadModulesOf,
	registrationProblems,
} from "../src/utils/command-modules.js";
import { LINKED_ROLE_METADATA } from "../src/utils/role-metadata.js";
import {
	deployRegistrationScopes,
	describeRegistrationScope,
	recordRegistration,
	withCommandScope,
} from "../src/utils/registration-log.js";
import type { RegistrationScopeOutcome } from "../src/utils/registration-log.js";

const log = (message: string) => console.log(`[register:deploy] ${message}`);
const reasonFor = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const applicationId = process.env.DISCORD_APPLICATION_ID ?? process.env.DISCORD_APP_ID;
const botToken = process.env.DISCORD_BOT_TOKEN ?? process.env.DISCORD_TOKEN;

if (process.env.VERCEL_ENV !== "production") {
	log(`skipped — VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"} (production deploys only)`);
} else if (!applicationId || !botToken) {
	log("skipped — DISCORD_APPLICATION_ID / DISCORD_BOT_TOKEN are not set for this build");
} else {
	try {
		const mini = new MiniInteraction({
			commandsDirectory: "src/commands",
			componentsDirectory: "src/components",
		});
		const modules = await loadModulesOf(mini);

		// A payload Discord rejects replaces nothing: the whole PUT is refused and
		// the app keeps its old command list, with the reason only in this log. So
		// anything wrong with the payload stops the request instead.
		const payloadProblems = registrationProblems(modules);

		if (payloadProblems.length > 0) {
			const reason = `refusing to overwrite the registered command list: ${payloadProblems.join("; ")}`;
			log(`ABORTED — ${reason}`);
			await recordRegistration({
				at: new Date().toISOString(),
				commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
				ok: false,
				reason,
				scopes: [],
			});
		} else {
			// Guild first (instant feedback in the configured server) — but a guild
			// list is not the app's command list, so the global scope is always
			// registered too. Registering the guild scope *instead of* global is
			// exactly how `/mesaj` went missing in every other server.
			const scopes = deployRegistrationScopes(process.env.DISCORD_GUILD_ID);
			const outcomes: RegistrationScopeOutcome[] = [];

			for (const scope of scopes) {
				const labelled = describeRegistrationScope(scope);
				try {
					// The library derives the route from `DISCORD_GUILD_ID` at call time;
					// pinning it here is what makes one process able to register both.
					await withCommandScope(scope, () => mini.registerCommands(botToken));
					outcomes.push({ scope: labelled, ok: true });
					log(`registered ${modules.commands.length} command(s) on ${labelled}: ${commandNames(modules).join(", ")}`);
				} catch (error) {
					outcomes.push({ scope: labelled, ok: false, error: reasonFor(error) });
					log(`FAILED on ${labelled} — ${reasonFor(error)}`);
				}
			}

			try {
				await mini.registerMetadata(botToken, LINKED_ROLE_METADATA);
				log("registered linked-role metadata");
			} catch (error) {
				log(`linked-role metadata failed (commands are unaffected): ${reasonFor(error)}`);
			}

			await recordRegistration({
				at: new Date().toISOString(),
				commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
				ok: outcomes.every((outcome) => outcome.ok),
				scopes: outcomes,
			});
		}
	} catch (error) {
		const reason = reasonFor(error);
		log(`FAILED — deploy continues, open /api/diag to see the Discord side: ${reason}`);
		await recordRegistration({
			at: new Date().toISOString(),
			commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
			ok: false,
			reason,
			scopes: [],
		}).catch(() => undefined);
	}
}
