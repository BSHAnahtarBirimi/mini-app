import "dotenv/config";

import { MiniInteraction } from "@minesa-org/mini-interaction";

import { commandNames, loadModulesOf } from "../src/utils/command-modules.js";
import { LINKED_ROLE_METADATA } from "../src/utils/role-metadata.js";

/**
 * Registers every command payload with Discord, then publishes the
 * linked-roles metadata. Run with `npm run register`.
 *
 * Set DISCORD_GUILD_ID to scope commands to one guild (instant updates);
 * leave it unset for global registration (may take up to an hour).
 *
 * Missing credentials are a hard failure rather than a warning: the script
 * used to log "skipping registration" and exit 0, so it looked like it had
 * worked while registering nothing — which is exactly how a deployment ends up
 * with no commands in Discord at all. `/api/diag` prints what Discord really
 * has, and production deploys register automatically
 * (`scripts/register-deploy.ts`).
 */
const applicationId = process.env.DISCORD_APPLICATION_ID ?? process.env.DISCORD_APP_ID;
const botToken = process.env.DISCORD_BOT_TOKEN ?? process.env.DISCORD_TOKEN;

if (!applicationId || !botToken) {
	const missing = [
		!applicationId && "DISCORD_APPLICATION_ID",
		!botToken && "DISCORD_BOT_TOKEN",
	]
		.filter(Boolean)
		.join(", ");
	console.error(`❌ Cannot register commands: missing ${missing}.`);
	console.error(
		"   Add them to the environment (env.example) and run again — commands cannot be registered without a bot token.",
	);
	process.exit(1);
}

const mini = new MiniInteraction({
	commandsDirectory: "src/commands",
	componentsDirectory: "src/components",
});

const modules = await loadModulesOf(mini);

if (modules.commands.length === 0) {
	console.error(
		"❌ Discovered 0 commands in src/commands — aborting so the already registered command list is not wiped.",
	);
	process.exit(1);
}

console.log(`Registering ${modules.commands.length} command(s): ${commandNames(modules).join(", ")}`);
await mini.registerCommands(botToken);
console.log("✅ Commands registered.");

await mini.registerMetadata(botToken, LINKED_ROLE_METADATA);
console.log("✅ Linked-role metadata registered.");

console.log("Registration complete!");
