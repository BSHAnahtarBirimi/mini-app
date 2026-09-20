/**
 * The Activity's client: `public/activity.js`.
 *
 * Two jobs, in this order:
 *
 * 1. **Start the game.** `startDogRunner` is called synchronously, so the frame
 *    shows a playable scene whatever else happens. A Discord Activity that fails
 *    silently is a white rectangle with no console — the reason this page exists
 *    at all — so nothing may gate the game, including authorization.
 * 2. **Find out who is playing**, in the background: `GET /api/activity` gives
 *    the application id and scopes, `sdk.ready()` is the handshake Discord needs
 *    (the frame is not considered loaded without it), Discord's own consent runs
 *    through `commands.authorize`, and the one-time code is exchanged on the
 *    server (`POST /api/activity`) because that needs the client secret. The
 *    token then goes to `commands.authenticate`, and the identity it returns
 *    keys the high score — so a record follows the player, not the browser.
 *
 * Authorization is deliberately **best effort**: if it fails, the failure becomes
 * a line of text next to a game that still plays. The game only asks for
 * `identify`/`guilds`, and the message-sending path is elsewhere entirely (the
 * web app at `/message`, and the `/mesaj` command inside Discord).
 */

import { DiscordSDK } from "/vendor/embedded-app-sdk/index.mjs";
import { startDogRunner } from "/dog-runner.js";

const status = document.getElementById("status");
const player = document.getElementById("player");
const canvas = document.getElementById("game");
const fallback = document.getElementById("fallback");
const jumpButton = document.getElementById("jump");

/** The frame is only an Activity when Discord embeds it. */
const inDiscord = window.parent !== window;

function setStatus(text, tone = "muted") {
	status.className = tone;
	status.textContent = text;
}

/** Rejects when `promise` has not settled in time. */
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

const describeError = (error) => (error instanceof Error ? error.message : String(error));

async function requestJson(url, options) {
	const response = await fetch(url, options);
	const text = await response.text();
	let body = null;
	try {
		body = JSON.parse(text);
	} catch {
		body = null;
	}
	return { status: response.status, ok: response.ok, body };
}

// ---------------------------------------------------------------------------
// The record: one per player, falling back to one per browser.
// ---------------------------------------------------------------------------

const BEST_KEY_PREFIX = "mini-app:dog-runner:best:";

function readBest(id) {
	try {
		return Number(localStorage.getItem(BEST_KEY_PREFIX + id)) || 0;
	} catch {
		return 0;
	}
}

function writeBest(id, value) {
	try {
		localStorage.setItem(BEST_KEY_PREFIX + id, String(value));
	} catch {
		// A blocked or full storage must not stop the game.
	}
}

// ---------------------------------------------------------------------------
// The game first, always.
// ---------------------------------------------------------------------------

let playerId = "guest";

/**
 * Start the game here, at module scope, before anything can await.
 *
 * A `try` even around this: if the game cannot start, that is a sentence on the
 * page (`#fallback` stays visible) rather than a silent frame.
 */
let runner = null;
try {
	runner = startDogRunner(canvas, {
		best: readBest(playerId),
		onBest: (value) => writeBest(playerId, value),
	});
} catch (error) {
	setStatus(`The game could not start: ${describeError(error)}`, "bad");
}

function showPlayer(name, best) {
	player.textContent = best > 0 ? `${name} · best ${best}` : name;
}

showPlayer(inDiscord ? "…" : "Guest (not in Discord)", readBest(playerId));

if (runner) {
	// A real button for the jump, because the canvas is a small target on a phone
	// and a tap that lands on the frame's edge is a jump that never happened. It
	// calls the same `jump()` the keys and the canvas taps call, so there is one
	// jump and three ways to ask for it. The button is in the page's own HTML, so
	// nothing here has to create it.
	if (jumpButton) {
		// `pointerdown`, not `click`: it fires the instant the press lands, on
		// mouse and touch alike, and `preventDefault` keeps the press from moving
		// focus away from the game's own keys.
		jumpButton.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			runner.jump();
		});
		// Keyboard activation: Space on a focused button is already handled by the
		// game's window keydown listener (which prevents the button's default), so
		// only Enter needs bridging here — otherwise a mouse press would jump twice.
		jumpButton.addEventListener("keydown", (event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			runner.jump();
		});
	}

	// The troubleshooting card is only useful when nothing is on screen.
	fallback.hidden = true;
	if (inDiscord) {
		identify();
	} else {
		// Opened in a browser tab: there is no Discord client to authorize with,
		// and pretending otherwise would wait for a modal that cannot appear.
		setStatus("Running outside Discord — the game works, the player's name needs Discord.", "muted");
	}
}
// If the game could not start, `#fallback` stays on screen: it says what to check.

/**
 * Asks Discord who is playing, and repoints the high score at them.
 *
 * Every step can fail on its own and none of it is required to play, so the whole
 * thing is one `try`: whatever goes wrong is reported in the status line.
 */
async function identify() {
	try {
		const bootstrap = await requestJson("/api/activity");
		if (!bootstrap.ok || !bootstrap.body) {
			throw new Error(`The Activity endpoint answered ${bootstrap.status}.`);
		}
		const { clientId, scopes, tokenExchange, missing } = bootstrap.body;
		if (!clientId || !tokenExchange) {
			throw new Error(`Cannot authorize — missing ${(missing || []).join(", ")}.`);
		}

		const sdk = new DiscordSDK(clientId);
		setStatus("Connecting to Discord…");
		await withTimeout(
			sdk.ready(),
			20_000,
			"Discord did not answer the Activity handshake within 20s.",
		);

		const { code } = await sdk.commands.authorize({
			client_id: clientId,
			scope: scopes,
			response_type: "code",
			prompt: "none",
			state: crypto.randomUUID ? crypto.randomUUID() : "",
		});

		const token = await requestJson("/api/activity", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code }),
		});
		if (!token.ok || !token.body?.ok) {
			throw new Error(token.body?.error ?? `The code exchange failed (${token.status}).`);
		}

		const auth = await sdk.commands.authenticate({ access_token: token.body.accessToken });
		const user = auth?.user ?? {};
		const name = user.global_name || user.username || "player";

		// The record belongs to the player, not to this browser: switch to their
		// key now that we know who they are.
		playerId = user.id || "guest";
		runner?.setBest(readBest(playerId));
		showPlayer(name, runner?.best ?? 0);
		setStatus("Score is saved per Discord account. Have fun!");
	} catch (error) {
		// Not fatal, and said plainly: the game below is already running.
		setStatus(`Playing as a guest — ${describeError(error)}`);
	}
}
