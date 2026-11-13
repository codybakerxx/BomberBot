"""
Retakes the screenshots used in the documentation (docs/screenshots/).

It opens the built game in a phone-sized browser window, drives it with
simulated touches and key presses, and saves the pictures: the title screen (upright and sideways), the menu and its
Controls tab (on Standard, and on My thumb), the right-thumb layout, the menu
opened mid-round, a round in progress, the Match my thumb screens, the
sideways layout, a close-up of the power-ups, blocks falling after the
timer reaches 0, the knocked-out animation, and the end of a round.

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
REPORT_TEXT = None
# the order Match my thumb asks for: twelve learning swipes, then eight test swipes
# (TEACH_ORDER and TEST_ORDER in src/teach.ts)
ORDER = [3, 1, 4, 2, 4, 3, 2, 1, 3, 2, 1, 4] + [2, 4, 1, 3, 3, 1, 4, 2]


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


async def phone(browser, width, height, title=None):
    """A phone-sized page with the game open. The game opens on the title screen: it is saved as `title`
    (once the robot is waving) if given, then Local is tapped, which leads to the menu."""
    context = await browser.new_context(
        viewport={"width": width, "height": height}, device_scale_factor=2, has_touch=True, is_mobile=True
    )
    page = await context.new_page()
    await page.goto(PAGE)
    await page.wait_for_timeout(400)
    if title:
        await page.wait_for_timeout(1800)  # the first wave (WAVE_FIRST in src/title.ts)
        await page.screenshot(path=str(OUT / title))
    await page.tap("#titleLocal")
    await page.wait_for_timeout(100)
    return context, page


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        chrome = os.environ.get("CHROME")
        browser = await p.chromium.launch(executable_path=chrome, args=["--no-sandbox"]) if chrome else await p.chromium.launch()

        # --- upright phone: menu
        context, page = await phone(browser, 393, 740, title="title.png")
        await page.screenshot(path=str(OUT / "menu.png"))
        await page.tap("#tabControls")
        await page.wait_for_timeout(100)
        await page.screenshot(path=str(OUT / "menu-controls.png"))
        await page.locator("#paneControls").screenshot(path=str(OUT / "menu-settings.png"))

        # --- Match my thumb: the prompt, then twenty swipes leaning about 30 degrees clockwise.
        # Sideways swipes lean a little more than up and down ones, as many thumbs do.
        await page.tap("#dirMine")  # no match saved yet, so this starts the matching
        await page.wait_for_timeout(200)
        cdp = await context.new_cdp_session(page)
        thumb = Thumb(page, cdp, 130, 600)
        await thumb.down()
        await page.wait_for_timeout(200)
        await page.screenshot(path=str(OUT / "match-prompt.png"))
        wobble = [5, -6, 3, -2, 7, -4, 0, 6, -7, 2, -3, 4, -5, 3, 6, -2, 4, -6, 1, -3]
        extra_lean = {1: -6, 2: -6, 3: 6, 4: 6}
        for i, (want, extra) in enumerate(zip(ORDER, wobble)):
            await thumb.drift_to(130, 600)
            await page.wait_for_timeout(220)
            await thumb.stroke(ANGLE[want] - 30 - extra_lean[want] + extra)
            await page.wait_for_timeout(260)
            if i == 12:
                await page.screenshot(path=str(OUT / "match-test.png"))
        await thumb.up()
        await page.wait_for_timeout(200)
        await page.screenshot(path=str(OUT / "match-result.png"))
        global REPORT_TEXT
        REPORT_TEXT = await page.evaluate(
            """() => {
              const t = document.getElementById('teach'), c = t.querySelector('.teach-card');
              return { text: c.innerText.replace(/\\n+/g, ' | '), panel: t.clientHeight, content: c.scrollHeight };
            }"""
        )
        await page.tap("#teachClose")
        await page.wait_for_timeout(150)
        await page.locator("#paneControls").screenshot(path=str(OUT / "menu-settings-matched.png"))
        await page.tap("#tabMain")

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

        # --- right thumb steering: the controls mirrored
        context, page = await phone(browser, 393, 740)
        await page.tap("#tabControls")
        await page.tap("#handRight")
        await page.tap("#tabMain")
        await page.tap("#play")
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT / "right-thumb.png"))
        # --- and the menu as it looks when opened in the middle of a round
        await page.tap("#menuBtn")
        await page.wait_for_timeout(150)
        await page.screenshot(path=str(OUT / "menu-paused.png"))
        await context.close()

        # --- the same game held sideways
        context, page = await phone(browser, 844, 390, title="title-sideways.png")
        await page.tap("#play")
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT / "sideways.png"))
        await context.close()

        # --- the seven power-ups in a row, and what a shield and a curse look like on a robot
        context, page = await phone(browser, 393, 740)
        await page.tap("#play")
        await page.wait_for_timeout(200)
        await page.evaluate(
            """() => {
              const w = __game.world;
              for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] === 2) w.tiles[i] = 0;
              __game.bots.length = 0;  // the CPU players stand still for the picture
              ['bomb', 'fire', 'speed', 'kick', 'grab', 'shield', 'curse'].forEach((kind, i) => w.items.push({ cx: 3 + i, cy: 1, kind, age: 20 }));
              const [a, b, c, d] = w.players;
              Object.assign(a, { x: 3, y: 3, facing: 2, shieldTicks: 1500 });            // shield up
              Object.assign(b, { x: 5, y: 3, facing: 2, curseTicks: 400 });              // cursed
              Object.assign(c, { x: 7, y: 3, facing: 2, shieldTicks: 1500, curseTicks: 400 });  // both
              Object.assign(d, { x: 9, y: 3, facing: 2, graceTicks: 18 });               // a shield just used up
            }"""
        )
        await page.wait_for_timeout(80)
        box = await page.locator("#cv").bounding_box()
        await page.screenshot(
            path=str(OUT / "power-ups.png"),
            clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": box["height"] * 0.42},
        )
        await context.close()

        # --- after the timer reaches 0: blocks falling round the edge
        context, page = await phone(browser, 393, 740)
        await page.tap("#play")
        await page.wait_for_timeout(200)
        await page.evaluate(
            """() => {
              const w = __game.world;
              __game.bots.length = 0;  // the CPU players stand still for the picture
              for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] === 2 && (i * 7) % 3) { w.tiles[i] = 0; w.hidden.delete(i); }
              [[7, 5], [5, 7], [9, 7], [7, 3]].forEach(([x, y], i) => Object.assign(w.players[i], { x, y, facing: 2 }));
              w.tick = w.roundTicks + 16 * 60;  // 16 seconds after 0:00: the blocks due by now land at once
            }"""
        )
        await page.wait_for_timeout(1300)
        box = await page.locator("#cv").bounding_box()
        await page.screenshot(
            path=str(OUT / "falling-blocks.png"),
            clip={"x": 0, "y": 0, "width": 393, "height": box["y"] + box["height"] + 4},
        )
        await context.close()

        # --- knocked out, then the round won: three robots caught a third of a second apart, so the
        # picture shows three moments of the knocked-out animation; then the winner and the result panel
        context, page = await phone(browser, 393, 740)
        await page.tap("#play")
        await page.wait_for_timeout(200)
        await page.evaluate(
            """() => {
              const w = __game.world;
              __game.bots.length = 0;
              for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] === 2) w.tiles[i] = 0;
              [[3, 5], [5, 5], [7, 5], [9, 5]].forEach(([x, y], i) => Object.assign(w.players[i], { x, y, facing: 2 }));
              window.blast = (i) => { const p = w.players[i]; w.flames.push({ cx: p.x, cy: p.y, ttl: 8, owner: 0, kind: 'c', tip: 0 }); };
            }"""
        )
        for i in (3, 2, 1):
            await page.evaluate(f"blast({i})")
            await page.wait_for_timeout(330)
        box = await page.locator("#cv").bounding_box()
        await page.screenshot(
            path=str(OUT / "knocked-out.png"),
            clip={"x": 0, "y": 0, "width": 393, "height": box["y"] + box["height"] * 0.62},
        )
        await page.wait_for_timeout(1250)  # the round is decided, and the winner is at the top of its jump
        await page.screenshot(path=str(OUT / "round-won.png"))
        await context.close()
        await browser.close()
    print("saved", ", ".join(sorted(f.name for f in OUT.glob("*.png"))))
    if os.environ.get("REPORT"):
        print("result panel:", REPORT_TEXT)


asyncio.run(main())
