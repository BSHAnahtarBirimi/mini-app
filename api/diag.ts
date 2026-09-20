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
 *   ?user=<id>     report whether that user has a stored Discord connection and
 *                  which scopes it granted (never the token itself) — the
 *                  scope, not the code, is what decides whether channel
 *                  linking can succeed
 *   ?command=authorize
 *                  run the real `/authorize` command against a stubbed
 *                  interaction and return the reply it would send. Discord's
 *                  signatures cannot be produced from here, so this is how the
 *                  command is exercised in a deployment; add `&user=<id>` to
 *                  have the stored connection really verified with Discord
 *                  (a `401` clears the revoked record, exactly as the command
 *                  does)
 *   ?fs=1          report the function's cwd and which runtime paths exist
 */

import {
	DiscordRestClient,
	DiscordRestApiError,
	MiniInteraction,
} from "@minesa-org/mini-interaction";

import { stat } from "node:fs/promises";
import path from "node:path";

import {
	DIAG_ENV_VARS,
	buildBotInviteUrl,
	buildEventsUrl,
	deriveProblems,
} from "../src/utils/diagnostics.js";
import type { DiagEnvVar, Probe } from "../src/utils/diagnostics.js";
import {
	commandNames,
	loadModulesOf,
	registrationProblems,
} from "../src/utils/command-modules.js";
import { buildSocialSdkOAuthUrl, hasSocialLayerScope } from "../src/utils/lobby-oauth.js";
import { getStoredUserToken } from "../src/utils/lobby-tokens.js";
import { listGuildChannelsForMenu } from "../src/utils/lobby-channels.js";
import type { ClassifiedChannel } from "../src/utils/lobby-channels.js";
import { getLobbyRecord } from "../src/utils/lobby-store.js";
import type { LobbyRecord } from "../src/utils/lobby-store.js";
import { describeLobbyError, getLobby } from "../src/utils/lobby-api.js";
import { describeError, getInteractionErrors } from "../src/utils/interaction-errors.js";
import { getRecentEvents } from "../src/utils/event-log.js";
import { linkedChannelTargets } from "../src/utils/webhook-events.js";
import {
	buildChannelMenuPayloads,
	buildPanelPayloads,
} from "../src/utils/linked-channel-panel.js";
import { buildAuthorizePayloads } from "../src/utils/authorize-panel.js";
// Deliberately *not* from `src/commands/`: a command module is imported by the
// framework's runtime scan, and importing one from here would make the bundler
// emit a compiled copy beside it, so the scan would find the command twice (see
// `src/utils/authorize-command.ts`).
import { createAuthorizeHandler } from "../src/utils/authorize-command.js";

/** Minimal structural subset of the Vercel node request/response we use. */
type DiagRequest = {
	method?: string;
	url?: string;
	headers?: Record<string, string | string[] | undefined>;
};

/** Case-insensitive header lookup on the plain header record Vercel passes. */
function headerValue(
	headers: DiagRequest["headers"],
	name: string,
): string | undefined {
	if (!headers) return undefined;
	const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
	return Array.isArray(direct) ? direct[0] : direct;
}
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

/**
 * Builds every message the Linked Channels flow edits into a deferred response,
 * plus the `/authorize` message (`src/utils/authorize-panel.ts`).
 *
 * A payload that throws while it is constructed kills the handler *after* the
 * acknowledgement — the user is left on "«bot» is thinking…" and the only trace
 * is a `console.error`. Serialising them here makes that failure visible in
 * `/api/diag` before anyone presses a button, which is how the accessory-less
 * section bug reached production unnoticed.
 */
