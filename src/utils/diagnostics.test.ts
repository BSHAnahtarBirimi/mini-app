import assert from "node:assert/strict";
import test from "node:test";

import { buildBotInviteUrl, deriveProblems } from "./diagnostics.ts";
import type { DiagInput } from "./diagnostics.ts";

/** A deployment where everything works — the baseline each test perturbs. */
const healthy = (): DiagInput => ({
	env: {
		DISCORD_APPLICATION_ID: true,
		DISCORD_PUBLIC_KEY: true,
		DISCORD_BOT_TOKEN: true,
		DISCORD_CLIENT_SECRET: true,
		DISCORD_REDIRECT_URI: true,
		DISCORD_GUILD_ID: false,
		MONGODB_URI: true,
	},
	modules: { commands: 4, components: 17, modals: 4, error: null },
	expectedCommands: ["echo", "linked-channel", "slow", "test"],
	bot: { ok: true, data: { id: "1", username: "mini" } },
	guilds: { ok: true, data: [{ id: "9", name: "server" }] },
	registered: { global: { ok: true, data: ["echo", "linked-channel", "slow", "test"] } },
});

const joined = (input: DiagInput) => deriveProblems(input).join("\n");

test("a healthy deployment reports no problems", () => {
	assert.deepEqual(deriveProblems(healthy()), []);
});

test("no registered commands is reported as the reason nothing shows up", () => {
	const problems = joined({ ...healthy(), registered: { global: { ok: true, data: [] } } });
	assert.match(problems, /No slash commands are registered/);
});

test("out-of-date registration lists the missing commands", () => {
	const problems = joined({
		...healthy(),
		registered: { global: { ok: true, data: ["echo", "slow", "test"] } },
	});
	assert.match(problems, /missing: linked-channel/);
});

test("guild-scoped commands count as registered", () => {
	const input: DiagInput = {
		...healthy(),
		registered: {
			global: { ok: true, data: [] },
			guild: { ok: true, data: ["echo", "linked-channel", "slow", "test"], guildId: "9" },
		},
	};
	assert.deepEqual(deriveProblems(input), []);
});

test("a rejected bot token is called out (it blocks registration and linking)", () => {
	const problems = joined({
		...healthy(),
		bot: { ok: false, status: 401, error: "401 — Unauthorized" },
		guilds: { ok: false, status: 401, error: "401 — Unauthorized" },
		registered: { global: { ok: false, status: 401, error: "401 — Unauthorized" } },
	});
	assert.match(problems, /DISCORD_BOT_TOKEN was rejected by Discord/);
});

test("a bot in no server is told to invite itself with the commands scope", () => {
	const problems = joined({ ...healthy(), guilds: { ok: true, data: [] } });
	assert.match(problems, /not a member of any Discord server/);
	assert.match(problems, /bot\+applications\.commands/);
});

test("a module load failure is reported first because it breaks everything", () => {
	const problems = joined({
		...healthy(),
		modules: { commands: 0, components: 0, modals: 0, error: 'Unknown file extension ".ts"' },
	});
	assert.match(problems, /Handler modules failed to load/);
});

test("missing database and OAuth credentials are reported for Linked Channels", () => {
	const problems = joined({
		...healthy(),
		env: { ...healthy().env, MONGODB_URI: false, DISCORD_CLIENT_SECRET: false },
	});
	assert.match(problems, /MONGODB_URI is not set/);
	assert.match(problems, /DISCORD_CLIENT_SECRET/);
});

test("a missing application id is not reported twice", () => {
	const input: DiagInput = {
		...healthy(),
		env: { ...healthy().env, DISCORD_APPLICATION_ID: false },
		registered: { global: { ok: false, error: "DISCORD_APPLICATION_ID is not set." } },
	};
	const problems = joined(input);
	assert.match(problems, /DISCORD_APPLICATION_ID is not set — the endpoint cannot start/);
	assert.doesNotMatch(problems, /Could not read the registered global commands/);
});

test("invite URL installs the bot with the commands scope", () => {
	const url = buildBotInviteUrl("1530890351101874277");
	assert.match(url, /scope=bot\+applications\.commands/);
	assert.match(url, /client_id=1530890351101874277/);
});
