#!/usr/bin/env node
/**
 * Refresh `vendor/mini-interaction-<version>.tgz` from a mini-interaction
 * GitHub tag (downloads the tag, builds it, repacks it).
 *
 * Why a vendored tarball instead of a normal dependency:
 *
 * - The Lobby / Linked-Channels APIs this app uses only exist after the newest
 *   release published to npm (npm still serves 0.9.0), so the package can only
 *   be taken from a GitHub tag.
 * - Vercel's build image ships npm >= 12, which refuses git dependencies
 *   (`allow-git = none`) and remote tarball URLs (`allow-remote = none`), so a
 *   `"github:minesa-org/mini-interaction#v0.14.0"` dependency fails the install
 *   with EALLOWGIT.
 * - The tag does not commit its `dist/`, so npm would have to run the package's
 *   `prepare` script to build it — and npm >= 12 blocks install scripts unless
 *   every package is approved, which leaves the deploy without a buildable
 *   package.
 * - `file:` dependencies are allowed, install offline and behave the same on
 *   npm 10, npm 12 and bun — so we vendor the built package instead.
 *
 * Usage:
 *   node scripts/vendor-mini-interaction.mjs              # tag v0.14.0
 *   node scripts/vendor-mini-interaction.mjs v0.15.0      # another tag
 *
 * After it runs, point package.json at the new file and reinstall:
 *   npm pkg set 'dependencies.@minesa-org/mini-interaction=file:vendor/<file>.tgz'
 *   npm install
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2] ?? "v0.14.0";

/** Files npm needs inside the tarball, all kept under the `package/` prefix. */
const PACKAGE_ENTRIES = ["package.json", "dist", "README.md", "LICENSE"];

const run = (command, args, cwd) =>
	execFileSync(command, args, { cwd, stdio: "inherit" });

const workDir = mkdtempSync(path.join(tmpdir(), "mini-interaction-vendor-"));

try {
	const sourceRoot = path.join(workDir, "src");
	mkdirSync(sourceRoot, { recursive: true });

	const archiveUrl = `https://codeload.github.com/minesa-org/mini-interaction/tar.gz/refs/tags/${tag}`;
	console.log(`→ downloading ${archiveUrl}`);
	const response = await fetch(archiveUrl);
	if (!response.ok) throw new Error(`download failed: ${response.status} ${response.statusText}`);
	const archivePath = path.join(workDir, "source.tar.gz");
	writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));
	run("tar", ["-xzf", archivePath, "-C", sourceRoot, "--strip-components=1"], workDir);

	const { version } = JSON.parse(readFileSync(path.join(sourceRoot, "package.json"), "utf8"));

	// `dist/` is not committed upstream, so build the tag with its own toolchain.
	console.log(`→ building @minesa-org/mini-interaction@${version} from ${tag}`);
	run("npm", ["install", "--no-audit", "--no-fund"], sourceRoot);
	run("npm", ["run", "build"], sourceRoot);
	if (!statSync(path.join(sourceRoot, "dist")).isDirectory()) {
		throw new Error("build produced no dist/ directory");
	}

	const stagePackage = path.join(workDir, "stage", "package");
	mkdirSync(stagePackage, { recursive: true });
	for (const entry of PACKAGE_ENTRIES) {
		cpSync(path.join(sourceRoot, entry), path.join(stagePackage, entry), { recursive: true });
	}

	mkdirSync(path.join(projectRoot, "vendor"), { recursive: true });
	const tarball = path.join(projectRoot, "vendor", `mini-interaction-${version}.tgz`);
	run("tar", ["-czf", tarball, "-C", path.join(workDir, "stage"), "package"], workDir);

	console.log(`\n✅ vendored @minesa-org/mini-interaction@${version} → ${path.relative(projectRoot, tarball)}`);
	console.log(
		`\nNext: npm pkg set 'dependencies.@minesa-org/mini-interaction=file:vendor/mini-interaction-${version}.tgz' && npm install`,
	);
} finally {
	rmSync(workDir, { recursive: true, force: true });
}
