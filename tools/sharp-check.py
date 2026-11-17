"""
Checks the guard that keeps the arena sharp (keepSharp and checkSharp in src/main.ts), by doing to a page
what makes an arena go soft and reading back what the game did about it:

- a normal phone screen (density 3) and one with a fractional density (2.625): drawn pixel for pixel;
- the page zoomed (as a pinch, a page shrunk to fit, or the app showing it would): the arena is drawn again
  with the pixels the zoom needs, once the zoom holds still, and not on every frame of a pinch;
- the page moved by part of a pixel under the arena: the arena is moved onto the screen's pixel grid;
- the arena stretched by something the game cannot undo: it says so (Settings > Graphics shows it) and
  stops trying after a few goes.

It cannot show that an iPhone is sharp: only an iPhone can. It shows the guard does what it is meant to.

Optional tooling, not part of the game. It needs Python 3 with the "playwright" package and a Chrome or
Chromium browser (see tools/screenshots.py):

    npm run build
    python3 tools/sharp-check.py

If Playwright cannot find a browser: CHROME=/usr/bin/google-chrome python3 tools/sharp-check.py
"""
import asyncio
import os
import pathlib
import sys

from playwright.async_api import async_playwright

PAGE = (pathlib.Path(__file__).resolve().parent.parent / "dist" / "index.html").as_uri()


async def launch(p):
    chrome = os.environ.get("CHROME")
    return await p.chromium.launch(executable_path=chrome, args=["--no-sandbox"]) if chrome else await p.chromium.launch()

GEO = "(() => { const c=document.getElementById('cv'), r=c.getBoundingClientRect(); return {w:c.width, cssW:+r.width.toFixed(3), left:+r.left.toFixed(4), top:+r.top.toFixed(4), ir:getComputedStyle(c).imageRendering, sharp:__game.sharp}; })()"
FAILS = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        FAILS.append(what)


async def start(pg):
    await pg.goto(PAGE)
    await pg.wait_for_timeout(500)
    await pg.tap("#titleLocal")
    await pg.tap("#colOk")
    await pg.tap("#colOk")
    await pg.evaluate("document.getElementById('lobbyStart').click()")
    await pg.wait_for_timeout(1500)


async def main():
    async with async_playwright() as p:
        b = await launch(p)
        for dsf in (3, 2.625):
            ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=dsf, has_touch=True, is_mobile=True)
            # (a page cannot be pinched from here, so the zoom the browser reports is put in by hand)
            await ctx.add_init_script("window.__z = 1; Object.defineProperty(window.visualViewport, 'scale', { get: () => window.__z });")
            pg = await ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            await start(pg)
            g = await pg.evaluate(GEO)
            check(g["sharp"]["ok"] and abs(g["w"] / g["cssW"] - dsf) < 0.01 and g["ir"] == "pixelated", f"density {dsf}: drawn pixel for pixel ({g['sharp']['text']})")
            for z in (1.25, 0.97):
                await pg.evaluate(f"window.__z = {z}")
                await pg.wait_for_timeout(1500)
                g = await pg.evaluate(GEO)
                check(g["sharp"]["ok"] and abs(g["w"] / g["cssW"] - dsf * z) < 0.02, f"  page zoomed x{z}: drawn at {g['w'] / g['cssW']:.2f} to the page pixel ({g['sharp']['text']})")
            await pg.evaluate("window.__z = 1.003")
            await pg.wait_for_timeout(1200)
            g = await pg.evaluate(GEO)
            check(g["sharp"]["zoom"] == 1 and abs(g["w"] / g["cssW"] - dsf) < 0.01, "  a zoom within half a per cent of 1 is 1")
            await pg.evaluate("window.__n = 0; const c = document.getElementById('cv'); const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width'); Object.defineProperty(c, 'width', { get() { return d.get.call(this); }, set(v) { window.__n++; d.set.call(this, v); } }); let t = 0; window.__pinch = setInterval(() => { window.__z = 1 + (++t % 40) / 50; }, 16);")
            await pg.wait_for_timeout(2000)
            n = await pg.evaluate("window.__n")
            check(n <= 2, f"  a pinch in progress does not have the arena made again every frame ({n} times in 2 s)")
            await pg.evaluate("clearInterval(window.__pinch); window.__z = 1")
            await pg.wait_for_timeout(1200)
            await pg.add_style_tag(content="html { transform: translate(0.4px, 0.27px); }")
            await pg.wait_for_timeout(2500)
            g = await pg.evaluate(GEO)
            off = max(abs((g["left"] * dsf + 0.5) % 1 - 0.5), abs((g["top"] * dsf + 0.5) % 1 - 0.5))
            check(g["sharp"]["ok"] and off < 0.05, f"  page moved by part of a pixel: the arena is back on the grid ({off:.3f} of a pixel off)")
            await pg.evaluate("document.querySelector('style:last-of-type').remove()")
            await pg.wait_for_timeout(2500)
            g = await pg.evaluate(GEO)
            check(g["sharp"]["ok"], "  and again when the page moves back")
            await pg.add_style_tag(content="#cv { width: 300px !important; }")
            await pg.wait_for_timeout(4000)
            g = await pg.evaluate(GEO)
            check(not g["sharp"]["ok"] and "than it is drawn" in g["sharp"]["text"] and g["sharp"]["tries"] <= 4, f"  stretched beyond its reach: it says so and stops trying ({g['sharp']['text']})")
            check(not errs, "  no errors")
            await ctx.close()
        await b.close()
    print("sharp check:", "all ok" if not FAILS else FAILS)
    sys.exit(1 if FAILS else 0)


asyncio.run(main())
