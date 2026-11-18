"""Draw the November 18 editorial plate and encode it as an RGB PNG."""

import math
import os
from pathlib import Path
import struct
import zlib


SIZE = 1024
SCALE = 2
GRID = SIZE * SCALE
PAPER = (243, 232, 209)
INK = (28, 41, 39)
LIGHT = (255, 246, 224)
RUST = (175, 62, 44)
RED = (193, 76, 52)
GOLD = (232, 177, 82)
TEAL = (34, 75, 72)
DARK = (22, 50, 50)
SAND = (230, 201, 146)

# Single-line capitals drawn on a five-by-seven coordinate grid.
LETTERS = {
    "A": "07 30 57/15 45", "B": "07 00 30 51 52 33 03/33 54 56 37 07",
    "C": "51 40 10 01 06 17 47 56", "D": "07 00 30 52 55 37 07",
    "E": "50 00 07 57/03 43", "F": "50 00 07/03 43",
    "G": "51 40 10 01 06 17 47 56 54 34", "H": "00 07/50 57/04 54",
    "I": "10 50/30 37/17 57", "J": "50 56 47 17 06", "K": "00 07/50 04/23 57",
    "L": "00 07 57", "M": "07 00 34 50 57", "N": "07 00 57 50",
    "O": "10 40 51 56 47 17 06 01 10", "P": "07 00 40 51 53 44 04",
    "Q": "10 40 51 56 47 17 06 01 10/34 58", "R": "07 00 40 51 52 43 03/23 57",
    "S": "51 40 10 01 02 13 44 55 56 47 17 06", "T": "00 50/30 37",
    "U": "00 06 17 47 56 50", "V": "00 37 50", "W": "00 17 34 47 60",
    "X": "00 57/50 07", "Y": "00 34 50/34 37", "Z": "00 50 07 57",
    "0": "10 40 51 56 47 17 06 01 10", "1": "11 30 37/17 57",
    "2": "01 10 40 51 52 06 07 57", "3": "00 40 51 52 33 23/33 54 56 47 07",
    "4": "40 04 54/40 47", "5": "50 00 03 43 54 56 47 17 06",
    "6": "50 20 02 06 17 47 56 54 43 13 04", "7": "00 50 27",
    "8": "13 02 01 10 40 51 52 43 13 04 06 17 47 56 54 43",
    "9": "07 37 55 51 40 10 01 03 14 44 53",
    "'": "20 21", "$": "51 40 10 01 02 13 44 55 56 47 17 06/30 37",
    ",": "26 17", "/": "07 50", "-": "04 44",
}


class Canvas:
    def __init__(self):
        self.pixels = bytearray(bytes(PAPER) * (GRID * GRID))

    def span(self, y, left, right, color):
        left = max(0, math.ceil(left - 0.5))
        right = min(GRID, math.ceil(right - 0.5))
        if right > left:
            start = (y * GRID + left) * 3
            end = (y * GRID + right) * 3
            self.pixels[start:end] = bytes(color) * (right - left)

    def polygon(self, points, color):
        points = [(x * SCALE, y * SCALE) for x, y in points]
        edges = list(zip(points, points[1:] + points[:1]))
        top = max(0, math.floor(min(y for _, y in points)))
        bottom = min(GRID, math.ceil(max(y for _, y in points)))
        for y in range(top, bottom):
            sample = y + 0.5
            crossings = sorted(
                x0 + (sample - y0) * (x1 - x0) / (y1 - y0)
                for (x0, y0), (x1, y1) in edges
                if min(y0, y1) <= sample < max(y0, y1)
            )
            for left, right in zip(crossings[::2], crossings[1::2]):
                self.span(y, left, right, color)

    def box(self, x, y, width, height, color):
        self.polygon([(x, y), (x + width, y), (x + width, y + height), (x, y + height)], color)

    def oval(self, x, y, rx, ry, color):
        x, y, rx, ry = (value * SCALE for value in (x, y, rx, ry))
        for row in range(max(0, math.floor(y - ry)), min(GRID, math.ceil(y + ry))):
            offset = (row + 0.5 - y) / ry
            half_width = rx * math.sqrt(max(0, 1 - offset * offset))
            self.span(row, x - half_width, x + half_width, color)

    def line(self, a, b, weight, color):
        x, y = a
        u, v = b
        length = math.hypot(u - x, v - y)
        radius = weight / 2
        if length:
            dx, dy = (v - y) * radius / length, (x - u) * radius / length
            self.polygon([(x + dx, y + dy), (u + dx, v + dy),
                          (u - dx, v - dy), (x - dx, y - dy)], color)
        self.oval(x, y, radius, radius, color)
        self.oval(u, v, radius, radius, color)

    def text(self, caption, x, y, height, color, *, weight=0.85, align=False):
        unit = height / 7
        advances = [4 if ch == " " else 7 for ch in caption]
        if align:
            x -= (sum(advances) - 2) * unit / 2
        for ch, advance in zip(caption, advances):
            if ch != " ":
                for stroke in LETTERS[ch].split("/"):
                    points = [(x + int(px) * unit, y + int(py) * unit) for px, py in stroke.split()]
                    for a, b in zip(points, points[1:]):
                        self.line(a, b, weight * unit, color)
            x += advance * unit

    def png(self):
        raw = bytearray()
        stride = GRID * 3
        for row in range(0, GRID, SCALE):
            top = self.pixels[row * stride:(row + 1) * stride]
            bottom = self.pixels[(row + 1) * stride:(row + 2) * stride]
            scanline = bytearray(SIZE * 3)
            for channel in range(3):
                averaged = bytes((a + b + c + d + 2) // 4 for a, b, c, d in zip(
                    top[channel::6], top[channel + 3::6], bottom[channel::6], bottom[channel + 3::6]
                ))
                scanline[channel::3] = averaged
            raw.append(0)  # PNG filter type None
            raw.extend(scanline)
        return (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b"")
        )


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def chair(canvas, x, y, angle):
    cos, sin = math.cos(angle), math.sin(angle)

    def position(points):
        return [(x + u * cos - v * sin, y + u * sin + v * cos) for u, v in points]

    canvas.polygon(position([(-49, -21), (-36, -35), (36, -35), (49, -21),
                             (44, 28), (-44, 28)]), INK)
    canvas.polygon(position([(-35, -13), (-26, -19), (26, -19), (35, -13),
                             (31, 24), (-31, 24)]), TEAL)
    canvas.polygon(position([(-49, -21), (-36, -35), (36, -35), (49, -21),
                             (37, -15), (-37, -15)]), DARK)
    a, b = position([(-30, -27), (30, -27)])
    canvas.line(a, b, 2, GOLD)


