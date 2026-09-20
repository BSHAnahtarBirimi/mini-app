/**
 * The documentation site's content, as data.
 *
 * The site at `/docs` explains what this app is made of and how to use every
 * part of it: the slash commands, the interactive components, the HTTP
 * endpoints, the pages, and the exported functions of each module in `src/utils`.
 *
 * Three rules this module exists to enforce:
 *
 * 1. **It is data, not HTML.** `docs-page.ts` renders it, so nothing here has to
 *    think about markup and nothing here can inject any. Code samples contain
 *    `<@123>`, `@everyone` and `1 << 0` — text that *must* be escaped on the way
 *    out, which is one place to get right instead of a hundred.
 * 2. **It is checked against the code.** `docs-content.test.ts` reads
 *    `src/commands`, `src/components` and `api/` and fails if a command, a
 *    component or an endpoint exists that this file does not mention — a
 *    documentation site that quietly stops covering the app is worse than none.
 * 3. **It is not imported by a handler.** The framework discovers commands by
 *    importing everything in `src/commands`, so this file stays in `src/utils`
 *    and is imported only by the docs page, the docs endpoint and the tests.
 */

/** What kind of thing an entry documents. Rendered as a chip. */
export type DocsKind =
	| "Command"
	| "Component"
	| "Endpoint"
	| "Page"
	| "Function"
	| "Constant"
	| "Type"
	| "Class"
	| "Script"
	| "Key";

/** One documented thing. */
export type DocsEntry = {
	/** The name as it is used: `/mesaj`, `lc:confirm`, `linkChannelToLobby`. */
	name: string;
	kind: DocsKind;
	/** Call signature, when the entry is callable. */
	signature?: string;
	/** One or two sentences: what it is for. */
	summary: string;
	/** Anything else worth knowing, one paragraph per entry. */
	details?: string[];
	/** The file it lives in, so the docs point back at the code. */
	where?: string;
	/** A short usage example, rendered as a code block. */
	example?: string;
	/** Free-text keywords, searched in addition to the text above. */
	tags?: string[];
};

/** A titled block inside a section: one command family, one file. */
export type DocsGroup = {
	/** Anchor id, unique across the whole page. */
	id: string;
	title: string;
	blurb?: string;
	entries: DocsEntry[];
};

export type DocsSection = {
	/** Anchor id, unique across the whole page. */
	id: string;
	title: string;
	blurb: string;
	groups: DocsGroup[];
};

export const DOCS_TITLE = "Mini App — Documentation";
export const DOCS_SUBTITLE =
	"Every command, component, endpoint and exported function of this Discord app, and how to use it.";

/** Where the site lives and what `vercel.json` rewrites to it. */
export const DOCS_PAGE_PATH = "/docs";

/**
 * How many entries the site documents. Reported in the page header, and asserted
 * by the tests so the count cannot silently go stale.
 */
export function countEntries(sections: DocsSection[] = DOCS_SECTIONS): number {
	return sections.reduce(
		(total, section) =>
			total + section.groups.reduce((inSection, group) => inSection + group.entries.length, 0),
		0,
	);
}

/* ------------------------------------------------------------------ overview */

const OVERVIEW: DocsSection = {
	id: "overview",
	title: "Overview",
	blurb:
		"One Vercel deployment, several surfaces: slash commands and buttons inside Discord, a web page, an Activity, and the HTTP endpoints that serve them.",
	groups: [
		{
			id: "overview-what",
			title: "What this app is",
			entries: [
				{
					name: "Mini App",
					kind: "Page",
					summary:
						"A Discord HTTP-interaction app built on `@minesa-org/mini-interaction` that links a server's game lobby to a text channel, and delivers one message to every linked channel it maintains.",
					details: [
						"There is no build step for the pages and no framework: endpoints in `api/` are Vercel functions, handlers in `src/commands`, `src/components` and `src/modals` are discovered automatically, and the browser code is plain ES modules in `public/`.",
						"Discord has **no broadcast primitive** — no webhook, gateway event or Scheduled Event posts into a set of channels. Reaching every linked channel is a loop (`src/utils/lobby-broadcast.ts`), which is why every delivery reports each channel's own outcome instead of claiming success.",
					],
					where: "api/, src/, public/",
				},
				{
					name: "The five surfaces",
					kind: "Page",
					summary:
						"Discord (commands + components), the web page at `/message`, the Activity at `/activity`, the JSON endpoints under `/api/`, and this documentation page at `/docs`.",
					details: [
						"`/message` and the Activity both post through `POST /api/message`, which uses each server's own stored member connection — so a web visitor's message and a player's in-game message arrive the same way.",
						"`/linked-channel` is the admin side: it creates the per-guild lobby and links a channel to it.",
						"`/authorize` is the account side: it hands over the consent URL for the `openid sdk.social_layer` scope that linking and lobby messages require.",
					],
				},
				{
					name: "Read this first",
					kind: "Page",
					summary:
						"Three facts that explain most of the design: lobbies are session objects, channel linking needs a user token, and privacy is not visible over HTTP.",
					details: [
						"**A lobby is a session object.** Discord reaps it when it goes idle, so a stored lobby id can already be gone (`404 Unknown Lobby`). It is re-created — with the acting admin carrying `CanLinkLobby` — and the operation is retried **exactly once** (`src/utils/lobby-lifecycle.ts`).",
						"**Channel linking needs a USER OAuth2 Bearer token** carrying `openid sdk.social_layer`, not the bot token. That scope is limited access: apps must be accepted into Discord's Social SDK program. The bot token is only used for lobby administration and for posting a message into a channel.",
						"Over HTTP, `isLinkable` and `isViewableAndWriteableByAllMembers` **do not exist**: they are Social SDK client fields. So privacy is derived from `permission_overwrites`, and the rule is *warn unless the channel is provably public* (`src/utils/channel-privacy.ts`).",
					],
				},
			],
		},
		{
			id: "overview-flow",
			title: "The whole flow, end to end",
			entries: [
				{
					name: "Link a channel, then send a message",
					kind: "Page",
					summary:
						"`/linked-channel` → **Link a channel** → pick a channel → **Link anyway** → **✉️ Test all linked channels**; then `/mesaj` or `/message` to reach every linked channel.",
					details: [
						"1. `/linked-channel` creates the guild's lobby (the invoking admin gets `CanLinkLobby`, `1 << 0`) and shows the panel.",
						"2. **Link a channel** lists the guild's text channels with a privacy badge per channel and a mandatory warning step.",
						"3. **Link anyway** (`lc:confirm`) calls `linkChannelToLobby(lobbyId, channelId, userToken)` and remembers the channel on the guild's record.",
						"4. **🔁 Reconnect Discord** (or `/authorize`) grants `openid sdk.social_layer` when the stored connection lacks it — linking would otherwise fail with 403.",
						"5. `/mesaj metin:…` or `/message` posts one message to **every** linked channel: through each server's lobby when its member has a usable token, otherwise into the channel as the bot.",
					],
				},
			],
		},
	],
};

/* ------------------------------------------------------------------ commands */

const COMMANDS: DocsSection = {
	id: "commands",
	title: "Slash commands",
	blurb:
		"Commands live in `src/commands` as `{ data: new CommandBuilder()…, handler }` and are discovered by importing the directory. Registration happens on deploy (`npm run register:deploy`) or by hand (`npm run register`).",
	groups: [
		{
			id: "commands-linked-channel",
			title: "/linked-channel",
			blurb:
				"The Linked Channels admin panel. Ephemeral, and it needs a server — there is no lobby outside one.",
			entries: [
				{
					name: "/linked-channel",
					kind: "Command",
					signature: "/linked-channel",
					summary:
						"Shows the panel: **🔗 Link a channel**, **✖️ Unlink**, **✉️ Test all linked channels**, **🏠 Join Discord server**, and **🔁 Reconnect Discord** when the caller's stored connection lacks the Social SDK scope.",
					details: [
						"It defers first (`deferReply({ flags: MessageFlags.Ephemeral })`) because reading the lobby, maybe creating it, storing it and reading the caller's token cannot fit in Discord's 3-second first-response deadline. A late response makes the command look like it did nothing while its side effects already happened.",
						"The lobby is created once per guild with the invoking admin as a member carrying `CanLinkLobby` (`LobbyMemberFlags.CanLinkLobby`, i.e. `1 << 0`) — without that flag a member can neither link **nor** unlink. The lobby id is persisted as `lc:${guildId}`.",
						"Both the Components V2 and the legacy form of the panel are built **before** the first edit: a payload that throws while being constructed dies after the acknowledgement, leaving the admin on \"«bot» is thinking…\" with the reason only in the logs.",
						"Missing `MONGODB_URI`, missing `DISCORD_APPLICATION_ID`/`DISCORD_BOT_TOKEN` and a failed lobby creation are each answered with their own readable message.",
					],
					where: "src/commands/linked-channel.ts · payloads in src/utils/linked-channel-panel.ts",
					tags: ["lobby", "link", "admin", "ephemeral"],
				},
			],
		},
		{
			id: "commands-authorize",
			title: "/authorize",
			blurb:
				"Grants (or restores) this app's connection to your account — the recovery path whenever linking reports a scope problem.",
			entries: [
				{
					name: "/authorize",
					kind: "Command",
					signature: "/authorize",
					summary:
						"Replies with the current status of your stored Discord connection plus an **Authorize / Re-authorize Discord** link button (`openid sdk.social_layer`, `prompt=consent`).",
					details: [
						"It does **not** trust the stored record: a token can be revoked without the app being told, leaving storage that looks connected while every call fails with 401. The command asks Discord (`GET /oauth2/@me`) and then: **401** → the record is cleared and the message says the connection was revoked; **confirmed** → the message reports the scopes Discord says were actually granted (and stores them); **no answer** (403/429/5xx/timeout) → the record is kept and the message says it could not be confirmed.",
						"The same URL is the panel's **🔁 Reconnect Discord** button, built with `OAuth2Builder.communication({ clientId, clientSecret, redirectUri }).toURL()`.",
						"`sdk.social_layer` is limited access — the consent screen only succeeds once Discord has accepted the application into the Social SDK program.",
					],
					where: "src/commands/authorize.ts · src/utils/authorize-command.ts",
					example: "GET /api/diag?command=authorize&user=<USER_ID>",
					tags: ["oauth", "scope", "social layer", "reconnect"],
				},
			],
		},
		{
			id: "commands-mesaj",
			title: "/mesaj",
			blurb: "One message, every linked channel, from inside Discord.",
			entries: [
				{
					name: "/mesaj",
					kind: "Command",
					signature: "/mesaj metin:<text>",
					summary:
						"Posts one message into every linked channel this app maintains, through the same sender the web app uses (lobby first, bot as the fallback), and replies privately with one line per channel.",
					details: [
						"The text is posted **exactly as written** — no attribution, no wrapper — so nothing of the app's voice surrounds text the app did not write.",
						"Mentions are neutralised per path: the bot path sends `allowed_mentions: { parse: [] }`, and the lobby path (which has no such field and posts as the member's own account) has the content made structurally unable to form a mention token.",
						"Rate-limited per member at 5 per minute (`cmd-msg-rate:<userId>`), because one invocation reaches every server the app is in. A partial delivery is reported as one, naming the channel and Discord's reason.",
						"Limit: 2000 characters — Discord's own message limit.",
					],
					where: "src/commands/mesaj.ts · src/utils/mesaj-command.ts",
					example: "/mesaj metin:Bu akşam 21:00'de oyun var!",
					tags: ["broadcast", "message", "every channel", "lobby"],
				},
			],
		},
		{
			id: "commands-showcase",
			title: "Template commands",
			blurb: "The commands this app started with. They are kept working as living examples.",
			entries: [
				{
					name: "/echo",
					kind: "Command",
					signature: "/echo text:<text>",
					summary: "Replies with the text you gave, demonstrating the typed option resolver.",
					details: [
						"`interaction.options.getString(\"text\", true)` — the second argument marks the option required, so the handler never sees it missing.",
					],
					where: "src/commands/echo.ts",
				},
				{
					name: "/slow",
					kind: "Command",
					signature: "/slow",
					summary:
						"Defers immediately, waits ~4 seconds, then edits the reply — the minimal example of a handler that cannot answer in 3 seconds.",
					where: "src/commands/slow.ts",
				},
				{
					name: "/test",
					kind: "Command",
					signature: "/test",
					summary:
						"Showcases the whole Components V2 surface: container accent, section with thumbnail and button accessories, separators, select menus, modals, and spoiler text.",
					where: "src/commands/test.ts",
				},
			],
		},
	],
};

