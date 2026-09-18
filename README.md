# Mini App Template (mini-interaction ≥ 0.9)

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
| `src/commands/ping.ts` | `/ping` — Components V2 container + section + button |
| `src/commands/echo.ts` | `/echo` — typed option resolver demo |
| `src/components/ping_button.ts` | Button → modal with a modal-side select menu |
| `src/components/ping_menu.ts` | Select menu component handler |
| `src/modals/ping_modal.ts` | Modal submit handler |
| `src/utils/database.ts` | Shared `MiniDatabase` instance + helpers |
| `src/commands/linked-channel.ts` | `/linked-channel` — Linked Channels admin panel |
| `src/components/lc_*.ts` | Linked Channels flow components (`lc:link`, `lc:pick`, `lc:confirm`, `lc:cancel`, `lc:unlink`, `lc:join`) |
| `src/utils/lobby-api.ts` | Discord Lobby HTTP API client (channel linking/unlinking, invites) |
| `src/utils/lobby-store.ts` | Per-guild lobby records on `MiniDatabase` (`lc:${guildId}`) |
| `src/utils/channel-privacy.ts` | Pure privacy classifier for `permission_overwrites` |
| `scripts/register.ts` | Auto-discovers and registers commands + linked-role metadata |

## 1. Prepare

```bash
npm install
cp env.example .env   # then fill in the values
```

## 2. Register commands & metadata

```bash
npm run register
```

Set `DISCORD_GUILD_ID` to register instantly on one guild; leave it unset for
global registration.

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

Run the pure-logic tests with `npm test`.

## Environment variables

See `env.example` for the full list. The critical ones:

- `DISCORD_APPLICATION_ID` — from Discord Developer Portal
- `DISCORD_PUBLIC_KEY` — from Discord Developer Portal
- `DISCORD_BOT_TOKEN` — bot token from Discord Developer Portal
- `DISCORD_CLIENT_SECRET` — OAuth2 client secret
- `DISCORD_REDIRECT_URI` — OAuth2 redirect URL
- `MONGODB_URI` — MongoDB connection string for `MiniDatabase`
