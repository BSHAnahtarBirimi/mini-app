#!/usr/bin/env node
/**
 * Copies `@discord/embedded-app-sdk`'s browser build into
 * `public/vendor/embedded-app-sdk/`.
 *
 * Why copy it at all instead of importing it from a CDN:
 *
 * - A Discord Activity runs in an iframe served by Discord, and Discord applies
 *   its own Content-Security-Policy to that frame. Serving the SDK from *our*
 *   origin (proxied through the Activity's URL mapping) needs no allowance from
 *   that policy at all, whereas a CDN import is a dependency on a third-party
 *   host being permitted — a risk with no upside, since the file is 460 KB of
 *   plain ESM with every dependency already inlined (`./lib/**`, `./_virtual/**`).
 * - `output/**` is a *split* ESM tree whose imports are all relative, so the
 *   browser can load it directly: no bundler, and nothing for this project's
 *   build to do.
 *
 * The copy is committed (like `vendor/mini-interaction-<version>.tgz`) so a
 * deploy never depends on the order of install and build steps.
 *
 * Usage: `npm run activity-vendor`
 */

import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(projectRoot, "node_modules", "@discord", "embedded-app-sdk", "output");
const destination = path.join(projectRoot, "public", "vendor", "embedded-app-sdk");

if (!statSync(source, { throwIfNoEntry: false })) {
	console.error(`✖ ${path.relative(projectRoot, source)} is missing — run \`npm install\` first.`);
	process.exit(1);
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });

// Only the browser build: `*.cjs` is for Node, `*.d.ts`/`*.map` are for editors
// and debuggers and would triple the committed size for no runtime benefit.
let copied = 0;
for (const entry of readdirSync(source, { recursive: true, withFileTypes: true })) {
	if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
	const from = path.join(entry.parentPath, entry.name);
	const to = path.join(destination, path.relative(source, from));
	mkdirSync(path.dirname(to), { recursive: true });
	cpSync(from, to);
	copied += 1;
}

console.log(`✔ ${copied} module(s) → ${path.relative(projectRoot, destination)}`);
