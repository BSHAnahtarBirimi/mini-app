import { MiniDatabase } from "@minesa-org/mini-interaction";

/** Environment variable `MiniDatabase.fromEnv()` reads the connection string from. */
export const MONGO_ENV_VAR = "MONGODB_URI";

let instance: MiniDatabase | undefined;

/** True when this deployment has a MongoDB connection string configured. */
export function hasDatabaseConfig(): boolean {
	return Boolean(process.env[MONGO_ENV_VAR]);
}

/** User-facing message shown when the database is not configured. */
export const DATABASE_NOT_CONFIGURED_MESSAGE = [
	"❌ **This app has no database configured.**",
	`Set \`${MONGO_ENV_VAR}\` in the deployment's environment variables — lobby links and Discord tokens are stored there.`,
].join("\n");

/**
 * The shared MiniDatabase instance, built on first use.
 *
 * Never build this at module scope: `MiniDatabase.fromEnv()` throws when
 * `MONGODB_URI` is missing, and MiniInteraction loads `src/commands` and
 * `src/components` as one dynamic `import()` per file inside a single
 * `Promise.all`. A module that throws while importing rejects that whole load,
 * so every command and every button would start failing with "The application
 * did not respond" — a missing env var must never be able to do that. Deferring
 * construction keeps it a per-interaction error with a readable message.
 */
export function getDb(): MiniDatabase {
	instance ??= MiniDatabase.fromEnv();
	return instance;
}

/** Gets user data from the database. */
export async function getUserData(userId: string) {
	try {
		return await getDb().get(userId);
	} catch (error) {
		console.error("❌ Error getting user data:", error);
		throw error;
	}
}

/**
 * Updates Discord metadata for linked roles.
 * `is_miniapp` is always true — everyone who connects gets it.
 */
export async function updateDiscordMetadata(
	userId: string,
	accessToken: string,
) {
	const response = await fetch(
		`https://discord.com/api/v10/users/@me/applications/${process.env.DISCORD_APPLICATION_ID}/role-connection`,
		{
			method: "PUT",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				platform_name: "Mini-Interaction",
				metadata: { is_miniapp: 1 },
			}),
		},
	);

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to update Discord metadata: ${error}`);
	}

	return await response.json();
}
