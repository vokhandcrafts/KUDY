"""Render branded in-app loading concepts and pre-route Explore at 390 × 844."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
BRAND = HERE.parents[1]
FONTS = BRAND / "outputs" / "G25.01" / "fonts"
CITY_ART = BRAND / "outputs" / "mobile-welcome-2026-10-19" / "art" / "07-found-object.jpg"
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


def city_art(width, height):
    art = Image.open(CITY_ART).convert("RGB").crop((0, 80, 1024, 644))
    return art.resize((width * SCALE, height * SCALE), Image.Resampling.LANCZOS)


def save(image, name):
    image.resize((390, 844), Image.Resampling.LANCZOS).save(HERE / name, optimize=True)


def launch_atlas():
    image = Image.new("RGB", (390 * SCALE, 844 * SCALE), PAPER)
    draw = ImageDraw.Draw(image)
    draw.line(box((37, 173, 37, 222)), fill=GREEN, width=8)
    text(draw, (57, 164), "KUDY", size=61, color=GREEN, face="GolosText_600SemiBold.ttf")
    draw.line(box((37, 255, 353, 255)), fill="#9CB4A6", width=3)

    draw.rounded_rectangle(box((23, 321, 367, 622)), radius=17 * SCALE, fill="#E7E2D7")
    draw.rounded_rectangle(box((31, 312, 359, 611)), radius=14 * SCALE, fill="#FFFCF7", outline="#C4BDB0", width=2)
    art = city_art(302, 172)
    image.paste(art, box((44, 331)))
    draw = ImageDraw.Draw(image)
    draw.line(box((44, 525, 195, 542, 346, 525)), fill="#8DA99C", width=4)
    draw.line(box((195, 542, 195, 591)), fill="#C4BDB0", width=2)
    draw.line(box((60, 555, 173, 564)), fill="#B7C9BE", width=3)
    draw.line(box((217, 564, 330, 555)), fill="#B7C9BE", width=3)
    draw.line(box((59, 580, 171, 587)), fill="#D3DDD5", width=3)
    draw.line(box((219, 587, 331, 580)), fill="#D3DDD5", width=3)
    save(image, "01-atlas-opening.png")
    return image


def launch_threshold():
    image = Image.new("RGB", (390 * SCALE, 844 * SCALE), GREEN)
    draw = ImageDraw.Draw(image)
    text(draw, (54, 143), "KUDY", size=61, color=PAPER, face="GolosText_600SemiBold.ttf")
    draw.line(box((55, 225, 335, 225)), fill="#B8D0C1", width=3)
    draw.ellipse(box((46, 305, 344, 603)), fill="#143F31")
    draw.rectangle(box((46, 454, 344, 672)), fill="#143F31")
    draw.ellipse(box((58, 317, 332, 591)), fill=PAPER)
    draw.rectangle(box((58, 454, 332, 660)), fill=PAPER)
    art = Image.open(CITY_ART).convert("RGB").crop((279, 0, 745, 564))
    art = art.resize((274 * SCALE, 343 * SCALE), Image.Resampling.LANCZOS)
    mask = Image.new("L", image.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.ellipse(box((58, 317, 332, 591)), fill=255)
    mask_draw.rectangle(box((58, 454, 332, 660)), fill=255)
    image.paste(art, box((58, 317)), mask.crop(box((58, 317, 332, 660))))
    draw = ImageDraw.Draw(image)
    draw.line(box((58, 660, 332, 660)), fill="#B8D0C1", width=4)
    save(image, "01-city-threshold.png")
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
    text(draw, (22, 126), "Куды сёння?", size=30, face="GolosText_600SemiBold.ttf")
    text(draw, (23, 172), "Абяры, што цікава табе ў горадзе.", size=14, color=MUTED)

    art = city_art(346, 190)
    image.paste(art, box((22, 216)))
    draw = ImageDraw.Draw(image)
    text(draw, (23, 425), "АБЯРЫ НАПРАМАК", size=11, color=GREEN, face="GolosText_600SemiBold.ttf")
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
    atlas = launch_atlas().resize((390, 844), Image.Resampling.LANCZOS)
    threshold = launch_threshold().resize((390, 844), Image.Resampling.LANCZOS)
    second = explore().resize((390, 844), Image.Resampling.LANCZOS)
    sheet = Image.new("RGB", (844, 906), "#E8E5DF")
    sheet.paste(threshold, (20, 20))
    sheet.paste(second, (434, 20))
    draw = ImageDraw.Draw(sheet)
    draw.text((20, 869), "01  ·  Горад адкрываецца", fill=INK, font=ImageFont.truetype(str(FONTS / "GolosText_600SemiBold.ttf"), 14))
    draw.text((434, 869), "02  ·  Пасля запуску, да выбару гіда", fill=INK, font=ImageFont.truetype(str(FONTS / "GolosText_600SemiBold.ttf"), 14))
    sheet.save(HERE / "entry-pair.png", optimize=True)
    options = Image.new("RGB", (1258, 906), "#E8E5DF")
    for x, frame in ((20, atlas), (434, threshold), (848, second)):
        options.paste(frame, (x, 20))
    labels = ((20, "A · Атлас адкрываецца"), (434, "Б · Парог горада"), (848, "Пасля запуску · Explore"))
    draw = ImageDraw.Draw(options)
    for x, label in labels:
        draw.text((x, 869), label, fill=INK, font=ImageFont.truetype(str(FONTS / "GolosText_600SemiBold.ttf"), 14))
    options.save(HERE / "entry-options.png", optimize=True)


if __name__ == "__main__":
    main()
