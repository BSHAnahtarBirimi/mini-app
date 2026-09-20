import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	ACTIVITY_GAME_PATH,
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
 *   whose script never runs still says what it is and what to check.
 * 2. **Every module the page loads exists in the repository**, including the ones
 *   only reachable through an import (`activity.js` → `dog-runner.js` and the
 *   SDK). These are static files in `public/`, and the Discord proxy only
 *   forwards the paths the URL mapping covers, so a typo or a directory that was
 *   never committed is indistinguishable from a broken app.
 */

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const publicDir = path.join(projectRoot, "public");

/** The file a public URL like `/vendor/x.mjs` is served from. */
function publicFile(url: string): string {
	return path.join(publicDir, url.replace(/^\//, ""));
}

/** The file a module specifier resolves to, from the file that contains it. */
function resolveSpecifier(from: string, specifier: string): string {
	return specifier.startsWith("/")
		? publicFile(specifier)
		: path.resolve(path.dirname(from), specifier);
}

/** Every module specifier in a file, with where it resolves to. */
async function importsOf(file: string): Promise<{ specifier: string; resolved: string }[]> {
	const source = await readFile(file, "utf8");
	const found = new Set<string>();
	for (const match of source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
		found.add(match[1]);
	}
	return [...found]
		.filter((specifier) => specifier.startsWith(".") || specifier.startsWith("/"))
		.map((specifier) => ({ specifier, resolved: resolveSpecifier(file, specifier) }));
}

/** Walks a module graph and returns every file it reaches. */
async function moduleGraph(entry: string): Promise<string[]> {
	const seen = new Set<string>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop() as string;
		if (seen.has(file)) continue;
		seen.add(file);
		for (const { resolved } of await importsOf(file)) {
			if (!seen.has(resolved)) queue.push(resolved);
		}
	}
	return [...seen];
}

test("the Activity shell always has something to show", () => {
	const html = activityPage();

	// A visible status element with initial text: the difference between "the
	// frame is loading" and a blank rectangle.
	assert.match(html, /id="status"[^>]*>[^<]+</);
	assert.match(html, /<canvas id="game"/, "the game has somewhere to draw");
	assert.match(html, /id="fallback"/);
	// The fallback has to say what to do, not just that something is wrong.
	assert.match(html, /URL Mappings/);
	assert.match(html, new RegExp(ACTIVITY_SCRIPT_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	// The controls are advertised on the page: a game whose keys are a secret is
	// an Activity nobody can play.
	assert.match(html, /Space/);
	assert.match(html, /jump/);
	assert.match(html, /duck/);
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

test("the client script exists and loads the game and the SDK from our own origin", async () => {
	const script = publicFile(ACTIVITY_SCRIPT_PATH);
	assert.ok(existsSync(script), `${ACTIVITY_SCRIPT_PATH} is not in public/`);

	const source = await readFile(script, "utf8");
	const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	assert.match(
		source,
		new RegExp(`from\\s*["']${escape(ACTIVITY_SDK_PATH)}["']`),
		"the Activity must import the vendored SDK — a CDN import depends on Discord's frame CSP allowing it",
	);
	assert.match(
		source,
		new RegExp(`from\\s*["']${escape(ACTIVITY_GAME_PATH)}["']`),
		"and the game module, which is where the rules live",
	);

	// The secret-bearing exchange is the server's job: the code and nothing else
	// may cross into the frame.
	assert.equal(source.includes("client_secret"), false);
	assert.equal(source.includes("discord.com/api/oauth2/token"), false);

	// The game starts before anything awaits, so no failure downstream can turn
	// the frame blank; and authorization is explicitly allowed to fail.
	assert.match(source, /startDogRunner\(/, "the game is started by the client");
	assert.match(source, /try \{[\s\S]*startDogRunner/, "and starting it is guarded");
	assert.match(source, /catch \(error\) \{\s*\/\/ Not fatal|catch \(error\) \{/, "identify has its own catch");
	assert.match(source, /window\.parent/, "the frame is recognised by being embedded");
});

test("every module the Activity loads exists, one import at a time", async () => {
	const graph = await moduleGraph(publicFile(ACTIVITY_SCRIPT_PATH));

	// `activity.js` → `dog-runner.js` → (no further imports), plus the whole
	// vendored SDK: 60+ files, because the SDK inlines its dependencies.
	const relative = graph.map((file) => path.relative(publicDir, file));
	assert.ok(
		relative.includes("dog-runner.js"),
		`the game is not reachable from ${ACTIVITY_SCRIPT_PATH}: ${relative.join(", ")}`,
	);
	assert.ok(graph.length > 50, `expected the SDK graph too, reached ${graph.length} modules`);

	const missing = graph.filter((file) => !existsSync(file));
	assert.deepEqual(
		missing.map((file) => path.relative(publicDir, file)),
		[],
		"these modules are imported but not present in public/",
	);
});

test("every vendored SDK file is committed, not merely present", async () => {
	// `/vendor` is served from the *deployment*, so a file that exists on disk but
	// is not in git is missing in production — and if it is a module the SDK
	// imports, the frame is blank again with nothing to inspect.
	//
	// This is not hypothetical: the vendored tree contains
	// `lib/uuid/dist/esm-browser/v4.mjs`, and `.gitignore`'s build-output rule
	// was `dist/` (matching a directory named `dist` at *any* depth), which
	// silently dropped four files. Nothing local noticed, because locally they
	// exist; only CI's copy of this check did.
	const onDisk = (
		await readdir(path.join(publicDir, "vendor"), { recursive: true, withFileTypes: true })
	)
		.filter((entry) => entry.isFile())
		.map((entry) =>
			path
				.relative(publicDir, path.join(entry.parentPath, entry.name))
				.split(path.sep)
				.join("/"),
		)
		.sort();

	let tracked: string[];
	try {
		tracked = execFileSync("git", ["ls-files", "public/vendor"], {
			cwd: projectRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => line.replace(/^public\//, ""))
			.sort();
	} catch {
		// No git (a tarball checkout): the existence checks above still apply.
		return;
	}

	const untracked = onDisk.filter((file) => !tracked.includes(file));
	assert.deepEqual(
		untracked,
		[],
		`these vendored files are not committed — check .gitignore (an unanchored \`dist/\` used to swallow one) and re-run \`npm run activity-vendor\`:\n${untracked.join("\n")}`,
	);
});

test("the game is playable outside Discord too, for checking without it", async () => {
	// `/activity` is served by `api/index.ts` (see the rewrite in vercel.json), so
	// the page, its assets and the game itself can all be opened in a browser —
	// the only other place a blank frame could be diagnosed.
	assert.equal(ACTIVITY_PAGE_PATH, "/activity");
	assert.equal(ACTIVITY_GAME_PATH, "/dog-runner.js");
	assert.match(activityPage(), /Starting the Activity/);

	const source = await readFile(publicFile(ACTIVITY_SCRIPT_PATH), "utf8");
	assert.match(source, /Running outside Discord/, "and says so, rather than waiting for a parent");
});
