/**
 * The Activity page, as code rather than a file read at request time.
 *
 * The same reason `oauth-pages.ts` exists: Vercel ships `public/**` as static
 * output but *not* inside the function bundle, so a function that reads a page
 * from disk answers `FUNCTION_INVOCATION_FAILED` (that crash cost a day). This is
 * rendered by `api/index.ts`, which owns `/` and `/activity`.
 *
 * The page is a shell: all behaviour lives in `public/activity.js`, which is
 * served statically and imports the Embedded App SDK from `/vendor/`. Two
 * consequences are deliberate:
 *
 * 1. **It is never blank.** A Discord Activity that cannot start shows a white
 *    frame and nothing else — no error, no console access — which is exactly how
 *    a missing URL mapping presents itself. The shell ships a visible starting
 *    state and a plain-English fallback with the fix, so the worst case is a
 *    page that explains what to check.
 * 2. **The SDK and the script are same-origin paths**, not a CDN: Discord applies
 *    its own Content-Security-Policy to the frame, and a dependency on a
 *    third-party host being allowed has no upside for a 460 KB static file.
 */

/** Where the Activity is served (and what a plain browser can open). */
export const ACTIVITY_PAGE_PATH = "/activity";

/** The Activity's client script, a static file in `public/`. */
export const ACTIVITY_SCRIPT_PATH = "/activity.js";

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
 * something; `#fallback` is the "nothing is happening" explanation, hidden until
 * the script decides it is needed (or left visible if no script runs at all —
 * `activity.js` hides it as its first action).
 */
export function activityPage(): string {
	return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Mini App — Activity</title>
		<style>
			body { ${STYLE} }
			main { max-width: 620px; margin: 0 auto; padding: 20px }
			h1 { font-size: 18px; margin: 0 0 4px }
			.card { background: #2b2d31; border: 1px solid #1e1f22; border-radius: 10px; padding: 14px; margin-top: 12px }
			.muted { color: #a3a6aa }
			code { background: #1e1f22; border-radius: 4px; padding: 1px 5px; font-size: 12px }
			textarea { width: 100%; box-sizing: border-box; min-height: 84px; resize: vertical; background: #1e1f22; color: #dbdee1; border: 1px solid #1e1f22; border-radius: 8px; padding: 10px; font: inherit }
			input { background: #1e1f22; color: #dbdee1; border: 1px solid #1e1f22; border-radius: 8px; padding: 8px 10px; font: inherit }
			button { background: #5865f2; color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; font: inherit; font-weight: 600; cursor: pointer }
			button:disabled { opacity: 0.6; cursor: default }
			ul { list-style: none; padding: 0; margin: 8px 0 0 }
			li { padding: 3px 0 }
			.ok { color: #23a55a }
			.bad { color: #f23f43 }
			.warn { color: #f0b232 }
		</style>
	</head>
	<body>
		<main>
			<h1>💬 Send to every linked channel</h1>
			<p id="status" class="muted">Starting the Activity…</p>
			<div id="app"></div>
			<div id="fallback" class="card">
				<strong>This page is a Discord Activity.</strong>
				<p class="muted" style="margin: 8px 0 0">
					It has to be opened from Discord, where the client performs the authorization. If you
					are seeing this <em>inside</em> Discord, the frame is not being served correctly —
					check two things:
				</p>
				<ul class="muted">
					<li>
						1. <strong>Activities → URL Mappings</strong> in the Developer Portal: map
						<code>/</code> to <code>https://mini-app-bshanahtarbirimi.vercel.app/</code>.
					</li>
					<li>2. That the app is installed in this server and you are a member of it.</li>
				</ul>
				<p class="muted" style="margin: 8px 0 0">
					Outside Discord you can use the web app instead:
					<code>https://mini-app-bshanahtarbirimi.vercel.app/message</code>
				</p>
			</div>
			<noscript>
				<p class="bad">This Activity needs JavaScript, which is disabled in this client.</p>
			</noscript>
		</main>
		<script type="module" src="${ACTIVITY_SCRIPT_PATH}"></script>
	</body>
</html>
`;
}
