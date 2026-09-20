/**
 * "Dog Run" — an endless runner in the spirit of Chrome's offline dino, with a
 * white dog instead of the dino.
 *
 * Loaded by `public/activity.js` inside a Discord Activity frame. No assets and
 * no build step: the dog, the obstacles and the ground are all canvas paths, so
 * the file is the whole game.
 *
 * The **rules** — geometry, speed curve, spacing, collision — are exported and
 * free of any DOM reference, and this module touches `document` only inside
 * `startDogRunner`. That is not decoration: the Activity has no console and no
 * visibility, so `src/utils/dog-runner.test.ts` imports this file in Node and
 * checks the rules directly (that the dog has to *jump* a hydrant, *duck* a
 * mid-height frisbee and can ignore a high one, that spacing tightens as speed
 * rises, that a collision is a real overlap). Importing the file at all also
 * proves nothing DOM-shaped runs at module scope, which is the difference
 * between a game and a blank frame.
 *
 * Coordinates are logical: the world is `WORLD.width` × `WORLD.height` and the
 * canvas is scaled to fit, so the physics do not change with the frame size.
 */

// ---------------------------------------------------------------------------
// The world, in logical units.
// ---------------------------------------------------------------------------

export const WORLD = { width: 800, height: 300, ground: 250 };

/**
 * The dog's two postures.
 *
 * Ducking is a *crouch*: wider and shorter than standing, which is what lets a
 * mid-height obstacle pass over it. The two boxes are the entire dodge mechanic,
 * so they are defined here and used by both the physics and the drawing.
 */
export const DOG = {
	x: 64,
	stand: { width: 46, height: 36 },
	duck: { width: 58, height: 22 },
};

/** Jump physics: apex ≈ 129 units, airtime ≈ 0.63 s — enough for every obstacle. */
export const JUMP = { velocity: -820, gravity: 2600 };

/** The speed ramp: from 320 to 620 units/s, reached at score 860. */
export const SPEED = { start: 320, max: 620, perPoint: 0.35 };

/** Pixels travelled per point of score. */
export const DISTANCE_PER_POINT = 12;

/** The dog's box for a posture, sitting on the ground. */
export function dogBox(ducking) {
	const size = ducking ? DOG.duck : DOG.stand;
	return {
		x: DOG.x,
		y: WORLD.ground - size.height,
		width: size.width,
		height: size.height,
	};
}

/** Axis-aligned overlap. Touching edges do not count, so a graze is survivable. */
export function overlaps(a, b) {
	return (
		a.x < b.x + b.width &&
		b.x < a.x + a.width &&
		a.y < b.y + b.height &&
		b.y < a.y + a.height
	);
}

/**
 * The three heights an obstacle can occupy, all derived from the dog's boxes:
 *
 * - `low`    — on the ground, so it must be **jumped** (it overlaps both boxes).
 * - `middle` — clears the crouching dog but not the standing one: **duck**.
 * - `high`   — clears even the standing dog: nothing to do.
 *
 * Because they are derived, changing the dog's proportions cannot silently make
 * a band undodgeable.
 */
const OBSTACLE_HEIGHT = { low: 40, flying: 26 };
const CLEARANCE = 2;

export const FLIGHT_BANDS = {
	low: { height: OBSTACLE_HEIGHT.low, bottom: WORLD.ground },
	// 2 units above the crouching dog's head, so a ducked dog fits under it.
	middle: { height: OBSTACLE_HEIGHT.flying, bottom: dogBox(true).y - CLEARANCE },
	// Above the standing dog's head entirely.
	high: { height: OBSTACLE_HEIGHT.flying, bottom: dogBox(false).y - 14 },
};

/** The band names, in the order they are spawned. */
export const BAND_NAMES = ["low", "middle", "high"];