function buildPayloadsProbe(): { ok: boolean; errors: string[] } {
	const errors: string[] = [];
	const attempt = (name: string, build: () => unknown) => {
		try {
			// The request serializer walks the builders through toJSON().
			JSON.stringify(build());
		} catch (error) {
			errors.push(`${name}: ${describeError(error)}`);
		}
	};

	const lobbyId = "0";
	const reconnectUrl = "https://discord.com/oauth2/authorize?client_id=0&scope=openid";

	attempt("panel", () => buildPanelPayloads({ lobbyId, reconnectUrl: null }).v2);
	attempt("panel+reconnect", () => buildPanelPayloads({ lobbyId, reconnectUrl }).v2);
	attempt("panel(legacy)", () => buildPanelPayloads({ lobbyId, reconnectUrl }).legacy);
	attempt("channel-menu", () =>
		buildChannelMenuPayloads({
			lobbyId,
			channels: [{ id: "0", name: "diag", privacy: "unknown" }],
		}).v2,
	);
	attempt("channel-menu(legacy)", () =>
		buildChannelMenuPayloads({
			lobbyId,
			channels: [{ id: "0", name: "diag", privacy: "unknown" }],
		}).legacy,
	);
	// /authorize is the recovery path, so it is the worst message to discover is
	// broken only when someone needs it. Both states are built: a missing
	// connection shows the button, an existing one shows the re-authorize label.
	attempt("authorize", () =>
		buildAuthorizePayloads({
			authorizeUrl: reconnectUrl,
			status: { connected: false, hasSocialLayer: false },
		}).v2,
	);
	attempt("authorize+connected", () =>
		buildAuthorizePayloads({
			authorizeUrl: reconnectUrl,
			status: { connected: true, scope: "openid sdk.social_layer", hasSocialLayer: true },
		}).v2,
	);
	// The revoked message is the one /authorize exists to send and the hardest
	// state to reach on purpose (it needs a token Discord has already thrown
	// away), so its payload is proven here rather than by deauthorizing an app.
	attempt("authorize(revoked)", () =>
		buildAuthorizePayloads({
			authorizeUrl: reconnectUrl,
			status: { connected: false, hasSocialLayer: false, revoked: true },
		}).v2,
	);
	attempt("authorize(unconfirmed)", () =>
		buildAuthorizePayloads({
			authorizeUrl: reconnectUrl,
			status: {
				connected: true,
				scope: "openid sdk.social_layer",
				hasSocialLayer: true,
				verified: false,
				verifyError: "Discord did not answer within 5s.",
			},
		}).v2,
	);
	attempt("authorize(no-url)", () =>
		buildAuthorizePayloads({
			authorizeUrl: null,
			missingEnv: ["DISCORD_REDIRECT_URI"],
			status: { connected: false, hasSocialLayer: false },
		}).v2,
	);
	attempt("authorize(legacy)", () =>
		buildAuthorizePayloads({
			authorizeUrl: reconnectUrl,
			status: { connected: false, hasSocialLayer: false },
		}).legacy,
	);

	return { ok: errors.length === 0, errors };
}

/**
 * Runs the real `/authorize` command against a stubbed interaction
 * (`?command=authorize`).
 *
 * Discord signs interactions with the application's private key, so the command
 * cannot be triggered over HTTP from outside Discord — and waiting for a human
 * to press it is how a broken recovery path stays broken. Calling the command's
 * own handler with a stub that records `deferReply()`/`editReply()` exercises
 * everything downstream of Discord: the option parsing, the stored-token read,
 * the Discord token check and the payload it would send.
 *
 * Nothing is written to a channel and no token is altered by a successful
 * check. With `?user=<id>` the stored connection is really verified, which is
 * the point — and if Discord answers `401` the revoked record is cleared, the
 * same thing the command does when a human runs it.
 */
async function probeAuthorizeCommand(userId: string | undefined): Promise<{
	ok: boolean;
	deferred: boolean;
	replies: unknown[];
	error: string | null;
}> {
	let deferred = false;
	const replies: unknown[] = [];

	const stub = {
		...(userId ? { member: { user: { id: userId } } } : {}),
		deferReply: async (payload: unknown) => {
			deferred = true;
			void payload;
		},
		// The builders serialise through toJSON(), exactly as the request
		// serializer does when the reply is sent to Discord.
		editReply: async (payload: unknown) => {
			replies.push(JSON.parse(JSON.stringify(payload ?? null)));
		},
	};

	try {
		const handler = createAuthorizeHandler() as unknown as (interaction: unknown) => Promise<unknown>;
		await handler(stub);
	} catch (error) {
		return { ok: false, deferred, replies, error: describeError(error) };
	}

	return {
		ok: deferred && replies.length > 0,
		deferred,
		replies,
		error: replies.length > 0 ? null : "the handler produced no reply",
	};
}

/**
 * Where the deployment actually keeps files (`?fs=1`).
 *
 * The OAuth pages are rendered by reading a file at request time, so a file
 * that is missing from the function bundle turns every branch of the callback
 * into `FUNCTION_INVOCATION_FAILED` — including the one that reports the
 * failure. This reports the function's working directory and whether each path
 * the code reads at runtime is present, so the bundling can be fixed from
 * evidence rather than guesswork.
 */
