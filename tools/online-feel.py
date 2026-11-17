"""
How online play feels, measured: two browsers play each other through a made-up slow, uneven connection, and
the host's screen is watched frame by frame.

    npm run build && npx wrangler dev          # the game and its server on this computer, in another terminal
    CHROME=/usr/bin/google-chrome python3 tools/online-feel.py 35,25

The argument is the connection each way: milliseconds, then up to that many more at random (2% of messages
get a spike of 70 more). Try 5,2 (wired), 35,25 (a phone), 70,50 (a poor connection).

It prints, as seen on the host's screen:
  delay_ms  from a key press to the host's own robot starting that way (about 20 to 27 is one frame: the
            same as playing on this screen)
  own       the host's own robot while walking: frames it stood still (stalls) or leapt (jumps)
  other     the same for the friend's robot
  net       the connection: ping, how far the picture runs ahead, checksums, presses that arrived late

Set WHOLE_MS=1 to give the pages their frame times in whole milliseconds, as an iPhone's Safari does.

Needs Python with Playwright. docs/ONLINE.md has what it measured before and after the picture ran ahead.
"""
import asyncio, os, sys, json, statistics
from playwright.async_api import async_playwright
URL = os.environ.get("URL", "http://127.0.0.1:8787/")
LAT = sys.argv[1] if len(sys.argv) > 1 else "35,25"   # each way: base ms, jitter ms
SHIM = """
(() => {
  const [BASE, JIT] = '%s'.split(',').map(Number);
  const Real = window.WebSocket;
  const delay = () => BASE + Math.random() * JIT + (Math.random() < 0.02 ? 70 : 0);  // now and then a spike
  // messages stay in order, as they do on a real connection: one line each way, handed on when due
  window.WebSocket = class extends Real {
    constructor(u, p) {
      super(u, p);
      let outAt = 0, inAt = 0, handler = null;
      const out = [], inn = [];
      const send = super.send.bind(this);
      this.send = (d) => { outAt = Math.max(outAt, performance.now() + delay()); out.push([outAt, d]); };
      Object.defineProperty(this, 'onmessage', { set: (h) => { handler = h; }, get: () => handler });
      super.addEventListener('message', (e) => { inAt = Math.max(inAt, performance.now() + delay()); inn.push([inAt, e]); });
      const pump = () => {
        const t = performance.now();
        while (out.length && out[0][0] <= t) { const d = out.shift()[1]; if (this.readyState === 1) send(d); }
        while (inn.length && inn[0][0] <= t) { const e = inn.shift()[1]; handler && handler(e); }
      };
      const ch = new MessageChannel();   // (timers are too coarse: this comes round every millisecond or so)
      ch.port1.onmessage = () => { pump(); if (this.readyState <= 1) setTimeout(() => ch.port2.postMessage(0), 0); };
      ch.port2.postMessage(0);
    }
  };
})();
""" % LAT
# WHOLE_MS=1: frame times in whole milliseconds (17, 17, 16...), as an iPhone's Safari gives them
WHOLE_MS = "const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (f) => raf((t) => f(Math.round(t)));" if os.environ.get("WHOLE_MS") else ""
REC = """
window.__rec = []; window.__keys = [];
addEventListener('keydown', e => { if (!e.repeat) window.__keys.push([performance.now(), e.code]); }, true);
(function loop(){ const g = window.__game; if (g) { const w = g.view || g.world; if (w && w.players[1]) __rec.push([performance.now(), w.players[0].x, w.players[1].y]); } requestAnimationFrame(loop); })();
"""
async def main():
    async with async_playwright() as p:
        chrome = os.environ.get("CHROME")
        b = await p.chromium.launch(executable_path=chrome, args=["--no-sandbox"]) if chrome else await p.chromium.launch()
        hc = await b.new_context(viewport={"width": 390, "height": 844}); fc = await b.new_context(viewport={"width": 900, "height": 700})
        for c in (hc, fc): await c.add_init_script("localStorage.clear();" + WHOLE_MS + SHIM + REC)
        h = await hc.new_page(); f = await fc.new_page()
        await h.goto(URL); await h.wait_for_timeout(400)
        await h.click('#titleOnline'); await h.click('#onlineMake'); await h.wait_for_timeout(1200)
        code = await h.evaluate("__game.net.code")
        await f.goto(URL + "?room=" + code); await f.wait_for_timeout(300); await f.click('#onlineJoin'); await f.wait_for_timeout(1200)
        await h.evaluate("__game.net.send({t:'setup', setup: {...__game.setup, cpus: [], timerOn: false}})"); await h.wait_for_timeout(500)
        await h.evaluate("__game.net.send({t:'start'})"); await h.wait_for_timeout(2500)
        # the host walks right and left along the top row, the friend down and up, out of step with each other
        async def walk(pg, a, b_, n, ms):
            for i in range(n):
                k = a if i % 2 == 0 else b_
                await pg.keyboard.down(k); await pg.wait_for_timeout(ms); await pg.keyboard.up(k); await pg.wait_for_timeout(140)
        await asyncio.gather(walk(h, 'ArrowRight', 'ArrowLeft', 14, 330), walk(f, 'ArrowDown', 'ArrowUp', 14, 330))
        await h.wait_for_timeout(600)
        rec = await h.evaluate("__rec"); keys = await h.evaluate("__keys")
        stats = await h.evaluate("__game.net.stats()")
        await b.close()
    # how long after each key press the host's own robot first moves that way
    lat = []
    for t, code in keys:
        sign = 1 if code == 'ArrowRight' else -1 if code == 'ArrowLeft' else 0
        if not sign: continue
        prev = None
        for r in rec:
            if r[0] > t and prev is not None and (r[1] - prev[1]) * sign > 1e-6:
                if r[0] - t < 1000: lat.append(r[0] - t)
                break
            prev = r
    # evenness: within each stretch of walking, how many frames the robot stood still or leapt
    def even(col):
        d = [(c[0], abs(c[col] - a[col]) / max(1e-3, (c[0] - a[0]) / 16.667)) for a, c in zip(rec, rec[1:]) if c[0] - a[0] < 40]
        speed = statistics.median([v for _, v in d if v > 0.01] or [0.0425])
        runs, cur, still = [], [], 0
        for t, v in d:
            if v > 1e-6:
                cur.append(v); still = 0
            elif cur:
                still += 1
                if still >= 6:              # a tenth of a second standing: the walk is over
                    runs.append(cur[:len(cur) - still + 1]); cur, still = [], 0
                else: cur.append(0)
        frames = [v for r in runs for v in r if len(r) > 6]
        if len(frames) < 20: return None
        stalls = sum(1 for v in frames if v < speed * 0.25)
        jumps = sum(1 for v in frames if v > speed * 1.9)
        return dict(frames=len(frames), stalls=stalls, jumps=jumps, uneven=round(100 * (stalls + jumps) / len(frames), 1))
    print(json.dumps(dict(
        link=LAT, presses=len(lat),
        delay_ms=dict(median=round(statistics.median(lat)), worst=round(max(lat))) if lat else None,
        own=even(1), other=even(2), net=stats)))
asyncio.run(main())
