"""
Save large pictures of the robots as PNG files with transparent backgrounds,
for title screens and other artwork. Not part of the game.

    CHROME=/usr/bin/google-chrome python3 tools/portraits.py [out-folder] [--view front|back|right|left] [colour ...]

Needs Python with Playwright, Pillow, NumPy and SciPy, Chrome, and the
project's own node_modules (for esbuild). With no colours named it does white,
gold, black and pink. The robot is drawn by the game's own code (see
tools/portrait.ts). A thin outline can be put round it here (OUTLINE_WIDTH);
that was asked for with the first robot, and is off for the present one.
"""
import asyncio
import base64
import io
import os
import pathlib
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image
from playwright.async_api import async_playwright
from scipy.ndimage import distance_transform_edt

ROOT = pathlib.Path(__file__).resolve().parent.parent
SIZE = 2400  # one tile, in pixels: the robot is 1.09 tiles tall, so the PNG comes out about 1880 x 2860
PAD = 90  # clear space left round the robot
OUTLINE = (5, 5, 8)  # black
OUTLINE_WIDTH = 0  # pixels; 0 for no outline (12 was used for the first robot)
SOLID = 128  # how opaque a pixel must be to count as robot. The glow under the soles is fainter, and is not outlined


def outlined(robot: Image.Image) -> Image.Image:
    """The robot with a line round its outside edge (and round the gaps between its arms, legs and body)."""
    if OUTLINE_WIDTH <= 0:
        return robot
    alpha = np.asarray(robot)[:, :, 3]
    away = distance_transform_edt(alpha < SOLID)  # how far each pixel is from the robot
    line = np.clip(OUTLINE_WIDTH + 0.5 - away, 0, 1)  # full inside the line's width, fading over its last pixel
    layer = np.zeros(alpha.shape + (4,), dtype=np.uint8)
    layer[:, :, :3] = OUTLINE
    layer[:, :, 3] = np.round(line * 255)
    return Image.alpha_composite(Image.fromarray(layer, "RGBA"), robot)


async def main() -> None:
    args = sys.argv[1:]
    view = "front"
    if "--view" in args:
        i = args.index("--view")
        view = args[i + 1]
        del args[i : i + 2]
    facing = {"front": 2, "back": 1, "right": 4, "left": 3}[view]
    out = pathlib.Path(args[0] if args else "portraits")
    colours = args[1:] or ["white", "gold", "black", "pink"]
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        bundle = pathlib.Path(tmp) / "portrait.js"
        subprocess.run(
            ["npx", "esbuild", str(ROOT / "tools" / "portrait.ts"), "--bundle", "--format=iife", f"--outfile={bundle}", "--log-level=warning"],
            cwd=ROOT,
            check=True,
        )
        async with async_playwright() as p:
            browser = await p.chromium.launch(executable_path=os.environ.get("CHROME") or None)
            page = await browser.new_page()
            await page.set_content("<html><body></body></html>")
            await page.add_script_tag(path=str(bundle))
            for cid in colours:
                url = await page.evaluate("([id, s, f]) => portrait(id, s, f)", [cid, SIZE, facing])
                im = outlined(Image.open(io.BytesIO(base64.b64decode(url.split(",")[1]))).convert("RGBA"))
                box = im.getbbox()
                box = (max(0, box[0] - PAD), max(0, box[1] - PAD), min(im.width, box[2] + PAD), min(im.height, box[3] + PAD))
                im = im.crop(box)
                path = out / (f"bomberbot-{cid}.png" if view == "front" else f"bomberbot-{cid}-{view}.png")
                im.save(path, optimize=True)
                print(f"saved {path} {im.size[0]} x {im.size[1]}")
            await browser.close()


asyncio.run(main())
