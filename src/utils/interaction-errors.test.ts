import assert from "node:assert/strict";
import test from "node:test";

import { appendInteractionError, describeError } from "./interaction-errors.ts";
import type { InteractionErrorRecord } from "./interaction-errors.ts";

/**
 * The failure log behind `/api/diag`.
 *
 * Deferred interactions are completed in the background and the framework
 * swallows failures there, so these recorded entries are the only evidence of
 * why a message stayed on "«bot» is thinking…". Their retention rules are pure
 * and therefore tested here rather than only during a live incident.
 */

const entry = (context: string): InteractionErrorRecord => ({
	at: "2026-09-19T00:00:00.000Z",
	context,
	message: "boom",
});

test("a failure is prepended, newest first", () => {
	const next = appendInteractionError([entry("older")], new Error("boom"), "lc:link", new Date(0));
	assert.equal(next.length, 2);
	assert.equal(next[0].context, "lc:link");
	assert.equal(next[0].at, "1970-01-01T00:00:00.000Z");
	assert.equal(next[1].context, "older");
});

test("only the newest five failures are kept", () => {
	let log: InteractionErrorRecord[] = [];
	for (let index = 0; index < 8; index += 1) {
		log = appendInteractionError(log, new Error("boom"), `handler-${index}`);
	}
	assert.equal(log.length, 5);
	assert.deepEqual(
		log.map((record) => record.context),
		["handler-7", "handler-6", "handler-5", "handler-4", "handler-3"],
	);
});

test("long messages are truncated so one failure cannot flood the response", () => {
	const next = appendInteractionError([], new Error("x".repeat(5000)), "lc:pick");
	assert.equal(next[0].message.length, 700);
});

test("the stack head is kept as detail when one is available", () => {
	const next = appendInteractionError([], new Error("boom"), "lc:pick");
	assert.match(next[0].detail ?? "", /Error: boom/);
});

test("non-Error throwables are still described", () => {
	assert.equal(describeError("plain string"), "plain string");
	assert.equal(describeError({ code: "ECONNREFUSED" }), '{"code":"ECONNREFUSED"}');
	const next = appendInteractionError([], { status: 400 }, "lc:link");
	assert.equal(next[0].message, '{"status":400}');
	assert.equal(next[0].detail, undefined);
});
