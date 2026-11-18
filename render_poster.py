"""Draw the original editorial poster offline with Pillow and local URW fonts."""

from functools import lru_cache
from math import cos, pi, sin, sqrt
from pathlib import Path
from random import Random

from PIL import Image, ImageDraw, ImageFont

SCALE = 3
SIZE = 1024
PAPER = "#f2e6cc"
INK = "#132e2d"
RUST = "#ac4e36"
SEA = "#225150"
GOLD = "#f3be67"
FONT_DIR = Path("/usr/share/fonts/opentype/urw-base35")

image = Image.new("RGB", (SIZE * SCALE, SIZE * SCALE), PAPER)
draw = ImageDraw.Draw(image)
rng = Random(171126)


def coords(points):
    return [(round(x * SCALE), round(y * SCALE)) for x, y in points]


def polygon(points, color):
    draw.polygon(coords(points), fill=color)


def stroke(points, color, width=1):
    draw.line(coords(points), fill=color, width=round(width * SCALE), joint="curve")


def box(x0, y0, x1, y1, color):
    draw.rectangle(coords([(x0, y0), (x1, y1)]), fill=color)


def oval(x, y, rx, ry, color):
    draw.ellipse(coords([(x-rx, y-ry), (x+rx, y+ry)]), fill=color)


@lru_cache
def font(face, size):
    return ImageFont.truetype(str(FONT_DIR / (face + ".otf")), size * SCALE)


def label(x, y, text, size, face="NimbusSans-Bold", color=INK, anchor="lt"):
    draw.text((x * SCALE, y * SCALE), text, font=font(face, size), fill=color, anchor=anchor)


def issue_header():
    stroke([(36, 35), (988, 35)], RUST, 5)
    label(36, 54, "World in Print", 86, "NimbusRoman-Bold")
    label(988, 58, "TUESDAY", 22, color=RUST, anchor="rt")
    label(988, 89, "17 NOVEMBER 2026", 28, anchor="rt")


def strait():
    box(36, 143, 988, 630, INK)
    box(36, 143, 988, 337, "#e8c88f")
    # Ink breaks across the sunset and low shorelines.
    oval(808, 232, 71, 71, "#d68a52")
    for index in range(13):
        y = 181 + index * 9
        edge = sqrt(71**2 - (y - 232)**2)
        stroke([(808-edge, y), (808+edge, y-1)], "#e8c88f", 1.6 + index/11)
    for x, y, length in [(75, 179, 160), (118, 204, 179), (375, 174, 218),
                         (505, 204, 144), (562, 254, 103), (927, 206, 59)]:
        for row in range(5):
            left = x + row * 7
            right = x + length - row * 9
            polygon([(left, y+row*4), (right, y+row*4-3),
                     (right-21, y+row*4), (left+13, y+row*4+1)], "#ccaa79")
    polygon([(36, 290), (91, 272), (146, 276), (193, 260), (261, 273),
             (300, 295), (364, 303), (412, 324), (36, 354)], "#a17b58")
    polygon([(521, 340), (620, 311), (666, 311), (741, 291), (794, 303),
             (832, 284), (911, 279), (988, 262), (988, 357)], "#a17b58")
    polygon([(36, 313), (118, 300), (185, 309), (237, 296), (291, 319),
             (366, 328), (406, 343), (508, 349), (623, 331), (713, 333),
             (793, 313), (889, 319), (988, 297), (988, 409), (36, 409)], "#59736a")
    box(36, 350, 988, 630, SEA)
    for index in range(375):
        y = rng.uniform(354, 626)
        depth = (y-350) / 280
        x = rng.uniform(37, 977)
        length = rng.uniform(8, 46) * (0.4 + depth * 1.9)
        end = min(x+length, 987)
        color = rng.choice(("#416b64", "#627f70", "#173e3d", "#2c5d57", "#b5a27d"))
        polygon([(x, y), (end, y-2*depth), (end-4, y+depth),
                 (x+length*.33, y+1+depth*2)], color)
    for index in range(16):
        y = 450 + index * 11
        x = 753 + 22 * sin(index * .89)
        stroke([(x-21-index*2, y), (x+16+index*3, y-2)], "#9c916b", 1.5)
    for x, y, length in [(61, 368, 128), (192, 434, 108), (364, 480, 130),
                         (514, 424, 98), (618, 514, 139), (806, 470, 122)]:
        for row in range(6):
            left = x + row * 7
            right = x + length + row * 3
            points = [(left+i*4, y+row*5+2.3*sin(i*.28+row*.6))
                      for i in range(round((right-left)/4))]
            stroke(points, "#7a9580", 1.25)


