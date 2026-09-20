import assert from "node:assert/strict";
import test from "node:test";

import { MAX_MESSAGE_LENGTH, checkWebMessage, cleanText } from "./web-message.ts";

/**
 * The web app's endpoint is open: anyone with the link may post, and the message
 * goes to every linked channel. What these rules decide is therefore the whole of
 * the contract — that an empty or oversized message is refused with a reason, and
 * that a message that is accepted is posted **exactly as written**, with nothing
 * of the app's own voice around it (which is also why there is no attribution
 * field left to forge).
 */

test("an empty or whitespace-only message is refused with a reason", () => {
	for (const text of ["", "   ", "\n\n", undefined, 42, null]) {
		const checked = checkWebMessage({ text });
		assert.equal(checked.ok, false, `text ${JSON.stringify(text)} must be refused`);
		if (checked.ok) continue;
		assert.equal(checked.status, 400);
		assert.match(checked.error, /empty/);
	}
});

test("a message over the limit is refused, and says how long it was", () => {
	const checked = checkWebMessage({ text: "x".repeat(MAX_MESSAGE_LENGTH + 1) });
	assert.equal(checked.ok, false);
	if (checked.ok) return;
	assert.match(checked.error, new RegExp(String(MAX_MESSAGE_LENGTH + 1)));
	assert.match(checked.error, new RegExp(String(MAX_MESSAGE_LENGTH)));

	const atLimit = checkWebMessage({ text: "x".repeat(MAX_MESSAGE_LENGTH) });
	assert.equal(atLimit.ok, true, "exactly the limit is allowed");
});

test("the message is posted as written — nothing is wrapped around it", () => {
	const checked = checkWebMessage({ text: "  Merhabaaa  " });
	assert.equal(checked.ok, true);
	if (!checked.ok) return;

	assert.equal(checked.text, "Merhabaaa", "trimmed");
	assert.equal(checked.content, "Merhabaaa", "and posted verbatim: no header, no quote, no name");
});

test("markdown the author typed is theirs, and passes through untouched", () => {
	// A message is a message: the author's own formatting is what Discord renders
	// for any member. What the app must not do is *add* a voice of its own (a bold
	// run, a quote block) for text it did not write — and it no longer does.
	for (const text of ["**bold**", "> quoted", "# heading", "`code`", "~~strike~~"]) {
		const checked = checkWebMessage({ text });
		assert.equal(checked.ok, true, `${text} is allowed`);
		if (!checked.ok) continue;
		assert.equal(checked.content, text);
	}
});

test("line structure is preserved, since nothing re-indents it", () => {
	assert.equal(cleanText("line one\nline two\n\nline four"), "line one\nline two\n\nline four");

	const checked = checkWebMessage({ text: "a\r\nb\rc" });
	assert.equal(checked.ok, true);
	if (!checked.ok) return;
	assert.equal(checked.content, "a\nb\nc", "carriage returns are normalised, not dropped");
});

test("a name in the request body is ignored rather than rendered", () => {
	// The field used to be rendered as `**name**` by the app, which meant it had
	// to be escaped against closing that bold run. It is gone: an attribution can
	// no longer be forged because there is no attribution.
	const checked = checkWebMessage({ text: "hi", name: "**Admin**" } as { text: unknown });
	assert.equal(checked.ok, true);
	if (!checked.ok) return;
	assert.equal(checked.content, "hi");
});
