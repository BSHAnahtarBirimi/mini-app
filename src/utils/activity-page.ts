/**
 * The Activity page, as code rather than a file read at request time.
 *
 * The same reason `oauth-pages.ts` exists: Vercel ships `public/**` as static
 * output but *not* inside the function bundle, so a function that reads a page
 * from disk answers `FUNCTION_INVOCATION_FAILED` (that crash cost a day). This is
 * rendered by `api/index.ts`, which owns `/` and `/activity`.
 *
 * The page is a shell: the game lives in `public/dog-runner.js` and the
 * Activity's own logic (SDK handshake, identity) in `public/activity.js`, both
 * served statically. Two consequences are deliberate:
 *
 * 1. **It is never blank.** A Discord Activity that cannot start shows a white
 *    frame and nothing else — no error, no console access — which is how a
 *    missing URL mapping presents itself, and how the broken first version of
 *    this page did. The shell ships a visible starting state plus a fallback that
 *    names the fix, and it renders the game immediately rather than waiting on
 *    anything: authorization happens behind it, and a failure to authorize
 *    becomes a line of text next to a game that still plays.
 * 2. **The SDK and the game are same-origin paths**, not a CDN: Discord applies
 *    its own Content-Security-Policy to the frame, and a dependency on a
 *    third-party host being allowed has no upside for 460 KB of static ESM.
 */

/** Where the Activity is served (and what a plain browser can open). */
export const ACTIVITY_PAGE_PATH = "/activity";

/** The Activity's client script, a static file in `public/`. */
export const ACTIVITY_SCRIPT_PATH = "/activity.js";

/** The game itself — also a static file, and importable outside a browser. */
export const ACTIVITY_GAME_PATH = "/dog-runner.js";

/** The Embedded App SDK's entry module, vendored by `npm run activity-vendor`. */
export const ACTIVITY_SDK_PATH = "/vendor/embedded-app-sdk/index.mjs";

/** Discord's palette, so the frame does not flash a foreign colour scheme. */
const STYLE = [
	"margin: 0",
	"min-height: 100vh",
	"background: #313338",
	"color: #dbdee1",
	"font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
	"font-size: 14px",
	"line-height: 1.5",
].join(";");

/**
 * The Activity shell.
 *
 * `#status` starts with text, so a frame whose script never loads still says
 * something; `#fallback` is the "nothing is happening" explanation, hidden once
 * the game is running (or left visible if no script runs at all).
 */
export function activityPage(): string {
	return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Mini App — Dog Run</title>
		<style>
			body { ${STYLE} }
			main { max-width: 860px; margin: 0 auto; padding: 16px 16px 24px }
			header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px }
			h1 { font-size: 18px; margin: 0 }
			#player { color: #a3a6aa; font-size: 13px }
			#status { margin: 8px 0 0; font-size: 13px; min-height: 19px }
			.muted { color: #a3a6aa }
			#stage { position: relative; margin-top: 10px; border-radius: 12px; overflow: hidden; border: 1px solid #1e1f22 }
			canvas { display: block; width: 100%; height: min(58vh, 320px); touch-action: none; background: #f7f7f8 }
			.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; color: #a3a6aa; font-size: 12.5px }
			kbd { background: #1e1f22; border: 1px solid #3f4147; border-bottom-width: 2px; border-radius: 5px; padding: 1px 5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px }
			#fallback { margin-top: 12px; padding: 14px; background: #2b2d31; border: 1px solid #1e1f22; border-radius: 10px }
			code { background: #1e1f22; border-radius: 4px; padding: 1px 5px; font-size: 12px }
			ul { margin: 8px 0 0; padding-left: 18px }
			li { margin-top: 4px }
		</style>
	</head>
	<body>
		<main>
			<header>
				<h1>🐶 Dog Run</h1>
				<span id="player" class="muted">…</span>
			</header>
			<p id="status" class="muted">Starting the Activity…</p>

			<div id="stage"><canvas id="game" width="800" height="300"></canvas></div>

			<div class="legend">
				<span><kbd>Space</kbd> / <kbd>↑</kbd> / tap — jump a hydrant</span>
				<span><kbd>↓</kbd> — duck a frisbee</span>
				<span>High frisbees need nothing — just run.</span>
			</div>

			<div id="fallback">
				<strong>This page is a Discord Activity.</strong>
				<p class="muted" style="margin: 8px 0 0">
					It plays outside Discord too (the buttons above all work), but the authorization
					that names the player only happens inside. If you see this <em>inside</em>
					Discord with no game, the frame is not being served correctly — check two things:
				</p>
				<ul class="muted">
					<li>
						1. <strong>Activities → URL Mappings</strong> in the Developer Portal: map
						<code>/</code> to <code>https://mini-app-bshanahtarbirimi.vercel.app/</code>.
					</li>
					<li>2. That the app is installed in this server and you are a member of it.</li>
				</ul>
			</div>
			<noscript>
				<p class="muted">This game needs JavaScript, which is disabled in this client.</p>
			</noscript>
		</main>
		<script type="module" src="${ACTIVITY_SCRIPT_PATH}"></script>
	</body>
</html>
`;
}
