import { mini } from "./interactions.js";
import { updateDiscordMetadata } from "../src/utils/database.js";
import { MiniDatabase } from "@minesa-org/mini-interaction";

const database = MiniDatabase.fromEnv();

/**
 * OAuth2 callback. Exchanges the code, stores tokens in MiniDatabase and
 * writes the `is_miniapp` role-connection metadata for the user.
 */
export default mini.discordOAuthCallback({
	templates: {
		success: { htmlFile: "public/pages/connected.html" },
		missingCode: { htmlFile: "public/pages/failed.html" },
		oauthError: { htmlFile: "public/pages/failed.html" },
		invalidState: { htmlFile: "public/pages/failed.html" },
		serverError: { htmlFile: "public/pages/failed.html" },
	},
	onAuthorize: async ({ user, tokens }) => {
		await database.set(user.id, {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: tokens.expires_at,
			scope: tokens.scope,
		});

		await updateDiscordMetadata(user.id, tokens.access_token);
	},
});
