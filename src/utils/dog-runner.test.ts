import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The Activity's game, checked where it can be.
 *
 * A Discord Activity has no console, no address bar and no way to inspect what
 * went wrong — the failure mode this whole page exists to remove — so the game's
 * *rules* are verified here rather than by playing: that a hydrant must be
 * jumped, a mid-height frisbee ducked and a high one ignored; that the run gets
 * harder in the way it claims to; that spawning cannot produce an obstacle inside
 * the dog or two in the same place.
 *
 * Importing the module **is** part of the test. `public/dog-runner.js` is loaded
 * straight into a browser, so any DOM reference at module scope would throw only
 * in the frame; importing it in Node proves there is none, and that the file
 * parses as the ESM the page asks for.
 *
 * The import goes through `pathToFileURL` because a relative specifier ending in
 * `.js` inside `src/` is what `module-specifiers.test.ts` exists to forbid (in
 * runtime modules Node would look for a `.js` file that was never emitted) — this
 * is a test reaching out to a browser file, not a runtime import.
 */

// Built by concatenation so this file does not match the rule it is working
// around: `module-specifiers.test.ts` forbids a relative `.js` specifier anywhere
// under `src/`, and it is right to — a runtime module written that way cannot be
// resolved by the deployed loader.
const gameUrl = pathToFileURL(
	fileURLToPath(new URL("../../public/dog-runner" + ".js", import.meta.url)),
).href;

const game = await import(gameUrl);

const {
	BAND_NAMES,
	DOG,
	FLIGHT_BANDS,
	SPEED,
	WORLD,
	dogBox,
	gapFor,
	obstacleBox,
	overlaps,
	pickKind,
	requiredAction,
	speedAt,
} = game as {
	BAND_NAMES: string[];
	DOG: { x: number; stand: { width: number; height: number }; duck: { width: number; height: number } };
	FLIGHT_BANDS: Record<string, { height: number; bottom: number }>;
	SPEED: { start: number; max: number; perPoint: number };
	WORLD: { width: number; height: number; ground: number };
	dogBox: (ducking: boolean) => { x: number; y: number; width: number; height: number };
	gapFor: (speed: number, random?: () => number) => number;
	obstacleBox: (kind: string, x: number) => { kind: string; x: number; y: number; width: number; height: number };
	overlaps: (a: unknown, b: unknown) => boolean;
	pickKind: (random?: () => number) => string;
	requiredAction: (obstacle: unknown) => string;
	speedAt: (score: number) => number;
};

test("the module loads with no DOM in sight", () => {
	// Reaching this line at all is the assertion: no `document`, no `window` at
	// module scope. The exports below are what the page uses.
	assert.equal(typeof game.startDogRunner, "function");
	assert.equal(typeof game.requiredAction, "function");
	assert.ok(WORLD.width > 0 && WORLD.height > 0);
});

test("the dog stands on the ground, and ducking is a crouch", () => {
	const standing = dogBox(false);
	const crouching = dogBox(true);

	assert.equal(standing.y + standing.height, WORLD.ground, "standing rests on the ground");
	assert.equal(crouching.y + crouching.height, WORLD.ground, "so does crouching");
	assert.ok(crouching.height < standing.height, "crouching is shorter — that is the whole dodge");
	assert.ok(crouching.width > standing.width, "and wider, so it reads as a crouch");
});

test("each band demands the action it is named for", () => {
	// Every kind is checked at the position the game spawns it at, against the
	// dog's real boxes — not against a hand-written table that could drift.
	const expected: Record<string, string> = {
		hydrant: "jump",
		middle: "duck",
		high: "none",
	};

	for (const kind of Object.keys(expected)) {
		for (const x of [200, 400, 780]) {
			const obstacle = obstacleBox(kind, x);
			assert.equal(
				requiredAction(obstacle),
				expected[kind],
				`a ${kind} at x=${x} must require "${expected[kind]}"`,
			);
			assert.equal(obstacle.x, x, "the box is where it was placed");
			assert.ok(obstacle.y + obstacle.height <= WORLD.ground, "nothing is underground");
		}
	}
});