/* ---------------------------------------------------------------- components */

const COMPONENTS: DocsSection = {
	id: "components",
	title: "Components",
	blurb:
		"One file per component in `src/components`, each `{ customId, handler }`. Custom ids are prefixed by flow so a stray click is obvious: `lc:` for Linked Channels, `test_` for the showcase.",
	groups: [
		{
			id: "components-linked-channel",
			title: "lc:* — the Linked Channels flow",
			blurb:
				"Linking, unlinking and the warning step. Every handler defers first (the work is several round-trips) and answers with the reason when something is refused — nothing is retried in a loop.",
			entries: [
				{
					name: "lc:link",
					kind: "Component",
					summary:
						"Shows the channel picker: a labelled `StringSelect` built from the guild's channel list with a privacy badge per channel.",
					details: [
						"Discord's native channel select has **no per-option labels**, so the menu is a `StringSelect` with `✅` (provably public), `🔒` (private) or `❓` (unknown) in front of each name, computed from `permission_overwrites`.",
						"A fast scope pre-flight runs before the list is even fetched: without `sdk.social_layer` on the caller's connection it says *Reconnect required* instead of letting the link fail with 403.",
						"A 403 while listing channels almost always means the bot is not in *this* server (commands can be installed with the `applications.commands` scope alone), and the reply says so with the invite URL to use.",
					],
					where: "src/components/lc_link.ts",
					tags: ["select menu", "channels", "privacy"],
				},
				{
					name: "lc:pick",
					kind: "Component",
					summary:
						"The channel select handler: stores the pick and shows the **mandatory warning step** before anything is linked.",
					details: [
						"**Never links silently.** Every pick is confirmed with **🔗 Link anyway** (`lc:confirm`) or dropped with **Cancel** (`lc:cancel`).",
						"The warning says, in substance: everyone in the lobby will be able to **read AND post** messages in this channel from inside the game, including members who cannot see it in Discord; linking bypasses the channel's Discord permissions for lobby members; and **any lobby member can generate a server invite**, which **server admins cannot restrict**.",
						"The pick is persisted (`lc-pending:${userId}:${guildId}`, 10-minute TTL) because the confirmation is often served by a different serverless instance than the select.",
					],
					where: "src/components/lc_pick.ts",
				},
				{
					name: "lc:confirm",
					kind: "Component",
					summary:
						"Performs the link: `linkChannelToLobby(lobbyId, channelId, userToken)` with the caller's user token, then remembers the channel on the guild's record.",
					details: [
						"One attempt, and a recovery at most once: `404 Unknown Lobby` re-creates the lobby (with the acting admin and the original creator carrying `CanLinkLobby`) and retries the link a single time. Never a loop — while the app is unapproved, channel linking is capped at **20 calls per 2 hours per application**, and the cap counts attempts, not successes.",
						"`429` is reported as that cap with what to do about it; `401` drops the stored connection and points at `/authorize`; `403` names the three likely causes (`sdk.social_layer` missing, no `CanLinkLobby`, or missing Manage Channels / View Channel / Send Messages); a 5-second timeout is reported as ⏳ with \"nothing was linked and the request was **not** retried\".",
						"The channel is written to `lc:${guildId}` as `channelId`, because a lobby is a session object and the channel is not — the deauthorize notice must reach it whether or not the lobby is still alive.",
					],
					where: "src/components/lc_confirm.ts",
					example: "linkChannelToLobby(lobbyId, channelId, userToken); // user token + openid sdk.social_layer",
				},
				{
					name: "lc:cancel",
					kind: "Component",
					summary: "Clears the pending pick without linking anything.",
					where: "src/components/lc_cancel.ts",
				},
				{
					name: "lc:unlink",
					kind: "Component",
					summary:
						"Removes the channel link: `unlinkChannelFromLobby(lobbyId, userToken)`, then clears the guild's record.",
					details: [
						"Unlinking needs the same user token **and** the `CanLinkLobby` flag — a member without it cannot link *or* unlink.",
						"A lobby Discord has already reaped is not a failure: there is nothing linked, so the local record is cleared and the reply says exactly that.",
					],
					where: "src/components/lc_unlink.ts",
				},
				{
					name: "lc:join",
					kind: "Component",
					summary:
						"**Join Discord server**: `createLobbyChannelInviteForSelf(lobbyId, userToken)` returns a single-use invite (1 hour) to the linked channel's server.",
					details: [
						"Requires the caller's user token and membership of the lobby — the bot token is not accepted on this endpoint.",
					],
					where: "src/components/lc_join.ts",
					example: "const invite = await createLobbyChannelInviteForSelf(lobbyId, userToken);\n// https://discord.gg/${invite.code}",
				},
				{
					name: "lc:test",
					kind: "Component",
					summary:
						"**✉️ Test all linked channels**: posts a test message through **every** lobby with the caller's token — the call a Social SDK game makes — and names each channel's result.",
					details: [
						"It deliberately has no bot fallback: pressing it is how an admin checks that *their* connection works, so a fallback would hide the thing being tested.",
						"If every channel rejects the token with 401, the account revoked the app: the stored record is dropped and the reply points at `/authorize`.",
					],
					where: "src/components/lc_test.ts · src/utils/lobby-broadcast.ts",
				},
			],
		},
		{
			id: "components-showcase",
			title: "test_* — the /test showcase",
			blurb:
				"Every component the `/test` message can produce, kept as working examples of the library's surface.",
			entries: [
				{
					name: "test_accessory_button",
					kind: "Component",
					summary: "The section accessory button in `/test` — opens a modal that demonstrates inputs.",
					where: "src/components/test_accessory_button.ts",
				},
				{
					name: "test_mode_followup / test_mode_update / test_mode_edit",
					kind: "Component",
					summary:
						"The three response modes a select menu can use: follow-up reply, updating the message in place, and `deferUpdate()` + `editReply()`.",
					where: "src/components/test_mode_*.ts",
				},
				{
					name: "test_member_select / test_role_select / test_channel_select",
					kind: "Component",
					summary:
						"The member, role and channel select menus: each replies with what was resolved, which is how the typed resolvers are shown.",
					where: "src/components/test_*_select.ts",
				},
				{
					name: "test_showcase_inputs",
					kind: "Component",
					summary: "Opens the inputs modal: short and paragraph text inputs, read back on submit.",
					where: "src/components/test_showcase_inputs.button.ts · test_showcase_inputs_modal.modal.ts",
				},
				{
					name: "test_showcase_radio_check",
					kind: "Component",
					summary: "Opens the radio and checkbox modal and replies with what was chosen.",
					where: "src/components/test_showcase_radio_check.button.ts · test_showcase_radio_check_modal.modal.ts",
				},
				{
					name: "test_showcase_resolved",
					kind: "Component",
					summary:
						"Opens the modal with resolved member, role and channel select menus — the modal-side counterpart of the message selects.",
					where: "src/components/test_showcase_resolved.button.ts · test_showcase_resolved_modal.modal.ts",
				},
				{
					name: "test_showcase_upload",
					kind: "Component",
					summary: "Opens the file-upload modal, including its image preview.",
					where: "src/components/test_showcase_upload.button.ts · test_showcase_upload_modal.modal.ts",
				},
			],
		},
	],
};

/* ----------------------------------------------------------------- endpoints */

