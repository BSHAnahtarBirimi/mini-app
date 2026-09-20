import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DOCS_PAGE_PATH, DOCS_SECTIONS, countEntries } from "./docs-content.ts";
import { DIAG_ENV_VARS } from "./diagnostics.ts";
import { WEBHOOK_EVENT_LOG_KEY } from "./event-log.ts";
import { INTERACTION_ERRORS_KEY } from "./interaction-errors.ts";
import { LOBBY_GUILD_INDEX_KEY, lobbyKeyFor } from "./lobby-store.ts";
import { commandRateKeyFor, rateKeyFor } from "./web-rate-limit.ts";

/**
 * A documentation site that quietly stops covering the app is worse than none.
 *
 * So this file reads the source and fails when the app grows something the
 * content does not describe — a command, a component, an endpoint, an
 * environment variable, a storage key — and when a `where` reference points at a
 * file that no longer exists. It is deliberately one-directional: extra entries
 * are allowed, missing ones are not.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Every piece of documented text, joined — what "documented" means here. */
function docsText(): string {
	return DOCS_SECTIONS.map((section) =>
		[
			section.title,
			section.blurb,
			...section.groups.map((group) =>
				[
					group.title,
					group.blurb ?? "",
					...group.entries.map((entry) =>
						[
							entry.name,
							entry.kind,
							entry.signature ?? "",
							entry.summary,
							...(entry.details ?? []),
							entry.where ?? "",
							entry.example ?? "",
							...(entry.tags ?? []),
						].join("\n"),
					),
				].join("\n"),
			),
		].join("\n"),
	).join("\n");
}

async function sourcesIn(directory: string): Promise<{ file: string; source: string }[]> {
	const names = (await readdir(fileURLToPath(new URL(directory, import.meta.url)))).filter((name) =>
		name.endsWith(".ts"),
	);
	return await Promise.all(
		names.map(async (name) => ({
			file: `${directory}${name}`,
			source: await readFile(fileURLToPath(new URL(`${directory}${name}`, import.meta.url)), "utf8"),
		})),
	);
}

function matches(source: string, pattern: RegExp): string[] {
	return [...source.matchAll(pattern)].map((match) => match[1] ?? "").filter(Boolean);
}

/**
 * The names of the discovered commands.
 *
 * Anchored to `new CommandBuilder()` on purpose: `.setName("text")` also appears
 * on options, and an option named `text` is not a command.
 */
const COMMAND_NAME_PATTERN = /new CommandBuilder\(\)\s*\.setName\("([^"]+)"\)/g;

test("every slash command is documented", async () => {
	const files = await sourcesIn("../commands/");
	const names = files.flatMap(({ source }) => matches(source, COMMAND_NAME_PATTERN));

	assert.ok(names.length > 0, "the commands directory yielded command names");
	const missing = names.filter((name) => !docsText().includes(`/${name}`));
	assert.deepEqual(
		missing,
		[],
		`these commands exist in src/commands but not in the documentation:\n${missing.join("\n")}`,
	);
});

test("every component custom id is documented", async () => {
	// Custom ids live in the component files and, for the panel and the channel
	// picker, in the module that builds their payloads.
	const files = [
		...(await sourcesIn("../components/")),
		...(await sourcesIn("./")).filter(({ file }) => file.endsWith("linked-channel-panel.ts")),
	];
	const ids = files.flatMap(({ source }) => matches(source, /custom_?[Ii]d: *"([^"]+)"/g));

	assert.ok(ids.length > 0, "the components directory yielded custom ids");
	const text = docsText();
	const missing = [...new Set(ids)].filter((id) => !text.includes(id));
	assert.deepEqual(
		missing,
		[],
		`these custom ids exist in src/components but not in the documentation:\n${missing.join("\n")}`,
	);
});

test("every API endpoint is documented", async () => {
	const names = (await readdir(fileURLToPath(new URL("../../api/", import.meta.url))))
		.filter((name) => name.endsWith(".ts"))
		.map((name) => name.replace(/\.ts$/, ""));

	assert.ok(names.length > 0, "the api directory yielded endpoints");
	const text = docsText();
	// `api/index.ts` is the deployment root, documented as `GET / (api/index)`.
	const missing = names.filter(
		(name) =>
			!(name === "index" ? text.includes("api/index") : text.includes(`/api/${name}`)),
	);
	assert.deepEqual(
		missing,
		[],
		`these endpoints exist in api/ but not in the documentation:\n${missing.join("\n")}`,
	);
});

