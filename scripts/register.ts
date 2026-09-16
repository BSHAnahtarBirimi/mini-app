import "dotenv/config";

import {
	MiniInteraction,
	RoleConnectionMetadataTypes,
} from "@minesa-org/mini-interaction";

const botToken = process.env.DISCORD_BOT_TOKEN;

if (!botToken) {
	console.log("⚠️ DISCORD_BOT_TOKEN not found. Skipping registration.");
	process.exit(0);
}

const mini = new MiniInteraction({
	commandsDirectory: "src/commands",
	componentsDirectory: "src/components",
});

/**
 * Registers every command payload with Discord, then publishes the
 * linked-roles metadata. Run with `npm run register`.
 *
 * Set DISCORD_GUILD_ID to scope commands to one guild (instant updates);
 * leave it unset for global registration (may take up to an hour).
 */
await mini.registerCommands(botToken);
console.log("✅ Commands registered.");

await mini.registerMetadata(botToken, [
	{
		key: "is_miniapp",
		name: "Is Mini App?",
		description: "Is the user an assistant?",
		type: RoleConnectionMetadataTypes.BooleanEqual,
	},
]);
console.log("✅ Linked-role metadata registered.");

console.log("Registration complete!");
