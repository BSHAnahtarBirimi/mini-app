/**
 * Pure helpers behind `/api/diag` — the app's own answer to "why don't my
 * commands work?", computed without Vercel runtime logs.
 *
 * Everything here is side-effect free and takes plain data, so the rules that
 * decide which problems are reported can be unit tested.
 */

/** Names of the environment variables the app needs, in the order we report them. */
export const DIAG_ENV_VARS = [
	"DISCORD_APPLICATION_ID",
	"DISCORD_PUBLIC_KEY",
	"DISCORD_BOT_TOKEN",
	"DISCORD_CLIENT_SECRET",
	"DISCORD_REDIRECT_URI",
	"DISCORD_GUILD_ID",
	"MONGODB_URI",
] as const;

export type DiagEnvVar = (typeof DIAG_ENV_VARS)[number];

/** Outcome of a single Discord REST probe. */
export type Probe<T> = {
	ok: boolean;
	status?: number;
	error?: string;
	data?: T;
};

export type DiagInput = {
	env: Partial<Record<DiagEnvVar, boolean>>;
	modules: {
		commands: number;
		components: number;
		modals: number;
		error: string | null;
	};
	/** Names of the command modules the app discovered in `src/commands`. */
	expectedCommands: string[];
	bot: Probe<{ id: string; username: string }>;
	guilds: Probe<{ id: string; name: string }[]>;
	/** Commands currently registered for the application. */
	registered: { global: Probe<string[]>; guild?: Probe<string[]> & { guildId: string } };
	/**
	 * Stored OAuth token state for a user, when one was asked for. Never carries
	 * the token itself — only whether one exists and which scopes it granted.
	 */
	userToken?: {
		connected: boolean;
		scope: string | null;
		hasSocialLayer: boolean;
	};
	/**
	 * The newest interaction-handler failures the dispatch hook recorded, newest
	 * first. These are the errors that stay invisible otherwise: a handler that
	 * acknowledged and then threw leaves the client on "«bot» is thinking…" and
	 * only reaches `console.error`, which needs dashboard access to read.
	 */
	recentFailures?: { at: string; context: string; message: string }[];
	/**
	 * Result of serialising the messages the Linked Channels flow sends. A
	 * payload that cannot be built fails *after* the deferral, which is the
	 * "«bot» is thinking…" state, so it is reported like any other problem.
	 */
	payloads?: { ok: boolean; errors: string[] };
};

/** True when a probe was rejected by Discord for a bad/expired token. */
export function isAuthFailure(probe: Probe<unknown>): boolean {
	return !probe.ok && probe.status === 401;
}

/**
 * Turns the collected probe results into a short, ordered list of actionable
 * problems. An empty list means the deployment looks healthy.
 */