test("every environment variable /api/diag reports on is documented", () => {
	const text = docsText();
	const missing = DIAG_ENV_VARS.filter((name) => !text.includes(name));
	assert.deepEqual(
		missing,
		[],
		`these environment variables are read by the deployment but not documented:\n${missing.join("\n")}`,
	);
});

test("the storage keys are documented, derived from the code that builds them", () => {
	const text = docsText();
	// The prefixes come from the functions that produce the real keys, so a
	// renamed prefix cannot stay documented under its old name.
	const prefixes = [
		lobbyKeyFor("GUILD_ID").replace("GUILD_ID", ""),
		LOBBY_GUILD_INDEX_KEY,
		rateKeyFor("IP").replace("IP", ""),
		commandRateKeyFor("USER_ID").replace("USER_ID", ""),
		WEBHOOK_EVENT_LOG_KEY,
		INTERACTION_ERRORS_KEY,
		"lc-pending:", // built by `pendingKey()` in linked-channel-state.ts
	];

	const missing = prefixes.filter((prefix) => !text.includes(prefix));
	assert.deepEqual(
		missing,
		[],
		`these storage keys are used by the app but not documented:\n${missing.join("\n")}`,
	);
});

test("every entry is described, and described once per group", () => {
	const problems: string[] = [];

	for (const section of DOCS_SECTIONS) {
		for (const group of section.groups) {
			const seen = new Set<string>();
			for (const entry of group.entries) {
				if (entry.name.trim() === "") problems.push(`${group.id}: an entry has no name`);
				if (entry.summary.trim().length < 20) problems.push(`${group.id}: ${entry.name} has no real summary`);
				if (seen.has(entry.name)) problems.push(`${group.id}: ${entry.name} is documented twice`);
				seen.add(entry.name);
			}
		}
	}

	assert.deepEqual(problems, [], problems.join("\n"));
});

test("a `where` reference must point at a file that exists", async () => {
	const referenced = DOCS_SECTIONS.flatMap((section) =>
		section.groups.flatMap((group) =>
			group.entries.flatMap((entry) => [
				...matches(entry.where ?? "", /(?:^|[\s·(])((?:src|api|public|scripts|vendor)\/[\w./-]+\.(?:ts|js|mjs|html))/g),
				...matches(entry.example ?? "", /(?:^|[\s"'])((?:src|api|public)\/[\w./-]+\.ts)/g),
			]),
		),
	);

	assert.ok(referenced.length > 0, "the documentation points back at the code");
	const missing = [...new Set(referenced)].filter((file) => !existsSync(ROOT + file));
	assert.deepEqual(
		missing,
		[],
		`these files are referenced by the documentation but do not exist:\n${missing.join("\n")}`,
	);
});

test("the documented page path is the one vercel.json rewrites", async () => {
	assert.equal(DOCS_PAGE_PATH, "/docs");

	const config = JSON.parse(await readFile(ROOT + "vercel.json", "utf8")) as {
		rewrites?: { source: string; destination: string }[];
		functions?: Record<string, { includeFiles?: string }>;
	};

	const rewrite = (config.rewrites ?? []).find((entry) => entry.source === DOCS_PAGE_PATH);
	assert.deepEqual(
		rewrite,
		{ source: DOCS_PAGE_PATH, destination: "/api/docs" },
		`${DOCS_PAGE_PATH} must be rewritten to the docs function`,
	);
	assert.ok(existsSync(`${ROOT}api/docs.ts`), "the rewrite target exists");
	assert.equal(config.functions?.["api/docs.ts"]?.includeFiles, "src/**");
});

test("the content is large enough to be the whole app", async () => {
	const commandCount = (await sourcesIn("../commands/")).flatMap(({ source }) =>
		matches(source, COMMAND_NAME_PATTERN),
	).length;

	assert.ok(
		countEntries() >= commandCount + 1,
		`${countEntries()} documented entries cannot cover ${commandCount} commands and everything else`,
	);
});