/** A box for one obstacle kind at `x`. */
export function obstacleBox(kind, x) {
	if (kind === "hydrant") {
		const band = FLIGHT_BANDS.low;
		return {
			kind,
			x,
			y: band.bottom - band.height,
			width: 22,
			height: band.height,
		};
	}
	const band = FLIGHT_BANDS[kind];
	return {
		kind,
		x,
		y: band.bottom - band.height,
		width: 30,
		height: band.height,
	};
}

/**
 * What the player must do about `obstacle`: `"jump"`, `"duck"` or `"none"`.
 *
 * The obstacle is evaluated **as if it had reached the dog**, so its `x` is
 * irrelevant — the question this answers is "when this one arrives, what do I
 * do?", which is what makes it usable for both the spawner and a test. Computed
 * from the dog's two boxes rather than from a table of bands, so an obstacle that
 * is hittable while standing and clear while crouched is *by definition* a duck.
 */
export function requiredAction(obstacle) {
	const atTheDog = { ...obstacle, x: DOG.x };
	const standing = overlaps(dogBox(false), atTheDog);
	const crouching = overlaps(dogBox(true), atTheDog);
	if (!standing && !crouching) return "none";
	return standing && !crouching ? "duck" : "jump";
}

/** The current speed for a score — it only ever rises, and it is capped. */
export function speedAt(score) {
	return Math.min(SPEED.max, SPEED.start + Math.max(0, score) * SPEED.perPoint);
}

/**
 * The horizontal gap to leave before the next obstacle.
 *
 * Distance grows with speed (a faster dog covers more ground in the same
 * airtime), but not proportionally — so the *time* between obstacles shrinks as
 * the run goes on, which is the difficulty curve.
 */
export function gapFor(speed, random = Math.random) {
	return 210 + speed * 0.35 + random() * (150 + speed * 0.2);
}

/** Picks the next obstacle kind, weighted so the ground stays the common case. */
export function pickKind(random = Math.random) {
	const roll = random();
	if (roll < 0.5) return "hydrant";
	return roll < 0.78 ? "middle" : "high";
}

// ---------------------------------------------------------------------------
// The game itself.
// ---------------------------------------------------------------------------

/** Rounded-rectangle path, so the drawing does not depend on `ctx.roundRect`. */
function roundRectPath(ctx, x, y, width, height, radius) {
	const r = Math.min(radius, width / 2, height / 2);
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + width, y, x + width, y + height, r);
	ctx.arcTo(x + width, y + height, x, y + height, r);
	ctx.arcTo(x, y + height, x, y, r);
	ctx.arcTo(x, y, x + width, y, r);
	ctx.closePath();
}

/**
 * Draws the dog: a white dog with a dark outline in daylight, and plain white at
 * night.
 *
 * "White" is the brief, and white on a light background is invisible — so the
 * outline is what carries the shape in day mode (`ink`), while night mode inverts
 * the page and the fill alone is enough. Both postures are the same drawing,
 * scaled to the box: crouching is simply wider and shorter.
 */
