# Mini App Template (mini-interaction ≥ 0.14)

Starter template for Discord HTTP-interaction apps built on **auto-discovery**:
drop handler files into convention directories and `MiniInteraction` picks them
up automatically. No manual router wiring, no explicit registration in the
endpoint file.

## What's inside

| Path | Purpose |
| --- | --- |
| `api/interactions.ts` | Vercel endpoint — 3 lines, auto-discovers all handlers |
| `api/index.ts` | Linked-roles landing page (`index.html`) |
| `api/discord-oauth-callback.ts` | OAuth2 callback: stores tokens in `MiniDatabase`, updates role metadata |
| `api/diag.ts` | Read-only diagnostics: bot token, guild membership, registered commands |
| `src/commands/ping.ts` | `/ping` — Components V2 container + section + button |
| `src/commands/echo.ts` | `/echo` — typed option resolver demo |
| `src/components/ping_button.ts` | Button → modal with a modal-side select menu |
| `src/components/ping_menu.ts` | Select menu component handler |
| `src/modals/ping_modal.ts` | Modal submit handler |
| `src/utils/database.ts` | Shared `MiniDatabase` instance + helpers |
| `src/commands/linked-channel.ts` | `/linked-channel` — Linked Channels admin panel |
| `src/components/lc_*.ts` | Linked Channels flow components (`lc:link`, `lc:pick`, `lc:confirm`, `lc:cancel`, `lc:unlink`, `lc:join`) |
| `src/utils/lobby-api.ts` | Lobby API wrappers over the package's `DiscordRestClient` (fail-fast: `maxRetries: 0`) |
| `src/utils/lobby-store.ts` | Per-guild lobby records on `MiniDatabase` (`lc:${guildId}`) |
| `src/utils/channel-privacy.ts` | Pure privacy classifier for `permission_overwrites` |
| `scripts/register.ts` | Auto-discovers and registers commands + linked-role metadata (manual run) |
| `scripts/register-deploy.ts` | Same registration, executed by production deploys |

## 1. Prepare

```bash
npm install
cp env.example .env   # then fill in the values
```

## 2. Register commands & metadata

Registration is **automatic on production deploys** — the Vercel build runs
`npm run register:deploy`, which PUTs the discovered commands with the
deployment's own credentials. Nothing has to be done locally, and a deployment
can no longer ship with zero registered commands.

The same step can be run by hand:

```bash
npm run register
```

Set `DISCORD_GUILD_ID` to register instantly on one guild; leave it unset for
global registration (Discord can take up to an hour to publish global
commands). Both paths refuse to send an empty command list, because that PUT
*wipes* every registered command.

> [!IMPORTANT]
> Commands are only visible in a server when the app is installed there **with
the `applications.commands` scope**. Invite it with
`https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands`
(the ready-made link is in `/api/diag`) — the linked-roles OAuth flow on the
landing page does not add the bot to a server.

## 3. Deploy — Vercel

```bash
npm install -g vercel
vercel login && vercel link
vercel --prod
```

