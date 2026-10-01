"""Regenerates the Apps-menu icons (London double-decker, front view)."""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "community.bus_countdown", "appmeta")
AMBER = (255, 140, 0, 255)
DARK = (60, 60, 60, 255)

FRONT = [            # 8x8, colour: # body, w window, . transparent
    ".######.",
    "#wwwwww#",
    "########",
    "#wwwwww#",
    "#wwwwww#",
    "########",
    "#.####.#",
    ".#....#.",
]
BACK = [             # 11x11, greyscale: # on, . off
    ".#########.",
    "#.........#",
    "#.........#",
    "###########",
    "#.........#",
    "#.........#",
    "###########",
    "#.#######.#",
    "###########",
    ".##.....##.",
    ".##.....##.",
]

def build(rows, mode, colours, name):
    h, w = len(rows), len(rows[0])
    im = Image.new(mode, (w, h), 0)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in colours:
                im.putpixel((x, y), colours[ch])
    im.save(os.path.join(OUT, name))

build(FRONT, "RGBA", {"#": AMBER, "w": DARK}, "icon_front_8x8.png")
build(BACK, "L", {"#": 255}, "icon_back_11x11.png")
