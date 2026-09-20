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
| `public/message.html` | The web app at `/message`: type a message, it goes to every linked channel — and you see your own copy of it |
| `api/message.ts` | `GET` = where a message would go, `POST` = post it into all of them (lobby or bot) |
| `src/commands/mesaj.ts` | `/mesaj` — the same broadcast from inside Discord |
| `src/utils/mesaj-command.ts` | Its rules, reply wording and handler (pure + injectable) |
| `src/utils/activity-page.ts` | The Activity shell — the new name for `/activity`, and for `/` when Discord loads it |
| `public/activity.js` | The Activity client: starts the game first, identifies the player best-effort |
| `public/dog-runner.js` | The game: a white dog endless runner, Dino-style (pure rules + canvas) |
| `api/activity.ts` | `GET` = what the Activity needs to start, `POST` = exchange its authorization code |
| `src/utils/activity-auth.ts` | Activity scopes + the server-side code → token exchange (holds the client secret) |
| `public/vendor/embedded-app-sdk/` | Vendored Embedded App SDK browser build (`npm run activity-vendor`) |
| `src/commands/ping.ts` | `/ping` — Components V2 container + section + button |
| `src/commands/echo.ts` | `/echo` — posts your text into the **lobby chat** of every linked channel |
| `src/utils/echo-command.ts` | Its rules, reply wording and handler (pure + injectable) |
| `src/components/ping_button.ts` | Button → modal with a modal-side select menu |
| `src/components/ping_menu.ts` | Select menu component handler |
| `src/modals/ping_modal.ts` | Modal submit handler |
| `api/docs.ts` | `/docs` — the documentation site: every command, component, endpoint and exported function |
| `src/utils/docs-content.ts` | What the site documents (data) — kept in sync with the source tree by its test |
| `src/utils/docs-page.ts` | How it is rendered: escaping, anchors, search, sidebar |
| `src/utils/database.ts` | Shared `MiniDatabase` instance + helpers |
| `src/commands/linked-channel.ts` | `/linked-channel` — Linked Channels admin panel |
| `src/commands/authorize.ts` | `/authorize` — grants (or restores) this app's connection to your account |
| `src/components/lc_*.ts` | Linked Channels flow components (`lc:link`, `lc:pick`, `lc:confirm`, `lc:cancel`, `lc:unlink`, `lc:join`, `lc:test`) |
| `src/utils/authorize-panel.ts` | The `/authorize` message: connection status + the consent link |
| `src/utils/webhook-events.ts` | Webhook Events router + the deauthorize → linked-channel notice |
| `src/utils/lobby-broadcast.ts` | One message, sent into **every** linked channel, with a per-channel result (bot or user token) |
| `src/utils/web-message.ts` | What the web app accepts, and how it is composed for Discord (pure) |
| `src/utils/mentions.ts` | Makes text unable to ping anyone, for the path with no `allowed_mentions` |
| `src/utils/web-rate-limit.ts` | Per-visitor message quota (pure window + `MiniDatabase` store) |
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

## Documentation site (`/docs`)

`/docs` is the app's own reference — every slash command, every `lc:*` / `test_*`
component, every endpoint under `/api/`, every page, and every exported function
of `src/utils`, with signatures, the file each one lives in, and the reasoning
that is easy to forget (why a lobby has to be re-created, why privacy has to be
derived, why a link is never retried). It is searchable, has a sidebar of
anchors, and renders without JavaScript: the script only filters and highlights.

The page is **rendered from code**, not read from disk — `api/docs.ts` returns
`docsPage()` from `src/utils/docs-page.ts` — for the same reason the OAuth pages
are: Vercel serves `index.html` and `public/**` as static output and does not put
them inside a function bundle, so a function that reads a page from disk answers
`FUNCTION_INVOCATION_FAILED`. `vercel.json` rewrites `/docs` to the function.

What is documented lives in `src/utils/docs-content.ts` as plain data; the
renderer escapes every interpolated string (`escapeHtml` from `oauth-pages.ts`)
and only then applies a tiny inline-markup subset, because documentation is
mostly code samples and this page documents `<@123>`, `@everyone` and `1 << 0`.