async function probeFiles(): Promise<{
	cwd: string;
	candidates: { path: string; exists: boolean; bytes: number | null }[];
}> {
	const cwd = process.cwd();
	const relative = [
		"index.html",
		"public/pages/connected.html",
		"public/pages/failed.html",
		"src/commands/linked-channel.ts",
		"src/utils/linked-channel-panel.ts",
		"package.json",
	];

	const candidates = await Promise.all(
		[...relative, ...relative.map((entry) => path.join("/var/task", entry))].map(async (entry) => {
			const absolute = path.isAbsolute(entry) ? entry : path.resolve(cwd, entry);
			try {
				const info = await stat(absolute);
				return { path: absolute, exists: true, bytes: info.size };
			} catch {
				return { path: absolute, exists: false, bytes: null };
			}
		}),
	);

	return { cwd, candidates };
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
	payloadProblems: string[];
}> {
	const empty = {
		commands: 0,
		components: 0,
		modals: 0,
		error: null,
		expectedCommands: [] as string[],
		payloadProblems: [] as string[],
	};
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
			// What the deploy's registration step would have refused to send: a
			// payload Discord rejects leaves the command list unchanged, and the
			// only other trace of it is the build log.
			payloadProblems: registrationProblems(modules),
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
	// Used to report this deployment's own Webhook Events URL (`links.eventsUrl`).
	const hostHeader = headerValue(req.headers, "host") ?? process.env.VERCEL_URL ?? null;

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

	// Lobbies are session objects that Discord reaps when idle, so the stored id
	// can be gone by the time a link is attempted — which Discord answers with
	// "404 Unknown Lobby" on the channel-linking call. Reading it with the bot
	// token separates "the lobby expired" from "this call is not allowed".
	const lobbyState = lobby.ok && lobby.data
		? await probe(async () => {
				const live = await getLobby(lobby.data!.lobbyId);
				return {
					id: live.id,
					linkedChannelId: live.linked_channel?.id ?? null,
				};
			})
		: undefined;

	// Read-only: deliberately `getStoredUserToken` rather than the refreshing
	// helper, so a diagnostic can never rotate a user's tokens.
	const userId = url.searchParams.get("user");
	const userToken = userId
		? await probe(async () => {
				const stored = await getStoredUserToken(userId);
				return {
					connected: Boolean(stored),
					scope: stored?.scope ?? null,
					hasSocialLayer: hasSocialLayerScope(stored?.scope),
					expired: stored?.expiresAt ? stored.expiresAt < Date.now() : null,
				};
			})
		: undefined;

	// Read-only view of the failures the dispatch hook recorded. This is the
	// only place a "«bot» is thinking…" cause becomes visible without dashboard
	// access — the framework logs those to console.error and nowhere else.
	const recentFailures = await getInteractionErrors();
	// What Discord's Webhook Events endpoint sent us. Recording them is the only
	// way to tell "never configured" from "configured, nothing happened yet".
	const recentEvents = await getRecentEvents();
	// Which linked channels an `APPLICATION_DEAUTHORIZED` notice would reach.
	// Reported so that "did my second server get it?" is answerable directly,
	// instead of by deauthorizing the app and watching. Bounded (see
	// LINKED_CHANNEL_TARGET_LIMIT) so a large deployment cannot turn this into
	// hundreds of Discord calls.
	const linkedChannels = await probe(() => linkedChannelTargets());
	const payloads = buildPayloadsProbe();
	const authorizeCommand =
		url.searchParams.get("command") === "authorize"
			? await probeAuthorizeCommand(userId ?? undefined)
			: undefined;

	const problems = deriveProblems({
		...(modules.payloadProblems.length > 0 ? { commandPayloadProblems: modules.payloadProblems } : {}),
		...(authorizeCommand
			? {
					authorizeCommand: {
						ok: authorizeCommand.ok,
						deferred: authorizeCommand.deferred,
						replies: authorizeCommand.replies.length,
						error: authorizeCommand.error,
					},
				}
			: {}),
		payloads,
		env,
		modules: {
			commands: modules.commands,
			components: modules.components,
			modals: modules.modals,
			error: modules.error,
		},
		recentFailures,
		recentEvents,
		lobbyState,
		expectedCommands: modules.expectedCommands,
		bot,
		guilds,
		registered,
		userToken: userToken?.ok ? userToken.data : undefined,
	});

	sendJson(res, 200, {
		ok: problems.length === 0,
		...(url.searchParams.get("fs") === "1" ? { filesystem: await probeFiles() } : {}),
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
			payloadProblems: modules.payloadProblems,
		},
		bot,
		guilds,
		registered,
		guildId,
		userId,
		userToken,
		recentFailures,
		recentEvents,
		linkedChannels,
		payloads,
		...(authorizeCommand ? { authorizeCommand } : {}),
		channels,
		selectedChannel,
		lobby,
		lobbyState,
		links: {
			botInvite: applicationId ? buildBotInviteUrl(applicationId) : null,
			// The web app: type a message, it goes to every linked channel.
			messagePage: hostHeader ? `https://${hostHeader}/message` : null,
			// The exact URL to paste on the app's Webhooks page. Derived from the
			// request, so a preview deployment reports its own host.
			eventsUrl: buildEventsUrl(
				hostHeader ? `https://${hostHeader}` : (process.env.DISCORD_REDIRECT_URI ?? ""),
			),
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
