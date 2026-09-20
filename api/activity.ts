/**
 * `/api/activity` — the server half of the Activity.
 *
 * `GET`  reports what the Activity page needs to start: the application id the
 *        Embedded App SDK is constructed with, the scopes to request, and
 *        whether this deployment can exchange an authorization code at all. All
 *        of it is public; the point is that a misconfigured deployment says which
 *        variable is missing rather than leaving the frame blank.
 * `POST` takes `{ code }` — the one-time code `sdk.commands.authorize` handed the
 *        frame — and returns an access token. This has to happen here because the
 *        exchange needs `DISCORD_CLIENT_SECRET`, which must never reach the
 *        browser, and because Discord's token endpoint is not CORS-enabled.
 *
 * Nothing is logged or stored: the token belongs to the member using the
 * Activity and is returned to the frame that asked for it. Sending a message is
 * *not* done with it — the Activity posts through `POST /api/message`, which uses
 * each linked server's own stored member connection, so a message arrives as a
 * lobby message exactly as it does from the web app.
 */

import {
	ACTIVITY_SCOPES,
	ActivityAuthError,
	activityConfig,
	checkActivityCode,
	exchangeActivityCode,
} from "../src/utils/activity-auth.js";

/** Minimal structural subset of the Vercel node request/response we use. */
type ActivityRequest = {
	method?: string;
	body?: unknown;
	on?: (event: string, listener: (chunk?: unknown) => void) => unknown;
};

type ActivityResponse = {
	statusCode: number;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
};

/** Collaborators of {@link handleActivity}, injectable so tests can drive it. */
export type ActivityDeps = {
	config: () => ReturnType<typeof activityConfig>;
	exchange: (code: string) => Promise<{ accessToken: string; scope: string | null; expiresIn: number | null }>;
};

const defaultDeps: ActivityDeps = {
	config: () => activityConfig(),
	exchange: (code) => exchangeActivityCode(code),
};

function sendJson(res: ActivityResponse, status: number, payload: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(payload));
}

/** Reads the body Vercel already parsed, falling back to the raw stream. */
async function readBody(req: ActivityRequest): Promise<Record<string, unknown>> {
	if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
	if (typeof req.body === "string") {
		try {
			return JSON.parse(req.body) as Record<string, unknown>;
		} catch {
			return {};
		}
	}
	if (typeof req.on !== "function") return {};

	return await new Promise<Record<string, unknown>>((resolve) => {
		let raw = "";
		req.on?.("data", (chunk) => {
			raw += String(chunk ?? "");
			if (raw.length > 8_000) resolve({});
		});
		req.on?.("end", () => {
			try {
				resolve(JSON.parse(raw) as Record<string, unknown>);
			} catch {
				resolve({});
			}
		});
		req.on?.("error", () => resolve({}));
	});
}

/**
 * `/api/activity` — `GET` bootstraps the page, `POST` exchanges the code.
 *
 * A refused exchange is answered with `400` when Discord blamed the code (it is
 * single-use and short-lived, so a retry cannot help) and `401` when Discord
 * rejected the *application's* credentials, which is the difference between
 * "press the button again" and "fix the deployment".
 */
export async function handleActivity(
	req: ActivityRequest,
	res: ActivityResponse,
	deps: ActivityDeps = defaultDeps,
): Promise<void> {
	const method = (req.method ?? "GET").toUpperCase();

	if (method === "GET") {
		const config = deps.config();
		sendJson(res, 200, {
			ok: true,
			clientId: config.clientId,
			scopes: [...ACTIVITY_SCOPES],
			tokenExchange: config.tokenExchange,
			// The page says this instead of a blank frame when it cannot start.
			missing: [
				...(config.clientId ? [] : ["DISCORD_APPLICATION_ID"]),
				...(config.tokenExchange ? [] : ["DISCORD_CLIENT_SECRET"]),
			],
		});
		return;
	}

	if (method !== "POST") {
		res.setHeader("Allow", "GET, POST");
		sendJson(res, 405, { ok: false, error: "Use GET to bootstrap the Activity, POST to exchange a code." });
		return;
	}

	const body = await readBody(req);
	const checked = checkActivityCode(body.code);
	if (!checked.ok) {
		sendJson(res, checked.status, { ok: false, error: checked.error });
		return;
	}

	try {
		const token = await deps.exchange(checked.code);
		sendJson(res, 200, {
			ok: true,
			accessToken: token.accessToken,
			scope: token.scope,
			expiresIn: token.expiresIn,
		});
	} catch (error) {
		if (error instanceof ActivityAuthError) {
			// 401 is Discord rejecting *us* (client id/secret), not the code, and
			// is also what a missing secret produces — never the caller's fault.
			sendJson(res, error.status === 401 ? 401 : 400, { ok: false, error: error.message });
			return;
		}
		console.error("[activity] code exchange failed:", error);
		sendJson(res, 500, {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export default async function handler(
	req: ActivityRequest,
	res: ActivityResponse,
): Promise<void> {
	await handleActivity(req, res);
}