def pier(x, y, width, foot):
    polygon([(x+8, y), (x+width, y-9), (x+width-5, foot-4),
             (x+width-21, foot+6), (x-4, foot)], INK)
    polygon([(x+8, y+5), (x+width-19, y+2), (x+width-24, foot+3),
             (x-4, foot)], "#9b987a")
    for i in range(5):
        offset = 4 + i * (width-29)/5
        stroke([(x+9+offset, y+18), (x-1+offset, foot-6-i%2*5)], "#626f60", 1.3)
    stroke([(x-12, foot+3), (x+width+9, foot+7)], "#b1a47e", 2)


def bridge():
    # The parallel deck continues beyond the main road's fractured span.
    for x, y, w, foot in [(110, 441, 65, 580), (310, 398, 55, 542),
                           (516, 369, 48, 507), (684, 346, 41, 474),
                           (861, 318, 31, 417), (945, 303, 25, 389)]:
        pier(x, y, w, foot)
    polygon([(36, 434), (988, 275), (988, 291), (36, 468)], "#1a3834")
    stroke([(36, 437), (988, 277)], "#d9c29a", 3)

    # Bowstring arch and hangers, receding toward the right-hand shore.
    def arch(t):
        return 196 + 386*t, 404 - 64*t - 500*t*(1-t)

    rib = [arch(i/90) for i in range(91)]
    for i in range(1, 21):
        t = i / 21
        x, y = arch(t)
        base = 406 - 64*t
        stroke([(x, y), (x+6, base)], INK, 4)
        stroke([(x+1.6, y+6), (x+7.6, base-4)], "#b1ab86", 1.3)
    stroke([(x+14, y-13) for x, y in rib], "#7d8066", 9)
    for i in range(2, 19, 2):
        x, y = arch(i/20)
        stroke([(x, y), (x+14, y-13)], INK, 5)
    stroke(rib, INK, 13)
    stroke([(x, y-3) for x, y in rib], "#c7b68e", 3)

    polygon([(36, 465), (661, 348), (702, 340), (718, 345), (708, 353),
             (715, 359), (701, 360), (695, 378), (36, 508)], INK)
    polygon([(36, 465), (661, 348), (702, 340), (718, 345), (708, 353),
             (36, 487)], "#b2a17c")
    stroke([(36, 483), (708, 350)], "#eee0b5", 3)
    for x in range(49, 698, 19):
        y = 481 - (x-36)*.196
        stroke([(x, y), (x, y-11)], INK, 2)
    polygon([(701, 365), (715, 369), (780, 446), (773, 462), (752, 451),
             (698, 401), (682, 376)], INK)
    polygon([(702, 367), (715, 369), (780, 446), (763, 441), (687, 376)], "#c17c51")
    stroke([(698, 374), (771, 448)], "#f0c992", 3)
    for i in range(1, 8):
        x, y = 698+i*9, 374+i*9
        stroke([(x-3, y+3), (x-8, y+9)], "#9b987a", 2)
    polygon([(837, 317), (988, 287), (988, 307), (836, 341), (842, 332),
             (827, 333), (840, 325)], INK)
    polygon([(837, 317), (988, 287), (988, 298), (835, 327), (840, 325)], "#b2a17c")
    stroke([(845, 323), (988, 294)], "#eee0b5", 2)
    for x, y in [(733, 385), (767, 400), (788, 413), (807, 432)]:
        polygon([(x, y), (x+8, y+2), (x+4, y+8)], "#c49365")
    for x, y, length in [(728, 468, 82), (756, 476, 73), (727, 489, 85)]:
        stroke([(x, y), (x+length*.45, y+2), (x+length, y-2)], "#c3aa78", 2)


