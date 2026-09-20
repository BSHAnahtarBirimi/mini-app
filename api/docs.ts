/**
 * `GET /api/docs` — the documentation site.
 *
 * `vercel.json` rewrites `/docs` here. The page is rendered from
 * `src/utils/docs-content.ts` (what is documented) and `src/utils/docs-page.ts`
 * (how it is rendered) instead of being a static file, for the same reason the
 * OAuth pages are: Vercel serves `index.html` and `public/**` as *static output*
 * and does not include them in a function bundle, so a function that reads a page
 * from disk answers `FUNCTION_INVOCATION_FAILED`. `getStaticProps`-style
 * generation is not available either — this app has no build step for pages.
 *
 * It takes no arguments and touches no database or Discord API, so the only thing
 * that can fail is the request method. `HEAD` is answered like `GET` (the body is
 * allowed to be dropped by the platform), and anything else gets a `405` with an
 * `Allow` header, which is what `/api/message` and `/api/activity` do.
 */

import { docsPage } from "../src/utils/docs-page.js";

/** Minimal structural subset of the Vercel node request/response we use. */
type DocsRequest = {
	method?: string;
};

type DocsResponse = {
	statusCode: number;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

function sendJson(res: DocsResponse, status: number, payload: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(payload));
}

/** `GET /api/docs` — the documentation page, or `405` for anything else. */
export function handleDocs(req: DocsRequest, res: DocsResponse): void {
	const method = (req.method ?? "GET").toUpperCase();

	if (method !== "GET" && method !== "HEAD") {
		res.setHeader("Allow", "GET, HEAD");
		sendJson(res, 405, { ok: false, error: "Use GET — this endpoint serves the documentation page." });
		return;
	}

	res.statusCode = 200;
	res.setHeader("Content-Type", "text/html; charset=utf-8");
	// No secrets and no per-request data: the page is the same for everyone, so it
	// may be cached — but only briefly, because a deploy should show up quickly.
	res.setHeader("Cache-Control", "public, max-age=300");
	res.end(docsPage());
}

export default function handler(req: DocsRequest, res: DocsResponse): void {
	handleDocs(req, res);
}
