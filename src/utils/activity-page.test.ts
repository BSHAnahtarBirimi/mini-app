import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	ACTIVITY_PAGE_PATH,
	ACTIVITY_SCRIPT_PATH,
	ACTIVITY_SDK_PATH,
	activityPage,
} from "./activity-page.ts";

/**
 * Guards for the failure mode that made the Activity a white rectangle.
 *
 * A Discord Activity is an iframe with no console, no address bar and no error
 * output: if the page or any asset it needs is missing, the visible result is
 * blank and there is nothing to inspect. Two things follow, and both are pinned
 * here rather than trusted:
 *
 * 1. **The page is never empty.** It ships a visible starting state, so a frame
 *    whose script never runs still says what it is and what to check.
 * 2. **Every asset it references exists in the repository.** These are static
 *    files in `public/` served from the deployment root; the Discord proxy only
 *    forwards the paths the URL mapping covers, so a typo or a vendored directory
 *    that was never committed is indistinguishable from a broken app.
 */

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const publicDir = path.join(projectRoot, "public");

/** The file a root-relative URL like `/vendor/x.mjs` is served from. */
function publicFile(url: string): string {
	return path.join(publicDir, url.replace(/^\//, ""));
}

/** Every relative module specifier in a file, resolvable from its directory. */
async function relativeImportsOf(file: string): Promise<string[]> {
	const source = await readFile(file, "utf8");
	const specifiers = new Set<string>();
	for (const match of source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
		const specifier = match[1];
		if (specifier.startsWith(".")) specifiers.add(specifier);
	}
	return [...specifiers].map((specifier) => path.resolve(path.dirname(file), specifier));
}

/** Walks a module graph and returns every file it reaches. */
async function moduleGraph(entry: string): Promise<string[]> {
	const seen = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop() as string;
		if (seen.has(file)) continue;
		seen.add(file);
		for (const dependency of await relativeImportsOf(file)) {
			if (!seen.has(dependency)) queue.push(dependency);
		}
	}
	return [...seen];
}

test("the Activity shell always has something to show", () => {
	const html = activityPage();

	// A visible status element with initial text: the difference between "the
	// frame is loading" and a blank rectangle.
	assert.match(html, /id="status"[^>]*>[^<]+</);
	assert.match(html, /id="app"/);
	assert.match(html, /id="fallback"/);
	// The fallback has to say what to do, not just that something is wrong.
	assert.match(html, /URL Mappings/);
	assert.match(html, new RegExp(ACTIVITY_SCRIPT_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("the page references only assets that are committed", () => {
	const html = activityPage();
	for (const match of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
		const url = match[1];
		assert.ok(
			existsSync(publicFile(url)),
			`${ACTIVITY_PAGE_PATH} references ${url}, which is not in public/ — it would 404 and the frame would be blank`,
		);
	}
});

test("the Activity script exists and loads the SDK from our own origin", async () => {
	const script = publicFile(ACTIVITY_SCRIPT_PATH);
	assert.ok(existsSync(script), `${ACTIVITY_SCRIPT_PATH} is not in public/`);

	const source = await readFile(script, "utf8");
	assert.match(
		source,
		new RegExp(`from\\s*["']${ACTIVITY_SDK_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`),
		"the Activity must import the vendored SDK — a CDN import depends on Discord's frame CSP allowing it",
	);
	// The secret-bearing exchange is the server's job: the code and nothing else
	// may cross into the frame.
	assert.equal(source.includes("client_secret"), false);
	assert.equal(source.includes("discord.com/api/oauth2/token"), false);
	// The frame is recognised by being embedded, which is also how the page
	// decides between "Activity" and "opened in a browser".
	assert.match(source, /window\.parent/);
});

test("the vendored SDK is complete, not partially copied", async () => {
	const entry = publicFile(ACTIVITY_SDK_PATH);
	assert.ok(existsSync(entry), `${ACTIVITY_SDK_PATH} is missing — run \`npm run activity-vendor\``);

	const graph = await moduleGraph(entry);
	// 60+ modules: the SDK inlines zod, uuid, big-integer and friends as relative
	// files, so a copy that stopped at the entry would still "exist" and still
	// fail in the frame.
	assert.ok(graph.length > 50, `expected the whole SDK graph, reached ${graph.length} modules`);

	const missing = graph.filter((file) => !existsSync(file));
	assert.deepEqual(
		missing.map((file) => path.relative(publicDir, file)),
		[],
		"these SDK modules are referenced but not vendored",
	);
});

test("the Activity is reachable in a browser too, for checking without Discord", () => {
	// `/activity` is served by `api/index.ts` (see the rewrite in vercel.json), so
	// the page and its assets can be verified with curl before anyone opens
	// Discord — which is the only other place a blank frame could be diagnosed.
	assert.equal(ACTIVITY_PAGE_PATH, "/activity");
	assert.match(activityPage(), /Sending|Send to every linked|Starting the Activity/);
});