const ENDPOINTS: DocsSection = {
	id: "endpoints",
	title: "HTTP endpoints",
	blurb:
		"Each file in `api/` is a Vercel function. Pages are returned from modules in `src/utils` — never read from disk — because `index.html` and `public/**` are served as static output and are not inside the function bundle.",
	groups: [
		{
			id: "endpoints-discord",
			title: "Discord talks to these",
			entries: [
				{
					name: "POST /api/interactions",
					kind: "Endpoint",
					summary:
						"Every slash command, button, select menu and modal submit arrives here, signed with Ed25519. The endpoint verifies the signature and dispatches to the discovered handler.",
					details: [
						"Paste it into the Developer Portal as the **Interactions Endpoint URL** (`<your-app>/api/interactions`).",
						"Handler failures are recorded (`recordInteractionError`) and reported by `/api/diag` → `recentFailures`, because a handler that defers and then throws otherwise leaves nothing but a line in the dashboard logs.",
						"Module discovery is warmed at instance boot, so the first button press does not pay the dynamic-import cost.",
					],
					where: "api/interactions.ts",
					tags: ["interactions", "signature", "dispatch"],
				},
				{
					name: "POST /api/discord-events",
					kind: "Endpoint",
					summary:
						"Discord's **Webhook Events** endpoint: PING validation plus the subscribed events, with the same Ed25519 headers and the *raw* body signed.",
					details: [
						"The example implemented here is `APPLICATION_DEAUTHORIZED`: the stored connection is dropped and a notice is posted into every linked channel this app maintains.",
						"Deliberately invalid signatures must be rejected with **401** — Discord removes an endpoint URL that answers them with anything else.",
						"Delivery is at-least-once: the handled marker is written **after** the work succeeds, so a failed delivery is retried and a duplicate of a successful one is recognised (the payload repeats `event.timestamp`).",
					],
					where: "api/discord-events.ts · src/utils/webhook-events.ts",
					example: "GET /api/diag → links.eventsUrl",
				},
				{
					name: "GET /api/discord-oauth-callback",
					kind: "Endpoint",
					summary:
						"The OAuth2 redirect target: it compares the `mini_oauth_state` cookie, exchanges the code, stores the user token in `MiniDatabase` and updates linked-role metadata.",
					details: [
						"Set it as the Developer Portal's **OAuth2 redirect** and as `DISCORD_REDIRECT_URI`. The success page says whether the connection can link channels (`sdk.social_layer` present or not); the failure page shows Discord's actual reason.",
						"The linked-roles flow requests `applications.commands identify guilds role_connections.write` — deliberately **not** `sdk.social_layer`, which is limited access and would make Discord reject the whole authorization where it has not been granted.",
					],
					where: "api/discord-oauth-callback.ts · src/utils/oauth-callback.ts",
				},
			],
		},
		{
			id: "endpoints-message",
			title: "Sending messages",
			entries: [
				{
					name: "GET /api/message",
					kind: "Endpoint",
					summary:
						"Reports where a message would go: every linked channel, with names resolved by the bot token so the page can show `#genel` instead of a snowflake.",
					where: "api/message.ts",
					example: "{ ok: true, total: 2, channels: [{ guildId, channelId, name }] }",
				},
				{
					name: "POST /api/message",
					kind: "Endpoint",
					summary:
						"`{ text }` → posted into **all** linked channels: through each server's lobby when its member has a stored `sdk.social_layer` connection, otherwise into the channel as the bot.",
					details: [
						"**Open, rate-limited, not authenticated.** There are no accounts and nothing here is a secret, so **5 messages per minute per IP** (`web-msg-rate:<ip>`) is what protects the servers. A refusal is `429` with `Retry-After`; `GET` is never limited.",
						"**The text is posted exactly as written.** No attribution line, no quote, no name field — nothing of the app's voice wraps text the app did not write, so there is nothing to forge either.",
						"**Partial delivery is reported as such:** every channel's own result is returned (`results[]` with `delivery: \"lobby\" | \"channel\"`, `messageId` or `error`).",
						"Answers `409` when nothing is linked, `502` when Discord refused every channel.",
					],
					where: "api/message.ts · src/utils/lobby-broadcast.ts",
					example: "POST /api/message\n{ \"text\": \"selam herkese\" }",
				},
				{
					name: "GET /api/activity",
					kind: "Endpoint",
					summary:
						"Bootstraps the Activity: `{ clientId, scopes, tokenExchange, missing }` — the scopes requested and whether this deployment can exchange a code at all.",
					where: "api/activity.ts · src/utils/activity-auth.ts",
				},
				{
					name: "POST /api/activity",
					kind: "Endpoint",
					summary:
						"`{ code }` → an access token. The one-time code from `sdk.commands.authorize` is exchanged **server-side**, because that needs `DISCORD_CLIENT_SECRET` and Discord's token endpoint is not CORS-enabled.",
					details: [
						"`400` means Discord blamed the code (single-use and short-lived, so a retry cannot help); `401` means Discord rejected the *application's* credentials — the difference between \"press the button again\" and \"fix the deployment\".",
						"The Activity asks only for `identify` and `guilds`: **not** `sdk.social_layer`, which is limited access and would fail the whole authorization on an app that has not been accepted into the Social SDK program.",
					],
					where: "api/activity.ts",
				},
			],
		},
		{
			id: "endpoints-operations",
			title: "Operating it",
			entries: [
				{
					name: "GET /api/diag",
					kind: "Endpoint",
					summary:
						"Read-only JSON diagnostics — the endpoint that answers the questions Vercel's dashboard would otherwise be needed for. Never returns a secret: only *whether* an environment variable is set.",
					details: [
						"`problems` — why commands are missing or linking cannot work, in order.",
						"`?guild=<id>` also reads that server's commands, lobby record and channel menu with privacy verdicts; `?channel=<id>` highlights one of them; `?user=<id>` reports whether that user has a stored connection and which scopes it granted; `?command=authorize` runs the real `/authorize` command against a stub interaction and returns the reply it would send; `?fs=1` reports the function's `cwd` and which runtime paths exist.",
						"`lobbyState` says whether the stored lobby still exists on Discord's side; `linkedChannels` lists exactly what a deauthorization notice would reach; `recentEvents` and `recentFailures` are the last webhook deliveries and handler failures.",
						"`links.botInvite` is the invite URL to install the bot with `scope=bot+applications.commands` — the linked-roles consent flow does not add the bot to a server.",
					],
					where: "api/diag.ts · src/utils/diagnostics.ts",
					example: "curl \"https://<your-app>/api/diag\"\ncurl \"https://<your-app>/api/diag?guild=<GUILD_ID>\"\ncurl \"https://<your-app>/api/diag?command=authorize&user=<USER_ID>\"",
					tags: ["diagnostics", "health", "debug"],
				},
				{
					name: "GET /api/docs",
					kind: "Endpoint",
					summary: "Serves this documentation page. Anything but `GET` is answered with `405` and an `Allow: GET` header.",
					details: [
						"`vercel.json` rewrites `/docs` here. The page is rendered from `src/utils/docs-content.ts` + `src/utils/docs-page.ts` for the same reason the OAuth pages are: a page a function reads from disk is not in the function bundle.",
					],
					where: "api/docs.ts",
				},
				{
					name: "GET / (api/index)",
					kind: "Endpoint",
					summary:
						"The deployment root, which serves two pages on purpose: the `Connect Discord` start page, and the Activity when Discord loads the frame.",
					details: [
						"A Discord Activity's URL mapping is a **prefix → target** pair, and the useful mapping is `/` → the deployment root: the frame then sits at the root path, so `/activity.js`, `/vendor/…` and `/api/…` are all reachable where they already are.",
						"The frame is recognised by the parameters Discord always puts in it (`frame_id` / `instance_id`), so a plain browser request to `/` still gets the Connect page.",
					],
					where: "api/index.ts",
				},
			],
		},
	],
};

/* --------------------------------------------------------------------- pages */

const PAGES: DocsSection = {
	id: "pages",
	title: "Pages",
	blurb: "The three things a human opens, and what each one is for.",
	groups: [
		{
			id: "pages-list",
			title: "Browser and in-Discord pages",
			entries: [
				{
					name: "/",
					kind: "Page",
					summary:
						"`Connect Discord`: starts the linked-roles OAuth flow (it sets the `mini_oauth_state` cookie and redirects to the consent screen), or shows a configuration error when the OAuth variables are missing.",
					where: "api/index.ts · src/utils/oauth-pages.ts",
				},
				{
					name: "/message",
					kind: "Page",
					summary:
						"The web app: type a message, it goes to every linked channel across all servers, and your own copy is kept under **Your messages**.",
					details: [
						"The same delivery as `/mesaj`, asked for from a browser. The transcript is kept in `localStorage`, because a message that lands in other people's channels should be visible to the person who wrote it.",
						"It is a static file (`public/message.html`) rewritten from `/message`; it talks to `/api/message` and `/api/diag`.",
					],
					where: "public/message.html",
				},
				{
					name: "/activity — Dog Run",
					kind: "Page",
					summary:
						"The Discord Activity: a white dog endless runner in the spirit of Chrome's offline dino — space to jump a hydrant, ↓ to duck a frisbee.",
					details: [
						"The **game starts first and unconditionally**; authorization happens behind it and is best effort, because a Discord Activity has no console and a failure would otherwise be a white rectangle. Every failure writes a readable line into `#status`.",
						"To enable it: Developer Portal → **Activities** → **URL Mappings**, and add exactly one mapping, `/` → `https://<your-deployment>/`. Mapping a sub-path breaks every asset and API call the frame makes.",
						"It plays in a plain browser too — the quickest way to see that the frame, its assets and the loop are all fine.",
					],
					where: "src/utils/activity-page.ts · public/activity.js · public/dog-runner.js",
					example: "URL mapping:  /   →   https://<your-deployment>/",
				},
				{
					name: DOCS_PAGE_PATH,
					kind: "Page",
					summary: "This page — the reference for everything above, searchable and server-rendered.",
					details: [
						"Kept honest by `src/utils/docs-content.test.ts`, which fails when a command, component or endpoint exists that the content does not document.",
					],
					where: "src/utils/docs-content.ts · src/utils/docs-page.ts",
				},
			],
		},
	],
};

/* ------------------------------------------------------------------ modules */

