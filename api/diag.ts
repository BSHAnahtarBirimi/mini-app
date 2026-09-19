/**
 * `GET /api/diag` — read-only diagnostics for this deployment.
 *
 * Vercel runtime logs need dashboard access, so this endpoint answers the
 * questions we otherwise cannot see: is the bot token still valid, is the bot
 * even in a server, and which slash commands are actually registered with
 * Discord. That is what decides whether commands can appear in a server.
 *
 * Nothing secret is returned — only booleans for which environment variables
 * are set (never their values), the bot's public identity, and the command
 * *names* Discord already knows about, which are shown to every user anyway.
 *
 * Query parameters (all optional):
 *   ?guild=<id>    also read that server's commands, lobby record and channel
 *                  menu (privacy classification included)
 *   ?channel=<id>  highlight one channel from that menu
 */

import {
	DiscordRestClient,
	DiscordRestApiError,
	MiniInteraction,
} from "@minesa-org/mini-interaction";

import {
	DIAG_ENV_VARS,
	buildBotInviteUrl,
	deriveProblems,
} from "../src/utils/diagnostics.js";
import type { DiagEnvVar, Probe } from "../src/utils/diagnostics.js";
import { commandNames, loadModulesOf } from "../src/utils/command-modules.js";
import { buildSocialSdkOAuthUrl } from "../src/utils/lobby-oauth.js";
import { listGuildChannelsForMenu } from "../src/utils/lobby-channels.js";
import type { ClassifiedChannel } from "../src/utils/lobby-channels.js";
import { getLobbyRecord } from "../src/utils/lobby-store.js";
import type { LobbyRecord } from "../src/utils/lobby-store.js";
import { describeLobbyError } from "../src/utils/lobby-api.js";

/** Minimal structural subset of the Vercel node request/response we use. */
type DiagRequest = { method?: string; url?: string };
type DiagResponse = {
	statusCode: number;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

function sendJson(res: DiagResponse, status: number, payload: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(payload, null, 2));
}

/** Runs a Discord call and captures its outcome instead of throwing. */
async function probe<T>(run: () => Promise<T>): Promise<Probe<T>> {
	try {
		return { ok: true, data: await run() };
	} catch (error) {
		if (error instanceof DiscordRestApiError) {
			return { ok: false, status: error.status, error: describeLobbyError(error) };
		}
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

async function loadHandlerModules(): Promise<{
	commands: number;
	components: number;
	modals: number;
	error: string | null;
	expectedCommands: string[];
}> {
	const empty = { commands: 0, components: 0, modals: 0, error: null, expectedCommands: [] as string[] };
	try {
		const mini = new MiniInteraction({
			commandsDirectory: "src/commands",
			componentsDirectory: "src/components",
		});
		const modules = await loadModulesOf(mini);
		return {
			commands: modules.commands.length,
			components: modules.components.length,
			modals: modules.modals.length,
			error: null,
			expectedCommands: commandNames(modules),
		};
	} catch (error) {
		return { ...empty, error: error instanceof Error ? error.message : String(error) };
	}
}

export default async function handler(req: DiagRequest, res: DiagResponse): Promise<void> {
	if (req.method && req.method !== "GET") {
		sendJson(res, 405, { error: "Use GET." });
		return;
	}

	const url = new URL(req.url ?? "/", "http://localhost");
	const guildId = url.searchParams.get("guild") ?? process.env.DISCORD_GUILD_ID ?? null;
	const channelId = url.searchParams.get("channel");
	const applicationId = process.env.DISCORD_APPLICATION_ID ?? process.env.DISCORD_APP_ID ?? null;
	const botToken = process.env.DISCORD_BOT_TOKEN ?? process.env.DISCORD_TOKEN ?? null;

	const env = Object.fromEntries(
		DIAG_ENV_VARS.map((key: DiagEnvVar) => [key, Boolean(process.env[key])]),
	) as Partial<Record<DiagEnvVar, boolean>>;

	const modules = await loadHandlerModules();

	const rest = new DiscordRestClient({
		token: botToken ?? "",
		applicationId: applicationId ?? "",
		// Same fail-fast policy as the Lobby calls: a 429 is reported, not retried.
		maxRetries: 0,
	});

	const bot = await probe(async () => {
		const me = await rest.request<{ id: string; username: string }>("/users/@me");
		return { id: me.id, username: me.username };
	});

	const guilds = await probe(async () => {
		const list = await rest.request<{ id: string; name: string }[]>("/users/@me/guilds");
		return list.map((guild) => ({ id: guild.id, name: guild.name }));
	});

	const registered: {
		global: Probe<string[]>;
		guild?: Probe<string[]> & { guildId: string };
	} = {
		global: await probe(async () => {
			if (!applicationId) throw new Error("DISCORD_APPLICATION_ID is not set.");
			const commands = await rest.request<{ name: string }[]>(
				`/applications/${applicationId}/commands`,
			);
			return commands.map((command) => command.name);
		}),
	};

	if (guildId && applicationId) {
		const guildCommands = await probe(async () => {
			const commands = await rest.request<{ name: string }[]>(
				`/applications/${applicationId}/guilds/${guildId}/commands`,
			);
			return commands.map((command) => command.name);
		});
		registered.guild = { ...guildCommands, guildId };
	}

	// Linked Channels state for the requested server: the channel menu the
	// panel would show (privacy classification included) and the stored lobby.
	const channels = guildId
		? await probe(() => listGuildChannelsForMenu(guildId))
		: ({ ok: false, error: "pass ?guild=<id> to inspect a server" } as Probe<
				ClassifiedChannel[]
			>);

	const selectedChannel =
		channelId && channels.ok && channels.data
			? (channels.data.find((channel) => channel.id === channelId) ?? null)
			: null;

	const lobby = guildId
		? await probe(() => getLobbyRecord(guildId))
		: ({ ok: false, error: "pass ?guild=<id> to inspect a server" } as Probe<LobbyRecord>);

	const problems = deriveProblems({
		env,
		modules: {
			commands: modules.commands,
			components: modules.components,
			modals: modules.modals,
			error: modules.error,
		},
		expectedCommands: modules.expectedCommands,
		bot,
		guilds,
		registered,
	});

	sendJson(res, 200, {
		ok: problems.length === 0,
		deployment: {
			vercelEnv: process.env.VERCEL_ENV ?? null,
			commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
			ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
			node: process.version,
		},
		env,
		modules: {
			commands: modules.commands,
			components: modules.components,
			modals: modules.modals,
			loadError: modules.error,
			expectedCommands: modules.expectedCommands,
		},
		bot,
		guilds,
		registered,
		guildId,
		channels,
		selectedChannel,
		lobby,
		links: {
			botInvite: applicationId ? buildBotInviteUrl(applicationId) : null,
			socialSdkOAuth:
				applicationId && process.env.DISCORD_REDIRECT_URI
					? buildSocialSdkOAuthUrl({
							clientId: applicationId,
							clientSecret: process.env.DISCORD_CLIENT_SECRET,
							redirectUri: process.env.DISCORD_REDIRECT_URI,
						})
					: null,
		},
		problems,
	});
}