**The content cannot go stale.** `src/utils/docs-content.test.ts` reads the
source tree and fails the build when the app grows something the content does not
describe:

- every `new CommandBuilder().setName(…)` in `src/commands`,
- every `customId` / `custom_id` in `src/components` and in
  `src/utils/linked-channel-panel.ts`,
- every file in `api/` (each must be reachable as `/api/<name>`, or `api/index`),
- every variable in `DIAG_ENV_VARS`,
- every storage key, **derived from the functions that build it** (`lobbyKeyFor`,
  `rateKeyFor`, `commandRateKeyFor`, …) so a renamed prefix cannot stay
  documented under its old name,
- every `where:` reference (a file that no longer exists fails the test),
- and that `/docs` is the path `vercel.json` actually rewrites.

So adding a command means adding it to `docs-content.ts`; the test names the
one you forgot. `src/utils/docs-page.test.ts` covers the renderer itself:
unique anchors, escaping (no raw mention token, exactly one `<script>` element),
and both branches of the endpoint (`GET` → the page, anything else → `405` with
`Allow`).

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
| A message going *through* the lobby | **✉️ Test all linked channels** on the panel (`lc:test`) | The message appears in **every** linked channel this app maintains — this is the call a game makes via `sendLobbyMessage` — and the reply names each channel with Discord's answer for it |
| A lobby invite for a member | **🏠 Join Discord server** (`lc:join`) | A one-use `discord.gg` invite to the linked channel's server |
| Sending a message from Discord | **`/mesaj metin:…`** in your server | The message in every linked channel (lobby first, bot as the fallback), and a private reply naming each channel and the path it took |
| Sending a message from the web | `/message` | The same delivery, and your own copy of the message under **Your messages** |
| The Activity | `/activity` (or launch it from the server's Activity list) | **Dog Run** — space to jump, ↓ to duck — and, inside Discord, your name and record |
| What Discord tells your app | **Webhooks** page + `GET /api/diag` → `recentEvents` | `PING` when the URL is saved, then one line per subscribed event |
| The link itself | `/api/diag?guild=<id>` → `lobbyState` | The stored lobby's live state and its `linkedChannelId` |
| How any of it works, and how to call it | `/docs` | The whole reference: commands, components, endpoints, and every exported function |

So the shortest end-to-end check is: `/linked-channel` → **Link a channel** →
pick a channel → **Link anyway** → **✉️ Test all linked channels**, and watch your
message arrive in the channel. A message posted in the channel by a real user
posts *into* the lobby as well, which is why the linked channel is a two-way
bridge once a game is connected. To check the *broadcast* instead — every linked
channel at once — use `/mesaj` in Discord or the page at `/message`.

### How a message reaches every channel

Discord has **no broadcast primitive**, and nothing in the Developer Portal gives
you one: a webhook event, a Gateway event, a guild Scheduled Event and a Push
Event are all *notifications to your app*, not a way to post into a set of
channels. The only mechanism that exists is the loop in
`src/utils/lobby-broadcast.ts` — discover the linked channels, then post into
each. Three consequences are worth knowing before you design around it:

- **The bot must be in each server** (it is a normal member posting a normal
  message), which is why the target list comes from `GET /users/@me/guilds`.
- **One channel can fail alone.** The sends run under `Promise.allSettled`, so a
  channel the bot cannot post in is reported (`⚠️ Sent into 2 of 3`) instead of
  muting the rest — and instead of eating the whole function timeout, which a
  sequential loop over many servers would.
- **A lobby does not have to be alive to post.** The *notice* path
  (`APPLICATION_DEAUTHORIZED`) posts with the **bot** token straight into the
  channel, using the channel remembered on the guild's record, so a lobby
  Discord has already reaped cannot swallow it. The *test* button goes through a
  lobby, because that is the call a game makes, and a reaped lobby there is
  reported as `404` with what to do about it. The *web app* uses both: lobby
  first, bot as the fallback (see [Lobby first, bot as the safety
  net](#lobby-first-bot-as-the-safety-net)).

### Why the channel is remembered

A lobby is a session object and the channel is not, so `lc:${guildId}` also
stores `channelId` — written when a link succeeds (`lc:confirm`) and refreshed
the first time a live lobby read reports it. Before that, the notify step derived
its targets from a **live** `GET /lobbies/{id}` read, which meant a server whose
lobby happened to be idle at that moment was dropped from the broadcast in
silence: the message arrived in one channel and nothing anywhere said why. That
is the failure this field exists to prevent.

### The web app (`/message`)

`public/message.html` is a page anyone with the link can use: they type a message
and it is posted into **every** linked channel — **through each server's game
lobby** when that server's member has a connected account, and into the channel as
the app's **bot** when it cannot be. `api/message.ts` is what the page talks to.

The message is posted **exactly as written**: no attribution line, no quote, no
name field. Nothing of the app's voice wraps text the app did not write, so there
is also nothing left to forge (the old design named the sender in the app's own
bold run, and had to escape a name that could close it). What the page *does* add
is the sender's own copy: every message you send is listed under **Your messages**
with the time and each channel's outcome, kept in `localStorage` so a reload does
not lose it. A message that lands in other people's channels should be visible to
the person who wrote it.

### `/mesaj` — the same broadcast, from inside Discord

`/mesaj metin:<text>` posts one message into every linked channel this app
maintains, through the same sender the web app uses (lobby first, bot as the
fallback), and replies privately with one line per channel so a partial delivery
is visible instead of silent:

```
✅ Sent to all 2 linked channels.

• #genel — via the game lobby
• #klipler — via the bot (the member who linked this server has no stored Discord connection)
```

Three details of how it behaves, all of them from bugs this project already hit:

- **It acknowledges before it works.** `deferReply({ flags: Ephemeral })` is the
  first thing it does, because a broadcast across servers takes seconds and
  Discord invalidates the interaction token after 3. Ephemerality is fixed there,
  so the later `editReply` must not repeat the flag.
- **It is rate-limited per member** (`consumeCommandQuota`, 5 per minute, keyed
  `cmd-msg-rate:<userId>`) — the same window as the web app's, in its own
  namespace, because one invocation reaches every server the app is in.
- **The behaviour lives in `src/utils/mesaj-command.ts`**, not in the command
  file. The framework discovers commands by importing everything in
  `src/commands/`, so a command imported by an API endpoint or a diagnostic is
  emitted twice and Discord rejects the whole `PUT` — which is exactly how
  `/authorize` was once registered twice, with the reason only in the build log.
  `src/commands/mesaj.ts` is the declaration; the handler is a factory with
  injectable collaborators, so `src/utils/mesaj-command.test.ts` drives it.

### Lobby first, bot as the safety net

A message posted into a lobby is the call a Social SDK game makes, so a web
visitor's message and a player's in-game message arrive the same way. The web app
therefore sends per server (`sendToLinkedChannels`):

1. **Through the lobby** — `POST /lobbies/{id}/messages` with the OAuth2 token of
a member of *that server's* lobby (the `creatorId` on `lc:${guildId}`). One
person's token cannot post into another server's lobby, which is why the token is
looked up per server rather than once.
2. **Into the channel as the bot** — when there is no usable token (never
authorized, or without `openid sdk.social_layer`), or when the lobby call is
refused. This matters because **a lobby is a session object**: Discord reaps it
when idle, and a fresh one cannot inherit the old one's channel link (linking is
capped at 20 calls / 2 h). So the lobby carries the message while a game session
is live, and the bot guarantees it arrives when none is.

Every result says which path was taken, and why the lobby was not used when it
wasn't, so "via the bot" reads as *that lobby is idle* rather than as success.
The page summarises it too (`2 through the game lobby`, `1 through the game
lobby, 1 from the app's bot`).

| Request | Answer |
| --- | --- |
| `GET /api/message` | `{ ok, total, channels: [{ guildId, channelId, name }] }` — where a message would go, names resolved with the bot token |
| `POST /api/message` `{ text }` | `{ ok, sent, total, results: [{ channelId, ok, delivery, messageId \| error }] }` |

Rules, and why each exists:

- **Open, rate-limited, not authenticated.** There are no accounts here and
  nothing in the endpoint is a secret, so the limit is what protects your servers:
  **5 messages per minute per IP** (`src/utils/web-rate-limit.ts`), counted in
  `MiniDatabase` because consecutive requests are served by different instances.
  A refusal is a `429` with `Retry-After`; `GET` is never limited.
- **Mentions are disabled on both paths, differently.** The bot path sends
  `allowed_mentions: { parse: [] }` (server-enforced). The lobby path has no such
  field — the library's lobby send takes only `content`, `metadata` and `flags` —
  and posts as the *member's* account, so the content is made structurally unable
  to form a mention token instead: `@everyone` → `@\u200beveryone`,
  `<@123>` → `<@\u200b123>` (`src/utils/mentions.ts`). A stranger can never ping a
  server from this page, whichever path is used.
- **The text is posted as written, with nothing wrapped around it.** The endpoint
  adds no attribution and no formatting of its own — what the sender typed is what
  every channel receives (`src/utils/web-message.ts`), which is also why a name in
  the request body is ignored rather than rendered.
- **A partial delivery is reported as one.** Every channel's own result is
  returned, so a server the bot cannot post in shows `❌ 403` for that channel
  instead of being indistinguishable from success.

What it needs from Discord: the bot must be **in each server**, with **View
Channel + Send Messages** in the linked channel. That is the same requirement the
deauthorize notice has, and it is why the page posts with the bot token rather
than a user token — a visitor needs no Discord account, and no lobby has to be
alive.

### The Activity (`/activity`) — “Dog Run”

The frame you launch from a server's Activity list is a game: an endless runner
in the spirit of Chrome's offline dino, with a **white dog** in place of the dino,
fire hydrants to jump and frisbees to duck. `public/dog-runner.js` is the whole
game — no assets, no build step, drawn with canvas paths — `public/activity.js`
is the Activity's client, and `api/activity.ts` its server half. `api/index.ts`
serves the page, because an Activity's URL mapping is a **prefix → target** pair
and the one that keeps everything reachable is `/` → the deployment root.

| Route | What it is |
| --- | --- |
| `/activity` | The page. Open it in a browser and the game plays there too; inside Discord it also knows who you are. |
| `/activity.js` | The client: starts the game, then identifies the player in the background. |
| `/dog-runner.js` | The game: rules, physics, rendering, input. |
| `/vendor/embedded-app-sdk/…` | The `@discord/embedded-app-sdk` browser build, vendored (`npm run activity-vendor`) |
| `GET /api/activity` | `{ clientId, scopes, tokenExchange, missing }` — what the page needs to start |
| `POST /api/activity` `{ code }` | Exchanges the frame's one-time code for an access token |

Controls: **Space / ↑ / tap** to jump, **↓** to duck. High frisbees need nothing.
The speed rises with the score and the *time* between obstacles shrinks, so the
run gets harder in the way it claims to. The record is per Discord account.

Order of events: the **game starts first and unconditionally**; then, in the
background, `GET /api/activity` → `sdk.ready()` (which is also what tells Discord
the frame has loaded) → `sdk.commands.authorize` (Discord's own consent) →
`POST /api/activity` → `sdk.commands.authenticate`, whose answer keys the high
score. Authorization is **best effort**: if any step fails, the failure is one
line of text next to a game that still plays. Three decisions worth knowing:

- **The secret never reaches the browser.** `authorize` returns a one-time
  `code`; the exchange that turns it into a token needs `DISCORD_CLIENT_SECRET`,
  so it happens on the server. The Activity asks only for `identify` and
  `guilds` — **not** `sdk.social_layer`, which is limited access and would fail
  the whole authorization on an app that has not been accepted into Discord's
  Social SDK program. Nothing here needs that scope: the game only uses the
  identity, and sending a message does not use the Activity's token at all (see
  `/mesaj` and the web app, which go through `sendToLinkedChannels`).
- **It is never a blank frame.** A Discord Activity has no console, no address
  bar and no error output: a missing page or asset is a white rectangle. So the
  shell ships a visible starting state plus a fallback that names the fix, every
  failure writes a readable line into `#status`, `sdk.ready()` is bounded by a
  timeout (nothing answers `postMessage` outside Discord), and
  `src/utils/activity-page.test.ts` walks the page's assets *and* the client's
  whole module graph — the game and the vendored SDK — to prove every file they
  import exists.
- **The game is tested without a browser.** `src/utils/dog-runner.test.ts` checks
  the rules directly (a hydrant must be jumped, a mid frisbee ducked, a high one
  ignored; spacing tightens with speed; a graze survives) and
  `src/utils/dog-runner-engine.test.ts` runs the real loop against a fake canvas
  and a fake `requestAnimationFrame` — frames, a jump, a collision, game over, a
  restart, ducking, a tap, pause-on-blur and teardown. Rules that are right and a
  renderer that throws still mean a blank Activity, and that is the one failure
  nobody can debug from inside Discord.
- **The SDK is served from our own origin**, not a CDN: Discord applies its own
  Content-Security-Policy to the frame, and depending on a third-party host being
  allowed has no upside for 460 KB of static ESM. `public/vendor/` is committed,
  like `vendor/mini-interaction-*.tgz`, so a deploy never depends on the order of
  install and build steps. `vercel.json` pins its `Content-Type` to
  `text/javascript` — a module is refused outright if it is served as anything
  else.

**Enabling it (Developer Portal, one-time):** open your app → **Activities** →
**URL Mappings**, and add exactly one mapping:

```
/   →   https://<your-deployment>/        (prefix `/`, target the root)
```

The root, *not* `/activity`: Discord appends the requested path to the target, so
mapping the root is what lets the frame reach `/activity.js`, `/vendor/…` and
`/api/…` at the paths they already have. Two symptoms, and what they mean:

- **A white frame** — the mapping is missing, or points at `/activity`, so the
  assets and API calls 404. Then `curl https://<your-deployment>/api/diag` →
  `links.activityUrlMapping` reports the mapping to enter and
  `activity.configured` says whether the deployment can exchange a code at all.
- **"This page is a Discord Activity"** inside Discord — the frame reached the
  page but not as an Activity (no `frame_id`/`instance_id`).

You can verify most of it without Discord: `/activity` must return the page — and
**the game plays there**, in a plain browser tab, which is the quickest way to
see that the frame, its assets and the loop are all fine. `/activity.js`,
`/dog-runner.js` and `/vendor/embedded-app-sdk/index.mjs` must return JavaScript,
and `GET /api/activity` must report a `clientId` with `tokenExchange: true`.

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

The log line answers "did every channel get it?" directly, because that is the
question a partial delivery turns into a support thread:

```
APPLICATION_DEAUTHORIZED  deauthorized by tester (2851…)
  handled: connection dropped; notified <#1525905982000070780>, <#1550970323917340694>
```

A channel the notice could not reach appears as `failed <#…> (403 — Missing
Permissions)` instead, and the delivery is still acknowledged — Discord retries a
failed delivery, and a retry would re-notify the channels that already
succeeded.

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

Once a guild is known, its channel comes from the live lobby when Discord still
has one and from the guild's record when it does not (`channelId`), so the
broadcast never depends on a session object surviving. `/api/diag` →
`linkedChannels` reports the exact list a deauthorization would reach — check it
*before* removing the app rather than inferring it from what arrives.

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
| `links.messagePage` | The web app that posts a message into every linked channel |
| `activity` | Whether the Activity can exchange a code, the scopes it asks for, and its asset paths |
| `links.activityPage`, `links.activityUrlMapping` | The Activity URL, and the exact Developer Portal URL mapping that serves it |

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
