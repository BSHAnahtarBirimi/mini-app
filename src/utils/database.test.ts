import assert from "node:assert/strict";
import test from "node:test";

import { hasDatabaseConfig } from "./database.js";

/**
 * Regression guard: `MiniDatabase.fromEnv()` throws when `MONGODB_URI` is
 * missing, and MiniInteraction imports every file under `src/commands` and
 * `src/components` in one `Promise.all`. Building the database at module scope
 * therefore turned a missing env var into "no command or button resolves at
 * all" — that is what kept the Linked Channels flow dead in production.
 */
test("linked-channel modules import without MONGODB_URI set", async () => {
	const previous = process.env.MONGODB_URI;
	delete process.env.MONGODB_URI;
	try {
		assert.equal(hasDatabaseConfig(), false);
		const [link, confirm, command] = await Promise.all([
			import("../components/lc_link.js"),
			import("../components/lc_confirm.js"),
			import("../commands/linked-channel.js"),
		]);
		assert.equal(link.linkButton.customId, "lc:link");
		assert.equal(confirm.confirmLinkButton.customId, "lc:confirm");
		assert.equal(typeof command.linkedChannelCommand.handler, "function");
	} finally {
		if (previous === undefined) delete process.env.MONGODB_URI;
		else process.env.MONGODB_URI = previous;
	}
});
