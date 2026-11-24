"""Load every published build in a real browser and prove the player actually moves.

Run on the server as user `dev` (it owns the Playwright browsers). The point is to
separate "the build is broken" from "this load was slow": the harness waits for the
game to expose itself instead of sleeping a guessed number of seconds, and a build
that never exposes itself reports what the page actually did.
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = "https://gameforge.198-44-118-189.sslip.io"
BOOT = 30000


def probe_js():
    return """() => {
      const n = globalThis.__navara;
      const s = n && n.snapshot ? n.snapshot() : null;
      return {
        has: !!n,
        status: n && n.status ? n.status() : null,
        x: s && s.player ? Math.round(s.player.x) : null,
        y: s && s.player ? Math.round(s.player.y) : null,
        ground: s && s.player ? (s.player.ground ?? null) : null,
        hp: s && s.player ? s.player.hp : null,
        ents: s ? (s.entities || []).length : null,
        canvases: document.querySelectorAll('canvas').length,
        title: document.title,
        bodyLen: (document.body ? document.body.innerHTML.length : 0),
        scripts: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).slice(0, 4),
      };
    }"""


def one(pg, version):
    url = f"{BASE}/game/{version}/index.html?autoplay=1"
    errs = []
    handler = lambda e: errs.append(str(e)[:200])  # noqa: E731
    pg.on("pageerror", handler)
    st = {"version": version}
    try:
        pg.goto(url, wait_until="commit", timeout=BOOT + 30000)
        try:
            # The honest wait: until the game says it exists, not a fixed sleep.
            pg.wait_for_function("() => !!globalThis.__navara", timeout=BOOT)
        except Exception:
            a = pg.evaluate(probe_js())
            st["result"] = "NO-BOOT"
            st["page"] = a
            st["errs"] = errs[:4]
            return st
        a = pg.evaluate(probe_js())
        st.update({k: a[k] for k in ("x", "y", "ground", "hp", "ents", "status")})
        # Drive the simulation itself, not the render loop: wall-clock driving mixes
        # in host contention, so the same build scored 7px and 103px on two runs.
        # 60 steps of "hold right" is the same test on every build and every host.
        sim = pg.evaluate("""() => {
          const n = globalThis.__navara;
          n.start('s1');
          const r = n.tick(60, { right: true });
          const j = n.tick(1, { jump: true });
          return { x: Math.round(r.player.x), ground: r.player.onGround,
                   y: r.player.y, hp: r.player.hp,
                   afterJumpY: Math.round(j.player.y), status: n.status() };
        }""")
        st["sim"] = sim
        st["moved"] = round(abs(sim["x"] - 34), 1) if sim.get("x") is not None else None
        st["ground"] = sim.get("ground")
        st["errs"] = errs[:3]
        st["result"] = "OK"
    except Exception as e:  # noqa: BLE001 - one bad build must not kill the sweep
        st["result"] = f"ERROR {type(e).__name__}: {str(e)[:120]}"
        st["errs"] = errs[:3]
    finally:
        pg.remove_listener("pageerror", handler)
    return st


def main(versions):
    out = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        for v in versions:
            # A fresh page per build: reusing one page let a previous build's
            # globals survive and made nine different bundles report one result.
            pg = b.new_page(viewport={"width": 1280, "height": 800})
            try:
                out.append(one(pg, v))
            finally:
                pg.close()
        b.close()
    for s in out:
        print(json.dumps(s))
    bad = [s for s in out if s.get("result") != "OK" or (s.get("moved") or 0) < 8]
    print(f"\nPLAYABLE {len(out) - len(bad)}/{len(out)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["latest"]))
