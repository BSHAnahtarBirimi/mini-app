import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_NAME,
	MAX_MESSAGE_LENGTH,
	MAX_NAME_LENGTH,
	checkWebMessage,
	cleanName,
	composeWebMessage,
} from "./web-message.ts";

/**
 * The web app's endpoint is open: anyone with the link may post, and the message
 * goes to every linked channel. These rules are therefore the only thing between
 * a stranger's input and the app's servers, and the two that matter are that the
 * attribution cannot be forged (the name is rendered in bold by the app itself)
 * and that the body cannot exceed what a Discord message holds.
 */

test("an empty or whitespace-only message is refused with a reason", () => {
	for (const text of ["", "   ", "\n\n", undefined, 42, null]) {
		const checked = checkWebMessage({ name: "tester", text });
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

test("a missing name still produces an attribution", () => {
	assert.equal(cleanName(undefined), DEFAULT_NAME);
	assert.equal(cleanName(""), DEFAULT_NAME);
	assert.equal(cleanName("   \n "), DEFAULT_NAME);
	assert.equal(cleanName(42), DEFAULT_NAME);

	const checked = checkWebMessage({ text: "hello" });
	assert.equal(checked.ok, true);
	if (!checked.ok) return;
	assert.equal(checked.name, DEFAULT_NAME);
});

test("a name is one line, bounded, and cannot forge the app's formatting", () => {
	assert.equal(cleanName("  Neo\nDevils  "), "Neo Devils", "newlines are collapsed, not kept");
	assert.equal(cleanName("a".repeat(80)).length, MAX_NAME_LENGTH);
	assert.equal(cleanName("Neo\tDevils"), "Neo Devils", "control characters become spaces");

	// The name is rendered as `**name**` by the app, so a name carrying its own
	// markdown could close that bold run and impersonate a second speaker.
	assert.equal(cleanName("**Admin**"), "\\*\\*Admin\\*\\*");
	assert.equal(cleanName("> quoted"), "\\> quoted");
	assert.equal(cleanName("back`tick`"), "back\\`tick\\`");

	const checked = checkWebMessage({ name: "**Admin**", text: "hi" });
	assert.equal(checked.ok, true);
	if (!checked.ok) return;
	assert.equal(
		checked.content,
		`💬 **${cleanName("**Admin**")}** — sent from the web app\n> hi`,
		"the bold run the app opens with is closed by the app, not by the name",
	);
});

test("the body keeps the author's own formatting, quoted", () => {
	const checked = checkWebMessage({ name: "tester", text: "line one\nline two\n\nline four" });
	assert.equal(checked.ok, true);
	if (!checked.ok) return;

	assert.equal(checked.text, "line one\nline two\n\nline four");
	assert.equal(
		checked.content,
		[
			"💬 **tester** — sent from the web app",
			"> line one",
			"> line two",
			"> ",
			"> line four",
		].join("\n"),
		"each line is quoted so the body cannot be read as the app speaking",
	);
});

test("carriage returns are normalised so the quote holds together", () => {
	assert.equal(composeWebMessage("t", "a\r\nb\rc"), "💬 **t** — sent from the web app\n> a\n> b\n> c");
});
