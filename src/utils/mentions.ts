/**
 * Disarming mentions in text the app did not write.
 *
 * Discord has two different controls here, and which one is available depends on
 * the call:
 *
 * - **A bot sending a channel message** takes `allowed_mentions`, so
 *   `sendChannelMessage` sends `{ parse: [] }` and the message can never ping
 *   anything, whatever it says. That is server-enforced and is the guard used by
 *   the web app's fallback path and by the deauthorize notice.
 * - **A lobby message** (`POST /lobbies/{id}/messages`) accepts only `content`,
 *   `metadata` and `flags` — there is no `allowed_mentions` field to set. The
 *   message is posted as the *member's* account, and a member who can mention
 *   everyone would then ping a whole server on behalf of whoever typed the text.
 *
 * So for the lobby path the text itself must not be able to form a mention. A
 * zero-width space inside the token does exactly that and is structurally
 * reliable: Discord resolves `<@123>` by matching that exact shape, and
 * `@everyone` by matching that exact string, so `<@\u200b123>` and
 * `@\u200beveryone` are neither — they render as the literal text the author
 * typed. Backslash-escaping (`\@everyone`) is the other option, but it depends on
 * client-side markdown parsing rather than on the token not existing, and this
 * guard has to hold for any client.
 *
 * The cost is an invisible character in the copyable text, which is why this is
 * not applied to every message — only where Discord leaves no better control.
 */

/** Zero-width space: invisible, and enough to break a mention token. */
export const ZERO_WIDTH_SPACE = "\u200b";

/** `@everyone` / `@here`, but not `@everyones` or an email-ish `@heretic`. */
const BROADCAST = /@(everyone|here)\b/g;

/** `<@123>`, `<@!123>` (nickname), `<@&123>` (role). */
const MENTION_TOKEN = /<@([!&]?\d+)>/g;

/**
 * Returns `text` with every mention token made inert.
 *
 * Channel links (`<#123>`) are left alone: they cannot ping anyone, and breaking
 * them would only make a legitimate link unclickable.
 */
export function neutraliseMentions(text: string): string {
	return text
		.replace(BROADCAST, `@${ZERO_WIDTH_SPACE}$1`)
		.replace(MENTION_TOKEN, `<@${ZERO_WIDTH_SPACE}$1>`);
}
