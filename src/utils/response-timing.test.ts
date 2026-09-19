import assert from "node:assert/strict";
import test from "node:test";

import { MessageFlags } from "@minesa-org/mini-interaction";

import { linkedChannelCommand } from "../commands/linked-channel.ts";
import { linkButton } from "../components/lc_link.ts";
import { pickChannelSelect } from "../components/lc_pick.ts";
import { confirmLinkButton } from "../components/lc_confirm.ts";
import { cancelLinkButton } from "../components/lc_cancel.ts";
import { unlinkButton } from "../components/lc_unlink.ts";
import { joinServerButton } from "../components/lc_join.ts";

/**
 * Regression guard for "the command does nothing".
 *
 * Discord invalidates an interaction unless the FIRST response arrives within
 * 3 seconds. Every handler here reads Mongo (lobby record, stored token) and
 * calls Discord before it can render anything, so it has to acknowledge with a
 * deferral first — otherwise the client reports "The application did not
 * respond" while the side effects (e.g. the created lobby) have already
 * happened.
 *
 * The deferral is also the only place ephemerality may be set: `editReply`
 * edits the deferred message, and Discord rejects the Ephemeral flag on an
 * edit.
 */

type Recorded = {
	calls: string[];
	ackFlags: number | undefined;
	edits: { flags?: number }[];
};

function stubInteraction(recorded: Recorded) {
	return {
		guild_id: "1525905980422885406",
		member: { user: { id: "285118390031351809" } },
		user: { id: "285118390031351809" },
		values: ["1525905982000070780"],
		getChannels: () => [],
		async deferReply(options?: { flags?: number }) {
			recorded.calls.push("deferReply");
			recorded.ackFlags = options?.flags;
		},
		async deferUpdate() {
			recorded.calls.push("deferUpdate");
			recorded.ackFlags = MessageFlags.Ephemeral;
		},
		async reply() {
			recorded.calls.push("reply");
			throw new Error("handlers must acknowledge before replying");
		},
		async update() {
			recorded.calls.push("update");
			throw new Error("handlers must not update without acknowledging");
		},
		async editReply(data: { flags?: number }) {
			recorded.calls.push("editReply");
			recorded.edits.push(data ?? {});
			return data;
		},
	};
}

const handlers: [string, { handler: (interaction: never) => Promise<unknown> }][] = [
	["/linked-channel", linkedChannelCommand as never],
	["lc:link", linkButton as never],
	["lc:pick", pickChannelSelect as never],
	["lc:confirm", confirmLinkButton as never],
	["lc:cancel", cancelLinkButton as never],
	["lc:unlink", unlinkButton as never],
	["lc:join", joinServerButton as never],
];

for (const [name, module] of handlers) {
	test(`${name} acknowledges Discord before doing any work`, async () => {
		// Without a database the handlers stop early (or throw), which is fine:
		// the assertion is about what happened *before* that.
		const previous = process.env.MONGODB_URI;
		delete process.env.MONGODB_URI;
		const recorded: Recorded = { calls: [], ackFlags: undefined, edits: [] };
		try {
			await module.handler(stubInteraction(recorded) as never);
		} catch {
			// Mongo is unavailable in tests.
		} finally {
			if (previous === undefined) delete process.env.MONGODB_URI;
			else process.env.MONGODB_URI = previous;
		}

		assert.equal(
			recorded.calls[0],
			"deferReply",
			`${name} must acknowledge first, but its calls were: ${recorded.calls.join(", ") || "(none)"}`,
		);
		assert.equal(
			recorded.ackFlags,
			MessageFlags.Ephemeral,
			`${name} must acknowledge ephemerally so the deferral is not visible to the channel`,
		);

		for (const edit of recorded.edits) {
			assert.equal(
				(edit.flags ?? 0) & MessageFlags.Ephemeral,
				0,
				`${name} must not send MessageFlags.Ephemeral on an edit — Discord rejects it there`,
			);
		}
	});
}