export function deriveProblems(input: DiagInput): string[] {
	const problems: string[] = [];

	// 1. The interaction endpoint cannot work at all without these.
	if (!input.env.DISCORD_APPLICATION_ID) {
		problems.push("DISCORD_APPLICATION_ID is not set — the endpoint cannot start.");
	}
	if (!input.env.DISCORD_PUBLIC_KEY) {
		problems.push(
			"DISCORD_PUBLIC_KEY is not set — every interaction is rejected (Discord cannot be verified).",
		);
	}

	// 2. Handler discovery: a failing import kills every command and component.
	if (input.modules.error) {
		problems.push(
			`Handler modules failed to load (${input.modules.error}) — no command or component can run.`,
		);
	} else if (input.modules.commands === 0) {
		problems.push("No command modules were found in src/commands.");
	}

	// 3. A handler that acknowledged Discord and then threw never completes the
	//    message, so the user is stuck on "«bot» is thinking…". Nothing else in
	//    the deployment can explain that from the outside, so report the last
	//    recorded failure with its context.
	const failures = input.recentFailures ?? [];
	if (failures.length > 0) {
		const latest = failures[0];
		const consequence = latest.context.startsWith("discord-oauth-callback")
			? "a failed connection is shown on the OAuth page"
			: 'a handler that fails after acknowledging leaves the client on "«bot» is thinking…"';
		problems.push(
			`The last recorded failure was \`${latest.context}\` (${latest.at}): ${latest.message} — ${consequence}.`,
		);
	}

	// 4. A message that cannot even be built ends the interaction silently.
	if (input.payloads && !input.payloads.ok) {
		problems.push(
			`The Linked Channels messages cannot be built: ${input.payloads.errors.join("; ")} — the handler dies after acknowledging, leaving "«bot» is thinking…".`,
		);
	}

	// 5. Bot token validity — bot-authenticated calls (channel list, lobbies,
	//    command registration) all fail together when the token is stale.
	if (isAuthFailure(input.bot)) {
		problems.push(
			"DISCORD_BOT_TOKEN was rejected by Discord (401) — it is invalid, expired or from another application. Copy the current token from the Developer Portal.",
		);
	} else if (!input.bot.ok) {
		problems.push(`Could not reach Discord as the bot: ${input.bot.error ?? "unknown error"}.`);
	} else if (input.bot.data && input.env.DISCORD_APPLICATION_ID === false) {
		problems.push("DISCORD_APPLICATION_ID is missing but the bot token works.");
	}

	// 6. Commands only appear in a server when the bot is installed there with
	//    the `applications.commands` scope.
	const guilds = input.guilds.ok ? (input.guilds.data ?? []) : undefined;
	if (guilds && guilds.length === 0) {
		problems.push(
			"The bot is not a member of any Discord server — invite it with the URL below (scope bot+applications.commands), otherwise its commands can never appear.",
		);
	} else if (!input.guilds.ok && !isAuthFailure(input.guilds)) {
		problems.push(`Could not list the bot's servers: ${input.guilds.error ?? "unknown error"}.`);
	}

	// 7. Registration state: this is the usual reason commands are invisible.
	const globalNames = input.registered.global.ok ? (input.registered.global.data ?? []) : [];
	const guildNames = input.registered.guild?.ok ? (input.registered.guild.data ?? []) : [];
	const registeredNames = new Set([...globalNames, ...guildNames]);

	// Only worth reporting when we had an application id to look up with —
	// otherwise rule 1 already said exactly what is missing.
	if (
		input.env.DISCORD_APPLICATION_ID !== false &&
		!input.registered.global.ok &&
		!isAuthFailure(input.registered.global)
	) {
		problems.push(
			`Could not read the registered global commands: ${input.registered.global.error ?? "unknown error"}`,
		);
	}

	if (input.modules.commands > 0) {
		if (registeredNames.size === 0) {
			problems.push(
				"No slash commands are registered for this application — Discord has nothing to show. Registration runs automatically on production deploys; for a manual run use `npm run register`.",
			);
		} else {
			const missing = input.expectedCommands.filter((name) => !registeredNames.has(name));
			if (missing.length > 0) {
				problems.push(
					`Registered commands are out of date — missing: ${missing.join(", ")}. Re-deploy or run \`npm run register\`.`,
				);
			}
		}
	}

	// 8. Linked Channels extras.
	if (input.userToken) {
		if (!input.userToken.connected) {
			problems.push(
				"This user has no stored Discord connection — /linked-channel linking and invites need one (use the Connect Discord page first).",
			);
		} else if (!input.userToken.hasSocialLayer) {
			problems.push(
				`The stored connection's scopes are \`${input.userToken.scope ?? "unknown"}\` — linking/unlinking/invites all require \`openid sdk.social_layer\`, so every link attempt is refused before it reaches Discord. That scope is limited access: the application must be accepted into Discord's Social SDK program, then the user re-consents via **Reconnect Discord**.`,
			);
		}
	}
	if (input.registered.guild && isAuthFailure(input.registered.guild)) {
		problems.push(
			"Could not read this server's commands (401) — the bot token is invalid, so channel linking will fail too.",
		);
	}
	if (!input.env.MONGODB_URI) {
		problems.push(
			"MONGODB_URI is not set — lobby links, picked channels and user tokens cannot be stored, so /linked-channel cannot link anything.",
		);
	}
	if (!input.env.DISCORD_CLIENT_SECRET || !input.env.DISCORD_REDIRECT_URI) {
		problems.push(
			"DISCORD_CLIENT_SECRET and/or DISCORD_REDIRECT_URI are missing — the /linked-channel \"Reconnect Discord\" button (openid sdk.social_layer) cannot be built.",
		);
	}

	return problems;
}

/**
 * Bot invite URL (public data) that installs the app **with** the commands
 * scope. Without `applications.commands` on the invite the application's
 * commands never appear in the server, however well they are registered.
 */
export function buildBotInviteUrl(applicationId: string, permissions = 117760): string {
	// 117760 = ViewChannel | SendMessages | EmbedLinks | ReadMessageHistory | AttachFiles
	return `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot+applications.commands&permissions=${permissions}`;
}
