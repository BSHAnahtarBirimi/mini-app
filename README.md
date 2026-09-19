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
| `api/discord-events.ts` | Webhook Events endpoint (PING, `APPLICATION_DEAUTHORIZED`, …) |
| `src/commands/ping.ts` | `/ping` — Components V2 container + section + button |
| `src/commands/echo.ts` | `/echo` — typed option resolver demo |
| `src/components/ping_button.ts` | Button → modal with a modal-side select menu |
| `src/components/ping_menu.ts` | Select menu component handler |
| `src/modals/ping_modal.ts` | Modal submit handler |
| `src/utils/database.ts` | Shared `MiniDatabase` instance + helpers |
| `src/commands/linked-channel.ts` | `/linked-channel` — Linked Channels admin panel |
| `src/commands/authorize.ts` | `/authorize` — grants (or restores) this app's connection to your account |
| `src/components/lc_*.ts` | Linked Channels flow components (`lc:link`, `lc:pick`, `lc:confirm`, `lc:cancel`, `lc:unlink`, `lc:join`, `lc:test`) |
| `src/utils/authorize-panel.ts` | The `/authorize` message: connection status + the consent link |
| `src/utils/webhook-events.ts` | Webhook Events router + the deauthorize → linked-channel notice |
| `src/utils/event-log.ts` | Received events, kept for `/api/diag` and for retry dedupe |
| `src/utils/lobby-api.ts` | Lobby API wrappers over the package's `DiscordRestClient` (fail-fast: `maxRetries: 0`) |
| `src/utils/lobby-store.ts` | Per-guild lobby records on `MiniDatabase` (`lc:${guildId}`) + a guild index used as a fallback when enumerating them |
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
> `src/commands`, `src/components` and `src/modals` are **executed directories**,
> not folders. Handler discovery imports *every* importable file in them — at
> deploy time and on every cold start — so a `*.test.ts` placed there has its
> tests run inside the deployment, and a file that is not a command lands in the
> registration payload as `undefined`, which makes Discord reject the whole
> `PUT` (leaving the old command list in place, with nothing but a build-log
> line to say so). Keep tests and helpers out of those three directories;
> `src/utils/discovered-directories.test.ts` enforces it and
> `registrationProblems()` refuses to send a payload with a missing or
> duplicated command (`npm run register` exits non-zero, the deploy logs it and
> still succeeds).
>
> Equally: never import a **command module** from outside that scan (for
> example from `api/`). The bundler then emits a compiled copy beside the source,
> the directory scan finds the command twice, and the registration payload has a
> duplicate name. That is why `/authorize`'s behaviour lives in
> `src/utils/authorize-command.ts` and `src/commands/authorize.ts` only wraps it.
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
- **`/authorize` grants that connection** without leaving Discord: it answers
  with the current status of your stored connection and an
  **Authorize / Re-authorize Discord** link button (`openid sdk.social_layer`,
  `prompt=consent`). It is the same URL as the panel's **🔁 Reconnect Discord**
  button, and it is the recovery path whenever linking reports a scope problem.
- **`/authorize` does not trust the stored record** — it asks Discord. A
  connection whose token is dead looks perfectly fine in storage, so the command
  verifies it with `GET /oauth2/@me` (`src/utils/user-identity.ts`,
  `OAuth2Builder.getAuthorizationInfo`, which needs no `identify` scope): a
  `401` means the record is **cleared** and the message says the connection was
  revoked, a `200` replaces the stored scopes with the ones Discord reports were
  actually granted, and an unanswered check (403/429/5xx/timeout) keeps the
  record and says it could not be confirmed — a hiccup must not cost anyone a
  working connection.
- **A revoked connection is detected.** If Discord answers a user-token call
  with `401`, the stored record is dropped and the reply says to run
  `/authorize` — otherwise the app keeps reporting `connected: true` for a token
  that cannot do anything (which is what happens when the account removes the
  app and the deauthorization event never reached the endpoint).

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

### How to test Linked Channels