const MODULES: DocsSection = {
	id: "modules",
	title: "Functions and modules",
	blurb:
		"Everything exported by `src/utils`. The split follows the project's rule: pure logic and injectable collaborators live here, so the same code can be unit tested without a Discord interaction, a database or a deployment. Handlers in `src/commands` and `src/components` are thin wrappers over these.",
	groups: [
		{
			id: "modules-lobby-api",
			title: "src/utils/lobby-api.ts",
			blurb:
				"The Lobby HTTP API, driven through the package's `DiscordRestClient`. **One client per call** (no learned rate-limit state can be carried into the next attempt), no retries (`maxRetries: 0`) and a **5-second bound** — because the channel-linking bucket is the application-wide cap (20 calls / 2 h while unapproved), and a shared client that sleeps out a bucket leaves a serverless invocation dead with nothing linked and nothing reported.",
			entries: [
				{
					name: "LOBBY_CALL_TIMEOUT_MS",
					kind: "Constant",
					signature: "const LOBBY_CALL_TIMEOUT_MS = 5_000",
					summary: "How long one Lobby/Discord call may take before it is given up on.",
				},
				{
					name: "createLobby",
					kind: "Function",
					signature: "createLobby(members: LobbyMemberInput[]): Promise<APILobby>",
					summary: "Creates a lobby with the given members, using the bot token.",
					details: [
						"Grant the creator `flags: LobbyMemberFlags.CanLinkLobby` — without it a member can neither link nor unlink channels.",
					],
				},
				{
					name: "linkChannelToLobby",
					kind: "Function",
					signature: "linkChannelToLobby(lobbyId: string, channelId: string, userToken: string): Promise<APILobby>",
					summary: "Links a channel to a lobby. Needs a **user** token with `openid sdk.social_layer`.",
				},
				{
					name: "unlinkChannelFromLobby",
					kind: "Function",
					signature: "unlinkChannelFromLobby(lobbyId: string, userToken: string): Promise<APILobby>",
					summary: "Removes any linked channel from the lobby. Same user token requirement.",
				},
				{
					name: "createLobbyChannelInviteForSelf",
					kind: "Function",
					signature: "createLobbyChannelInviteForSelf(lobbyId: string, userToken: string): Promise<APILobbyInvite>",
					summary:
						"Creates a single-use, one-hour invite to the linked channel's server, targeted at the calling user.",
				},
				{
					name: "sendLobbyMessage",
					kind: "Function",
					signature: "sendLobbyMessage(lobbyId: string, content: string, userToken: string): Promise<{ id: string }>",
					summary:
						"Posts into the lobby as the calling user — the call a Social SDK game makes; it lands in the lobby's linked channel.",
					details: [
						"This route accepts no `allowed_mentions`, so the content is passed through `neutraliseMentions()` and is made unable to form a mention token at all.",
					],
				},
				{
					name: "sendChannelMessage",
					kind: "Function",
					signature: "sendChannelMessage(channelId: string, content: string, allowMentions = false): Promise<{ id: string }>",
					summary: "Posts into a channel as the bot. Used by the deauthorize notice and the message broadcast.",
					details: [
						"Mention parsing is **off** unless `allowMentions` is set: the web app carries text written by whoever has the link, and a bot-owned `@everyone` pings a whole server.",
					],
				},
				{
					name: "getLobby",
					kind: "Function",
					signature: "getLobby(lobbyId: string): Promise<APILobby>",
					summary:
						"Reads a lobby (bot auth) — used to check whether a stored lobby still exists, and to learn its linked channel.",
				},
				{
					name: "listGuildChannels",
					kind: "Function",
					signature: "listGuildChannels(guildId: string): Promise<APIChannel[]>",
					summary: "Lists a guild's channels (bot auth) — the source of the channel picker and of privacy classification.",
				},
				{
					name: "listBotGuilds",
					kind: "Function",
					signature: "listBotGuilds(): Promise<{ id: string; name?: string }[]>",
					summary:
						"Lists the servers the bot is in (`GET /users/@me/guilds`) — the only way to enumerate the guilds that can have a linked channel, since `MiniDatabase` can only read keys you already know.",
				},
				{
					name: "linkedChannelIdOf",
					kind: "Function",
					signature: "linkedChannelIdOf(lobby: APILobby): string | null",
					summary: "The channel a lobby currently links to, or null.",
				},
				{
					name: "describeLobbyError",
					kind: "Function",
					signature: "describeLobbyError(error: unknown): string",
					summary:
						"Turns a thrown value into one readable line — Discord's own `message` from the error body when there is one, the timeout's explanation otherwise.",
				},
				{
					name: "withTimeout",
					kind: "Function",
					signature: "withTimeout<T>(operation: string, promise: Promise<T>, timeoutMs?): Promise<T>",
					summary: "Bounds a promise, rejecting with `LobbyCallTimeoutError` instead of hanging.",
				},
				{
					name: "setLobbyFetchImplementation",
					kind: "Function",
					signature: "setLobbyFetchImplementation(impl): void",
					summary: "Test seam: replaces the transport every client this module builds uses.",
				},
				{
					name: "setLobbyCallTimeoutMs",
					kind: "Function",
					signature: "setLobbyCallTimeoutMs(ms: number): void",
					summary: "Test seam: shortens the per-call timeout so tests do not wait 5 seconds.",
				},
				{
					name: "LobbyCallTimeoutError",
					kind: "Class",
					signature: "class LobbyCallTimeoutError extends Error",
					summary:
						"Thrown when Discord did not answer in time. Fields are assigned in the body rather than declared as constructor parameters, because Node's strip-only TypeScript loader rejects parameter properties and this file is imported at runtime.",
				},
			],
		},
		{
			id: "modules-lobby-lifecycle",
			title: "src/utils/lobby-lifecycle.ts",
			blurb: "Keeping the stored lobby usable. A lobby is a session object, not durable state.",
			entries: [
				{
					name: "provisionLobby",
					kind: "Function",
					signature: "provisionLobby(guildId: string, memberIds: string[]): Promise<LobbyRecord>",
					summary:
						"Creates a lobby for the guild and stores it. Every listed member gets `CanLinkLobby` (`1 << 0`), and the first id becomes the record's `creatorId`.",
					example: "const record = await provisionLobby(guildId, [userId]);\n// record.lobbyId is persisted as `lc:${guildId}`",
				},
				{
					name: "isUnknownLobbyError",
					kind: "Function",
					signature: "isUnknownLobbyError(error: unknown): boolean",
					summary:
						"True when Discord answered `404` — the stored lobby id no longer exists. Only meaningful where the id came from a successful create of our own.",
				},
			],
		},
		{
			id: "modules-lobby-store",
			title: "src/utils/lobby-store.ts",
			blurb:
				"Per-guild lobby records on `MiniDatabase`, keyed `lc:${guildId}`, plus an index of the guilds used as a fallback when enumerating them.",
			entries: [
				{
					name: "lobbyKeyFor",
					kind: "Function",
					signature: "lobbyKeyFor(guildId: string): string",
					summary: "The storage key of a guild's lobby record — `lc:${guildId}`.",
				},
				{
					name: "LOBBY_GUILD_INDEX_KEY",
					kind: "Constant",
					signature: "const LOBBY_GUILD_INDEX_KEY = \"lc:guilds\"",
					summary:
						"The stored index of guilds with a lobby. A write-time index alone is blind to records created before it existed, which is why Discord's own guild list is consulted first.",
				},
				{
					name: "getLobbyRecord",
					kind: "Function",
					signature: "getLobbyRecord(guildId: string): Promise<LobbyRecord | null>",
					summary:
						"Loads a guild's lobby record: `{ lobbyId, creatorId, createdAt, channelId? }`. The optional `channelId` is the remembered link, so a notice does not depend on a live lobby.",
				},
				{
					name: "setLobbyRecord",
					kind: "Function",
					signature: "setLobbyRecord(guildId: string, record: LobbyRecord): Promise<boolean>",
					summary: "Creates or replaces the record and indexes the guild (an index failure is logged, never fatal).",
				},
				{
					name: "setLobbyChannel",
					kind: "Function",
					signature: "setLobbyChannel(guildId: string, channelId: string): Promise<void>",
					summary:
						"Remembers the channel a guild's lobby is linked to. Best effort: failing to remember must never fail the link that just succeeded.",
				},
				{
					name: "deleteLobbyRecord",
					kind: "Function",
					signature: "deleteLobbyRecord(guildId: string): Promise<boolean>",
					summary: "Forgets the guild's lobby (used by **Unlink**).",
				},
				{
					name: "indexLobbyGuild",
					kind: "Function",
					signature: "indexLobbyGuild(guildId: string): Promise<void>",
					summary:
						"Adds a guild to the index without touching its record. Called wherever a record is read as well as written, so older records become visible to the webhook handler.",
				},
				{
					name: "listLobbyGuilds",
					kind: "Function",
					signature: "listLobbyGuilds(): Promise<string[]>",
					summary: "Every indexed guild, newest first.",
				},
				{
					name: "unionGuilds",
					kind: "Function",
					signature: "unionGuilds(...lists: string[][]): string[]",
					summary: "Merges guild id lists without duplicates — pure, so the rule is unit tested.",
				},
				{
					name: "withGuild",
					kind: "Function",
					signature: "withGuild(list: string[], guildId: string, max = 200): string[]",
					summary: "Adds a guild to the front of an index list, dropping the oldest entries past `max`.",
				},
			],
		},
		{
			id: "modules-lobby-tokens",
			title: "src/utils/lobby-tokens.ts",
			blurb: "Stored user OAuth tokens, written by the OAuth callback under the user's Discord id.",
			entries: [
				{
					name: "getFreshUserToken",
					kind: "Function",
					signature: "getFreshUserToken(userId: string): Promise<StoredUserToken | null>",
					summary:
						"The stored token, refreshed first when it has expired — Discord access tokens live ~7 days, and a link attempted a week later would otherwise fail with a 401 that looks like a permission problem.",
					details: [
						"If the refresh fails, the (possibly stale) stored token is returned so the caller can still surface Discord's real error.",
					],
					example: "const token = await getFreshUserToken(userId);\nif (!token || !hasSocialLayerScope(token.scope)) { /* show Reconnect */ }",
				},
				{
					name: "getStoredUserToken",
					kind: "Function",
					signature: "getStoredUserToken(userId: string): Promise<StoredUserToken | null>",
					summary: "The stored record as it is, without refreshing.",
				},
				{
					name: "saveUserToken",
					kind: "Function",
					signature: "saveUserToken(userId: string, token: StoredUserToken): Promise<void>",
					summary: "Persists an access token, its refresh token, expiry and granted scopes.",
				},
				{
					name: "deleteUserToken",
					kind: "Function",
					signature: "deleteUserToken(userId: string): Promise<void>",
					summary:
						"Drops a user's connection. Called when Discord reports `APPLICATION_DEAUTHORIZED`, and whenever a user-token call answers `401` — every revocation is mechanically an unmerge, and keeping the record only makes the panel claim a connection that no longer works.",
				},
			],
		},
		{
			id: "modules-lobby-oauth",
			title: "src/utils/lobby-oauth.ts",
			blurb: "The user-token consent URL, and the messages that point at it.",
			entries: [
				{
					name: "buildSocialSdkOAuthUrl",
					kind: "Function",
					signature: "buildSocialSdkOAuthUrl({ clientId, clientSecret?, redirectUri }): string",
					summary:
						"The `openid sdk.social_layer` consent URL, built with `OAuth2Builder.communication(…).toURL()` with `prompt=consent` so re-consent is forced and the added scope is actually granted.",
					details: [
						"`clientSecret` is not embedded in the URL — it is only needed server-side when the code is exchanged. Without a client id/secret/redirect URI there is no URL, which is why callers check for all three.",
					],
				},
				{
					name: "hasSocialLayerScope",
					kind: "Function",
					signature: "hasSocialLayerScope(scope: string | undefined | null): boolean",
					summary:
						"Whether a scope string grants `sdk.social_layer` — the check every Linked Channels handler makes before attempting a user-token call.",
				},
				{
					name: "REVOKED_CONNECTION_HINT",
					kind: "Constant",
					summary:
						"The wording used whenever a user-token call answers `401`: the record has been cleared and `/authorize` grants it again. Shared so the next step is the same everywhere.",
				},
				{
					name: "AUTHORIZE_COMMAND",
					kind: "Constant",
					signature: "const AUTHORIZE_COMMAND = \"/authorize\"",
					summary: "The command to point users at for (re-)granting the connection.",
				},
			],
		},
		{
			id: "modules-channel-privacy",
			title: "src/utils/channel-privacy.ts",
			blurb:
				"Pure privacy classification for `permission_overwrites`. Over HTTP, `isLinkable` and `isViewableAndWriteableByAllMembers` **do not exist** — they are Social SDK client fields — so privacy is derived, and the rule is *warn unless the channel is provably public*.",
			entries: [
				{
					name: "classifyChannelPrivacy",
					kind: "Function",
					signature: "classifyChannelPrivacy(channel, guildId): \"public\" | \"private\" | \"unknown\"",
					summary:
						"Classifies a guild text channel: no overwrites at all → **public**; an `@everyone` overwrite denying VIEW_CHANNEL or SEND_MESSAGES → **private**; any role/member overwrite denying either → **private** (someone is locked out and we cannot tell who); anything else → **unknown**.",
					details: [
						"Callers must treat anything that is not `public` as needing the private-channel warning.",
						"The shape is a small structural type declared locally: `discord-api-types/v10` is not a declared dependency of this app.",
					],
				},
				{
					name: "classifyEveryoneOverwrite",
					kind: "Function",
					signature: "classifyEveryoneOverwrite(overwrite, guildId): ChannelPrivacy",
					summary: "Classifies a single `@everyone` role overwrite against the read/write mask.",
				},
				{
					name: "hasRestrictiveOverwrites",
					kind: "Function",
					signature: "hasRestrictiveOverwrites(overwrites): boolean",
					summary: "Whether any role or member overwrite denies VIEW_CHANNEL or SEND_MESSAGES.",
				},
			],
		},
		{
			id: "modules-lobby-channels",
			title: "src/utils/lobby-channels.ts",
			blurb:
				"Assembling the channel menu. Discord's channel select menus carry no per-option labels, so the menu is a labelled `StringSelect` built from the guild's channel list.",
			entries: [
				{
					name: "listGuildChannelsForMenu",
					kind: "Function",
					signature: "listGuildChannelsForMenu(guildId: string): Promise<ClassifiedChannel[]>",
					summary:
						"Fetches the guild's text channels with the bot token and classifies each one's privacy, sorted by name.",
				},
				{
					name: "buildChannelMenuOptions",
					kind: "Function",
					signature: "buildChannelMenuOptions(channels): { label, value, description? }[]",
					summary:
						"Turns classified channels into options with a badge (`✅` public, `🔒` private, `❓` unknown) and a description that says whether a warning will follow.",
				},
				{
					name: "MAX_MENU_CHANNELS",
					kind: "Constant",
					signature: "const MAX_MENU_CHANNELS = 24",
					summary: "Discord caps a select menu at 25 options; the 24th leaves room for a hint entry.",
				},
			],
		},
		{
			id: "modules-linked-channel-panel",
			title: "src/utils/linked-channel-panel.ts",
			blurb:
				"The wire payloads of the Linked Channels flow, built **two ways**: a Components V2 container and a legacy equivalent, so a refused edit still completes instead of leaving the admin on \"«bot» is thinking…\".",
			entries: [
				{
					name: "buildPanelPayloads",
					kind: "Function",
					signature: "buildPanelPayloads({ lobbyId, reconnectUrl }): EditablePayloadPair",
					summary:
						"The `/linked-channel` panel, with the Reconnect section only when `reconnectUrl` is set.",
					details: [
						"A `SectionBuilder` **throws** without an accessory, so plain text goes directly into the container and only blocks with a real accessory are wrapped in a section. Every payload here is exercised by `linked-channel-panel.test.ts` for exactly that reason.",
					],
				},
				{
					name: "buildChannelMenuPayloads",
					kind: "Function",
					signature: "buildChannelMenuPayloads({ lobbyId, channels }): EditablePayloadPair",
					summary: "The channel picker (`lc:link`) — a `StringSelect` with the privacy legend and a cancel button.",
				},
				{
					name: "PANEL_V2_FLAGS",
					kind: "Constant",
					signature: "const PANEL_V2_FLAGS = MessageFlags.IsComponentsV2",
					summary:
						"The flag a container payload needs. The legacy form must **not** set it, and a V2 payload must not mix in `content`/`embeds`.",
				},
			],
		},
		{
			id: "modules-linked-channel-state",
			title: "src/utils/linked-channel-state.ts",
			blurb:
				"The channel picked in `lc:pick` and confirmed in `lc:confirm`, persisted because consecutive interactions can be served by different serverless instances.",
			entries: [
				{
					name: "setPendingLink",
					kind: "Function",
					signature: "setPendingLink(userId, guildId, pick): Promise<void>",
					summary: "Stores the pick (channel id, name, privacy) under `lc-pending:${userId}:${guildId}`.",
				},
				{
					name: "getPendingLink",
					kind: "Function",
					signature: "getPendingLink(userId, guildId): Promise<PendingLink | undefined>",
					summary: "Reads a pick, returning it only while it is still fresh (cache first, then the database).",
				},
				{
					name: "clearPendingLink",
					kind: "Function",
					signature: "clearPendingLink(userId, guildId): Promise<void>",
					summary: "Forgets the pick — after a successful link, or when the warning is cancelled.",
				},
				{
					name: "parsePendingLink",
					kind: "Function",
					signature: "parsePendingLink(raw: Record<string, unknown> | null): PendingLink | undefined",
					summary: "Validates a stored record, so a malformed or half-written value is treated as absent.",
				},
				{
					name: "isFreshPendingLink",
					kind: "Function",
					signature: "isFreshPendingLink(record, now = Date.now()): record is PendingLink",
					summary: "Whether a pick is inside its TTL — pure, and unit tested at the boundary.",
				},
				{
					name: "PENDING_LINK_TTL_MS",
					kind: "Constant",
					signature: "const PENDING_LINK_TTL_MS = 10 * 60 * 1000",
					summary:
						"Ten minutes. An expired pick is reported plainly (\"the selected channel was forgotten\") rather than linking something stale.",
				},
			],
		},
		{
			id: "modules-lobby-broadcast",
			title: "src/utils/lobby-broadcast.ts",
			blurb:
				"Sending one message to **every** linked channel — the loop that stands in for the broadcast primitive Discord does not have. Sends run concurrently under `Promise.allSettled`, so one unreachable channel cannot mute the rest or eat the function timeout.",
			entries: [
				{
					name: "sendToLinkedChannels",
					kind: "Function",
					signature: "sendToLinkedChannels(content: string): Promise<DeliveryOutcome[]>",
					summary:
						"The web app's and `/mesaj`'s sender: **lobby first** (the OAuth2 token of a member of *that server's* lobby — one person's token cannot post into another server's lobby), and **into the channel as the bot** when that is impossible.",
					details: [
						"Each outcome says which path delivered it, and `lobbyFallback` says why the lobby was not used — so \"via the bot\" reads as *that lobby is idle* rather than as plain success.",
						"A lobby is a session object and a channel is not, so this is the difference between \"delivered while a game session is live\" and \"delivered, always\".",
					],
				},
				{
					name: "broadcastToLinkedChannels",
					kind: "Function",
					signature: "broadcastToLinkedChannels(content: string, userToken: string): Promise<BroadcastOutcome[]>",
					summary:
						"Posts into every lobby as the given user — what the panel's **Test all linked channels** button uses. Deliberately no bot fallback: it is a check that *your* connection works.",
				},
				{
					name: "describeBroadcastOutcomes",
					kind: "Function",
					signature: "describeBroadcastOutcomes(outcomes): string",
					summary:
						"The one-line-per-channel reply, with a hint per status code (404 = that lobby went idle, 403 = not a member or the bot cannot post, 401 = reconnect). Pure, so the wording is unit tested.",
				},
			],
		},
		{
			id: "modules-webhook-events",
			title: "src/utils/webhook-events.ts",
			blurb:
				"Discord's outgoing webhooks. Handlers must be idempotent: a delivery that is not acknowledged in time is retried for up to 10 minutes, and the events are neither realtime nor ordered.",
			entries: [
				{
					name: "buildWebhookEventEndpoint",
					kind: "Function",
					signature: "buildWebhookEventEndpoint(publicKey: string): WebhookEventEndpoint",
					summary: "The verifier + router `api/discord-events.ts` serves.",
				},
				{
					name: "buildEventRouter",
					kind: "Function",
					signature: "buildEventRouter(): WebhookEventRouter",
					summary:
						"The router: `PING` is logged, `APPLICATION_DEAUTHORIZED` drops the connection and notifies, everything else is logged, and an error is recorded and rethrown so Discord retries the delivery.",
				},
				{
					name: "notifyLinkedChannelsOfDeauthorization",
					kind: "Function",
					signature: "notifyLinkedChannelsOfDeauthorization(user, deps?): Promise<DeauthorizeOutcome>",
					summary:
						"Drops the stored connection (idempotent, and first) and posts a notice into **every** linked channel this app maintains.",
					details: [
						"The notice is not scoped to the servers whose link that user created: which account was linked last is not what the other servers need to know. To scope it, filter `considered` by `record.creatorId === user.id`.",
						"The outcome separates `notified`, `failed` (with Discord's reason), `withoutLinkedChannel`, `considered` and `ownedByUser`, so \"did every channel get it?\" is answerable from the log and from `/api/diag`.",
					],
				},
				{
					name: "linkedChannelTargets",
					kind: "Function",
					signature: "linkedChannelTargets(deps?, maxGuilds?): Promise<LinkedChannelTarget[]>",
					summary:
						"Every linked channel this app maintains — exactly what a deauthorization would notify, and what `GET /api/diag` reports so the answer is checkable without deauthorizing anything.",
					details: [
						"Bounded to `LINKED_CHANNEL_TARGET_LIMIT` (10) servers per run.",
					],
				},
				{
					name: "candidateGuilds",
					kind: "Function",
					signature: "candidateGuilds(): Promise<string[]>",
					summary:
						"The servers to inspect: Discord's own guild list (authoritative) merged with the stored index as a fallback, so a failure to list the bot's servers still leaves the indexed ones.",
				},
				{
					name: "summarizeEvent",
					kind: "Function",
					signature: "summarizeEvent(payload: WebhookEventPayload): string",
					summary:
						"One readable line per event type for the log and `/api/diag` — deliberately loose about the payload, so an unexpected shape still produces something readable instead of throwing.",
				},
				{
					name: "deliveryKeyOf",
					kind: "Function",
					signature: "deliveryKeyOf(payload): string | undefined",
					summary:
						"A stable identity for one delivery (`type:timestamp:subject`), so a retry is recognised. Discord gives no event id, but a retry repeats the payload byte for byte.",
				},
				{
					name: "deauthorizationMessage",
					kind: "Function",
					signature: "deauthorizationMessage(user): string",
					summary: "The notice posted in the linked channels when a user disconnects the app.",
				},
				{
					name: "describeDeauthorizationOutcome",
					kind: "Function",
					signature: "describeDeauthorizationOutcome(outcome): string",
					summary:
						"The one-line log summary naming the channels that were notified, the ones that failed with their reason, and how many have no linked channel.",
				},
			],
		},
		{
			id: "modules-authorize",
			title: "src/utils/authorize-command.ts and authorize-panel.ts",
			blurb:
				"`/authorize`'s behaviour. It lives outside `src/commands` because `/api/diag` runs it (to prove the recovery path works in a deployment) and importing a command module from outside the runtime scan would make the bundler emit a second copy — the command would then be registered twice and Discord would reject the whole `PUT`.",
			entries: [
				{
					name: "resolveAuthorizeReply",
					kind: "Function",
					signature: "resolveAuthorizeReply(userId: string | undefined, deps?): Promise<AuthorizePayloadPair>",
					summary:
						"What `/authorize` replies: the stored connection's status, verified against Discord, plus the consent URL.",
					details: [
						"`401` → the record is deleted and the reply says the connection was revoked; **confirmed** → the scopes Discord reports are stored (a user may decline one at consent time); **no answer** → the record is kept and the reply says it could not be confirmed. A hiccup must not cost anyone a working connection.",
					],
				},
				{
					name: "resolveAuthorizeUrl",
					kind: "Function",
					signature: "resolveAuthorizeUrl(env): { authorizeUrl: string | null; missingEnv: string[] }",
					summary: "Builds the consent URL, and names the environment variables that are missing when it cannot.",
				},
				{
					name: "createAuthorizeHandler",
					kind: "Function",
					signature: "createAuthorizeHandler(deps?): SlashCommandHandler",
					summary:
						"The handler, with injectable collaborators (token store, Discord check, environment) so the exact reply for every connection state is testable without an interaction.",
				},
				{
					name: "buildAuthorizePayloads",
					kind: "Function",
					signature: "buildAuthorizePayloads(data): AuthorizePayloadPair",
					summary: "Builds the V2 and legacy forms of the `/authorize` message.",
				},
				{
					name: "statusLine",
					kind: "Function",
					signature: "statusLine(status: AuthorizeStatus): string",
					summary:
						"The human-readable status: connected or not, the scopes granted, whether `sdk.social_layer` is present, whether Discord confirmed it, or that it was revoked.",
				},
				{
					name: "AUTHORIZE_COMMAND_NAME",
					kind: "Constant",
					signature: "const AUTHORIZE_COMMAND_NAME = \"authorize\"",
					summary: "The registered command name, derived from the `/authorize` string so the two cannot drift apart.",
				},
			],
		},
		{
			id: "modules-user-identity",
			title: "src/utils/user-identity.ts",
			blurb: "Asking Discord whether a stored token still works.",
			entries: [
				{
					name: "checkUserToken",
					kind: "Function",
					signature: "checkUserToken(accessToken: string, options?): Promise<UserTokenCheck>",
					summary:
						"`GET /oauth2/@me` — which needs no `identify` scope — and interprets the answer as `valid` (with the scopes Discord reports), `revoked` (401) or `unconfirmed` (403/429/5xx/timeout) with a reason.",
					details: [
						"Only `401` counts as a revocation: treating a rate limit or a 5xx as one would clear a working connection because of a hiccup.",
					],
				},
				{
					name: "interpretTokenCheckError",
					kind: "Function",
					signature: "interpretTokenCheckError(error: unknown): UserTokenCheck",
					summary: "Maps a thrown request error onto the same three states.",
				},
				{
					name: "describeTokenCheck",
					kind: "Function",
					signature: "describeTokenCheck(check: UserTokenCheck): string",
					summary: "One line per state, used by the panel and by `/api/diag`.",
				},
			],
		},
		{
			id: "modules-mesaj-web",
			title: "src/utils/mesaj-command.ts, web-message.ts, web-rate-limit.ts, mentions.ts",
			blurb:
				"The rules that stand between somebody's input and every server the app is in — pure functions, tested without a deployment.",
			entries: [
				{
					name: "checkMesajText",
					kind: "Function",
					signature: "checkMesajText(raw: unknown): { ok: true; text } | { ok: false; error }",
					summary:
						"Validates `/mesaj`'s `metin` option: non-empty after trimming, and at most 2000 characters (Discord's own limit). The refusal says how long the message was instead of truncating in silence.",
				},
				{
					name: "describeMesajReply",
					kind: "Function",
					signature: "describeMesajReply(outcomes: DeliveryOutcome[]): string",
					summary:
						"The reply, one line per channel, including which path delivered each one — the only thing that makes a broadcast dependable rather than hopeful.",
				},
				{
					name: "createMesajHandler",
					kind: "Function",
					signature: "createMesajHandler(deps?): SlashCommandHandler",
					summary:
						"The `/mesaj` handler with injectable collaborators. It defers first, checks the member's quota, and never leaves the deferred reply unanswered.",
				},
				{
					name: "describeQuotaRefusal",
					kind: "Function",
					signature: "describeQuotaRefusal(quota: QuotaResult): string",
					summary: "The refusal shown when a member broadcasts too often.",
				},
				{
					name: "checkWebMessage",
					kind: "Function",
					signature: "checkWebMessage({ text }): WebMessageCheck",
					summary:
						"Validates a web submission: trimmed, non-empty, at most 500 characters. `content` is the text itself — the app adds **nothing** to it.",
				},
				{
					name: "cleanText",
					kind: "Function",
					signature: "cleanText(raw: unknown): string | null",
					summary: "Normalises line endings and trims, returning null for anything that is not usable text.",
				},
				{
					name: "consumeQuota",
					kind: "Function",
					signature: "consumeQuota(ip: string, now = Date.now()): Promise<QuotaResult>",
					summary:
						"Counts one web message against the visitor's IP quota — 5 per minute, stored in `MiniDatabase` because consecutive requests are served by different instances.",
					details: [
						"A database failure is treated as *allow, not enforced* (`enforced: false`): the limit exists for abuse, and a storage outage must not take the feature down with it.",
					],
				},
				{
					name: "consumeCommandQuota",
					kind: "Function",
					signature: "consumeCommandQuota(userId: string, now = Date.now()): Promise<QuotaResult>",
					summary:
						"The same window for a **member** running `/mesaj`, in its own namespace (`cmd-msg-rate:<userId>`) — the web limit is per address because it has no accounts, this one is per person because it has one.",
				},
				{
					name: "decideQuota",
					kind: "Function",
					signature: "decideQuota(timestamps, now, max?, windowMs?): QuotaDecision",
					summary:
						"The pure decision. A refusal waits for the **oldest** timestamp in the window rather than the window end, which makes it a sliding window instead of a fixed one that lets a caller burst across a boundary.",
				},
				{
					name: "pruneTimestamps",
					kind: "Function",
					signature: "pruneTimestamps(timestamps, now, windowMs?): number[]",
					summary: "Drops the timestamps that have fallen out of the window. Pure.",
				},
				{
					name: "neutraliseMentions",
					kind: "Function",
					signature: "neutraliseMentions(text: string): string",
					summary:
						"Makes text structurally unable to form a mention token: `@everyone` → `@\\u200beveryone`, `<@123>` → `<@\\u200b123>`.",
					details: [
						"Used on the lobby path, which accepts no `allowed_mentions` and posts as the member's own account. A zero-width space is used rather than a backslash because a backslash only works if the client renders it as an escape.",
					],
				},
			],
		},
		{
			id: "modules-oauth",
			title: "src/utils/oauth-callback.ts and oauth-pages.ts",
			blurb:
				"The linked-roles flow and the pages it answers with. The pages are returned from **code**, never read from disk: `index.html` and `public/**` are static output and are not in the function bundle.",
			entries: [
				{
					name: "handleOAuthCallback",
					kind: "Function",
					signature: "handleOAuthCallback(req, res): Promise<void>",
					summary:
						"Compares the `mini_oauth_state` cookie with the one it sent, exchanges the code, stores the token and updates the linked-role metadata — answering with a page that says what happened either way.",
				},
				{
					name: "connectPage",
					kind: "Function",
					signature: "connectPage(oauthUrl: string | null): string",
					summary:
						"The `Connect Discord` page. With a URL it redirects to the consent screen; without one it reports which configuration is missing instead of failing silently.",
				},
				{
					name: "connectedPage",
					kind: "Function",
					signature: "connectedPage({ scope, hasSocialLayer }): string",
					summary:
						"The success page, which also says whether this connection can link channels (`openid sdk.social_layer` present or not).",
				},
				{
					name: "failedPage",
					kind: "Function",
					signature: "failedPage({ heading?, message, detail? }): string",
					summary: "The failure page, showing Discord's actual reason — the point of that module.",
				},
				{
					name: "escapeHtml",
					kind: "Function",
					signature: "escapeHtml(value: string): string",
					summary:
						"Escapes `& < > \"` for interpolation into HTML. Reused by this documentation page so there is one escaping rule in the app.",
				},
			],
		},
		{
			id: "modules-activity",
			title: "src/utils/activity-auth.ts, activity-page.ts and the game",
			blurb:
				"The Activity's server half and its shell. Authorization is best effort; the game is never gated on it.",
			entries: [
				{
					name: "activityConfig",
					kind: "Function",
					signature: "activityConfig(): { clientId, tokenExchange, redirectUri }",
					summary: "What the Activity page needs to start, and whether this deployment can exchange a code at all.",
				},
				{
					name: "exchangeActivityCode",
					kind: "Function",
					signature: "exchangeActivityCode(code: string, deps?): Promise<ActivityToken>",
					summary:
						"Exchanges the frame's one-time code for an access token. Server-side by necessity: it needs `DISCORD_CLIENT_SECRET`, and Discord's token endpoint is not CORS-enabled.",
				},
				{
					name: "checkActivityCode",
					kind: "Function",
					signature: "checkActivityCode(raw: unknown): { ok: true; code } | { ok: false; status; error }",
					summary: "Validates the submitted code before anything is sent to Discord.",
				},
				{
					name: "ACTIVITY_SCOPES",
					kind: "Constant",
					signature: "const ACTIVITY_SCOPES = [\"identify\", \"guilds\"] as const",
					summary:
						"Only identity — **not** `sdk.social_layer`, which is limited access and would fail the whole authorization on an app that has not been accepted into the Social SDK program. Nothing in the Activity needs it.",
				},
				{
					name: "activityPage",
					kind: "Function",
					signature: "activityPage(): string",
					summary:
						"The Activity shell: a visible starting state, the canvas, the controls legend, and a fallback that names the missing URL mapping.",
					details: [
						"A Discord Activity has no console and no address bar, so a missing page or asset is a white rectangle. This page ships text that is readable before any script runs.",
					],
				},
				{
					name: "startDogRunner",
					kind: "Script",
					signature: "startDogRunner(canvas, options?)",
					summary:
						"The game: rules, physics, rendering and input for the white dog endless runner. No assets, no build step — drawn with canvas paths.",
					details: [
						"Controls: **Space / ↑ / tap** to jump a hydrant, **↓** to duck a frisbee. High frisbees need nothing. Speed rises with the score and the time between obstacles shrinks.",
						"Tested without a browser: `dog-runner.test.ts` checks the rules and `dog-runner-engine.test.ts` runs the real loop against a fake canvas and `requestAnimationFrame` — a renderer that throws still means a blank Activity, which is the one failure nobody can debug from inside Discord.",
					],
					where: "public/dog-runner.js · public/activity.js",
				},
			],
		},
		{
			id: "modules-ops-utils",
			title: "src/utils/diagnostics.ts, command-modules.ts, event-log.ts, interaction-errors.ts",
			blurb: "The modules that make the deployment answerable without dashboard access.",
			entries: [
				{
					name: "deriveProblems",
					kind: "Function",
					signature: "deriveProblems(input: DiagInput): string[]",
					summary:
						"Turns every probe `/api/diag` collects into an ordered list of what is wrong and how to fix it. `ok: true` with an empty list means the deployment is healthy.",
				},
				{
					name: "buildBotInviteUrl",
					kind: "Function",
					signature: "buildBotInviteUrl(applicationId: string, permissions = 117760): string",
					summary:
						"The invite URL with `scope=bot+applications.commands` — the only way to get both the commands and the bot into a server. The linked-roles consent flow does not add the bot.",
				},
				{
					name: "buildEventsUrl",
					kind: "Function",
					signature: "buildEventsUrl(baseUrl: string): string",
					summary: "The Webhook Events URL to paste into the Developer Portal (`/api/discord-events`).",
				},
				{
					name: "DIAG_ENV_VARS",
					kind: "Constant",
					summary: "The environment variables `/api/diag` reports on — only **whether** each is set, never its value.",
				},
				{
					name: "loadModulesOf",
					kind: "Function",
					signature: "loadModulesOf(mini: MiniInteraction): Promise<LoadedModules>",
					summary:
						"Access to the library's private `loadModules()`, so the endpoint, the registration scripts and `/api/diag` all ask discovery the same way.",
				},
				{
					name: "commandNames / commandPayloads / payloadOf",
					kind: "Function",
					signature: "commandNames(modules): string[] · commandPayloads(modules): unknown[]",
					summary: "The discovered command names, and exactly the payloads `registerCommands()` would send.",
				},
				{
					name: "registrationProblems",
					kind: "Function",
					signature: "registrationProblems(modules: LoadedModules): string[]",
					summary:
						"Why a module list must **not** be sent to Discord: no command modules at all, a discovered file that is not a command, or a duplicated name.",
					details: [
						"Registering commands replaces the whole list in one `PUT`, so a rejected payload leaves the application with no command updates at all — silently, with the reason only in the build log. The scripts therefore skip the `PUT` and log instead.",
					],
				},
				{
					name: "recordWebhookEvent / getRecentEvents / hasSeenDelivery",
					kind: "Function",
					signature: "recordWebhookEvent(record) · getRecentEvents() · hasSeenDelivery(key)",
					summary:
						"The webhook event log behind `recentEvents`, and the dedupe check that makes retries safe. Written **after** the work succeeds, so a failed delivery is retried and a duplicate of a successful one is ignored.",
				},
				{
					name: "appendEvent / hasSeenEvent",
					kind: "Function",
					signature: "appendEvent(existing, record, max?) · hasSeenEvent(existing, key)",
					summary: "The pure parts of the event log — the newest 20 entries, and the dedupe lookup.",
				},
				{
					name: "recordInteractionError / getInteractionErrors / describeError",
					kind: "Function",
					signature: "recordInteractionError(error, context) · getInteractionErrors() · describeError(error)",
					summary:
						"The last five handler failures, behind `recentFailures`. This is how a message stuck on \"«bot» is thinking…\" is explained without the Vercel dashboard.",
				},
				{
					name: "appendInteractionError",
					kind: "Function",
					signature: "appendInteractionError(existing, error, context, max?)",
					summary: "The pure part: newest first, truncated, bounded.",
				},
			],
		},
		{
			id: "modules-misc",
			title: "Other modules",
			blurb: "Storage helpers, the linked-role metadata and this documentation site itself.",
			entries: [
				{
					name: "hasDatabaseConfig / getDb / DATABASE_NOT_CONFIGURED_MESSAGE",
					kind: "Function",
					signature: "hasDatabaseConfig(): boolean · getDb(): MiniDatabase",
					summary:
						"The shared `MiniDatabase` instance, built **on first use** — never at module scope, because `MiniDatabase.fromEnv()` throws without `MONGODB_URI` and the framework loads every command and component in one `Promise.all`: a throw while importing would take every command and button down with it.",
				},
				{
					name: "getUserData / updateDiscordMetadata",
					kind: "Function",
					signature: "getUserData(userId) · updateDiscordMetadata(userId, accessToken)",
					summary: "The linked-roles side of the template: reading a user's record and pushing role-connection metadata to Discord.",
				},
				{
					name: "MONGO_ENV_VAR",
					kind: "Constant",
					signature: "const MONGO_ENV_VAR = \"MONGODB_URI\"",
					summary: "The variable `MiniDatabase.fromEnv()` reads, named in one place for error messages.",
				},
				{
					name: "LINKED_ROLE_METADATA",
					kind: "Constant",
					signature: "const LINKED_ROLE_METADATA: RoleConnectionMetadataInput[]",
					summary: "The metadata schema registered with Discord (starting with `is_miniapp`), sent by `npm run register`.",
				},
				{
					name: "DOCS_SECTIONS / countEntries",
					kind: "Constant",
					signature: "countEntries(sections = DOCS_SECTIONS): number",
					summary:
						"The content of this page and how many entries it documents. `docs-content.test.ts` reads the source tree and fails when the app grows something the content does not describe.",
				},
				{
					name: "docsPage",
					kind: "Function",
					signature: "docsPage(): string",
					summary:
						"Renders the content above into the page you are reading: sidebar, search, anchors, code blocks, and escaping for every piece of text.",
				},
			],
		},
	],
};

