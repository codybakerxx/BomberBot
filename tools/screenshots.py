"""
Retakes the screenshots used in the documentation (docs/screenshots/).

It opens the built game in a phone-sized browser window, drives it with
simulated touches and key presses, and saves the pictures: the title screen (upright and sideways), the lobby, Settings, the menu and its
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


async def start_round(page):
    """From the lobby (as a fresh visit leaves it, on the Players page): Ready, Next ›, then Start."""
    if await page.evaluate("document.getElementById('lobbyMatch').hidden"):
        if await page.evaluate("document.getElementById('colOk').textContent") != "Next ›":
            await page.tap("#colOk")  # Ready
        await page.tap("#colOk")  # Next ›
    await page.tap("#lobbyStart")
    if await page.evaluate("!document.getElementById('confirm').hidden"):
        await page.tap("#confirmYes")


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

        # --- upright phone: the lobby's two pages (the player cards, then with teams on), then Settings
        context, page = await phone(browser, 393, 740, title="title.png")
        await page.screenshot(path=str(OUT / "lobby.png"))
        await page.evaluate("[...document.querySelectorAll('#lobby .opt-label')].find(e => e.textContent === 'Teams').click()")
        await page.evaluate("document.getElementById('slots').scrollIntoView({block: 'start'})")
        await page.wait_for_timeout(100)
        await page.screenshot(path=str(OUT / "lobby-cards.png"))
        await page.evaluate("[...document.querySelectorAll('#lobby .opt-label')].find(e => e.textContent === 'Teams').click()")
        await page.evaluate("document.querySelector('#lobby .scroll').scrollTop = 0")
        await page.tap("#colOk")
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(OUT / "lobby-ready.png"))
        await page.tap("#colOk")  # Next ›
        await page.wait_for_timeout(100)
        await page.screenshot(path=str(OUT / "lobby-match.png"))
        await page.tap("#lobbyPrev")
        await page.tap("#lobbySettings")
        await page.wait_for_timeout(100)
        await page.screenshot(path=str(OUT / "settings-sound.png"))
        await page.tap("#pgGraphics")
        await page.screenshot(path=str(OUT / "settings-graphics.png"))
        await page.tap("#pgGamepad")
        await page.wait_for_timeout(100)
        await page.screenshot(path=str(OUT / "settings-gamepad.png"))
        await page.tap("#pgControls")
        await page.wait_for_timeout(100)
        await page.screenshot(path=str(OUT / "settings-controls.png"))
        await page.locator("#setControls").screenshot(path=str(OUT / "menu-settings.png"))

        await page.tap("#setDone")

        # --- a round in progress: power-ups in the open, a blast along the top row
        await start_round(page)
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
        await page.tap("#lobbySettings")
        await page.tap("#pgControls")
        await page.tap("#handRight")
        await page.tap("#setDone")
        await start_round(page)
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT / "right-thumb.png"))
        # --- and the menu as it looks when opened in the middle of a round
        await page.tap("#menuBtn")
        await page.wait_for_timeout(150)
        await page.screenshot(path=str(OUT / "menu-paused.png"))
        await context.close()

        # --- the same game held sideways
        context, page = await phone(browser, 844, 390, title="title-sideways.png")
        await start_round(page)
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT / "sideways.png"))
        await context.close()

        # --- the power-ups in a row, and what a shield and a curse look like on a robot
        context, page = await phone(browser, 393, 740)
        await start_round(page)
        await page.wait_for_timeout(200)
        await page.evaluate(
            """() => {
              const w = __game.world;
              for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] === 2) w.tiles[i] = 0;
              __game.bots.length = 0;  // the CPU players stand still for the picture
              ['bomb', 'fire', 'speed', 'kick', 'grab', 'shield', 'curse', 'laptop', 'decoy', 'wire'].forEach((kind, i) => w.items.push({ cx: 2 + i, cy: 1, kind, age: 20 }));
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

        # --- decoys and trip wires: your robot with its two decoys, a wire strung across a lane, another set off
        context, page = await phone(browser, 393, 740)
        await start_round(page)
        await page.wait_for_timeout(200)
        await page.evaluate(
            """() => {
              const w = __game.world;
              __game.bots.length = 0;  // the CPU players stand still for the picture
              for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] === 2 && (i % 3 === 0 || i % 5 === 0)) { w.tiles[i] = 0; w.hidden.delete(i); }
              const clear = (x, y) => { w.tiles[y * w.w + x] = 0; w.hidden.delete(y * w.w + x); };
              for (const [x, y] of [[5, 5], [4, 5], [6, 5], [7, 5], [3, 5], [3, 4], [3, 3], [9, 3], [9, 4], [9, 5], [9, 6], [9, 7], [8, 7], [7, 7]]) clear(x, y);
              const [a, b, c, d] = w.players;
              Object.assign(a, { x: 5, y: 5, facing: 4, moving: true, walk: 1.2 });
              Object.assign(b, { x: 11, y: 1, facing: 2 });
              Object.assign(c, { x: 1, y: 9, facing: 2 });
              Object.assign(d, { x: 13, y: 11, facing: 1 });
              w.decoys.push({ ...a, x: 7, y: 5, mirror: false, born: w.tick - 100, until: w.tick + 600, popped: -1 });
              w.decoys.push({ ...a, x: 3.4, y: 5, facing: 3, mirror: true, born: w.tick - 100, until: w.tick + 600, popped: -1 });
              w.wires.push({ cx: 3, cy: 4, dir: 'h', owner: 1, armed: true, at: 0 });
              w.wires.push({ cx: 9, cy: 4, dir: 'h', owner: 0, armed: true, at: 0 });
              // a third, just set off: its fire down the whole lane
              w.players[2].wires = 0;
              const lane = []; for (let y = 1; y <= w.h - 2; y++) lane.push(y);
              for (const y of lane) if (w.tiles[y * w.w + 11] !== 1) w.flames.push({ cx: 11, cy: y, ttl: 27, owner: 2, kind: 'v', tip: y === 1 ? 1 : y === w.h - 2 ? 2 : 0, wire: true });
              Object.assign(b, { x: 13, y: 1 });
            }"""
        )
        await page.wait_for_timeout(60)
        box = await page.locator("#cv").bounding_box()
        await page.screenshot(path=str(OUT / "decoy-wire.png"), clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": box["height"]})
        await context.close()

        # --- after the timer reaches 0: blocks falling round the edge
        context, page = await phone(browser, 393, 740)
        await start_round(page)
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
        await start_round(page)
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

        # --- the Wild West map: picked on the Match page, then a round on it with a blast, power-ups and a train
        context, page = await phone(browser, 393, 740)
        await page.tap("#colOk")
        await page.tap("#colOk")  # Next ›
        await page.tap("#arenaNext")  # (the arrows go through the maps)
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT / "lobby-west.png"))
        await start_round(page)
        await page.wait_for_timeout(200)
        await page.evaluate(
            """() => {
              const w = __game.world, open = (x, y) => { w.tiles[y * w.w + x] = 0; w.hidden.delete(y * w.w + x); };
              for (const [x, y] of [[2,1],[3,1],[4,1],[5,1],[7,1],[1,2],[1,3],[1,5],[3,3],[5,3],[2,3],[4,3]]) open(x, y);
              const item = (x, y, kind) => w.items.push({ cx: x, cy: y, kind, age: 20 });
              item(7, 1, 'bomb'); item(1, 5, 'fire'); item(3, 3, 'speed'); item(5, 3, 'kick'); item(4, 3, 'grab');
              w.flames.push(...[[2,1,'h',3],[3,1,'c',0],[4,1,'h',0],[5,1,'h',4]].map(([cx, cy, kind, tip]) => ({ cx, cy, ttl: 20, owner: 0, kind, tip })));
              __game.bots.length = 0;
              // a train on the lower line across, mid-arena, its signals flashing (the railway: 25 November 2026)
              const enterAt = w.tick - 52;
              w.train = { line: 1, dir: 1, warnAt: enterAt - 150, enterAt, exitAt: enterAt + 200 };
            }"""
        )
        await page.wait_for_timeout(60)
        await page.screenshot(path=str(OUT / "play-west.png"))
        await context.close()

        # --- Frozen Lake (25 November 2026): the ice, a robot sliding to a stop, a bomb sliding, ice blocks breaking
        context, page = await phone(browser, 393, 740)
        await page.tap("#colOk")
        await page.tap("#colOk")  # Next ›
        await page.tap("#arenaNext")
        await page.wait_for_timeout(700)
        await page.tap("#arenaNext")
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT / "lobby-ice.png"))
        await start_round(page)
        await page.wait_for_timeout(200)
        await page.evaluate(
            """() => {
              const w = __game.world, open = (x, y) => { w.tiles[y * w.w + x] = 0; w.hidden.delete(y * w.w + x); };
              for (let x = 1; x < w.w - 1; x++) open(x, 1);
              for (const [x, y] of [[1,2],[1,3],[3,3],[5,3],[2,3],[4,3]]) open(x, y);
              __game.bots.length = 0;
              const me = w.players[0];
              me.x = 4.3; me.y = 1; me.slip = 0.07; me.slipDir = 4; me.facing = 3; me.moving = true; me.skid = true; me.speed = 4;
              w.bombs.push({ id: 900, owner: 1, x: 8.4, y: 1, cx: 8, cy: 1, fuse: 140, range: 2, age: 20, state: 'ground', slide: 4, speed: 0.06, heldBy: -1, lifted: true, fromX: 5, fromY: 1, flyDir: 4, flyDist: 3, flyT: 21 });
              w.players[1].activeBombs++;
              let n = 0;
              for (let i = 0; i < w.tiles.length && n < 3; i++) if (w.tiles[i] === 2 && Math.floor(i / w.w) > 4) { w.burning.push({ cx: i % w.w, cy: Math.floor(i / w.w), ttl: 12 }); n++; }
            }"""
        )
        await page.wait_for_timeout(50)
        await page.screenshot(path=str(OUT / "play-ice.png"))
        await context.close()

        # --- the Factory (26 November 2026): the belts, a robot and a bomb riding one, the alarm's beacons
        context, page = await phone(browser, 393, 740)
        await page.tap("#colOk")
        await page.tap("#colOk")  # Next ›
        for _ in range(3):
            await page.tap("#arenaNext")
            await page.wait_for_timeout(700)
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(OUT / "lobby-factory.png"))
        await start_round(page)
        await page.wait_for_timeout(200)
        await page.evaluate(
            """() => {
              const w = __game.world, open = (x, y) => { w.tiles[y * w.w + x] = 0; w.hidden.delete(y * w.w + x); };
              for (let x = 1; x < w.w - 1; x++) open(x, 3);
              for (const [x, y] of [[1,2],[2,1],[3,1],[3,2]]) open(x, y);
              __game.bots.length = 0;
              const me = w.players[0];
              me.x = 5.3; me.y = 3;
              w.bombs.push({ id: 901, owner: 1, x: 8.6, y: 3, cx: 9, cy: 3, fuse: 120, range: 2, age: 20, state: 'ground', slide: 0, speed: 0, heldBy: -1, lifted: false, fromX: 0, fromY: 0, flyDir: 0, flyDist: 0, flyT: 0 });
              w.players[1].activeBombs++;
              w.beltFlip = w.tick + 100; // the alarm sounding
            }"""
        )
        await page.wait_for_timeout(120)
        await page.screenshot(path=str(OUT / "play-factory.png"))
        await context.close()
        await browser.close()
    print("saved", ", ".join(sorted(f.name for f in OUT.glob("*.png"))))


asyncio.run(main())
