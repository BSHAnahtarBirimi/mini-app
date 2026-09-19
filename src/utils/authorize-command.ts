import { MessageFlags } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

import { buildAuthorizePayloads } from "./authorize-panel.ts";
import { describeError, recordInteractionError } from "./interaction-errors.ts";
import { buildSocialSdkOAuthUrl, hasSocialLayerScope } from "./lobby-oauth.ts";
import { deleteUserToken, getFreshUserToken, saveUserToken } from "./lobby-tokens.ts";
import type { StoredUserToken } from "./lobby-tokens.ts";
import { checkUserToken } from "./user-identity.ts";
import type { UserTokenCheck } from "./user-identity.ts";

/**
 * What `/authorize` does, kept out of `src/commands/`.
 *
 * The command itself (`src/commands/authorize.ts`) is a one-line wrapper around
 * this, because `MiniInteraction` discovers handlers by **importing every file**
 * in `src/commands` at runtime. Anything that imports a command module from
 * outside that scan — `/api/diag` runs this handler to prove the recovery path
 * works — makes the bundler emit a compiled copy next to the source, and the
 * directory scan then finds the command twice: `registered commands are out of
 * date` grows a duplicate name, and the registration payload Discord receives
 * has two commands called `authorize`, which it rejects as a whole (leaving the
 * command list unchanged and the failure nowhere but the build log).
 *
 * Channel linking, unlinking, lobby invites and lobby messages all run with a
 * **user** OAuth2 Bearer token carrying `openid sdk.social_layer`; the bot token
 * is rejected on those endpoints. That consent screen only exists on Discord's
 * website, so `/authorize` exists to hand over the link from inside Discord and
 * to say what the app currently knows about your connection.
 *
 * That last part is why the stored record is not trusted: a token can be revoked
 * without the app being told (`APPLICATION_DEAUTHORIZED` only reaches a
 * configured Webhooks endpoint and is never replayed), leaving storage that
 * looks connected while every call fails with `401`. The command therefore asks
 * Discord — `checkUserToken()` — and
 *
 * - **`401`** → the record is deleted and the message says the connection was
 *   revoked, which is the one moment the user can still be told instead of
 *   discovering it through a failed link;
 * - **confirmed** → the message reports the scopes Discord says are granted
 *   (not merely the ones stored at exchange time);
 * - **no answer** (timeout, 429, 5xx) → the record is kept and the message says
 *   it could not be confirmed.
 *
 * `sdk.social_layer` is limited access: the consent screen only succeeds once
 * Discord has accepted the application into the Social SDK program.
 *
 * Defers first: reading the stored token and verifying it are network
 * round-trips, and this handler must not miss Discord's 3 second first-response
 * deadline.
 */

/** Collaborators of the command, injectable so the reply is testable. */
export type AuthorizeDeps = {
	/** The stored connection for a user, refreshed when it has expired. */
	getToken: (userId: string) => Promise<StoredUserToken | null>;
	/** Asks Discord whether a stored token still works. */
	checkToken: (accessToken: string) => Promise<UserTokenCheck>;
	/** Drops a record Discord has rejected. */
	clearToken: (userId: string) => Promise<void>;
	/** Persists the scopes Discord actually reports. */
	saveToken: (userId: string, token: StoredUserToken) => Promise<void>;
	/** Environment, read per invocation so tests and previews can differ. */
	env: () => NodeJS.ProcessEnv;
};

const defaultDeps: AuthorizeDeps = {
	getToken: getFreshUserToken,
	checkToken: (accessToken) => checkUserToken(accessToken),
	clearToken: deleteUserToken,
	saveToken: saveUserToken,
	env: () => process.env,
};

/** `openid sdk.social_layer` — the consent URL, or null with the missing vars. */
export function resolveAuthorizeUrl(env: NodeJS.ProcessEnv): {
	authorizeUrl: string | null;
	missingEnv: string[];
} {
	const clientId = env.DISCORD_APPLICATION_ID;
	const secret = env.DISCORD_CLIENT_SECRET;
	const redirectUri = env.DISCORD_REDIRECT_URI;
	const missingEnv = [
		clientId ? "" : "DISCORD_APPLICATION_ID",
		secret ? "" : "DISCORD_CLIENT_SECRET",
		redirectUri ? "" : "DISCORD_REDIRECT_URI",
	].filter(Boolean);

	return {
		authorizeUrl:
			clientId && secret && redirectUri
				? buildSocialSdkOAuthUrl({ clientId, clientSecret: secret, redirectUri })
				: null,
		missingEnv,
	};
}

/**
 * The reply `/authorize` sends, given what is stored and what Discord answers.
 *
 * Extracted from the handler so the exact message for every connection state can
 * be exercised without a Discord interaction (and reported by `/api/diag`).
 */
export async function resolveAuthorizeReply(
	userId: string | undefined,
	deps: AuthorizeDeps = defaultDeps,
): Promise<ReturnType<typeof buildAuthorizePayloads>> {
	const { authorizeUrl, missingEnv } = resolveAuthorizeUrl(deps.env());

	let stored = userId ? await deps.getToken(userId) : null;
	let revoked = false;
	let verified: boolean | undefined;
	let verifyError: string | null = null;

	if (stored && userId) {
		const check = await deps.checkToken(stored.accessToken);
		if (check.state === "valid") {
			verified = true;
			const granted = check.scopes.join(" ");
			if (granted && granted !== stored.scope) {
				// The scopes Discord reports are authoritative (a user may decline
				// one at consent time), so keep the record honest — this is what
				// `/api/diag?user=…` and the panel read.
				const updated: StoredUserToken = { ...stored, scope: granted };
				await deps.saveToken(userId, updated).catch((error) => {
					console.error("[authorize] could not update the stored scopes:", error);
				});
				stored = updated;
			}
		} else if (check.state === "revoked") {
			revoked = true;
			stored = null;
			await deps.clearToken(userId).catch((error) => {
				console.error("[authorize] could not clear the revoked record:", error);
			});
		} else {
			verified = false;
			verifyError = check.reason;
		}
	}

	return buildAuthorizePayloads({
		authorizeUrl,
		missingEnv,
		status: {
			connected: Boolean(stored),
			scope: stored?.scope ?? null,
			hasSocialLayer: hasSocialLayerScope(stored?.scope),
			...(revoked ? { revoked } : {}),
			...(verified === undefined ? {} : { verified }),
			verifyError,
		},
	});
}

/** Builds the command's handler, with collaborators that can be replaced in tests. */
export function createAuthorizeHandler(
	deps: AuthorizeDeps = defaultDeps,
): SlashCommandHandler {
	return (async (interaction) => {
		// Ephemerality is fixed here; the editReply below must not repeat it.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const userId = interaction.member?.user?.id ?? interaction.user?.id;

		try {
			// Built before the first edit: a payload that throws while being
			// constructed dies after the acknowledgement (see the panel module).
			const payloads = await resolveAuthorizeReply(userId, deps);

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
	}) satisfies SlashCommandHandler;
}