/* ------------------------------------------------------------------- storage */

const STORAGE: DocsSection = {
	id: "storage",
	title: "Storage",
	blurb:
		"Everything is kept in `MiniDatabase` (MongoDB) through `getDb()`. Keys are prefixed by the feature that owns them, because a serverless deployment can only read a key it already knows — which is why some lists are indexed.",
	groups: [
		{
			id: "storage-keys",
			title: "Keys",
			entries: [
				{
					name: "<userId>",
					kind: "Key",
					summary:
						"A user's Discord OAuth token record: `{ accessToken, refreshToken, expiresAt, scope }`. Written by the OAuth callback, read by every user-token call through `getFreshUserToken()`.",
					where: "src/utils/lobby-tokens.ts",
				},
				{
					name: "lc:${guildId}",
					kind: "Key",
					summary:
						"A guild's lobby: `{ lobbyId, creatorId, createdAt, channelId? }`. The `channelId` is remembered when a link succeeds, because a lobby is a session object that Discord reaps but a channel is not.",
					where: "src/utils/lobby-store.ts",
				},
				{
					name: "lc:guilds",
					kind: "Key",
					summary:
						"The index of guilds with a lobby — used as a fallback when enumerating them. Discord's own guild list is consulted first, because an index written at write-time is blind to records that predate it.",
					where: "src/utils/lobby-store.ts",
				},
				{
					name: "lc-pending:${userId}:${guildId}",
					kind: "Key",
					summary:
						"The channel picked but not yet confirmed, with its privacy verdict. 10-minute TTL; persisted because the confirmation may be served by a different instance.",
					where: "src/utils/linked-channel-state.ts",
				},
				{
					name: "web-msg-rate:${ip}",
					kind: "Key",
					summary: "The web app's sliding window: 5 messages per minute per visitor IP.",
					where: "src/utils/web-rate-limit.ts",
				},
				{
					name: "cmd-msg-rate:${userId}",
					kind: "Key",
					summary: "The same window for `/mesaj`, per member, in its own namespace.",
					where: "src/utils/web-rate-limit.ts",
				},
				{
					name: "diag:webhook-events",
					kind: "Key",
					summary: "The last 20 received webhook events with what the handler did, reported by `recentEvents`.",
					where: "src/utils/event-log.ts",
				},
				{
					name: "diag:interaction-errors",
					kind: "Key",
					summary: "The last five handler failures, reported by `recentFailures`.",
					where: "src/utils/interaction-errors.ts",
				},
			],
		},
	],
};

