import { mini } from "./interactions.js";
import { getDb, updateDiscordMetadata } from "../src/utils/database.js";

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
		// Stored first: `/linked-channel` needs this record even if the
		// linked-roles call below is rejected.
		await getDb().set(user.id, {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresAt: tokens.expires_at,
			scope: tokens.scope,
		});

		try {
			await updateDiscordMetadata(user.id, tokens.access_token);
		} catch (error) {
			// A Social SDK authorization (`openid sdk.social_layer`) carries no
			// `role_connections.write`, so this PUT is rejected with 403. That
			// must not fail the connection — the token above is already stored
			// and it is the one channel linking needs.
			console.error("[oauth] linked-role metadata update failed:", error);
		}
	},
});
