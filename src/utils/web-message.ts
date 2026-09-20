/**
 * What the web app (`public/message.html` → `api/message.ts`) accepts, and how
 * it is turned into the message Discord receives.
 *
 * The endpoint is deliberately open — anyone with the link may post, and the
 * message goes to **every** linked channel — so the rules that stand between a
 * stranger's input and the app's servers live here, as pure functions, where
 * they can be tested without a deployment:
 *
 * - **Length is bounded.** Discord caps a message at 2000 characters and the
 *   quoted body plus the attribution has to fit; 500 for the body keeps a long
 *   paste from filling a channel and is reported as such rather than truncated
 *   silently.
 * - **The attribution cannot be forged.** The author's name is rendered in bold
 *   and the body as a quote, so markdown metacharacters in the *name* are
 *   escaped — otherwise a name of `**Admin**` or a leading `>` forges a second
 *   speaker inside the app's own formatting.
 * - **Mentions are not part of this.** `sendChannelMessage` disables mention
 *   parsing (`allowed_mentions: { parse: [] }`) because a bot-owned message
 *   containing `@everyone` pings a whole server. The text is passed through
 *   untouched here; the privilege is removed at the call.
 */

/** Longest accepted message body. */
export const MAX_MESSAGE_LENGTH = 500;

/** Longest accepted display name. */
export const MAX_NAME_LENGTH = 32;

/** Used when no name is given — never an empty attribution. */
export const DEFAULT_NAME = "A web visitor";

/** Result of checking a submission: either the composed message, or why not. */
export type WebMessageCheck =
	| { ok: true; name: string; text: string; content: string }
	| { ok: false; status: number; error: string };

/**
 * Escapes Discord markdown metacharacters.
 *
 * Backslashes first, or the escapes added below would themselves be escaped.
 */
export function escapeMarkdown(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/([*_~`|>])/g, "\\$1");
}

/**
 * A display name that cannot break out of the app's formatting: one line, no
 * control characters, no markdown, at most {@link MAX_NAME_LENGTH} characters.
 */
export function cleanName(raw: unknown): string {
	if (typeof raw !== "string") return DEFAULT_NAME;
	const name = escapeMarkdown(
		raw
			// Control characters (including newlines) would break the layout.
			.replace(/[\u0000-\u001f\u007f]/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	).slice(0, MAX_NAME_LENGTH);
	return name === "" ? DEFAULT_NAME : name;
}

/** The message body: trimmed, and `null` when it is not usable text. */
export function cleanText(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const text = raw.replace(/\r\n?/g, "\n").trim();
	return text === "" ? null : text;
}

/**
 * The exact content posted into each linked channel.
 *
 * Every line of the body is quoted, so the author's text cannot be read as the
 * app speaking, and line endings are normalised first so a stray `\r` cannot
 * break the quote block apart.
 */
export function composeWebMessage(name: string, text: string): string {
	const quoted = text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
	return [`💬 **${name}** — sent from the web app`, quoted].join("\n");
}

/** Validates one submission and composes the message, or explains the refusal. */
export function checkWebMessage(input: { name?: unknown; text?: unknown }): WebMessageCheck {
	const text = cleanText(input.text);
	if (text === null) {
		return { ok: false, status: 400, error: "Write a message first — the box is empty." };
	}
	if (text.length > MAX_MESSAGE_LENGTH) {
		return {
			ok: false,
			status: 400,
			error: `That message is ${text.length} characters; the limit is ${MAX_MESSAGE_LENGTH}.`,
		};
	}

	const name = cleanName(input.name);
	return { ok: true, name, text, content: composeWebMessage(name, text) };
}
