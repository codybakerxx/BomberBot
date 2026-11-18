"""
Checks that the arena stays sharp in WebKit (the engine of Safari and of every browser on an iPhone) when the
browser shows the page before the game's script has run, as it can on a slow connection.

The blur of November 2026: WebKit puts a canvas whose CSS size equals its own pixel size (any canvas before the
game has sized it: 300 x 150) on a layer without the screen's density when the canvas has a layer of its own, and
the layer keeps that scale after the canvas is sized for the screen. On an iPhone every position: fixed element
has its own layer, the arena canvas among them. So whether the arena came up sharp depended on whether the page
was shown once before the script ran: a race, different on each refresh. (page.html, #cv, has the two guards.)

This opens the built game in WebKitGTK (the same WebCore code) at an iPhone's density, served twice: once with the
whole page at once, once with a pause before the game's script, starts a match and measures, on what the screen
shows, how much of the arena sits on hard edges. Blurred, it drops to about a third. Two test-only shims make this
port take the iPhone's path: each fixed canvas gets its own layer (will-change: transform; an iPhone does it for
position: fixed) and 2D canvases are painted into their layers (an iPhone's are; this port would otherwise show an
accelerated canvas as it is).

It cannot show that an iPhone is sharp: only an iPhone can. It shows the cause found in WebKit cannot come back.

Optional tooling, not part of the game. Linux only. It needs WebKitGTK and its Python bindings, and Xvfb:

    sudo apt-get install libwebkit2gtk-4.1-0 gir1.2-webkit2-4.1 gir1.2-gtk-3.0 python3-gi xvfb
    npm run build
    /usr/bin/python3 tools/webkit-check.py      (the system Python, the one python3-gi is for)
"""
import http.server
import os
import pathlib
import shutil
import subprocess
import sys
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = pathlib.Path(os.environ.get("WEBKIT_CHECK_PAGE") or ROOT / "dist" / "index.html")  # (another page to check: WEBKIT_CHECK_PAGE)
PAUSE = 1.5  # seconds between the page and its script, on the slow load
SCALE = 3  # an iPhone's density

if not os.environ.get("DISPLAY") and not os.environ.get("WEBKIT_CHECK_INNER"):
    if not shutil.which("xvfb-run"):
        sys.exit("needs xvfb-run (sudo apt-get install xvfb)")
    env = dict(os.environ, WEBKIT_CHECK_INNER="1", GDK_SCALE=str(SCALE), GDK_BACKEND="x11", LIBGL_ALWAYS_SOFTWARE="1", NO_AT_BRIDGE="1")
    run = subprocess.run(["xvfb-run", "-a", "-s", "-screen 0 1400x3000x24", sys.executable, *sys.argv], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    # (the browser's own complaints about the missing sound card and desktop bus are left out)
    noise = ("ALSA lib", "ALSOFT", "pw.conf", "D-Bus", "dbus-launch")
    sys.stdout.write("".join(l for l in run.stdout.splitlines(True) if l.strip() and not any(k in l for k in noise)))
    sys.exit(run.returncode)

import gi  # noqa: E402

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, GLib, Gtk, WebKit2  # noqa: E402

SHIM = """<style>#cv, #score, #ghosts { will-change: transform; }</style>
<script>(() => { const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, o) { return t === '2d' ? gc.call(this, t, Object.assign({}, o, { willReadFrequently: true })) : gc.call(this, t, o); }; })();</script>
"""
html = PAGE.read_text(encoding="utf-8")
html = html.replace("https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;700&display=swap", "/font.css")
html = html.replace("<head>", "<head>\n" + SHIM, 1)
cut = html.find("<script>", html.find("<body"))
PART1, PART2 = html[:cut].encode(), html[cut:].encode()


class Serve(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/font.css"):
            self.send_response(200)
            self.send_header("Content-Type", "text/css")
            self.end_headers()
            return
        if self.path in ("/fast", "/slow"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(PART1)
            self.wfile.flush()
            if self.path == "/slow":
                time.sleep(PAUSE)
            self.wfile.write(PART2)
            return
        self.send_response(404)
        self.end_headers()


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Serve)
threading.Thread(target=server.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{server.server_address[1]}"

STEPS = [
    "document.getElementById('titleLocal').click()",
    "document.getElementById('colOk').click()",
    "document.getElementById('colOk').click()",
    "document.getElementById('lobbyStart').click()",
]
WHERE = "(() => { const r = document.getElementById('cv').getBoundingClientRect(); return [__game.mode, devicePixelRatio, r.left, r.top, r.width, r.height].join(' '); })()"


def capture(path):
    """Loads BASE + path, starts a match, returns (mode, density, hard edges per 1000 pixels of the arena)."""
    result = {}
    win = Gtk.Window()
    win.set_default_size(440, 956)
    view = WebKit2.WebView.new_with_context(WebKit2.WebContext.new_ephemeral())
    view.get_settings().set_property("hardware-acceleration-policy", WebKit2.HardwareAccelerationPolicy.ALWAYS)
    win.add(view)
    win.show_all()
    view.load_uri(BASE + path)

    def js(code, then):
        def done(v, res, _):
            try:
                then(v.evaluate_javascript_finish(res).to_string())
            except GLib.Error:
                then("")
        view.evaluate_javascript(code, -1, None, None, None, done, None)

    def measure(where):
        mode, dpr, left, top, w, h = where.split()
        d = float(dpr)
        gw = win.get_window()
        pb = Gdk.pixbuf_get_from_window(gw, 0, 0, gw.get_width(), gw.get_height())
        px, stride, n = pb.get_pixels(), pb.get_rowstride(), pb.get_n_channels()
        x0, y0 = round(float(left) * d) + 6, round(float(top) * d) + 6
        x1, y1 = x0 + round(float(w) * d) - 12, y0 + round(float(h) * d) - 12
        hard = total = 0
        for y in range(y0, y1, 2):
            row = y * stride
            prev = None
            for x in range(x0, x1):
                i = row + x * n
                lum = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) // 1000
                if prev is not None:
                    total += 1
                    hard += abs(lum - prev) > 40
                prev = lum
        result.update(mode=mode, density=d, hard=round(1000 * hard / max(total, 1), 1))
        GLib.source_remove(guard)
        win.destroy()
        Gtk.main_quit()

    def step(i):
        if i == len(STEPS):
            GLib.timeout_add(2500, lambda: js(WHERE, measure) and False)
            return
        js(STEPS[i], lambda _: GLib.timeout_add(700, lambda: step(i + 1) and False))

    def wait():
        js("typeof __game === 'object' ? 'yes' : 'no'", lambda ok: step(0) if ok == "yes" else GLib.timeout_add(250, lambda: wait() and False))

    GLib.timeout_add(400, lambda: wait() and False)
    guard = GLib.timeout_add(30000, lambda: (result.setdefault("mode", "timed out"), win.destroy(), Gtk.main_quit()) and False)
    Gtk.main()
    return result


fast = capture("/fast")
slow = capture("/slow")
print(f"page and script together: {fast}")
print(f"script {PAUSE} s late:       {slow}")
ok = fast.get("mode") == slow.get("mode") == "playing" and fast.get("density") == SCALE and slow.get("hard", 0) >= 0.8 * fast.get("hard", 1)
print(("ok   " if ok else "FAIL ") + "the arena is as sharp when the page was shown before the game's script ran")
sys.exit(0 if ok else 1)
