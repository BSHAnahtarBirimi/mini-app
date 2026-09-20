/**
 * The Activity's client: `public/activity.js`.
 *
 * Plain ESM, no build step. It is loaded by `activityPage()`
 * (`src/utils/activity-page.ts`) inside Discord's Activity iframe, where it
 *
 * 1. reads the application id and scopes from `GET /api/activity`,
 * 2. performs the Embedded App SDK handshake (`ready`), which is also what tells
 *    Discord the frame has loaded — a frame that never calls it stays blank,
 * 3. runs the OAuth consent (`commands.authorize`) and has the **server**
 *    exchange the resulting code (`POST /api/activity`) so the client secret
 *    never reaches the browser,
 * 4. authenticates that token (`commands.authenticate`) to learn who is using it,
 * 5. and then does exactly what the web app does — `GET`/`POST /api/message` —
 *    so a message typed here goes to every linked channel, through each server's
 *    lobby when it can and through the bot when it cannot.
 *
 * Every failure path writes a readable message into `#status`, because a Discord
 * Activity that fails silently is a white rectangle with no way to find out why.
 */

import { DiscordSDK } from "/vendor/embedded-app-sdk/index.mjs";

const status = document.getElementById("status");
const app = document.getElementById("app");
const fallback = document.getElementById("fallback");

/** The frame is only an Activity when Discord embeds it. */
const inDiscord = window.parent !== window;

function setStatus(text, kind = "muted") {
	status.className = kind;
	status.textContent = text;
}

function render(html) {
	app.innerHTML = html;
}

/** Escapes text put into the DOM, so a name or channel cannot inject markup. */
function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** `fetch` + JSON, with the status code kept so callers can react to it. */
async function requestJson(url, options) {
	const response = await fetch(url, options);
	const text = await response.text();
	let body = null;
	try {
		body = JSON.parse(text);
	} catch {
		body = null;
	}
	return { status: response.status, ok: response.ok, body, text };
}

function postJson(url, payload) {
	return requestJson(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
}

/**
 * Rejects when `promise` has not settled in time.
 *
 * `sdk.ready()` waits for a reply from the Discord client over `postMessage`. If
 * the frame is not really inside Discord there is nobody to answer, so without
 * this the page would sit on "Starting…" forever — the blank-frame failure again,
 * just slower.
 */
function withTimeout(promise, ms, message) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}

/** One line per channel, with the path that actually delivered it. */
function describeResults(results) {
	return results
		.map((result) => {
			const where = result.channelId ? `<code>${escapeHtml(result.channelId)}</code>` : "?";
			if (result.ok) {
				const via = result.delivery === "lobby" ? "through the lobby" : "from the app's bot";
				return `<li class="ok">✅ ${where} — sent ${via}</li>`;
			}
			return `<li class="bad">❌ ${where} — ${escapeHtml(result.error ?? "failed")}</li>`;
		})
		.join("");
}

async function listChannels() {
	const { ok, body } = await requestJson("/api/message");
	if (!ok || !body) throw new Error("Could not read the linked channels.");
	return body;
}

/** The identity the SDK verified, as a header for the page. */
function renderIdentity(auth) {
	const user = auth?.user ?? {};
	const name = user.global_name || user.username || "you";
	const avatar = user.avatar
		? `<img src="https://cdn.discordapp.com/avatars/${escapeHtml(user.id)}/${escapeHtml(
				user.avatar,
			)}.png?size=64" alt="" width="32" height="32" style="border-radius:50%;vertical-align:middle;margin-right:8px" />`
		: "";
	return `${avatar}<strong>${escapeHtml(name)}</strong>`;
}

