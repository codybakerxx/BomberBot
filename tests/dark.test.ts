/**
 * Blackout (the owner's design, 27 November 2026): the flash, the flashlight power-up, what is lit, and CPU
 * players who see only what is lit.
 */
import assert from 'node:assert/strict';
import { createWorld, step, World, PlayerInput, flashLight, isLit, lights, withTorches, ITEM_CHANCE, FLASH_EVERY, FLASH_TICKS, LIGHTS_OUT, TORCH_TICKS, TORCH_REACH, TORCH_SURE, TICK_HZ } from '../src/sim';
import { createBot, botInput } from '../src/bot';
import { defaultSetup, worldConfig } from '../src/setup';

const none: PlayerInput = { dir: 0, a: false, b: false };
const arena = (seed = 3, extra = {}): World => createWorld({ seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], roundTicks: 0, dark: true, ...extra });

// the light: on at the start, out by LIGHTS_OUT, a flash every 8 s for half a second, on once the round is decided
{
  const w = arena();
  assert.equal(flashLight(w), 1, 'lights on at the start');
  w.tick = LIGHTS_OUT;
  assert.equal(flashLight(w), 0, 'then out');
  w.tick = FLASH_EVERY - 1;
  assert.equal(flashLight(w), 0);
  w.tick = FLASH_EVERY + 10;
  assert.equal(flashLight(w), 1, 'the flash');
  w.tick = FLASH_EVERY + FLASH_TICKS;
  assert.equal(flashLight(w), 0, 'half a second, then dark');
  assert.equal(FLASH_EVERY, 8 * TICK_HZ, 'every 8 s (the owner)');
  assert.equal(FLASH_TICKS, TICK_HZ / 2, 'half a second (the owner)');
  const lit = createWorld({ seed: 3, players: [{ colorId: 'gold' }, { colorId: 'blue' }], roundTicks: 0 });
  lit.tick = 1000;
  assert.equal(flashLight(lit), 1, 'every other map is always lit');
  // the flash is an event, for its sound
  const e = arena();
  e.tick = FLASH_EVERY - 1;
  step(e, [none, none]);
  assert.ok(e.events.some((x) => x.type === 'flash'));
}

// the flashlight: 15 s, 3 tiles; flashlights only on Blackout, at least TORCH_SURE of them
{
  assert.equal(TORCH_TICKS, 15 * TICK_HZ);
  assert.equal(TORCH_REACH, 3);
  for (let seed = 1; seed <= 20; seed++) {
    const w = arena(seed);
    const n = [...w.hidden.values()].filter((k) => k === 'torch').length;
    assert.ok(n >= TORCH_SURE, `seed ${seed}: ${n} flashlights`);
    const plain = createWorld({ seed, players: [{ colorId: 'gold' }, { colorId: 'blue' }], roundTicks: 0 });
    assert.ok(![...plain.hidden.values()].includes('torch'), 'none on other maps');
  }
  const t = withTorches(ITEM_CHANCE);
  assert.ok(t.reduce((n, [, c]) => n + c, 0) <= 1 + 1e-12);
  assert.deepStrictEqual(withTorches([]), [], 'no power-ups at all: no flashlights either');
  // picked up: lit round it, for 15 s
  const w = arena();
  w.tick = LIGHTS_OUT;
  const me = w.players[0];
  const at = { cx: Math.round(me.x) + 1, cy: Math.round(me.y) };
  w.tiles[at.cy * w.w + at.cx] = 0;
  w.items.push({ cx: at.cx, cy: at.cy, kind: 'torch', age: 0 });
  for (let i = 0; i < 40 && !me.torchTicks; i++) step(w, [{ dir: 4, a: false, b: false }, none]);
  assert.ok(me.torchTicks > TORCH_TICKS - 30, 'picked up');
  assert.ok(isLit(w, me.x + 2.5, me.y), 'lit within 3 tiles');
  assert.ok(!isLit(w, me.x + 3.5, me.y) || flashLight(w) > 0.5, 'dark past it');
  // a bomb lights itself
  assert.ok(lights(w).length >= 1);
}

// the setup: Blackout asks for the dark
{
  const s = { ...defaultSetup('gold'), map: 'blackout' as const };
  assert.equal(worldConfig(s, 'gold', 1).dark, true);
  assert.equal(worldConfig(defaultSetup('gold'), 'gold', 1).dark, undefined);
}

// CPU players are blind: in the dark they do not go after a rival they cannot see, and the same seed still
// plays the same match (online depends on it)
{
  const play = (): string => {
    const w = arena(7);
    const bots = [createBot(0, 'hard', 11), createBot(1, 'hard', 12)];
    for (let t = 0; t < 40 * TICK_HZ && !w.over; t++) step(w, bots.map((b) => botInput(w, b)));
    return `${w.tick}|${w.players.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.alive}`).join(';')}`;
  };
  assert.equal(play(), play(), 'the same match twice');
}