function drawDog(ctx, dog, ink, night, elapsed) {
	const box = dogBox(dog.ducking);
	const sx = box.width / DOG.stand.width;
	const sy = box.height / DOG.stand.height;

	ctx.save();
	ctx.translate(box.x, box.y);
	ctx.scale(sx, sy);
	ctx.lineWidth = 2.4 / Math.max(sx, sy);
	ctx.lineJoin = "round";
	ctx.strokeStyle = night ? "rgba(255,255,255,0.001)" : ink;
	ctx.fillStyle = "#ffffff";

	const run = dog.ducking ? 0 : Math.sin(elapsed * dog.speed * 0.055);
	const legPhase = run > 0 ? 1 : -1;

	// Tail, behind the body, wagging with the run.
	ctx.beginPath();
	ctx.moveTo(3, 14);
	ctx.lineTo(-7, 8 + legPhase * 3);
	ctx.lineTo(-5, 17);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();

	// Body.
	roundRectPath(ctx, 0, 12, 38, 18, 7);
	ctx.fill();
	ctx.stroke();

	// Head + snout, so the silhouette reads as a dog and not a loaf.
	roundRectPath(ctx, 30, 2, 16, 15, 5);
	ctx.fill();
	ctx.stroke();
	roundRectPath(ctx, 42, 9, 10, 8, 3);
	ctx.fill();
	ctx.stroke();

	// Ear, folded back.
	ctx.beginPath();
	ctx.moveTo(32, 3);
	ctx.lineTo(27, -5);
	ctx.lineTo(37, 2);
	ctx.closePath();
	ctx.fill();
	ctx.stroke();

	// Eye + nose.
	ctx.fillStyle = ink;
	ctx.beginPath();
	ctx.arc(41, 7, 1.9, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.arc(51.5, 13, 1.6, 0, Math.PI * 2);
	ctx.fill();

	// Collar, the one spot of colour.
	ctx.fillStyle = "#5865f2";
	ctx.fillRect(29, 12, 4, 8);

	// Legs — four of them, alternating, which is what sells the run.
	if (!dog.ducking) {
		ctx.fillStyle = "#ffffff";
		ctx.strokeStyle = night ? "rgba(255,255,255,0.001)" : ink;
		const legs = [
			{ x: 5, phase: 1 },
			{ x: 14, phase: -1 },
			{ x: 25, phase: -1 },
			{ x: 33, phase: 1 },
		];
		for (const leg of legs) {
			const swing = Math.sin(elapsed * dog.speed * 0.055 + (leg.phase > 0 ? 0 : Math.PI)) * 3;
			roundRectPath(ctx, leg.x + swing, 28, 5, 9, 2);
			ctx.fill();
			ctx.stroke();
		}
	}

	ctx.restore();
}

/** Draws one obstacle: a fire hydrant on the ground, a frisbee in the air. */
function drawObstacle(ctx, obstacle, ink, night) {
	ctx.save();
	ctx.lineWidth = 2.4;
	ctx.lineJoin = "round";
	ctx.strokeStyle = night ? "rgba(255,255,255,0.001)" : ink;

	if (obstacle.kind === "hydrant") {
		ctx.fillStyle = "#ffffff";
		roundRectPath(ctx, obstacle.x + 2, obstacle.y + 8, 18, obstacle.height - 8, 5);
		ctx.fill();
		ctx.stroke();
		// A red cap: the only other colour in the world, so it reads instantly.
		ctx.fillStyle = "#f23f43";
		roundRectPath(ctx, obstacle.x, obstacle.y, 22, 10, 4);
		ctx.fill();
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(obstacle.x + 4, obstacle.y + 14);
		ctx.lineTo(obstacle.x - 2, obstacle.y + 22);
		ctx.lineTo(obstacle.x + 6, obstacle.y + 22);
		ctx.closePath();
		ctx.fillStyle = "#f23f43";
		ctx.fill();
		ctx.stroke();
		return;
	}

	// A frisbee, spinning on its way across.
	const cx = obstacle.x + obstacle.width / 2;
	const cy = obstacle.y + obstacle.height / 2;
	ctx.fillStyle = "#5865f2";
	ctx.beginPath();
	ctx.ellipse(cx, cy, obstacle.width / 2, obstacle.height / 2, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();
	ctx.fillStyle = "#ffffff";
	ctx.beginPath();
	ctx.ellipse(cx, cy - 2, obstacle.width / 2 - 7, obstacle.height / 2 - 7, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

/** The score readout, in the dino's monospaced idiom: `HI 01320  01345`. */
function padded(score) {
	return String(Math.floor(score)).padStart(5, "0");
}

/**
 * Runs the game on `canvas`.
 *
 * `options.best` is the score to show as the record — passed in because it
 * belongs to the player, and the caller knows who they are (the Activity
 * authenticates them; in a browser tab there is nobody). `options.onBest` is
 * called when the record is beaten, so the caller can persist it.
 */
export function startDogRunner(canvas, options = {}) {
	const ctx = canvas.getContext("2d");
	const best = { value: Number(options.best) || 0 };
	const listeners = { detach: [] };

	let state = freshState();
	let frame = 0;
	let elapsed = 0;
	let last = 0;
	let paused = false;
	let stopped = false;

	function freshState() {
		return {
			score: 0,
			distance: 0,
			speed: SPEED.start,
			dog: { y: 0, velocity: 0, ducking: false },
			obstacles: [],
			clouds: [
				{ x: 620, y: 60 },
				{ x: 340, y: 96 },
				{ x: 90, y: 48 },
			],
			nextSpawn: 520,
			over: false,
			started: false,
		};
	}

	function restart() {
		state = freshState();
		last = 0;
	}

	function jump() {
		if (state.over) {
			restart();
			return;
		}
		state.started = true;
		// Only from the ground: no double jumps, so a jump is a commitment.
		if (state.dog.y === 0) state.dog.velocity = JUMP.velocity;
	}

	function update(dt) {
		if (state.over || !state.started) return;

		state.speed = speedAt(state.score);
		state.distance += state.speed * dt;
		state.score = state.distance / DISTANCE_PER_POINT;

		// The dog: gravity while airborne, ground otherwise.
		state.dog.velocity += JUMP.gravity * dt;
		state.dog.y += state.dog.velocity * dt;
		if (state.dog.y >= 0) {
			state.dog.y = 0;
			state.dog.velocity = 0;
		}

		for (const obstacle of state.obstacles) obstacle.x -= state.speed * dt;
		state.obstacles = state.obstacles.filter((obstacle) => obstacle.x + obstacle.width > -20);

		for (const cloud of state.clouds) {
			cloud.x -= state.speed * 0.18 * dt;
			if (cloud.x < -60) {
				cloud.x = WORLD.width + 60;
				cloud.y = 40 + Math.random() * 70;
			}
		}

		const lastObstacle = state.obstacles[state.obstacles.length - 1];
		const tail = lastObstacle ? lastObstacle.x + lastObstacle.width : WORLD.width;
		state.nextSpawn -= state.speed * dt;
		if (state.nextSpawn <= 0 || (!lastObstacle && tail < WORLD.width - 260)) {
			const kind = pickKind();
			state.obstacles.push(obstacleBox(kind, WORLD.width + 20));
			state.nextSpawn = gapFor(state.speed);
		}

		const dog = dogBox(state.dog.ducking);
		for (const obstacle of state.obstacles) {
			if (overlaps(dog, obstacle)) {
				state.over = true;
				if (state.score > best.value) {
					best.value = Math.floor(state.score);
					options.onBest?.(best.value);
				}
				break;
			}
		}
	}

	function render() {
		const width = WORLD.width;
		const height = WORLD.height;
		// Day/night flips every 700 points, which is the dino's own trick for
		// making a long run feel like it is going somewhere.
		const night = Math.floor(state.score / 700) % 2 === 1;
		const ink = night ? "#ffffff" : "#535353";

		ctx.save();
		ctx.clearRect(0, 0, width, height);
		ctx.fillStyle = night ? "#1e1f22" : "#f7f7f8";
		ctx.fillRect(0, 0, width, height);

		// Clouds, then the ground.
		ctx.fillStyle = night ? "#3f4147" : "#d9dade";
		for (const cloud of state.clouds) {
			ctx.beginPath();
			ctx.ellipse(cloud.x, cloud.y, 26, 10, 0, 0, Math.PI * 2);
			ctx.ellipse(cloud.x + 18, cloud.y - 5, 18, 9, 0, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.strokeStyle = ink;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(0, WORLD.ground + 1);
		ctx.lineTo(width, WORLD.ground + 1);
		ctx.stroke();

		// Ground speckles, so the speed is visible when the dog is alone.
		ctx.fillStyle = night ? "#4e5058" : "#c5c6ca";
		for (let x = 0; x < width; x += 34) {
			const offset = (state.distance % 34) - 34;
			ctx.fillRect(x + offset, WORLD.ground + 7 + ((x / 34) % 3) * 4, 12, 2.5);
		}

		for (const obstacle of state.obstacles) drawObstacle(ctx, obstacle, ink, night);
		drawDog(ctx, { ...state.dog, speed: state.speed }, ink, night, elapsed);

		// Score, top right; the record only while there is one.
		ctx.fillStyle = ink;
		ctx.font = "600 16px ui-monospace, SFMono-Regular, Menlo, monospace";
		ctx.textAlign = "right";
		if (best.value > 0) {
			ctx.fillText("HI " + padded(best.value), width - 120, 34);
		}
		ctx.fillText(padded(state.score), width - 24, 34);
		ctx.textAlign = "left";

		if (!state.started) {
			ctx.font = "500 15px system-ui, -apple-system, sans-serif";
			ctx.fillText("Space / ↑ / tap to jump  ·  ↓ to duck", 24, 42);
		}
		if (state.over) {
			ctx.font = "700 20px system-ui, -apple-system, sans-serif";
			ctx.fillText("Ouch! Press space to run again", 24, 46);
		}
		ctx.restore();
	}

	function loop(now) {
		if (stopped) return;
		const dt = last === 0 ? 0 : Math.min((now - last) / 1000, 1 / 30);
		last = now;
		if (!paused) {
			elapsed += dt;
			update(dt);
			render();
		}
		frame = requestAnimationFrame(loop);
	}

	/** Fits the logical world into the canvas, letterboxing the spare space. */
	function resize() {
		const ratio = Math.min(window.devicePixelRatio || 1, 2);
		const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
		const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		const scale = Math.min(width / WORLD.width, height / WORLD.height);
		ctx.setTransform(scale, 0, 0, scale, (width - WORLD.width * scale) / 2, (height - WORLD.height * scale) / 2);
	}

	function on(event, handler, target = window) {
		target.addEventListener(event, handler);
		listeners.detach.push(() => target.removeEventListener(event, handler));
	}

	on("keydown", (event) => {
		if (event.code === "Space" || event.code === "ArrowUp" || event.code === "KeyW") {
			event.preventDefault();
			jump();
			return;
		}
		if (event.code === "ArrowDown" || event.code === "KeyS") {
			event.preventDefault();
			state.dog.ducking = true;
		}
	});
	on("keyup", (event) => {
		if (event.code === "ArrowDown" || event.code === "KeyS") state.dog.ducking = false;
	});
	// Pointer and touch, because a Discord Activity is often a tablet or a phone.
	on(
		"pointerdown",
		(event) => {
			event.preventDefault();
			jump();
		},
		canvas,
	);
	on(
		"touchstart",
		(event) => {
			event.preventDefault();
			jump();
		},
		canvas,
	);
	// A hidden Activity keeps running in the background otherwise, and the player
	// comes back to a collision they never saw.
	on("visibilitychange", () => {
		paused = document.hidden;
		last = 0;
	});
	on("blur", () => {
		paused = true;
		last = 0;
	});
	on("focus", () => {
		paused = false;
		last = 0;
	});
	on("resize", resize);
	if (typeof ResizeObserver !== "undefined") {
		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		listeners.detach.push(() => observer.disconnect());
	}

	resize();
	frame = requestAnimationFrame(loop);

	return {
		/** Stops the loop and detaches every listener. */
		stop() {
			stopped = true;
			cancelAnimationFrame(frame);
			for (const detach of listeners.detach) detach();
			listeners.detach.length = 0;
		},
		/**
		 * Replaces the record being shown.
		 *
		 * Used once the Activity knows *who* is playing: until then the run is
		 * scored against whatever this browser remembered, and the player's own
		 * record replaces it — the game itself has no idea about accounts.
		 */
		setBest(value) {
			best.value = Number(value) || 0;
		},
		/** The current score, for a caller that wants to show it elsewhere. */
		get score() {
			return Math.floor(state.score);
		},
		/** The record this run is measured against. */
		get best() {
			return best.value;
		},
	};
}
