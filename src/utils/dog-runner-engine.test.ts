import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The game, actually run — headless.
 *
 * The rules are covered by `dog-runner.test.ts`, but rules that are right and a
 * *renderer* that throws still mean a blank Activity, and a blank Activity has no
 * console: the failure is exactly what nobody can debug from inside Discord. So
 * this drives the real loop against a fake canvas and a fake
 * `requestAnimationFrame` queue — frames, keys, collision, game over, restart and
 * teardown — which is the closest thing to playing it that a terminal can do.
 *
 * The specifier is built by concatenation because a relative `.js` string under
 * `src/` is what `module-specifiers.test.ts` forbids.
 */
const gameUrl = pathToFileURL(
	fileURLToPath(new URL("../../public/dog-runner" + ".js", import.meta.url)),
).href;

const { startDogRunner, WORLD, DOG } = (await import(gameUrl)) as {
	startDogRunner: (
		canvas: unknown,
		options?: { best?: number; onBest?: (value: number) => void },
	) => { stop(): void; setBest(value: number): void; readonly score: number; readonly best: number };
	WORLD: { width: number; height: number; ground: number };
	DOG: { x: number };
};

type Listener = (event: { code?: string; preventDefault?: () => void }) => void;

/** Every DOM surface the game touches, as an inspectable stand-in. */
type FakeTarget = {
	addEventListener(event: string, listener: Listener): void;
	removeEventListener(event: string, listener: Listener): void;
	/** Calls every listener registered for `event`. */
	fire(event: string, payload?: { code?: string }): number;
	/** How many listeners are attached right now — teardown is checked with it. */
	count(): number;
};

function fakeEventTarget(): FakeTarget {
	const listeners = new Map<string, Listener[]>();
	return {
		addEventListener(event, listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), listener]);
		},
		removeEventListener(event, listener) {
			listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== listener));
		},
		fire(event, payload = {}) {
			const attached = listeners.get(event) ?? [];
			for (const listener of attached) listener({ ...payload, preventDefault: () => {} });
			return attached.length;
		},
		count() {
			let total = 0;
			for (const attached of listeners.values()) total += attached.length;
			return total;
		},
	};
}

/** A canvas that records what was drawn, plus its own event target. */
function fakeCanvas() {
	const calls: string[] = [];
	const noop = () => {
		calls.push("call");
	};
	const ctx = {
		save: noop,
		restore: noop,
		clearRect: noop,
		fillRect: noop,
		fillText(raw: unknown, x: number) {
			calls.push(`text:${String(raw)}@${x}`);
		},
		beginPath: noop,
		moveTo: noop,
		lineTo: noop,
		arcTo: noop,
		arc: noop,
		ellipse: noop,
		closePath: noop,
		fill: noop,
		stroke: noop,
		translate: noop,
		scale: noop,
		setTransform: noop,
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 1,
		lineJoin: "round",
		font: "",
		textAlign: "left",
	};
	const target = fakeEventTarget();
	return {
		canvas: {
			clientWidth: 800,
			clientHeight: 300,
			width: 0,
			height: 0,
			getContext: () => ctx,
			addEventListener: target.addEventListener,
			removeEventListener: target.removeEventListener,
		},
		calls,
		target,
	};
}

/**
 * Installs the browser globals the game needs, and returns a driver.
 *
 * Each global exposes *only* the surface the game touches, so anything the game
 * needs and does not have shows up here as a thrown error rather than as an empty
 * frame in Discord.
 */
function installBrowserGlobals() {
	const globals = globalThis as unknown as Record<string, unknown>;
	const saved = new Map<string, unknown>();
	const windowTarget = fakeEventTarget();
	const documentTarget = fakeEventTarget();
	const queue: ((now: number) => void)[] = [];
	let nextHandle = 1;

	const install = (name: string, value: unknown) => {
		if (!saved.has(name)) saved.set(name, globals[name]);
		globals[name] = value;
	};

	install("window", {
		addEventListener: windowTarget.addEventListener,
		removeEventListener: windowTarget.removeEventListener,
		devicePixelRatio: 2,
	});
	install("document", {
		hidden: false,
		addEventListener: documentTarget.addEventListener,
		removeEventListener: documentTarget.removeEventListener,
	});
	install("requestAnimationFrame", (callback: (now: number) => void) => {
		queue.push(callback);
		return nextHandle++;
	});
	install("cancelAnimationFrame", () => {});

	let now = 0;
	return {
		windowTarget,
		/** Runs one frame at 60 fps — the loop reschedules itself as it goes. */
		frame(stepMs = 1000 / 60) {
			now += stepMs;
			const pending = queue.splice(0, queue.length);
			for (const callback of pending) callback(now);
		},
		key(code: string, type: "keydown" | "keyup" = "keydown") {
			windowTarget.fire(type, { code });
		},
		restore() {
			for (const [name, value] of saved) globals[name] = value;
		},
	};
}

