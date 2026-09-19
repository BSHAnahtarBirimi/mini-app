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
 * - never fail the build: problems are logged and `/api/diag` reports them.
 */

import { MiniInteraction } from "@minesa-org/mini-interaction";

import {
	commandNames,
	loadModulesOf,
	registrationProblems,
} from "../src/utils/command-modules.js";
import { LINKED_ROLE_METADATA } from "../src/utils/role-metadata.js";

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
		// the app keeps its old command list, with the reason only in this log.
		// So anything wrong with the payload stops the request instead.
		const payloadProblems = registrationProblems(modules);

		if (payloadProblems.length > 0) {
			log(`ABORTED — refusing to overwrite the registered command list: ${payloadProblems.join("; ")}`);
		} else {
			await mini.registerCommands(botToken);
			log(`registered ${modules.commands.length} command(s): ${commandNames(modules).join(", ")}`);

			try {
				await mini.registerMetadata(botToken, LINKED_ROLE_METADATA);
				log("registered linked-role metadata");
			} catch (error) {
				log(`linked-role metadata failed (commands are unaffected): ${reasonFor(error)}`);
			}
		}
	} catch (error) {
		log(`FAILED — deploy continues, open /api/diag to see the Discord side: ${reasonFor(error)}`);
	}
}
