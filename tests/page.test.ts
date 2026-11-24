/**
 * Checks of src/page.html that keep the arena sharp on an iPhone (the blur of November 2026; tools/webkit-check.py
 * shows it in WebKit itself). WebKit puts a canvas whose CSS size equals its pixel size (any canvas before the
 * game has sized it: 300 x 150) on a layer without the screen's density, if the canvas has a layer of its own,
 * as every position: fixed element has on an iPhone; and the layer keeps that scale after the canvas is sized.
 * So:
 * - every position: fixed canvas is hidden (html.booting) until main.ts has sized it, right after the first layout;
 * - the arena canvas has a background, which keeps WebKit from ever using that layer for it.
 * Run with: npm test
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/page.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const css = page.slice(page.indexOf('<style>'), page.indexOf('</style>'));

// the page starts booting
assert.match(page, /<html[^>]*\bclass="booting"/, '<html> starts with class "booting"');

// the canvases with a layer of their own: every <canvas id> whose own rule is position: fixed
const ids = [...page.matchAll(/<canvas id="([\w-]+)"/g)].map((m) => m[1]);
const fixed = ids.filter((id) => new RegExp(`(^|[\\s,}])#${id}\\s*\\{[^}]*position:\\s*fixed`).test(css));
assert.ok(fixed.includes('cv') && fixed.includes('score') && fixed.includes('ghosts'), `the fixed canvases are found (${fixed.join(', ')})`);

// ...are all hidden while booting
const booting = css.match(/((?:html\.booting #[\w-]+\s*,?\s*)+)\{\s*display:\s*none\s*!important;?\s*\}/);
assert.ok(booting, 'there is a rule hiding canvases while the page boots');
const hidden = [...booting![1].matchAll(/#([\w-]+)/g)].map((m) => m[1]);
for (const id of fixed) assert.ok(hidden.includes(id), `#${id} (position: fixed) is hidden while booting: add it to the html.booting rule`);

// the arena canvas has a background
const cv = css.match(/#cv\s*\{([^}]*)\}/);
assert.ok(cv && /background(-color)?:\s*(?!transparent|none)[^;]+;/.test(cv[1]), '#cv has a background (it keeps WebKit from showing it on a layer without the screen density)');

// main.ts takes "booting" off once the first layout has sized the canvases, and not before
const first = main.indexOf('\nlayout();');
const off = main.indexOf("document.documentElement.classList.remove('booting')");
assert.ok(first > 0 && off > first, 'main.ts removes "booting" after the first layout()');
assert.ok(main.lastIndexOf('\nnewWorld();', off) > 0 && main.slice(first, off).split('\n').length < 6, '...right after it');

// Short class names that pieces of the page add for a moment (the P1 tag's and the presence dot's `pop`, a
// button's `flash`) have no rule of their own: a panel once borrowed `.pop` for its look, and the P1 tag under
// your colour stretched into a long box when Ready made it pop (24 November 2026).
for (const name of ['pop']) {
  assert.ok(!new RegExp(`(^|[\\s,}])\\.${name}\\s*[{,\\[]`).test(css), `no rule styles .${name} on its own (only with the element it is added to)`);
}

console.log('page checks passed');