def virus(cx, cy):
    for i in range(13):
        angle = i * 2*pi / 13
        x, y = cos(angle), sin(angle)
        length = 56 + i%4*4
        stroke([(cx+x*42, cy+y*42), (cx+x*length, cy+y*length)], "#722e2b", 5)
        oval(cx+x*length, cy+y*length, 5, 5, "#722e2b")
    oval(cx, cy, 48, 48, "#722e2b")
    for i in range(17):
        y = -42 + i*5
        width = sqrt(45**2-y**2)
        stroke([(cx-width, cy+y), (cx+width*.88, cy+y-5)], "#d48a66", 1.5)
    for x, y in [(-20, -12), (11, -21), (25, 6), (-13, 19), (5, 6), (10, 29)]:
        oval(cx+x, cy+y, 4, 4, "#f1b58c")


def earthshot(cx, cy):
    oval(cx, cy-11, 43, 43, GOLD)
    for y in range(-46, 28, 6):
        width = sqrt(42**2-(y+11)**2)
        stroke([(cx-width, cy+y), (cx+width, cy+y)], "#9c733f", 1.2)
    polygon([(cx-1, cy+30), (cx-30, cy+16), (cx-56, cy-33), (cx-25, cy-22),
             (cx-7, cy-2), (cx, cy+22), (cx+9, cy-9), (cx+32, cy-31),
             (cx+54, cy-39), (cx+39, cy+3), (cx+15, cy+26)], "#c1cf9b")
    stroke([(cx-43, cy-21), (cx-17, cy+9), (cx, cy+29), (cx+36, cy-21)], INK, 2)
    stroke([(cx, cy+26), (cx, cy+51)], GOLD, 4)
    polygon([(cx-8, cy+43), (cx+8, cy+43), (cx+13, cy+52), (cx+27, cy+55),
             (cx+27, cy+61), (cx-27, cy+61), (cx-27, cy+55), (cx-13, cy+52)], GOLD)


def captions():
    box(36, 548, 988, 630, INK)
    label(53, 156, "KERCH STRAIT", 23)
    label(53, 563, "Crimean Bridge partly collapses", 59, "NimbusRoman-Bold", PAPER)
    label(37, 645, "Ukraine reports a missile and drone attack on the crossing.", 31,
          "NimbusSans-Regular")

    stroke([(36, 696), (988, 696)], INK, 2)
    box(36, 714, 503, 858, "#e1a07b")
    box(521, 714, 988, 858, "#315847")
    virus(139, 785)
    earthshot(621, 784)
    stroke([(249, 741), (249, 829)], "#ac4e36", 1.5)
    stroke([(714, 741), (714, 829)], "#8ba581", 1.5)
    label(272, 748, "Status held for", 23, "NimbusSans-Bold", "#722e2b")
    label(270, 783, "26 years", 42, "NimbusRoman-Bold", "#722e2b")
    label(737, 754, "Environmental", 29, "NimbusSans-Bold", PAPER)
    label(737, 793, "awards", 29, "NimbusSans-Bold", PAPER)
    label(36, 871, "UNITED STATES", 23, color="#933e2b")
    label(521, 871, "MUMBAI, INDIA", 23, color="#315847")
    label(35, 908, "US loses measles", 45, "NimbusRoman-Bold")
    label(35, 953, "elimination status", 45, "NimbusRoman-Bold")
    label(520, 908, "Earthshot Prize", 45, "NimbusRoman-Bold")
    label(520, 953, "honours winners", 45, "NimbusRoman-Bold")
    stroke([(36, 1008), (988, 1008)], RUST, 4)


def render():
    issue_header()
    strait()
    bridge()
    captions()
    result = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    result.save(Path(__file__).with_name("entry.png"), optimize=True)


if __name__ == "__main__":
    render()
