import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { commandPayloads, registrationProblems } from "./command-modules.ts";

/**
 * `MiniInteraction` discovers handlers by **importing every importable file** in
 * `src/commands`, `src/components` and `src/modals` — first at deploy time (the
 * registration step) and again on every cold start of the interaction endpoint.
 *
 * That makes these three directories executable surfaces, not folders:
 *
 * - a test file placed there has its `test(...)` bodies executed inside the
 *   running deployment, and the suite it pulls in drags `node:test`, its
 *   fixtures and its collaborators into the function bundle;
 * - a file that is not a command lands in the registration payload as `undefined`
 *   and Discord rejects the whole `PUT`, leaving the command list unchanged.
 *
 * So the rule is enforced here rather than remembered.
 */

const SCANNED = ["commands", "components", "modals"] as const;

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

test("no test file lives in a directory the framework scans at runtime", async () => {
	const offenders: string[] = [];

	for (const directory of SCANNED) {
		let entries: string[];
		try {
			entries = await readdir(path.join(sourceRoot, directory));
		} catch {
			continue; // the directory is optional
		}
		for (const entry of entries) {
			if (/\.test\.(ts|mts|js|mjs|cjs)$/i.test(entry) || entry.endsWith(".d.ts")) {
				offenders.push(`src/${directory}/${entry}`);
			}
		}
	}

	assert.deepEqual(
		offenders,
		[],
		`these files are imported (and their tests executed) by the deployment — move them out of ${SCANNED.join("/")}: \n${offenders.join("\n")}`,
	);
});

test("a discovered module that is not a command is refused, not sent", () => {
	// Both shapes have broken registration here: a non-command file being
	// scanned, and one command discovered twice (the bundler emitting a compiled
	// copy of a command module into the scanned directory).
	const payloadNames = (commands: unknown[]) =>
		commands
			.map((command) => (command as { data?: { name?: string } }).data?.name)
			.filter((name): name is string => typeof name === "string");

	assert.deepEqual(payloadNames([{ data: { name: "echo" } }, { data: { name: "test" } }]), [
		"echo",
		"test",
	]);

	const missing = registrationProblems({
		commands: [{ data: { name: "echo" } }, {}],
		components: [],
		modals: [],
	});
	assert.equal(missing.length, 1);
	assert.match(missing[0]!, /no command payload/);

	const duplicated = registrationProblems({
		commands: [{ data: { name: "authorize" } }, { data: { name: "authorize" } }],
		components: [],
		modals: [],
	});
	assert.equal(duplicated.length, 1);
	assert.match(duplicated[0]!, /duplicate command name/);
	assert.match(duplicated[0]!, /authorize/);

	assert.deepEqual(
		registrationProblems({ commands: [{ data: { name: "echo" } }], components: [], modals: [] }),
		[],
		"a well-formed list is not blocked",
	);
	assert.deepEqual(
		registrationProblems({ commands: [], components: [], modals: [] }),
		["no command modules were discovered"],
		"an empty list is still refused, as it always was",
	);
});

test("the real commands directory registers cleanly — the payload Discord gets today", async () => {
	const { MiniInteraction } = await import("@minesa-org/mini-interaction");
	const mini = new MiniInteraction({
		applicationId: "1",
		token: "x",
		commandsDirectory: path.join(sourceRoot, "commands"),
		componentsDirectory: path.join(sourceRoot, "components"),
	});
	const modules = await (
		mini as unknown as { loadModules: () => Promise<unknown> }
	).loadModules();

	const problems = registrationProblems(modules as never);
	assert.deepEqual(problems, [], "the shipped command list must be registrable");
	assert.deepEqual(
		commandPayloads(modules as never).map((payload) => (payload as { name?: string })?.name),
		["authorize", "echo", "linked-channel", "slow", "test"],
		"every command is discovered exactly once",
	);
});
