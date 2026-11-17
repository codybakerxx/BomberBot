"""
Saves the game's icon as PNG pictures for a phone's home screen and for installing the game as an app:
public/icon-180.png (iPhone), icon-192.png and icon-512.png (Android and the rest). The picture is the game's
own (drawIcon in src/title.ts: a small version of the title screen), drawn by the built game in Chrome.
build.mjs copies public/ into dist/. Run it again after changing the icon:

    npm run build && CHROME=/usr/bin/google-chrome python3 tools/icons.py
"""
import asyncio, base64, os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public"


async def main():
    async with async_playwright() as p:
        chrome = os.environ.get("CHROME")
        browser = await p.chromium.launch(executable_path=chrome, args=["--no-sandbox"]) if chrome else await p.chromium.launch()
        page = await browser.new_page()
        await page.goto((ROOT / "dist" / "index.html").as_uri())
        await page.wait_for_timeout(600)  # the font, and the robots' pictures
        OUT.mkdir(exist_ok=True)
        for size in (180, 192, 512):
            await page.evaluate(f"__game.icon({size})")  # once to make the robots' pictures at this size
            data = await page.evaluate(f"__game.icon({size})")
            (OUT / f"icon-{size}.png").write_bytes(base64.b64decode(data.split(",", 1)[1]))
        await browser.close()
    print("saved", ", ".join(sorted(f.name for f in OUT.glob("icon-*.png"))))


asyncio.run(main())