def summit(canvas):
    canvas.text("WORLD NEWS", 57, 51, 23, INK, weight=1.05)
    canvas.text("18 NOVEMBER 2026", 575, 51, 24, INK, weight=1.05)
    canvas.box(54, 97, 916, 3, INK)
    canvas.text("BEFORE THE TALKS", 512, 132, 52, INK, weight=1.17, align=True)
    canvas.text("TRUMP SHAKES HANDS WITH XI AND PUTIN",
                512, 211, 23, RUST, weight=1.05, align=True)

    # Empty chairs form three points around an overhead conference table.
    canvas.oval(512, 479, 430, 129, SAND)
    chair(canvas, 512, 302, 0)
    chair(canvas, 142, 405, -0.91)
    chair(canvas, 882, 405, 0.91)
    canvas.oval(512, 468, 375, 142, RUST)
    canvas.oval(512, 455, 375, 142, RED)
    canvas.oval(512, 455, 350, 119, GOLD)
    canvas.oval(512, 455, 347, 116, RED)

    canvas.text("XI", 512, 353, 23, LIGHT, align=True)
    canvas.text("TRUMP", 283, 434, 25, LIGHT, align=True)
    canvas.text("PUTIN", 741, 434, 25, LIGHT, align=True)

    # Three place settings converge on a single, still-unoccupied table.
    for x, y in [(512, 399), (361, 493), (663, 493)]:
        canvas.box(x - 25, y, 50, 4, GOLD)
        canvas.oval(x, y + 18, 4, 4, GOLD)
    canvas.oval(512, 474, 66, 38, RUST)
    canvas.oval(512, 473, 59, 31, RED)
    for x, y in [(512, 460), (494, 480), (530, 480)]:
        canvas.oval(x, y, 4, 4, LIGHT)
    canvas.text("FIRST THREE-WAY TALKS IN CHINA ON THURSDAY",
                512, 626, 20, INK, weight=1.05, align=True)


def tunnel(canvas):
    canvas.box(54, 678, 458, 292, TEAL)
    canvas.text("UKRAINE / KHARKIV", 82, 705, 20, GOLD)
    canvas.text("GAS TUNNEL BATTLE", 82, 744, 22, LIGHT, weight=1.1)
    canvas.text("WITH RUSSIAN TROOPS", 82, 782, 22, LIGHT, weight=1.1)

    # Concentric ribs surround a distant opening in a cutaway view of the pipe.
    canvas.oval(280, 886, 173, 69, GOLD)
    canvas.oval(280, 886, 165, 62, DARK)
    for rx, ry in [(131, 51), (97, 39), (68, 28), (44, 20)]:
        canvas.oval(252, 887, rx, ry, (139, 130, 89))
        canvas.oval(252, 887, rx - 4, ry - 3, DARK)
    canvas.oval(252, 887, 17, 9, GOLD)
    for end in [(406, 923), (335, 944), (168, 938)]:
        canvas.line((252, 895), end, 1.5, (139, 130, 89))


def jet(canvas):
    canvas.box(512, 678, 458, 292, SAND)
    canvas.text("GHANA", 540, 705, 20, RUST, weight=1.05)
    canvas.text("$60M PRESIDENTIAL", 540, 744, 23, INK, weight=1.1)
    canvas.text("JET SPARKS OUTRAGE", 540, 782, 23, INK, weight=1.1)

    # An abstract side profile stands for the purchase.
    canvas.oval(744, 891, 155, 57, GOLD)
    canvas.polygon([(569, 892), (583, 883), (637, 878), (693, 877),
                    (665, 847), (686, 846), (754, 877), (868, 877),
                    (891, 849), (908, 850), (898, 884), (925, 893),
                    (893, 899), (774, 904), (726, 931), (699, 932),
                    (719, 906), (613, 906), (584, 902)], INK)
    canvas.polygon([(590, 892), (628, 884), (644, 885), (634, 891)], LIGHT)
    for x in range(661, 861, 19):
        canvas.oval(x, 889, 3, 3, GOLD)
    canvas.box(642, 944, 205, 2, RUST)


def main():
    canvas = Canvas()
    summit(canvas)
    tunnel(canvas)
    jet(canvas)
    output = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))
    output.mkdir(parents=True, exist_ok=True)
    (output / "entry.png").write_bytes(canvas.png())


if __name__ == "__main__":
    main()