The linked-channel *experience* — players reading and posting the channel from
inside the game — only exists inside a Social SDK client, so there is no
browser UI for it. Everything on Discord's side can still be exercised in a real
server, and the parts Discord never shows you are covered by the webhook events
and the test message:

| What | Where | What you see |
| --- | --- | --- |
| Panel, channel pick, warning step, link/unlink | `/linked-channel` in your server | The panel and its ephemeral answers |
| Grant / restore your connection | **`/authorize`** (or **🔁 Reconnect Discord** on the panel) | The consent page, then `userToken.hasSocialLayer: true` in `/api/diag?user=…` |
| The command itself, without typing anything | `GET /api/diag?command=authorize&user=<id>` | The reply `/authorize` would send — the link, and whether that connection is confirmed, incomplete or revoked |
| A message going *through* the lobby | **✉️ Send a test message** on the panel (`lc:test`) | The message appears in the linked channel — this is the call a game makes via `sendLobbyMessage` |
| A lobby invite for a member | **🏠 Join Discord server** (`lc:join`) | A one-use `discord.gg` invite to the linked channel's server |
| What Discord tells your app | **Webhooks** page + `GET /api/diag` → `recentEvents` | `PING` when the URL is saved, then one line per subscribed event |
| The link itself | `/api/diag?guild=<id>` → `lobbyState` | The stored lobby's live state and its `linkedChannelId` |

So the shortest end-to-end check is: `/linked-channel` → **Link a channel** →
pick a channel → **Link anyway** → **✉️ Send a test message**, and watch your
message arrive in the channel. A message posted in the channel by a real user
posts *into* the lobby as well, which is why the linked channel is a two-way
bridge once a game is connected.

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

## Webhook Events

`api/discord-events.ts` serves Discord's **Webhook Events** ("outgoing
webhooks") — the one-way events Discord POSTs to your app, as opposed to the
interactions Discord sends when someone uses a command. They are the only
out-of-game signal for a user deauthorizing the app and for messages moving
through a linked channel, and unlike Gateway events they are **not realtime and
not ordered**, and are retried with backoff for up to 10 minutes.

### Set it up in the Developer Portal

1. `GET /api/diag` and copy `links.eventsUrl` (it is
   `https://<your-deployment>/api/discord-events`).
2. Open your app → **Webhooks** → paste it into **Endpoint URL**.
3. Enable **Events** and tick the ones you want — `APPLICATION_DEAUTHORIZED` for
the example below, and `LOBBY_MESSAGE_CREATE` if you want to watch a linked
channel being used.
4. **Save Changes.** Discord sends a `PING` immediately; it appears in
   `/api/diag` → `recentEvents` as soon as the endpoint is accepted.

The URL is verified with the same Ed25519 headers as interactions, and Discord
routinely re-checks it with **deliberately invalid signatures** — an endpoint
that answers those with anything but `401` gets its URL removed. Both are
enforced in `api/discord-events.ts` (and covered by
`src/utils/discord-events-endpoint.test.ts`, which drives the real handler with
real signatures).

### The example: `APPLICATION_DEAUTHORIZED`

For a Social SDK app, a deauthorization is *the* state change to react to: every
revocation is mechanically an unmerge, and the user's OAuth2 tokens become
invalid immediately. `src/utils/webhook-events.ts` therefore

1. **drops the stored connection** (`deleteUserToken`) so the panel stops
   claiming one and `/api/diag?user=…` stops reporting `connected: true`;
2. **posts a notice in every linked channel this app maintains** — “_tester
   disconnected this app from Discord. Channel linking and lobby invites need
   their Discord connection, so those actions will fail until they reconnect_”
   — so no server has to discover through a failed click that the connection it
   relies on is gone. Lobbies with no linked channel (or an id Discord has
   already reaped) are reported, not treated as failures.

The notice is deliberately **not** scoped to the servers whose link that user
created: which account was linked last is not what the other servers need to
know. To scope it that way, filter the `considered` targets by
`record.creatorId === user.id` in `notifyLinkedChannelsOfDeauthorization`.