async function main() {
	if (!inDiscord) {
		// Loaded in a browser tab, not an Activity frame: the fallback card is
		// already on screen and says what this page is and where to use it.
		setStatus("Running outside Discord — this page is a Discord Activity.", "warn");
		return;
	}

	// Inside Discord the troubleshooting card would only be noise once the
	// handshake succeeds; it is removed now and re-shown if we fail. It is not
	// restored on failure below, deliberately: the status line and the error
	// report are more specific than a generic list of things to check.
	fallback.remove();

	const bootstrap = await requestJson("/api/activity");
	if (!bootstrap.ok || !bootstrap.body) {
		throw new Error(`The Activity endpoint answered ${bootstrap.status}.`);
	}
	const { clientId, scopes, tokenExchange, missing } = bootstrap.body;
	if (!clientId || !tokenExchange) {
		throw new Error(
			`This deployment cannot authorize the Activity — missing ${missing.join(", ")}.`,
		);
	}

	const sdk = new DiscordSDK(clientId);
	setStatus("Connecting to Discord…");
	await withTimeout(
		sdk.ready(),
		20_000,
		"Discord did not answer the Activity handshake within 20s.",
	);

	setStatus("Waiting for your authorization…");
	const { code } = await sdk.commands.authorize({
		client_id: clientId,
		scope: scopes,
		response_type: "code",
		prompt: "none",
		state: crypto.randomUUID ? crypto.randomUUID() : "",
	});

	// The code is single-use and short-lived: it is exchanged immediately, on the
	// server, because the exchange needs the application's client secret.
	const token = await postJson("/api/activity", { code });
	if (!token.ok || !token.body?.ok) {
		throw new Error(token.body?.error ?? `The code exchange failed (${token.status}).`);
	}

	const auth = await sdk.commands.authenticate({ access_token: token.body.accessToken });

	const channels = await listChannels();
	const channelList =
		channels.channels?.length > 0
			? `<ul>${channels.channels
					.map(
						(channel) =>
							`<li>• <code>${escapeHtml(channel.name ?? channel.channelId)}</code> <span class="muted">in ${escapeHtml(
								channel.guildId,
							)}</span></li>`,
					)
					.join("")}</ul>`
			: `<p class="warn" style="margin:8px 0 0">No channel is linked yet — run <code>/linked-channel</code> in a server first.</p>`;

	setStatus("Connected.", "ok");
	render(`
		<div class="card">${renderIdentity(auth)} <span class="muted">· ${escapeHtml(
			(auth.scopes ?? []).join(" "),
		)}</span></div>
		<div class="card">
			<strong>This message will go to ${channels.total ?? 0} linked channel${
				channels.total === 1 ? "" : "s"
			}:</strong>
			${channelList}
		</div>
		<div class="card">
			<textarea id="text" maxlength="500" placeholder="Write a message…"></textarea>
			<div style="display:flex;gap:8px;align-items:center;margin-top:10px">
				<button id="send">Send to every channel</button>
				<span id="send-status" class="muted" style="font-size:12px"></span>
			</div>
			<ul id="results"></ul>
		</div>
	`);

	const text = document.getElementById("text");
	const send = document.getElementById("send");
	const sendStatus = document.getElementById("send-status");
	const results = document.getElementById("results");
	const name = auth?.user?.global_name || auth?.user?.username || "A Discord member";

	send.addEventListener("click", async () => {
		const content = text.value.trim();
		if (content === "") {
			sendStatus.textContent = "Write a message first.";
			return;
		}
		send.disabled = true;
		results.innerHTML = "";
		sendStatus.textContent = "Sending…";
		try {
			const sent = await postJson("/api/message", { name, text: content });
			if (sent.status === 429) {
				sendStatus.textContent = sent.body?.error ?? "Too many messages — wait a moment.";
				return;
			}
			if (sent.status === 409) {
				sendStatus.textContent = sent.body?.error ?? "No channel is linked yet.";
				return;
			}
			results.innerHTML = describeResults(sent.body?.results ?? []);
			sendStatus.textContent = sent.body?.ok
				? `Sent to ${sent.body.sent} of ${sent.body.total}.`
				: (sent.body?.error ?? `Failed (${sent.status}).`);
			if (sent.body?.ok) text.value = "";
		} catch (error) {
			sendStatus.textContent = describeError(error);
		} finally {
			send.disabled = false;
		}
	});
}

main().catch((error) => {
	setStatus("The Activity could not start.", "bad");
	render(
		`<div class="card"><strong class="bad">${escapeHtml(
			describeError(error),
		)}</strong><p class="muted" style="margin:8px 0 0">Frame: <code>${escapeHtml(
			window.location.search || "(none)",
		)}</code>. <code>GET /api/activity</code> reports what this deployment is missing.</p></div>`,
	);
});
