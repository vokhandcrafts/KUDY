"""Render a proposed native launch frame and pre-route Explore frame at 390 × 844."""

from io import BytesIO
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFont, ImageOps

HERE = Path(__file__).resolve().parent
BRAND = HERE.parents[1]
FONTS = BRAND / "outputs" / "G25.01" / "fonts"
FIGURINE = BRAND / "references" / "a1.png"
SCALE = 3
PAPER = "#FAF7F2"
GREEN = "#1D6B4F"
INK = "#22262B"
MUTED = "#5F6561"
LINE = "#D7D4CA"


def box(values):
    return tuple(round(value * SCALE) for value in values)


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), round(size * SCALE))


def text(draw, xy, value, *, size, color=INK, face="GolosText_400Regular.ttf"):
    draw.text(box(xy), value, fill=color, font=font(face, size))


def svg_image(path, width, height):
    payload = cairosvg.svg2png(url=str(path), output_width=width * SCALE, output_height=height * SCALE)
    return Image.open(BytesIO(payload)).convert("RGBA")


def save(image, name):
    image.resize((390, 844), Image.Resampling.LANCZOS).save(HERE / name, optimize=True)


def launch():
    image = Image.new("RGB", (390 * SCALE, 844 * SCALE), GREEN)
    source = Image.open(FIGURINE).convert("RGBA")
    silhouette = Image.new("RGBA", source.size, PAPER)
    silhouette.putalpha(source.getchannel("A"))
    mark = ImageOps.contain(silhouette, (184 * SCALE, 184 * SCALE), Image.Resampling.LANCZOS)
    image.paste(mark, ((image.width - mark.width) // 2, (image.height - mark.height) // 2), mark)
    save(image, "01-loading.png")
    return image


def card(draw, y, label, detail, glyph):
    draw.rounded_rectangle(box((22, y, 368, y + 72)), radius=13 * SCALE, fill="#FFFFFF", outline=LINE, width=2)
    draw.rounded_rectangle(box((34, y + 14, 78, y + 58)), radius=10 * SCALE, fill="#EDF2ED")
    if glyph == "book":
        draw.line(box((45, y + 24, 55, y + 27, 55, y + 49, 45, y + 46, 45, y + 24)), fill=GREEN, width=3)
        draw.line(box((55, y + 27, 66, y + 24, 66, y + 46, 55, y + 49)), fill=GREEN, width=3)
    elif glyph == "nearby":
        draw.ellipse(box((45, y + 25, 67, y + 47)), outline=GREEN, width=3)
        draw.ellipse(box((53, y + 33, 59, y + 39)), fill=GREEN)
    else:
        draw.line(box((55, y + 22, 55, y + 50)), fill=GREEN, width=3)
        draw.line(box((42, y + 36, 69, y + 36)), fill=GREEN, width=3)
        draw.line(box((46, y + 27, 65, y + 46)), fill=GREEN, width=2)
        draw.line(box((46, y + 46, 65, y + 27)), fill=GREEN, width=2)
    text(draw, (91, y + 13), label, size=18, face="GolosText_600SemiBold.ttf")
    text(draw, (91, y + 40), detail, size=12, color=MUTED)
    text(draw, (340, y + 23), "›", size=25, color=GREEN, face="Alegreya_600SemiBold.ttf")


def explore():
    image = Image.new("RGB", (390 * SCALE, 844 * SCALE), PAPER)
    draw = ImageDraw.Draw(image)
    text(draw, (24, 15), "9:41", size=13, face="GolosText_600SemiBold.ttf")
    for index, height in enumerate((5, 7, 9, 12)):
        draw.rounded_rectangle(box((321 + index * 6, 27 - height, 325 + index * 6, 27)), radius=2 * SCALE, fill=INK)
    draw.rounded_rectangle(box((351, 16, 368, 27)), radius=3 * SCALE, outline=INK, width=2)
    draw.rectangle(box((354, 19, 363, 24)), fill=INK)
    draw.rectangle(box((369, 19, 371, 24)), fill=INK)
    text(draw, (22, 57), "KUDY", size=26, color=GREEN, face="GolosText_600SemiBold.ttf")
    draw.rounded_rectangle(box((244, 53, 368, 97)), radius=10 * SCALE, fill="#FFFFFF", outline=LINE, width=2)
    text(draw, (257, 65), "Гданьск", size=14, face="GolosText_600SemiBold.ttf")
    draw.line(box((344, 72, 350, 78, 356, 72)), fill=INK, width=3)
    text(draw, (22, 123), "Куды сёння?", size=34, face="Alegreya_600SemiBold.ttf")
    text(draw, (23, 172), "Абяры, што цікава табе ў горадзе.", size=14, color=MUTED)

    art = svg_image(HERE / "city-vignette.svg", 346, 190)
    image.paste(art, box((22, 216)), art)
    draw = ImageDraw.Draw(image)
    text(draw, (23, 425), "АДКРЫВАЙ ПА-СВОЙМУ", size=11, color=GREEN, face="GolosText_600SemiBold.ttf")
    card(draw, 451, "Гіды", "Аўтарскія гісторыі горада", "book")
    card(draw, 535, "Побач", "Месцы і падказкі вакол", "nearby")
    card(draw, 619, "Чым заняцца", "Падборкі і гарадскія ідэі", "spark")

    draw.rectangle(box((0, 758, 390, 844)), fill="#FFFFFF")
    draw.line(box((0, 758, 390, 758)), fill=LINE, width=2)
    draw.rounded_rectangle(box((33, 772, 159, 818)), radius=13 * SCALE, fill="#EAF2EC")
    text(draw, (53, 782), "Explore", size=15, color=GREEN, face="GolosText_600SemiBold.ttf")
    text(draw, (246, 782), "My KUDY", size=15, color=MUTED, face="GolosText_600SemiBold.ttf")
    save(image, "02-explore.png")
    return image


def main():
    first = launch().resize((390, 844), Image.Resampling.LANCZOS)
    second = explore().resize((390, 844), Image.Resampling.LANCZOS)
    sheet = Image.new("RGB", (844, 906), "#E8E5DF")
    sheet.paste(first, (20, 20))
    sheet.paste(second, (434, 20))
    draw = ImageDraw.Draw(sheet)
    draw.text((20, 869), "01  ·  Пакуль праграма запускаецца", fill=INK, font=ImageFont.truetype(str(FONTS / "GolosText_600SemiBold.ttf"), 14))
    draw.text((434, 869), "02  ·  Пасля запуску, да выбару гіда", fill=INK, font=ImageFont.truetype(str(FONTS / "GolosText_600SemiBold.ttf"), 14))
    sheet.save(HERE / "entry-pair.png", optimize=True)


if __name__ == "__main__":
    main()
