"""Render the reaction meme offline using Pillow and local Open Sans fonts."""

import argparse
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

FONTS = Path("/usr/share/fonts/truetype/open-sans")
MAX_BYTES = 1_048_576

NEWS = (
    "Trump greets Xi and Putin  •  Israel crosses Gaza’s Yellow Line",
    "Kuwait says it repelled Iran attack  •  Battles in Kharkiv gas tunnel",
    "Ghana’s $60m jet draws outrage  •  Waymo exits US freeways",
)


def font(face, size):
    return ImageFont.truetype(str(FONTS / f"OpenSans-{face}.ttf"), size)


def outlined_caption(canvas, phrase, y, size, max_width=978):
    face = font("ExtraBold", size)
    stroke = 7
    left, top, right, bottom = face.getbbox(phrase, stroke_width=stroke)
    lettering = Image.new("RGBA", (right - left + 4, bottom - top + 4))
    ImageDraw.Draw(lettering).text(
        (2 - left, 2 - top), phrase, font=face, fill="white",
        stroke_width=stroke, stroke_fill="black",
    )
    width = min(max_width, round(lettering.width * 0.78))
    lettering = lettering.resize((width, lettering.height), Image.Resampling.LANCZOS)
    if y + lettering.height > 852:
        raise ValueError(f"Caption overlaps footer: {phrase}")
    canvas.paste(lettering, ((1024 - width) // 2, y), lettering)


def render(artwork):
    canvas = Image.new("RGB", (1024, 1024), "black")
    with Image.open(artwork) as original:
        hero = ImageOps.contain(original.convert("RGB"), (1024, 852), Image.Resampling.LANCZOS)
    canvas.paste(hero, ((1024 - hero.width) // 2, (852 - hero.height) // 2))

    outlined_caption(canvas, "ME: I’M GONNA STOP", 12, 84)
    outlined_caption(canvas, "DOOMSCROLLING.", 83, 105)
    outlined_caption(canvas, "ALSO ME: ONE LAST REFRESH.", 749, 98)

    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 852, 1023, 1023), fill="#181818")
    date_font = font("ExtraBold", 29)
    story_font = font("CondBold", 35)
    draw.text((24, 865), "WEDNESDAY 18 NOVEMBER 2026", fill="#ffffff", font=date_font, anchor="lt")
    draw.text((1000, 869), "SATIRICAL COMPOSITE", fill="#ffc399", font=font("Bold", 21), anchor="rt")
    for row, line in enumerate(NEWS):
        if draw.textlength(line, font=story_font) > 976:
            raise ValueError(f"News line overflows footer: {line}")
        draw.text((24, 904 + 36 * row), line, fill="#f4f4f4", font=story_font, anchor="lt")
    return canvas


def save_entry(canvas, output):
    for colors in (None, 256):
        image = canvas if colors is None else canvas.quantize(colors=colors)
        buffer = BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        if buffer.tell() <= MAX_BYTES:
            output.write_bytes(buffer.getvalue())
            return
    raise ValueError("PNG exceeds the competition’s byte limit")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artwork", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("entry.png"))
    args = parser.parse_args()
    save_entry(render(args.artwork), args.output)