### How it finds the servers

The event payload carries a user id and nothing else, and `MiniDatabase` can only
read keys you already know — so the guilds come from **Discord itself**
(`GET /users/@me/guilds`: the bot is in exactly the servers that can have a
linked channel), and then `lc:${guildId}` is read for each one. The stored index
(`lc:guilds`) is merged in as a fallback for when that call fails.

That order matters: a write-time index alone is blind to every lobby created
before the index existed, which is exactly how a channel linked in a second
server stayed invisible to the first version of this handler.

Delivery is **at-least-once**: the handled marker is written *after* the work
succeeds, so a failed delivery is retried and processed again, while a duplicate
of a delivery that succeeded is recognised (the payload repeats
`event.timestamp`, which is what the dedupe key uses). Deauthorization is your
real-world test: remove the app from **User Settings → Authorized Apps**, and
the notice lands in the linked channel.

Every received event is logged and returned by `/api/diag` as `recentEvents`,
which is also how you confirm a subscription is live — the `handled` field says
what the handler did with it.

## Diagnostics

Vercel runtime logs need dashboard access, so the app answers the same
questions itself. `GET /api/diag` returns JSON (no secrets — only *whether* an
environment variable is set, never its value, plus public ids and the command
names Discord already shows to everyone):

| Field | Answers |
| --- | --- |
| `problems` | Why commands are missing / linking cannot work, in order |
| `modules` | Whether handler discovery works in the deployment, and its error otherwise; `payloadProblems` lists why the discovered commands must not be registered |
| `bot` | Whether `DISCORD_BOT_TOKEN` is still accepted by Discord |
| `guilds` | Which servers the bot is actually in |
| `registered.global` / `registered.guild` | Which commands Discord currently has |
| `channels`, `selectedChannel`, `lobby` | The Linked Channels channel menu with privacy verdicts, and the stored lobby |
| `recentFailures` | The last handler failures, which is why a message stayed on "«bot» is thinking…" |
| `recentEvents` | The last Webhook Events Discord delivered, with what the handler did |
| `linkedChannels` | Which linked channels an `APPLICATION_DEAUTHORIZED` notice would reach (bounded to 10 servers) |
| `lobbyState` | Whether the stored lobby still exists on Discord's side (and its linked channel) |
| `payloads` | Whether the Linked Channels **and `/authorize`** messages can be serialised at all |
| `authorizeCommand` (`?command=authorize`) | The reply the real `/authorize` command just produced (add `&user=<id>` to have that user's stored connection really verified) |
| `filesystem` (`?fs=1`) | The function's `cwd` and which runtime paths actually exist |
| `links.botInvite` | Invite URL with `scope=bot+applications.commands` |
| `links.eventsUrl` | The exact URL to paste on the Developer Portal's Webhooks page |

```bash
curl "https://<your-app>/api/diag"
curl "https://<your-app>/api/diag?guild=<GUILD_ID>&channel=<CHANNEL_ID>"
curl "https://<your-app>/api/diag?command=authorize&user=<USER_ID>"
```

`ok: true` with an empty `problems` array means the deployment is healthy. The
endpoint never writes to a Discord channel and never changes a token it is not
asked about: `?command=authorize&user=<id>` runs the command against a stub
interaction, which means it *verifies* that user's stored connection (and, if
Discord answers `401`, clears the revoked record exactly as the command does).

## Environment variables

See `env.example` for the full list. The critical ones:

- `DISCORD_APPLICATION_ID` — from Discord Developer Portal
- `DISCORD_PUBLIC_KEY` — from Discord Developer Portal
- `DISCORD_BOT_TOKEN` — bot token from Discord Developer Portal
- `DISCORD_CLIENT_SECRET` — OAuth2 client secret
- `DISCORD_REDIRECT_URI` — OAuth2 redirect URL
- `MONGODB_URI` — MongoDB connection string for `MiniDatabase`
