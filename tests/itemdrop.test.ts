/**
 * Item Drop (the owner's ask, 24 November 2026): a robot knocked out drops the power-ups it collected, round
 * where it fell, for anyone to pick up. And the quick chat's lines.
 */
import assert from 'node:assert';
import { createWorld, step, FLAME_TICKS, FLOOR, DROP_REACH, World } from '../src/sim';
import { CHAT_MAX, cleanChat } from '../src/net';
import { CHAT_GROUPS } from '../src/quick';
import { defaultSetup, itemDropRules, modeOf, readSetup, rollRules, worldConfig, ITEM_DROP_SHARE } from '../src/setup';
import { makeRng } from '../src/sim';
import { COLORS } from '../src/render';

function arena(itemDrop: boolean): World {
  return createWorld({ seed: 3, softDensity: 0, roundTicks: 0, players: [{ colorId: 'a' }, { colorId: 'b' }, { colorId: 'c' }], itemDrop });
}
/** Give player 0 two extra bombs, a flame, a speed, the boot and the glove, then knock it out where it stands. */
function knock(w: World): { x: number; y: number } {
  const p = w.players[0];
  p.bombsMax += 2;
  p.fire += 1;
  p.speed += 1;
  p.canKick = true;
  p.canGrab = true;
  const at = { x: Math.round(p.x), y: Math.round(p.y) };
  w.flames.push({ cx: at.x, cy: at.y, ttl: FLAME_TICKS, owner: 1, kind: 'c', tip: 0 });
  step(w, []);
  assert.ok(!w.players[0].alive, 'knocked out');
  return at;
}

{
  const w = arena(true);
  const at = knock(w);
  const kinds = w.items.map((it) => it.kind).sort();
  assert.deepStrictEqual(kinds, ['bomb', 'bomb', 'fire', 'grab', 'kick', 'speed'], 'everything it collected, and nothing it started with');
  const tiles = new Set(w.items.map((it) => `${it.cx},${it.cy}`));
  assert.equal(tiles.size, w.items.length, 'one to a tile');
  for (const it of w.items) {
    assert.equal(w.tiles[it.cy * w.w + it.cx], FLOOR, 'on open floor');
    assert.ok(Math.abs(it.cx - at.x) + Math.abs(it.cy - at.y) <= DROP_REACH, 'near where it fell');
  }
  // they stay through the blast that knocked it out
  for (let i = 0; i < FLAME_TICKS + 5; i++) step(w, []);
  assert.equal(w.items.length, 6, 'still there once the blast has gone');
  // and anyone may pick them up: player 1 walked onto one
  const it = w.items[0];
  const q = w.players[1];
  q.x = it.cx;
  q.y = it.cy;
  step(w, []);
  assert.equal(w.items.length, 5, 'picked up by another robot');
}
{
  const w = arena(false);
  knock(w);
  assert.equal(w.items.length, 0, 'Item drop off: the power-ups go with it');
}
{
  // a robot with only its starting kit drops nothing
  const w = arena(true);
  w.flames.push({ cx: Math.round(w.players[0].x), cy: Math.round(w.players[0].y), ttl: FLAME_TICKS, owner: 1, kind: 'c', tip: 0 });
  step(w, []);
  assert.equal(w.items.length, 0, 'nothing collected, nothing dropped');
}

// the mode: Classic with Item drop on and power-ups much rarer; it survives being saved and sent
{
  const me = 'gold';
  const s = defaultSetup(me);
  assert.ok(!s.itemDrop, 'off by default');
  const d = itemDropRules(s, me);
  assert.equal(modeOf(d, me), 'itemdrop');
  assert.ok(d.itemDrop && d.itemShare === ITEM_DROP_SHARE && ITEM_DROP_SHARE < s.itemShare, 'Item drop on, power-ups rarer');
  assert.ok(worldConfig(d, me, 1).itemDrop, 'the round is told');
  const back = readSetup(JSON.parse(JSON.stringify(d)), me, COLORS.map((c) => c.id));
  assert.equal(modeOf(back, me), 'itemdrop', 'kept when saved');
  const on = { ...s, itemDrop: true };
  assert.equal(modeOf(on, me), 'custom', 'switched on by hand with the usual density: Custom');
  let seen = false;
  for (let i = 0; i < 40; i++) seen ||= rollRules(s, makeRng(i)).itemDrop;
  assert.ok(seen, 'Random sometimes switches it on');
}

// quick chat: five groups, the last one Custom; lines tidied and kept short
{
  assert.equal(CHAT_GROUPS.length, 5);
  assert.equal(CHAT_GROUPS[4].lines.length, 0, 'Custom has a box, not lines');
  for (const g of CHAT_GROUPS.slice(0, 4)) {
    assert.equal(g.lines.length, 4, `${g.name}: four lines`);
    for (const l of g.lines) assert.equal(cleanChat(l), l, `"${l}" is sent as it is (${CHAT_MAX} characters at most)`);
  }
  assert.equal(cleanChat('  hi\n\tthere  '), 'hi there');
  assert.equal(cleanChat('x'.repeat(100)).length, CHAT_MAX);
  assert.equal(cleanChat('   '), '');
  assert.equal(cleanChat(42), '');
}

console.log('item drop and chat checks passed');