/* --------------------------------------------------------------- environment */

const ENVIRONMENT: DocsSection = {
	id: "environment",
	title: "Environment",
	blurb:
		"Read from `process.env`; `env.example` lists them. `/api/diag` reports whether each is set — never a value. No secret is ever sent to a browser.",
	groups: [
		{
			id: "environment-vars",
			title: "Variables",
			entries: [
				{
					name: "DISCORD_APPLICATION_ID",
					kind: "Constant",
					summary:
						"The application id: the OAuth client id, the Activity's client id and the id in the bot invite URL.",
				},
				{
					name: "DISCORD_PUBLIC_KEY",
					kind: "Constant",
					summary:
						"Verifies the Ed25519 signature on interactions and webhook events. Without it nothing can be verified, so nothing is ever acknowledged. Whitespace is trimmed — a stray newline makes every signature fail with \"invalid interaction signature\".",
				},
				{
					name: "DISCORD_BOT_TOKEN",
					kind: "Constant",
					summary:
						"Bot auth for lobby creation and administration, listing channels and guilds, and posting a message into a channel. Rejected on the channel-linking, invite and lobby-message endpoints.",
				},
				{
					name: "DISCORD_CLIENT_SECRET",
					kind: "Constant",
					summary:
						"Server-side only: exchanging an authorization code (linked roles and the Activity) and refreshing user tokens. Never embedded in a URL sent to a browser.",
				},
				{
					name: "DISCORD_REDIRECT_URI",
					kind: "Constant",
					summary:
						"The OAuth2 redirect target (`<your-app>/api/discord-oauth-callback`). The same value is used to build the consent URL, so it must match the Developer Portal exactly.",
				},
				{
					name: "DISCORD_GUILD_ID",
					kind: "Constant",
					summary:
						"Optional. Registers commands on one guild for instant updates; leave it unset for global registration, which Discord may take an hour to publish.",
				},
				{
					name: "MONGODB_URI",
					kind: "Constant",
					summary:
						"The `MiniDatabase` connection string. Without it nothing is persisted, so linking, `/authorize` status and the rate limits all report that instead of pretending.",
				},
			],
		},
	],
};

