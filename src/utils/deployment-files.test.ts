import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Regression guard for a failure that only shows up in the deployment.
 *
 * Vercel bundles the source tree (`src/**`, imported by the function) but serves
 * `index.html` and `public/**` as *static output* and does not put them in the
 * function bundle. Verified in the deployment — `GET /api/diag?fs=1` reports
 * `cwd: /var/task` with `index.html` and `public/pages/*.html` missing while
 * `src/**` is present. Anything a function reads at request time must therefore
 * live under a bundled path; a page belongs in a module like
 * `src/utils/oauth-pages.ts`.
 *
 * The alternative, `includeFiles` in `vercel.json`, does not help here: the
 * entries for `index.html` and `public/pages/**` were present and the files were
 * still absent at runtime.
 */

const FUNCTION_FILES = [
	"index.ts",
	"interactions.ts",
	"diag.ts",
	"discord-oauth-callback.ts",
	"docs.ts",
];

/**
 * `src/**` is shipped as raw TypeScript, and the modules inside it import each
 * other with explicit `.ts` specifiers (they must: the interaction handlers are
 * imported by Node at runtime, which rewrites nothing). A compiled function
 * bundle keeps those specifiers as written, so a function only resolves them if
 * it ships that tree too. Dropping `includeFiles` from one entry is what made
 * the OAuth callback answer `FUNCTION_INVOCATION_FAILED`:
 * `Cannot find module '/var/task/src/utils/database.ts'`.
 */
test("every function ships src/** so the .ts specifiers inside it resolve", async () => {
	const config = JSON.parse(
		await readFile(fileURLToPath(new URL("../../vercel.json", import.meta.url)), "utf8"),
	) as { functions?: Record<string, { includeFiles?: string }> };

	const configured = Object.entries(config.functions ?? {});
	assert.ok(configured.length > 0, "vercel.json declares function configuration");

	const missing = configured
		.filter(([, options]) => options.includeFiles !== "src/**")
		.map(([file, options]) => `${file} → includeFiles: ${options.includeFiles ?? "(none)"}`);

	assert.deepEqual(
		missing,
		[],
		`these functions would fail to resolve the .ts imports inside src/** at runtime:\n${missing.join("\n")}`,
	);
});

/**
 * Reading a page at request time, or asking the library to. Referencing the
 * paths is fine — `api/diag.ts?fs=1` *stats* them on purpose, which is how the
 * rule was established.
 */
const DISK_PAGE_PATTERNS = [/\bhtmlFile\b/, /readFile(Sync)?\(/];

test("OAuth functions do not read their pages from the filesystem at runtime", async () => {
	const apiDirectory = fileURLToPath(new URL("../../api/", import.meta.url));
	const present = new Set(await readdir(apiDirectory));

	const offenders: string[] = [];
	for (const file of FUNCTION_FILES) {
		if (!present.has(file)) continue;
		const source = await readFile(path.join(apiDirectory, file), "utf8");
		source.split("\n").forEach((line, index) => {
			for (const pattern of DISK_PAGE_PATTERNS) {
				if (pattern.test(line)) {
					offenders.push(`${file}:${index + 1} → ${line.trim()}`);
				}
			}
		});
	}

	assert.deepEqual(
		offenders,
		[],
		`these functions must return pages from a bundled module, not the filesystem — the files are not in the function bundle:\n${offenders.join("\n")}`,
	);
});
