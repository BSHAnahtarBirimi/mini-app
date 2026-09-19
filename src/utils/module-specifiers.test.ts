import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Regression guard for a failure that only shows up in production.
 *
 * `MiniInteraction` discovers handlers by importing `src/commands` and
 * `src/components` **at runtime**, which only works because Node strips
 * TypeScript types itself. Locally everything runs through `tsx`, which happily
 * rewrites a `./foo.js` specifier to `./foo.ts` — Node does not. So a relative
 * import written the usual TypeScript way resolves on a developer machine and
 * fails on the deployment with
 * `Cannot find module '/var/task/src/utils/foo.js'`, which rejects the whole
 * module load: every command and every button stops responding at once.
 *
 * Template files already use explicit `.ts` extensions for this reason
 * (`test_mode_edit.ts` → `./test_showcase_container.ts`). `api/` and `scripts/`
 * are exempt: they are bundled by Vercel or run through `tsx`.
 */
test("runtime-loaded modules import their siblings with explicit .ts extensions", async () => {
	const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
	const self = path.basename(fileURLToPath(import.meta.url));
	// Built by concatenation so this file does not match its own rule.
	const relativeJsSpecifier = new RegExp('"(\\.' + '[^"]*\\.js)"', "g");

	const files = (await walk(sourceRoot)).filter(
		(file) => file.endsWith(".ts") && !file.endsWith(".d.ts") && path.basename(file) !== self,
	);
	assert.ok(files.length > 10, `expected to scan the src tree, found ${files.length} files`);

	const offenders: string[] = [];
	for (const file of files) {
		const source = await readFile(file, "utf8");
		for (const match of source.matchAll(relativeJsSpecifier)) {
			offenders.push(`${path.relative(sourceRoot, file)} → ${match[1]}.js`);
		}
	}

	assert.deepEqual(
		offenders,
		[],
		`these relative imports must use the .ts extension, otherwise the deployed loader cannot resolve them:\n${offenders.join("\n")}`,
	);
});

/**
 * Regression guard for the second half of the same rule.
 *
 * Node loads these modules **itself**, and its TypeScript support is
 * *strip-only*: syntax that needs transforming — parameter properties
 * (`constructor(readonly x: string)`), `enum`, `namespace`, `declare` fields —
 * is rejected with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. `tsx` accepts it, so
 * the failure exists only in the deployment, and because every handler is
 * imported in one `Promise.all`, one such line breaks all of them at once (it
 * broke `/api/diag` and would have broken every Linked Channels handler).
 *
 * Importing each module under plain Node is the only check that catches this
 * before a deploy, so the test does exactly that, in one child process.
 */
test("runtime-loaded modules use only TypeScript that Node can strip", async () => {
	const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
	const self = path.basename(fileURLToPath(import.meta.url));

	const files = (await walk(sourceRoot))
		.filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
		.filter((file) => !file.endsWith(".test.ts") && path.basename(file) !== self);
	assert.ok(files.length > 10, `expected to scan the src tree, found ${files.length} files`);

	const script = [
		`const files = ${JSON.stringify(files.map((file) => pathToFileURL(file).href))};`,
		"const failures = [];",
		"for (const file of files) {",
		"\ttry {",
		"\t\tawait import(file);",
		"\t} catch (error) {",
		"\t\tfailures.push({ file, code: error?.code ?? null, message: error?.message ?? String(error) });",
		"\t}",
		"}",
		"console.log(JSON.stringify(failures));",
	].join("\n");

	const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
		encoding: "utf8",
		maxBuffer: 4 * 1024 * 1024,
	});
	const failures = JSON.parse(output) as { file: string; code: string | null; message: string }[];

	assert.deepEqual(
		failures.map(({ file, code, message }) => `${path.relative(sourceRoot, fileURLToPath(file))}: ${code ?? ""} ${message}`),
		[],
		"every runtime-loaded module must be importable by plain Node (strip-only TypeScript)",
	);
});

async function walk(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const resolved = path.join(directory, entry.name);
			return entry.isDirectory() ? walk(resolved) : Promise.resolve([resolved]);
		}),
	);
	return nested.flat();
}