/* ---------------------------------------------------------------- operations */

const OPERATIONS: DocsSection = {
	id: "operations",
	title: "Running it",
	blurb: "Scripts, the Developer Portal checklist, and what each failure means.",
	groups: [
		{
			id: "operations-scripts",
			title: "npm scripts",
			entries: [
				{
					name: "npm test",
					kind: "Script",
					summary:
						"The whole suite (`tsx --test`): pure rules, payload construction, endpoint handlers driven with real signatures, and the guards that keep tests out of the deployed directories.",
				},
				{
					name: "npm run build",
					kind: "Script",
					summary:
						"The type check (`tsc --noEmit`). It also runs as part of the Vercel build, before registration.",
				},
				{
					name: "npm run register",
					kind: "Script",
					summary:
						"Discovers and registers the commands and the linked-role metadata. Refuses to send an empty list, because that `PUT` **wipes** every registered command.",
				},
				{
					name: "npm run register:deploy",
					kind: "Script",
					summary:
						"The same registration, run by the deployment itself — so a deployment can no longer ship with zero registered commands.",
				},
				{
					name: "npm run mi-vendor / npm run activity-vendor",
					kind: "Script",
					summary:
						"Bundles the library and the Embedded App SDK browser build into `vendor/` and `public/vendor/`. Both are committed, so a deploy never depends on the order of install and build steps.",
				},
			],
		},
		{
			id: "operations-portal",
			title: "Developer Portal checklist",
			entries: [
				{
					name: "Interactions Endpoint URL",
					kind: "Page",
					signature: "https://<your-app>/api/interactions",
					summary: "Where Discord sends every command and button press. Discord validates it immediately.",
				},
				{
					name: "OAuth2 redirect",
					kind: "Page",
					signature: "https://<your-app>/api/discord-oauth-callback",
					summary: "Must equal `DISCORD_REDIRECT_URI`, or the state check and the token exchange fail.",
				},
				{
					name: "Webhooks → Endpoint URL",
					kind: "Page",
					signature: "https://<your-app>/api/discord-events",
					summary:
						"Subscribe to `APPLICATION_DEAUTHORIZED` for the notice, and to `LOBBY_MESSAGE_CREATE` if you want to watch a linked channel being used. Discord sends a `PING` on save, which appears in `/api/diag` → `recentEvents`.",
				},
				{
					name: "Activities → URL Mappings",
					kind: "Page",
					signature: "/   →   https://<your-app>/",
					summary:
						"Exactly one mapping, the root prefix to the deployment root. Mapping a sub-path leaves the frame unable to reach its own assets, which looks like a white rectangle.",
				},
				{
					name: "Bot invite",
					kind: "Page",
					signature: "scope=bot+applications.commands",
					summary:
						"The bot must be **in a server** for `/linked-channel` to list its channels and for a broadcast to reach its linked channel. The linked-roles consent flow does not add the bot. `/api/diag` → `links.botInvite` has the ready-made URL.",
				},
				{
					name: "Social SDK access request",
					kind: "Page",
					summary:
						"Required once from Discord for the `openid sdk.social_layer` scope. Until the application is accepted, the token exchange only works for allow-listed apps and channel linking is capped at 20 calls per 2 hours.",
				},
			],
		},
		{
			id: "operations-troubleshooting",
			title: "When something is wrong",
			entries: [
				{
					name: "Commands do not appear",
					kind: "Page",
					summary:
						"`/api/diag` → `registered` and `problems`. Global registration can take an hour; set `DISCORD_GUILD_ID` for instant updates. The app must be installed with the `applications.commands` scope.",
				},
				{
					name: "\"«bot» is thinking…\" forever",
					kind: "Page",
					summary:
						"A handler deferred and then threw. `/api/diag` → `recentFailures` names the context, and `payloads` reports whether the Linked Channels and `/authorize` messages can be serialised at all.",
				},
				{
					name: "Linking fails with 403",
					kind: "Page",
					summary:
						"Three causes, in order of likelihood: the stored connection lacks `openid sdk.social_layer` (use **Reconnect Discord** / `/authorize`), the lobby member lacks `CanLinkLobby`, or the app lacks Manage Channels / View Channel / Send Messages on the channel.",
				},
				{
					name: "Linking fails with 429",
					kind: "Page",
					summary:
						"The development cap: **20 link calls per 2 hours per application** while the app is unapproved. The request is never retried automatically; wait for the window to reset.",
				},
				{
					name: "404 Unknown Lobby",
					kind: "Page",
					summary:
						"The stored lobby was reaped while idle. It is re-created automatically on the next link, with the acting admin carrying `CanLinkLobby`, and the operation is retried exactly once.",
				},
				{
					name: "The Activity is a white frame",
					kind: "Page",
					summary:
						"Almost always the URL mapping (see above), or the app is not installed in the server. `/activity` in a plain browser tab shows whether the page, the game and its assets load at all; `/api/diag` → `activity` names what the deployment is missing.",
				},
				{
					name: "A message only reached one channel",
					kind: "Page",
					summary:
						"`/api/diag` → `linkedChannels` lists exactly what a broadcast would reach, and `/mesaj` replies per channel with the path each took. A server whose lobby is idle is delivered to by the bot, and \"via the bot\" is the tell.",
				},
			],
		},
	],
};

/** Every section of the site, in the order the sidebar shows them. */
export const DOCS_SECTIONS: DocsSection[] = [
	OVERVIEW,
	COMMANDS,
	COMPONENTS,
	ENDPOINTS,
	PAGES,
	MODULES,
	STORAGE,
	ENVIRONMENT,
	OPERATIONS,
];
