"""
Looks over every screen of the game, at seven phone sizes (upright from 320 to 430 wide, and sideways),
for anything out of place: text wider than its own box, a button or a line sticking out of its card, anything
off the side of the screen. It sets the game up with the longest things it can show (seven CPU players, a
twelve-letter name, the Wild West map, Randomize CPUs on) and walks through the title, the lobby's two pages,
a CPU player's panel, the five Settings pages, a round, the menu, a question and a result.

Written after the same kind of fault got through four times in a day (a slider's value, a card's line and
the Settings page names each ran out of their boxes on some phone). Run it after any change to a screen.

Optional tooling, not part of the game. It needs Python 3 with the "playwright" package and a Chrome or
Chromium browser (see tools/screenshots.py):

    npm run build
    python3 tools/layout-check.py

If Playwright cannot find a browser: CHROME=/usr/bin/google-chrome python3 tools/layout-check.py
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

FIND = """() => {
  const bad = [];
  const W = innerWidth, H = innerHeight;
  const shown = (e) => { for (let n = e; n && n !== document.documentElement; n = n.parentElement) { const st = getComputedStyle(n); if (st.display === 'none' || st.visibility === 'hidden' || n.hidden) return false; } return true; };
  for (const e of document.body.querySelectorAll('*')) {
    if (!shown(e) || e.closest('svg')) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const st = getComputedStyle(e);
    const name = (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '')) + ' "' + (e.textContent || '').trim().slice(0, 24) + '"';
    // off the side of the screen (things on purpose off-screen aside)
    if ((r.right > W + 1 || r.left < -1) && st.position !== 'fixed' && !['cv','ghosts','titleArt'].includes(e.id)) bad.push('off screen: ' + name + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    // text wider than its own box
    if (e.children.length === 0 && (e.textContent || '').trim() && e.scrollWidth > e.clientWidth + 1 && st.overflow === 'visible' && st.display !== 'inline') bad.push('text out of its box: ' + name + ' ' + e.scrollWidth + ' > ' + e.clientWidth);
    // a child sticking out of a box with a border (a card, a button)
    const p = e.parentElement;
    if (p && p !== document.body) { const q = p.getBoundingClientRect(); const ps = getComputedStyle(p);
      if (ps.overflow === 'visible' && (parseFloat(ps.borderLeftWidth) > 0 || ps.backgroundColor !== 'rgba(0, 0, 0, 0)') && st.position !== 'absolute' && st.position !== 'fixed' && (r.right > q.right + 1.5 || r.left < q.left - 1.5) && q.width > 20) bad.push('sticks out of its box: ' + name + ' ' + Math.round(r.left) + '..' + Math.round(r.right) + ' in ' + Math.round(q.left) + '..' + Math.round(q.right));
    }
  }
  return [...new Set(bad)];
}"""
async def main():
    async with async_playwright() as p:
        b = await launch(p)
        total = 0
        for (w,h) in [(320,568),(360,640),(375,667),(390,844),(430,932),(667,375),(844,390)]:
            ctx = await b.new_context(viewport={'width':w,'height':h}, device_scale_factor=2, has_touch=True, is_mobile=True)
            pg = await ctx.new_page()
            await pg.add_init_script("localStorage.setItem('matchSetup', JSON.stringify({v:7,cpus:['black','pink','blue','red','orange','white','green'].map(c=>({colorId:c,level:'beginner'})),arena:'classic',map:'western',randEmotes:true,randLevels:true,timerOn:true,roundSecs:90,closeIn:0,firstTo:3,lives:3,postMortem:true,afterlife:'angel'})); localStorage.setItem('playerName', JSON.stringify('Codywwwwwwww'));")
            await pg.goto(PAGE); await pg.wait_for_timeout(400)
            async def look(name):
                await pg.wait_for_timeout(150)
                bad = await pg.evaluate(FIND)
                nonlocal total; total += len(bad)
                for x in bad: print(f'  {w}x{h} {name}: {x}')
            await look('title')
            await pg.evaluate("document.getElementById('titleOnline').click()"); await look('online panel')
            await pg.evaluate("document.getElementById('onlineCancel').click()")
            await pg.evaluate("document.getElementById('titleLocal').click()"); await look('lobby players')
            for y in (400, 900, 5000):
                await pg.evaluate(f"document.querySelector('#lobby .scroll').scrollTop = {y}"); await look('lobby players scrolled')
            await pg.evaluate("document.getElementById('slot-1').click()"); await look('cpu panel')
            await pg.evaluate("document.getElementById('cpuDone').click()")
            await pg.evaluate("document.getElementById('colOk').click(); document.getElementById('pgMatch').click()"); await look('lobby match')
            for y in (500, 1200, 5000):
                await pg.evaluate(f"document.querySelector('#lobby .scroll').scrollTop = {y}"); await look('lobby match scrolled')
            await pg.evaluate("document.getElementById('lobbySettings').click()")
            for t in ['Controls','Gamepad','Sound','Graphics','App']:
                await pg.evaluate(f"document.getElementById('pg{t}').click(); document.querySelector('#settings .scroll').scrollTop = 0"); await look('settings ' + t)
                await pg.evaluate("document.querySelector('#settings .scroll').scrollTop = 5000"); await look('settings ' + t + ' end')
            await pg.evaluate("document.getElementById('setDone').click()")
            await pg.evaluate("document.getElementById('arenaStart').click()"); await pg.wait_for_timeout(600); await look('playing')
            await pg.evaluate("document.getElementById('menuBtn').click()"); await look('menu')
            await pg.evaluate("document.getElementById('pauseRestart').click()"); await look('confirm')
            await pg.evaluate("document.getElementById('confirmNo').click(); document.getElementById('pauseResume').click()")
            await pg.evaluate("for (const p of __game.world.players.slice(1)) { p.alive = false; p.lives = 0; }"); await pg.wait_for_timeout(1500); await look('round won')
            await ctx.close()
        await b.close()
    print('layout check:', 'nothing out of place' if not total else f'{total} things out of place')
    sys.exit(1 if total else 0)


asyncio.run(main())
