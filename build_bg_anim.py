#!/usr/bin/env python3
"""Pre-render Bus Timetable's animated background as a native .anim file.

A dim, slow orange glow: a few soft ripples drifting across the dark grey
background (same wave pattern as Boat Timetable's river). Crests glow orange,
troughs just go darker grey, so it never shifts towards blue. The firmware plays .anim files itself at the file's fps, so the app
sends no per-frame draws for it. Every wave completes a whole number of
cycles over the loop, so it repeats seamlessly.

Output: community.bus_countdown/anims/bg_glow.anim  ("bicycle1", encoded with
the firmware's scripts/seq2anim.py — set BSB_FW if the checkout isn't at
../busybar-fw-jerryscript).
"""
import json, math, os, sys, tempfile
from pathlib import Path
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "community.bus_countdown", "anims", "bg_glow.anim")

W, H = 72, 16
FPS = 12
LOOP_S = 10                       # one full loop; slow drift
BASE = (28, 28, 28)               # = BG_COLOR in main.js (#1C1C1C)
TINT_UP = (1.0, 0.55, 0.15)       # crests: orange
TINT_DOWN = (0.5, 0.5, 0.5)       # troughs: neutral darker grey
AMP = 30                          # max levels above BASE (red channel)

# (x wavelength px, y wavelength px or 0, cycles per loop, weight, phase)
WAVES = [
    (40, 0,  -2, 0.50, 0.0),      # long swell drifting left
    (22, 30, -3, 0.30, 1.7),      # diagonal ripple
    (15, -24, 1, 0.20, 4.1),      # counter-ripple, slower
]


def field(x, y, t):
    v = 0.0
    for lx, ly, cyc, w, ph in WAVES:
        a = x / lx + (y / ly if ly else 0.0) + cyc * t
        v += w * math.sin(2 * math.pi * a + ph)
    return v                       # roughly -1..1


def frames():
    n = FPS * LOOP_S
    out = []
    for i in range(n):
        t = i / n
        im = Image.new("RGB", (W, H))
        px = im.load()
        for y in range(H):
            for x in range(W):
                v = field(x, y, t)
                tint = TINT_UP if v > 0 else TINT_DOWN
                px[x, y] = tuple(max(0, min(255, round(b + v * AMP * k))) for b, k in zip(BASE, tint))
        out.append(im)
    return out


def load_converter():
    fw = os.environ.get("BSB_FW", os.path.join(HERE, "..", "busybar-fw-jerryscript"))
    sys.path.insert(0, os.path.join(fw, "scripts"))
    from seq2anim import BSBAnimConverter
    return BSBAnimConverter


def write_anim(ims, path):
    conv = load_converter()
    with tempfile.TemporaryDirectory(prefix="bus-bg-") as tmp:
        for i, im in enumerate(ims):
            # No R/B pre-swap: verified on the bar (fw api 27.9.0) that a plain
            # RGB anim shows the same colours as the draw API.
            im.save(os.path.join(tmp, f"frame_{i}.png"))
        with open(os.path.join(tmp, "meta.json"), "w") as f:
            json.dump({"fps": FPS, "color_mode": "rgb888", "sections": []}, f)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        info = conv().convert_dir(Path(tmp), Path(path))
    print(f"Wrote {os.path.relpath(path, HERE)}: {info.frame_cnt} frames @ {FPS} fps, {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    ims = frames()
    if "--preview" in sys.argv:
        d = sys.argv[sys.argv.index("--preview") + 1]
        for i, im in enumerate(ims):
            im.save(os.path.join(d, f"bg_{i:03d}.png"))
        print(f"{len(ims)} preview frames -> {d}")
    write_anim(ims, OUT)
