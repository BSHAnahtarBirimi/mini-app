import { CommandBuilder, MessageFlags } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

import { buildAuthorizePayloads, AUTHORIZE_COMMAND_NAME } from "../utils/authorize-panel.ts";
import { describeError, recordInteractionError } from "../utils/interaction-errors.ts";
import { buildSocialSdkOAuthUrl, hasSocialLayerScope } from "../utils/lobby-oauth.ts";
import { getFreshUserToken } from "../utils/lobby-tokens.ts";

/**
 * `/authorize` — grants (or restores) this app's connection to your account.
 *
 * Channel linking, unlinking, lobby invites and lobby messages all run with a
 * **user** OAuth2 Bearer token carrying `openid sdk.social_layer`; the bot token
 * is rejected on those endpoints. That consent screen only exists on Discord's
 * website, so this command exists to hand over the link from inside Discord and
 * to say what the app currently knows about your connection — which matters
 * because a revoked token keeps looking valid in storage until Discord answers
 * `401`.
 *
 * `sdk.social_layer` is limited access: the consent screen only succeeds once
 * Discord has accepted the application into the Social SDK program.
 *
 * Defers first: reading the stored token is a database round-trip and this
 * handler must not miss Discord's 3 second first-response deadline.
 */
export const authorizeCommand = {
	data: new CommandBuilder()
		.setName(AUTHORIZE_COMMAND_NAME)
		.setDescription("Authorize (or re-authorize) this app with your Discord account"),

	handler: (async (interaction) => {
		// Ephemerality is fixed here; the editReply below must not repeat it.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const userId = interaction.member?.user?.id ?? interaction.user?.id;

		try {
			const stored = userId ? await getFreshUserToken(userId) : null;

			const clientId = process.env.DISCORD_APPLICATION_ID;
			const secret = process.env.DISCORD_CLIENT_SECRET;
			const redirectUri = process.env.DISCORD_REDIRECT_URI;
			const missingEnv = [
				clientId ? "" : "DISCORD_APPLICATION_ID",
				secret ? "" : "DISCORD_CLIENT_SECRET",
				redirectUri ? "" : "DISCORD_REDIRECT_URI",
			].filter(Boolean);

			const authorizeUrl =
				clientId && secret && redirectUri
					? buildSocialSdkOAuthUrl({ clientId, clientSecret: secret, redirectUri })
					: null;

			// Built before the first edit: a payload that throws while being
			// constructed dies after the acknowledgement (see the panel module).
			const payloads = buildAuthorizePayloads({
				authorizeUrl,
				missingEnv,
				status: {
					connected: Boolean(stored),
					scope: stored?.scope ?? null,
					hasSocialLayer: hasSocialLayerScope(stored?.scope),
				},
			});

			try {
				return await interaction.editReply(payloads.v2);
			} catch (error) {
				// An edit can be refused (the V2 flag describes how a message was
				// created); the legacy form still delivers the link.
				console.error("[authorize] V2 payload rejected:", error);
				await recordInteractionError(error, "authorize:payload-v2");
				return await interaction.editReply(payloads.legacy);
			}
		} catch (error) {
			console.error("[authorize] handler failed:", error);
			await recordInteractionError(error, "authorize");
			return await interaction
				.editReply({ content: `❌ **Could not build the authorize link.**\n• ${describeError(error)}` })
				.catch(() => undefined);
		}
	}) satisfies SlashCommandHandler,
};
