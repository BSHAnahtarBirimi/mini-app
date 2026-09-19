/**
 * The pages the OAuth functions return, as code instead of files.
 *
 * These pages used to be read from disk at request time
 * (`mini.discordOAuthVerificationPage({ htmlFile: "index.html" })`,
 * `public/pages/failed.html`). They are not in the function bundle: Vercel
 * serves `index.html` and `public/**` as *static output* and leaves them out,
 * while `src/**` is bundled (verified in the deployment — `/api/diag?fs=1`
 * reports the layout). So every request crashed with
 * `FUNCTION_INVOCATION_FAILED`, and because the library renders its failure page
 * from a file too, even its error path crashed: the callback could not report
 * anything, and `Connect Discord` could never store a token.
 *
 * Returning the HTML from an imported module removes that dependency entirely,
 * and lets a failure say what actually went wrong instead of "Something went
 * wrong".
 */

/** Escapes text interpolated into HTML. */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const PAGE_STYLE = [
	"margin: 0",
	"min-height: 100vh",
	"display: flex",
	"flex-direction: column",
	"align-items: center",
	"justify-content: center",
	"gap: 12px",
	"background: #1e1f22",
	"color: #dbdee1",
	"font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
	"text-align: center",
	"padding: 24px",
].join(";");

type LayoutOptions = {
	title: string;
	emoji: string;
	heading: string;
	headingColor: string;
	body: string;
	/** Inline script appended just before `</body>`. */
	script?: string;
};

function layout({ title, emoji, heading, headingColor, body, script }: LayoutOptions): string {
	return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>${escapeHtml(title)}</title>
	</head>
	<body style="${PAGE_STYLE}">
		<div style="font-size: 48px">${emoji}</div>
		<h1 style="margin: 0; color: ${headingColor}; font-size: 24px">${escapeHtml(heading)}</h1>
		${body}
		${script ?? ""}
	</body>
</html>
`;
}

const paragraph = (html: string) =>
	`<p style="margin: 0; max-width: 42ch; color: hsl(214 8.1% 61.2%); line-height: 1.5">${html}</p>`;

/**
 * The `Connect Discord` page. It redirects to the OAuth consent screen, and
 * only reports a configuration problem when there is no URL to go to.
 */
export function connectPage(oauthUrl: string | null): string {
	// JSON.stringify keeps the URL a single string literal; escaping `<` stops
	// a crafted URL from closing the script element early.
	const literal = oauthUrl ? JSON.stringify(oauthUrl).replaceAll("<", "\\u003c") : "";

	return layout({
		title: "Mini App — Connect",
		emoji: "🌌",
		heading: "Connect your Mini App account",
		headingColor: "#fff",
		body: paragraph(
			oauthUrl
				? "You'll be redirected to <strong>Discord</strong> to verify your linked roles. This only takes a moment."
				: "<strong>ERROR:</strong> the OAuth URL is not configured (DISCORD_APPLICATION_ID, DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI are required).",
		),
		script: literal
			? `<script>
			window.location.replace(${literal});
		</script>`
			: undefined,
	});
}

/** The success page, telling the user whether the Social SDK scope was granted. */
export function connectedPage(options: { scope?: string; hasSocialLayer: boolean }): string {
	const scopeLine = options.scope
		? `<code style="color: hsl(214 8.1% 78%)">${escapeHtml(options.scope)}</code>`
		: "unknown";

	const social = options.hasSocialLayer
		? `<p style="margin: 0; color: #23a55a">✅ This connection can link channels.</p>`
		: [
				`<p style="margin: 0; color: #f0b232"><strong>Channel linking still needs the Social SDK scope.</strong></p>`,
				`<p style="margin: 0; color: hsl(214 8.1% 61.2%)">`,
				`Granted: ${scopeLine}. Linking requires <code>openid sdk.social_layer</code> — that is limited`,
				`access, so the application has to be accepted into Discord's Social SDK program. Use`,
				`<strong>Reconnect Discord</strong> on the <code>/linked-channel</code> panel once it is.`,
				`</p>`,
			].join(" ");

	return layout({
		title: "Connected!",
		emoji: "✅",
		heading: "Account connected!",
		headingColor: "#23a55a",
		body: [
			paragraph(
				"Your linked role should update on Discord within a few moments. You can close this window now.",
			),
			social,
		].join("\n\t\t"),
	});
}

/** The failure page. It shows the actual reason — the point of this module. */
export function failedPage(options: { heading?: string; message: string; detail?: string }): string {
	return layout({
		title: "Connection failed",
		emoji: "⚠️",
		heading: options.heading ?? "Connection failed",
		headingColor: "#f23f43",
		body: [
			paragraph(escapeHtml(options.message)),
			options.detail
				? `<pre style="margin: 0; max-width: 60ch; overflow-x: auto; text-align: left; background: #2b2d31; color: hsl(214 8.1% 78%); padding: 12px; border-radius: 8px; font-size: 13px">${escapeHtml(
						options.detail,
					)}</pre>`
				: "",
			paragraph(
				"Go back and try again. If it keeps failing, <code>GET /api/diag</code> reports what the deployment is missing.",
			),
		]
			.filter(Boolean)
			.join("\n\t\t"),
	});
}