Then in the [Developer Portal](https://discord.com/developers/applications):

- **Interactions Endpoint URL** → `https://<your-app>/api/interactions`
- **OAuth2 redirect** → `https://<your-app>/api/discord-oauth-callback`

> [!TIP]
> Importing the repository into Vercel and adding the environment variables is
> even easier — no CLI needed.

## Adding features

1. **New command:** Create `src/commands/my_command.ts` with this shape:

```ts
import { CommandBuilder } from "@minesa-org/mini-interaction";
import type { SlashCommandHandler } from "@minesa-org/mini-interaction";

export const myCommand = {
	data: new CommandBuilder().setName("my_command").setDescription("Does something"),
	handler: (async (interaction) => {
		return interaction.reply({ content: "Hello!" });
	}) satisfies SlashCommandHandler,
};
```

2. **New component:** Create `src/components/my_button.ts` with this shape:

```ts
import type { ComponentHandler } from "@minesa-org/mini-interaction";

export const myButton = {
	customId: "my_button",
	handler: (async (interaction) => {
		return interaction.reply({ content: "Clicked!", ephemeral: true });
	}) satisfies ComponentHandler,
};
```

3. **New modal:** Create `src/modals/my_form.ts` with this shape:

```ts
import type { ModalHandler } from "@minesa-org/mini-interaction";

export const myModal = {
	customId: "my_form",
	handler: (async (interaction) => {
		const value = interaction.getTextFieldValue("field_id");
		return interaction.reply({ content: `You said: ${value}` });
	}) satisfies ModalHandler,
};
```

That's it — `MiniInteraction` auto-discovers all files in `src/commands/`,
`src/components/`, and `src/modals/`. No other registration needed.

> [!IMPORTANT]
> Handler files are imported **at runtime by Node**, which strips TypeScript
types itself but does *not* rewrite module specifiers. Import shared code with
the real extension — `import { getDb } from "../utils/database.ts"` — never
`"./database.js"`. A `.js` specifier points at a file that does not exist in
the deployment, and one unresolvable import rejects the whole module load, so
**every** command and button stops responding while local tooling (tsx) keeps
working. `src/utils/module-specifiers.test.ts` enforces this for `src/`.
>
> A handler that touches the database or Discord **before answering** must call
> `interaction.deferReply({ flags: MessageFlags.Ephemeral })` (or `deferUpdate()`
> for a component) as its first statement, then fill the message in with
> `editReply()`. Discord discards a first response that takes longer than 3
> seconds, so a slow handler looks like a command that does nothing while its
> side effects still happen. The Ephemeral flag belongs on the deferral only —
> Discord rejects it on an edit. `src/utils/response-timing.test.ts` enforces
> this for the Linked Channels handlers.
>
> Build a deferral's payload **before** the first response is sent, and never
> let a builder throw after it. `SectionBuilder.toJSON()` rejects a section with
> no accessory (`[SectionBuilder] accessory is required for sections`) — a
> payload that throws while being constructed kills the handler *after* the
> acknowledgement, so the user sees "«bot» is thinking…" indefinitely and the
> only trace is a `console.error` in the Vercel dashboard. That is how
> `/linked-channel` broke, so `src/utils/linked-channel-panel.ts` builds the V2
> and legacy forms of each message in one tested place
> (`src/utils/linked-channel-panel.test.ts` constructs every payload), and
> `api/interactions.ts` records handler failures for `/api/diag`.
>
> A function must not read a **page** from disk at request time. Vercel bundles
> the imported source tree (`src/**`) but serves `index.html` and `public/**` as
> static output, so they are absent from the function — `GET /api/diag?fs=1`
> reports the layout (`cwd: /var/task`) and proves it. `includeFiles` does not
> fix it either. The OAuth pages therefore live in `src/utils/oauth-pages.ts` and
> are returned as strings; `src/utils/deployment-files.test.ts` fails the build
> if a function goes back to `htmlFile`/`readFile`.

## Handler API reference

| Handler type | `interaction` methods | Return |
|---|---|---|
| Command | `interaction.options.getString()`, `.getUser()`, `.getInteger()`, etc. | `interaction.reply()`, `interaction.deferReply()`, `interaction.editReply()`, `interaction.followUp()` |
| Component | `interaction.getStringValues()`, `interaction.getUser()`, `interaction.showModal()` | `interaction.reply()`, `interaction.deferReply()` |
| Modal | `interaction.getTextFieldValue()`, `interaction.getSelectMenuValues()`, `interaction.getRadioGroupValue()` | `interaction.reply()` |

## Linked Channels (`/linked-channel`)

Example implementation of Discord Social SDK **Linked Channels** over the HTTP
Lobby API (see `docs.discord.com/developers/resources/lobby`):

- The panel auto-creates a per-guild lobby with the invoking admin as a member
  carrying `CanLinkLobby` (`1 << 0`) — without that flag nobody can link **or**
  unlink. The lobby id is persisted in `MiniDatabase` as `lc:${guildId}`.
- **A lobby is a session object, not durable state.** Discord reaps it when it
  goes idle (the create call takes `idle_timeout_seconds`), so a stored id can
  already be gone when a link is attempted, and Discord answers
  **`404 Unknown Lobby`**. That is recovered from automatically: the lobby is
  re-created — with the acting admin carrying `CanLinkLobby` — and the operation
  is retried **exactly once** (`src/utils/lobby-lifecycle.ts`). Unlinking or
  inviting against a lobby that no longer exists says so instead of reporting a
  Discord failure. `GET /api/diag?guild=…` reports `lobbyState` so you can see
  whether the stored lobby is still alive.
- **Every Lobby call uses a fresh `DiscordRestClient` and a 5 s bound.**
  `DiscordRestClient` remembers rate-limit buckets on the instance, and
  `waitForBucket()` sleeps until a bucket resets *before* the next call is even
  attempted. The channel-linking bucket is the application-wide cap (20 calls /
  2 h while the app is unapproved), so a single `404 Unknown Lobby` on a shared
  client makes the *next* link call sleep for up to two hours — in a serverless
  function the invocation is killed at `maxDuration` first, leaving the admin on
  "«bot» is thinking…" with nothing linked and nothing recorded. A client that
  carries no learned state cannot do that, and `withTimeout()` converts any
  remaining stall into a reported `LobbyCallTimeoutError` instead of a silent
  hang. `src/utils/lobby-api.test.ts` reproduces the trap with the library's own
  client and pins both halves of the fix.
- **Link a channel** fetches the guild's text channels with the bot token and
  shows a labelled `StringSelect` (Discord channel select menus have no
  per-option labels, so privacy badges are computed from
  `permission_overwrites` by `src/utils/channel-privacy.ts`).
- **Every pick shows a warning step**: all lobby members will be able to read
  and post in the channel from inside the game, even members who cannot see it
  in Discord, and any lobby member can generate a server invite that server
  admins cannot restrict. Linking only proceeds after "Link anyway".
- Linking/unlinking/invites require a **user** OAuth2 Bearer token with the
  `openid sdk.social_layer` scope. That scope is limited access — apps must be
  accepted into Discord's Social SDK communication-features program. When a
  stored token lacks it, the panel shows a **Reconnect Discord** button built
  with those scopes. While the app is unapproved, channel linking is capped at
  **20 calls per 2 hours per application** — failed links are shown to the
  user and never retried in a loop.

### When it does not link

The panel and the components answer with the reason instead of failing
silently: `MONGODB_URI` missing (nothing can be persisted), a stored token
without `sdk.social_layer` (press **Reconnect Discord**), a lobby whose member
lacks `CanLinkLobby`, missing Manage Channels / View Channel / Send Messages on
the chosen channel, an expired lobby (re-created automatically on the next
link), the 20-calls-per-2-hours development cap, or a call Discord did not
answer within 5 s (reported as ⏳ and recorded, never retried). User tokens
expire after ~7 days and are refreshed automatically from the stored refresh
token. The picked channel is persisted in `MiniDatabase`
(`lc-pending:${userId}:${guildId}`, 10 minute TTL) because consecutive
interactions can be served by different serverless instances.

Run the pure-logic tests with `npm test`.

### Package version note

Built on `@minesa-org/mini-interaction` **v0.14.0**, which ships the full Lobby
surface (`LobbyMemberFlags`, `linkChannelToLobby`, `unlinkChannelFromLobby`,
`createLobbyChannelInviteForSelf`, `OAuth2Builder`). `src/utils/lobby-api.ts`
drives the package's `DiscordRestClient` with `maxRetries: 0`, **one client per
call** (no learned rate-limit state can be carried into the next attempt) and a
5 s bound per call, so a rate-limited or stalled link is reported to the admin
instead of retried or slept out.

v0.14.0 exists only as a GitHub tag — npm still serves 0.9.0 — and it cannot be
installed from there on Vercel: the build image's npm 12 refuses git
dependencies (`allow-git = none`) and remote tarballs (`allow-remote = none`),
and the tag does not commit the `dist/` that its blocked `prepare` script would
build. So the **built package is vendored** as
`vendor/mini-interaction-0.14.0.tgz` and installed through a `file:` spec,
which npm 10, npm 12 and bun all accept offline. To move to another tag:

```bash
node scripts/vendor-mini-interaction.mjs v0.15.0
npm pkg set 'dependencies.@minesa-org/mini-interaction=file:vendor/mini-interaction-0.15.0.tgz'
npm install
```

## Diagnostics

Vercel runtime logs need dashboard access, so the app answers the same
questions itself. `GET /api/diag` returns JSON (no secrets — only *whether* an
environment variable is set, never its value, plus public ids and the command
names Discord already shows to everyone):

| Field | Answers |
| --- | --- |
| `problems` | Why commands are missing / linking cannot work, in order |
| `modules` | Whether handler discovery works in the deployment, and its error otherwise |
| `bot` | Whether `DISCORD_BOT_TOKEN` is still accepted by Discord |
| `guilds` | Which servers the bot is actually in |
| `registered.global` / `registered.guild` | Which commands Discord currently has |
| `channels`, `selectedChannel`, `lobby` | The Linked Channels channel menu with privacy verdicts, and the stored lobby |
| `recentFailures` | The last handler failures, which is why a message stayed on "«bot» is thinking…" |
| `lobbyState` | Whether the stored lobby still exists on Discord's side (and its linked channel) |
| `payloads` | Whether the Linked Channels messages can be serialised at all |
| `filesystem` (`?fs=1`) | The function's `cwd` and which runtime paths actually exist |
| `links.botInvite` | Invite URL with `scope=bot+applications.commands` |

```bash
curl "https://<your-app>/api/diag"
curl "https://<your-app>/api/diag?guild=<GUILD_ID>&channel=<CHANNEL_ID>"
```

`ok: true` with an empty `problems` array means the deployment is healthy. The
endpoint is read-only and never calls Discord as a user.

## Environment variables

See `env.example` for the full list. The critical ones:

- `DISCORD_APPLICATION_ID` — from Discord Developer Portal
- `DISCORD_PUBLIC_KEY` — from Discord Developer Portal
- `DISCORD_BOT_TOKEN` — bot token from Discord Developer Portal
- `DISCORD_CLIENT_SECRET` — OAuth2 client secret
- `DISCORD_REDIRECT_URI` — OAuth2 redirect URL
- `MONGODB_URI` — MongoDB connection string for `MiniDatabase`
