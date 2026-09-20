import assert from "node:assert/strict";
import test from "node:test";

import { ZERO_WIDTH_SPACE, neutraliseMentions } from "./mentions.ts";

/**
 * The lobby path posts as the *member's* account and Discord's lobby endpoint
 * accepts no `allowed_mentions`, so a web visitor's text has to be unable to form
 * a mention token at all. These assertions are what makes that a property of the
 * content rather than a hope about client-side parsing.
 */

test("everyone and here can no longer match", () => {
	assert.match(neutraliseMentions("@everyone"), /^@\u200beveryone$/);
	assert.match(neutraliseMentions("@here"), /^@\u200bhere$/);
	assert.doesNotMatch(neutraliseMentions("@everyone"), /@everyone/);
	assert.doesNotMatch(neutraliseMentions("@here"), /@here/);

	// Punctuation after the word does not stop Discord from pinging.
	assert.doesNotMatch(neutraliseMentions("hi @everyone, look"), /@everyone/);
	assert.doesNotMatch(neutraliseMentions("@everyone\nnew line"), /@everyone/);
});

test("user and role mentions can no longer resolve", () => {
	for (const token of ["<@285118390031351809>", "<@!285118390031351809>", "<@&1525905982000070780>"]) {
		const neutralised = neutraliseMentions(token);
		assert.doesNotMatch(neutralised, /<@[!&]?\d+>/, `${token} must not stay resolvable`);
		assert.equal(
			neutralised.replaceAll(ZERO_WIDTH_SPACE, ""),
			token,
			"the text still reads exactly as it was written",
		);
	}
});

test("channel links and ordinary text are left alone", () => {
	// A channel link cannot ping anyone, and breaking it would only take away a
	// link the author meant to include.
	assert.equal(neutraliseMentions("see <#1525905982000070780>"), "see <#1525905982000070780>");
	assert.equal(neutraliseMentions("hello world"), "hello world");
	assert.equal(neutraliseMentions("mail me at a@heretic.example"), "mail me at a@heretic.example");
	assert.equal(neutraliseMentions("no mentions @all"), "no mentions @all");
});

test("a message full of mentions comes out inert", () => {
	const neutralised = neutraliseMentions("@everyone <@1> @here <@&2> ok");
	assert.doesNotMatch(neutralised, /@everyone|@here/);
	assert.doesNotMatch(neutralised, /<@[!&]?\d+>/);
	assert.match(neutralised, /ok$/);
});
