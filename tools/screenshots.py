"""
Retakes the screenshots used in the documentation (docs/screenshots/).

It opens the built game in a phone-sized browser window, drives it with
simulated touches and key presses, and saves five pictures: the menu, a round
in progress, the two Match my thumb screens, and the sideways layout.

This is optional tooling, not part of the game. It needs Python 3 with the
"playwright" package and a Chrome or Chromium browser:

    pip install playwright
    npm run build
    python3 tools/screenshots.py

If Playwright cannot find a browser, point it at one:

    CHROME=/usr/bin/google-chrome python3 tools/screenshots.py
"""
import asyncio
import math
import os
import pathlib

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = (ROOT / "dist" / "index.html").as_uri()
OUT = ROOT / "docs" / "screenshots"

# screen angle of each direction (1 up, 2 down, 3 left, 4 right), anticlockwise from "right"
ANGLE = {1: 90, 2: 270, 3: 180, 4: 0}
# the order Match my thumb asks for (TEACH_ORDER in src/teach.ts)
ORDER = [3, 1, 4, 2, 4, 3, 2, 1, 3, 2, 1, 4]


class Thumb:
    """One simulated finger on the swipe pad."""

    def __init__(self, page, cdp, x, y):
        self.page, self.cdp, self.x, self.y = page, cdp, x, y

    async def _send(self, kind):
        points = [] if kind == "touchEnd" else [{"x": self.x, "y": self.y}]
        await self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})

    async def down(self):
        await self._send("touchStart")

    async def up(self):
        await self._send("touchEnd")

    async def stroke(self, degrees, length=46, ms=80):
        """A quick straight swipe."""
        steps = max(1, round(ms / 8))
        x0, y0 = self.x, self.y
        for i in range(1, steps + 1):
            self.x = x0 + length * math.cos(math.radians(degrees)) * i / steps
            self.y = y0 - length * math.sin(math.radians(degrees)) * i / steps
            await self._send("touchMove")
            await self.page.wait_for_timeout(8)

    async def drift_to(self, x, y):
        """Creep back slowly. The pad ignores slow drift, so this registers nothing."""
        dx, dy = x - self.x, y - self.y
        steps = int(math.hypot(dx, dy) / 3) + 1
        for _ in range(steps):
            self.x += dx / steps
            self.y += dy / steps
            await self._send("touchMove")
            await self.page.wait_for_timeout(90)


async def phone(browser, width, height):
    context = await browser.new_context(
        viewport={"width": width, "height": height}, device_scale_factor=2, has_touch=True, is_mobile=True
    )
    page = await context.new_page()
    await page.goto(PAGE)
    await page.wait_for_timeout(400)
    return context, page


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        chrome = os.environ.get("CHROME")
        browser = await p.chromium.launch(executable_path=chrome, args=["--no-sandbox"]) if chrome else await p.chromium.launch()

        # --- upright phone: menu
        context, page = await phone(browser, 393, 740)
        await page.screenshot(path=str(OUT / "menu.png"))

        # --- Match my thumb: the prompt, then twelve swipes leaning 30 degrees clockwise
        await page.tap("#matchStart")
        await page.wait_for_timeout(200)
        cdp = await context.new_cdp_session(page)
        thumb = Thumb(page, cdp, 130, 600)
        await thumb.down()
        await page.wait_for_timeout(200)
        await page.screenshot(path=str(OUT / "match-prompt.png"))
        wobble = [5, -6, 3, -2, 7, -4, 0, 6, -7, 2, -3, 4]
        for want, extra in zip(ORDER, wobble):
            await thumb.drift_to(130, 600)
            await page.wait_for_timeout(220)
            await thumb.stroke(ANGLE[want] - 30 + extra)
            await page.wait_for_timeout(260)
        await thumb.up()
        await page.wait_for_timeout(200)
        await page.screenshot(path=str(OUT / "match-result.png"))
        await page.tap("#teachClose")
        await page.tap("#matchReset")  # leave the saved setting as standard

        # --- a round in progress: power-ups in the open, a blast along the top row
        await page.tap("#play")
        await page.wait_for_timeout(200)
        await page.evaluate(
            """() => {
              const w = __game.world, open = (x, y) => { w.tiles[y * w.w + x] = 0; w.hidden.delete(y * w.w + x); };
              for (const [x, y] of [[2,1],[3,1],[4,1],[5,1],[7,1],[1,2],[1,3],[1,5],[3,3],[5,3],[2,3],[4,3]]) open(x, y);
              const item = (x, y, kind) => w.items.push({ cx: x, cy: y, kind, age: 20 });
              item(7, 1, 'bomb'); item(1, 5, 'fire'); item(3, 3, 'speed'); item(5, 3, 'kick'); item(4, 3, 'grab');
            }"""
        )
        async def hold(key, until):
            await page.keyboard.down(key)
            for _ in range(200):
                if await page.evaluate(until):
                    break
                await page.wait_for_timeout(10)
            await page.keyboard.up(key)

        await hold("ArrowRight", "__game.world.players[0].x >= 3")
        await page.keyboard.down("Space")
        await page.wait_for_timeout(60)
        await page.keyboard.up("Space")
        await hold("ArrowLeft", "__game.world.players[0].x <= 1")
        await hold("ArrowDown", "__game.world.players[0].y >= 3")
        for _ in range(400):
            if await page.evaluate("__game.world.flames.length > 0 && __game.world.flames[0].ttl < 22"):
                break
            await page.wait_for_timeout(10)
        await page.screenshot(path=str(OUT / "play.png"))
        await context.close()

        # --- the same game held sideways
        context, page = await phone(browser, 844, 390)
        await page.tap("#play")
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT / "sideways.png"))
        await context.close()
        await browser.close()
    print("saved", ", ".join(sorted(f.name for f in OUT.glob("*.png"))))


asyncio.run(main())