test("the game runs headless: frames render, a collision ends the run, space restarts it", () => {
	const driver = installBrowserGlobals();
	try {
		const { canvas, calls, target: canvasTarget } = fakeCanvas();
		let bestReported = 0;
		const runner = startDogRunner(canvas, { best: 0, onBest: (value) => (bestReported = value) });

		// The first frames draw, and the scene is static until the first jump.
		driver.frame();
		driver.frame();
		assert.ok(calls.length > 20, "the renderer actually drew something");
		assert.equal(runner.score, 0, "nothing moves until the player starts");
		assert.ok(driver.windowTarget.count() >= 5, "keyboard and life-cycle listeners are attached");
		assert.ok(canvasTarget.count() >= 2, "so are the pointer ones, for a touch screen");

		// Start, and jump: the run is under way.
		driver.key("Space");
		for (let i = 0; i < 60; i += 1) driver.frame();
		assert.ok(runner.score > 10, `expected the score to advance, got ${runner.score}`);

		// Now stop jumping — one jump is a commitment, so the run ends in a hit.
		let frames = 0;
		while (bestReported === 0 && frames < 3000) {
			driver.frame();
			frames += 1;
		}
		assert.ok(bestReported > 0, "an obstacle was hit, and the record was reported to the caller");
		assert.ok(runner.best > 0);

		// Game over is a state, not a stop: the scene still renders, and the score
		// holds until the player starts again.
		const atTheEnd = runner.score;
		for (let i = 0; i < 30; i += 1) driver.frame();
		assert.equal(runner.score, atTheEnd, "a finished run does not keep scoring");

		// Space restarts: a new run, and the previous record is kept.
		driver.key("Space");
		driver.key("Space");
		for (let i = 0; i < 30; i += 1) driver.frame();
		assert.ok(runner.score > 0, "a restart runs again");
		assert.ok(runner.best >= bestReported, "the record survives the restart");

		// A tap is a jump too, which is how the game is played on a phone.
		canvasTarget.fire("pointerdown");
		for (let i = 0; i < 10; i += 1) driver.frame();

		// Ducking changes the dog's box mid-run; nothing may throw while it is held.
		driver.key("ArrowDown");
		for (let i = 0; i < 10; i += 1) driver.frame();
		driver.key("ArrowDown", "keyup");

		// A frame that loses focus pauses instead of playing on without the player.
		driver.windowTarget.fire("blur");
		driver.frame();
		driver.windowTarget.fire("focus");

		runner.stop();
		assert.equal(driver.windowTarget.count(), 0, "teardown detaches every window listener");
		assert.equal(canvasTarget.count(), 0, "and every canvas listener");
		const before = calls.length;
		driver.frame();
		assert.equal(calls.length, before, "and stops drawing");
	} finally {
		driver.restore();
	}
});

test("the world is sized for the canvas it is drawn into", () => {
	assert.ok(WORLD.width > 0 && WORLD.height > 0);
	assert.ok(WORLD.ground < WORLD.height, "the ground line is inside the world");
	assert.ok(DOG.x > 0 && DOG.x < WORLD.width / 2, "the dog starts on the left, with room to react");
});

test("a record passed in is shown, and can be replaced when the player is known", () => {
	const driver = installBrowserGlobals();
	try {
		const { canvas } = fakeCanvas();
		const runner = startDogRunner(canvas, { best: 1234 });
		assert.equal(runner.best, 1234);

		// The Activity does this once Discord says who is playing: the record
		// belongs to the player, not to the browser.
		runner.setBest(77);
		assert.equal(runner.best, 77);
		runner.setBest(Number.NaN);
		assert.equal(runner.best, 0, "a missing record is zero, not NaN in the readout");

		runner.stop();
	} finally {
		driver.restore();
	}
});