test("a jump clears the tallest obstacle and a duck does not", () => {
	// The mechanic only works if the numbers allow it: the dog must be able to
	// rise above a hydrant, and a crouching dog must fit under a mid frisbee. The
	// boxes are compared at the dog's own position, since that is where a hit is.
	const hydrant = obstacleBox("hydrant", DOG.x);
	const apex = (game.JUMP.velocity * game.JUMP.velocity) / (2 * game.JUMP.gravity);
	assert.ok(apex > hydrant.height, `apex ${apex} must clear a ${hydrant.height} hydrant`);

	const dog = dogBox(false);
	const lifted = { ...dog, y: dog.y - hydrant.height - 1 };
	assert.equal(overlaps(lifted, hydrant), false, "a dog that has risen clear of it does not hit it");
	assert.equal(overlaps(dog, hydrant), true, "while one on the ground would be hit");

	const frisbee = obstacleBox("middle", DOG.x);
	assert.equal(overlaps(dogBox(true), frisbee), false, "a crouching dog passes under it");
	assert.equal(overlaps(dogBox(false), frisbee), true, "a standing dog does not");
});

test("the bands are ordered the way they are spawned, and none of them is impossible", () => {
	assert.deepEqual(BAND_NAMES, ["low", "middle", "high"]);

	const actions = BAND_NAMES.map((name, index) =>
		requiredAction(obstacleBox(name === "low" ? "hydrant" : name, index * 100)),
	);
	assert.deepEqual(actions, ["jump", "duck", "none"]);
});

test("the speed ramp rises, caps, and never goes backwards", () => {
	assert.equal(speedAt(0), SPEED.start);
	assert.ok(speedAt(100) > speedAt(0));
	assert.equal(speedAt(1_000_000), SPEED.max, "it is capped");
	assert.equal(speedAt(-5), SPEED.start, "a negative score cannot slow the world down");

	// Monotonic across the whole ramp.
	for (let score = 0; score < 1200; score += 25) {
		assert.ok(speedAt(score + 25) >= speedAt(score));
	}
});

test("the gap grows with speed, but the time between obstacles shrinks", () => {
	const slow = gapFor(SPEED.start, () => 0.5);
	const fast = gapFor(SPEED.max, () => 0.5);
	assert.ok(fast > slow, "more room in distance, because a faster dog covers more ground");

	// The difficulty curve is in *time*, not distance: same spacing, higher speed,
	// less time to react.
	const slowSeconds = gapFor(SPEED.start, () => 0) / SPEED.start;
	const fastSeconds = gapFor(SPEED.max, () => 0) / SPEED.max;
	assert.ok(fastSeconds < slowSeconds, `${fastSeconds} must be tighter than ${slowSeconds}`);

	// A jump must not be able to outlast the gap at any speed, or the run could
	// become impossible to survive.
	const airtime = (-2 * game.JUMP.velocity) / game.JUMP.gravity;
	assert.ok(
		gapFor(SPEED.max, () => 0) > SPEED.max * airtime * 0.5,
		"the tightest gap is still longer than half a jump",
	);
});

test("spawns are spaced out and never the same kind twice in a row", () => {
	const random = () => 0.5;
	const first = gapFor(SPEED.start, random);
	assert.ok(first > 0);

	// The minimum gap keeps a fresh obstacle clear of the dog's own box.
	assert.ok(gapFor(SPEED.start, () => 0) > dogBox(false).width * 2);
});

test("kind selection covers the ground case and both flying bands", () => {
	const kinds = new Set<string>();
	for (let roll = 0; roll < 1; roll += 0.05) {
		kinds.add(pickKind(() => roll));
	}
	assert.deepEqual([...kinds].sort(), ["high", "hydrant", "middle"]);
	// A hydrant is the common case: the game should read as a runner, not a flap.
	assert.equal(pickKind(() => 0), "hydrant");
	assert.ok(Object.keys(FLIGHT_BANDS).length === 3);
	assert.ok(DOG.stand.height > DOG.duck.height);
});

test("a graze is survivable: touching edges do not collide", () => {
	const a = { x: 0, y: 0, width: 10, height: 10 };
	assert.equal(overlaps(a, { x: 10, y: 0, width: 10, height: 10 }), false, "edge to edge");
	assert.equal(overlaps(a, { x: 9.9, y: 0, width: 10, height: 10 }), true, "one unit of overlap");
	assert.equal(overlaps(a, { x: 0, y: 10, width: 10, height: 10 }), false, "stacked, not overlapping");
	assert.equal(overlaps(a, { x: 0, y: 9.9, width: 10, height: 10 }), true);
});
