/**
 * What the web app (`public/message.html` → `api/message.ts`) accepts, and how
 * it turns that into the message Discord receives.
 *
 * The endpoint is deliberately open — anyone with the link may post, and the
 * message goes to **every** linked channel — so the rules that stand between a
 * stranger's input and the app's servers live here, as pure functions, where
 * they can be tested without a deployment:
 *
 * - **The text is posted as written.** No attribution line, no quote, no
 *   formatting added by the app: what the sender typed is what every channel
 *   receives. There is also no name field, so the old risk — a name rendered in
 *   the app's own bold run, which could be escaped but never truly trusted — is
 *   gone by construction. Nothing of the app's voice surrounds the message, so
 *   nothing of the app's voice can be forged.
 * - **Length is bounded.** Discord caps a message at 2000 characters; 500 keeps
 *   a long paste from filling a channel across every server at once, and the
 *   refusal says how long the message was rather than truncating in silence.
 * - **Mentions are not handled here.** They are removed at the call, and
 *   differently per path, because the two paths have different controls: the
 *   bot path sends `allowed_mentions: { parse: [] }` (server-enforced), and the
 *   lobby path has no such field and posts as the member's account, so the
 *   content itself is made unable to form a mention token
 *   (`src/utils/mentions.ts`). The text is passed through untouched here.
 */

/** Longest accepted message body. */
export const MAX_MESSAGE_LENGTH = 500;

/** Result of checking a submission: either the message, or why it was refused. */
export type WebMessageCheck =
	| { ok: true; text: string; content: string }
	| { ok: false; status: number; error: string };

/** The message body: trimmed, and `null` when it is not usable text. */
export function cleanText(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const text = raw.replace(/\r\n?/g, "\n").trim();
	return text === "" ? null : text;
}

/**
 * Validates one submission.
 *
 * `content` is what gets posted, and is the text itself — see the note at the
 * top of this file for why the app adds nothing to it.
 */
export function checkWebMessage(input: { text?: unknown }): WebMessageCheck {
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

	return { ok: true, text, content: text };
}
