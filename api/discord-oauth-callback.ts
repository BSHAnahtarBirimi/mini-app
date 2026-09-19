/**
 * OAuth2 callback entry point.
 *
 * The flow lives in `src/utils/oauth-callback.ts` and is imported **inside** the
 * request, not at the top level. This endpoint has already spent a day answering
 * `FUNCTION_INVOCATION_FAILED` for every request — a module-scope failure leaves
 * no way to say why, and the user only sees "A function needed by this page
 * failed". Loading the flow dynamically means a failure to load it is caught,
 * reported, and recorded like any other.
 *
 * The fallback page below therefore imports nothing at all.
 */

type OAuthRequest = {
	url?: string;
	headers?: Record<string, string | string[] | undefined>;
};
type OAuthResponse = {
	statusCode?: number;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Rendered with no dependencies, so it works even when imports fail. */
function failurePage(message: string, detail?: string): string {
	return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Connection failed</title>
	</head>
	<body style="margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: #1e1f22; color: #dbdee1; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 24px">
		<div style="font-size: 48px">⚠️</div>
		<h1 style="margin: 0; color: #f23f43; font-size: 24px">Connection failed</h1>
		<p style="margin: 0; max-width: 42ch; color: hsl(214 8.1% 61.2%)">${escapeHtml(message)}</p>
		${
			detail
				? `<pre style="margin: 0; max-width: 60ch; overflow-x: auto; text-align: left; background: #2b2d31; color: hsl(214 8.1% 78%); padding: 12px; border-radius: 8px; font-size: 13px">${escapeHtml(detail)}</pre>`
				: ""
		}
	</body>
</html>
`;
}

function sendHtml(res: OAuthResponse, html: string): void {
	res.statusCode = 200;
	res.setHeader("Content-Type", "text/html; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(html);
}

export default async function handler(req: OAuthRequest, res: OAuthResponse): Promise<void> {
	try {
		const { handleOAuthCallback } = await import("../src/utils/oauth-callback.js");
		await handleOAuthCallback(req, res);
	} catch (error) {
		// Best-effort recording; the page is what matters here.
		try {
			const { recordInteractionError, describeError } = await import(
				"../src/utils/interaction-errors.js"
			);
			await recordInteractionError(error, "discord-oauth-callback:load");
			sendHtml(
				res,
				failurePage(
					"The deployment could not load the OAuth flow, so the connection was not completed.",
					describeError(error),
				),
			);
		} catch {
			sendHtml(
				res,
				failurePage(
					"The deployment could not load the OAuth flow, so the connection was not completed.",
					error instanceof Error ? error.message : String(error),
				),
			);
		}
	}
}
