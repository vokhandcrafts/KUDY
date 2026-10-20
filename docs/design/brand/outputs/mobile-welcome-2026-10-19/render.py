"""Render comparable 390 × 844 KUDY mobile welcome concepts from saved artwork."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONTS = HERE.parent / "G25.01" / "fonts"
PAPER = "#FAF7F2"
INK = "#22262B"
MUTED = "#505954"
GREEN = "#1D6B4F"
GREEN_DARK = "#124D38"
LINE = "#C9C4BA"
NAMES = [
    "01-doorway",
    "02-waterfront",
    "03-detail",
    "04-atlas",
    "05-harbor-walk",
    "06-after-rain",
    "07-found-object",
    "08-night-harbor",
]
ART_TOP = {"08-night-harbor": 230}


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def screen(name: str) -> Image.Image:
    canvas = Image.new("RGB", (390, 844), PAPER)
    draw = ImageDraw.Draw(canvas)
    draw.text((22, 37), "KUDY", fill=GREEN, font=font("GolosText_600SemiBold.ttf", 27))
    draw.rounded_rectangle((300, 34, 368, 79), 9, fill="#FFFCF7", outline=LINE, width=1)
    draw.text((312, 47), "Меню", fill=INK, font=font("GolosText_600SemiBold.ttf", 13))
    draw.line((22, 94, 368, 94), fill=LINE, width=1)

    art = Image.open(HERE / "art" / f"{name}.jpg").convert("RGB")
    top = ART_TOP.get(name, 0)
    crop_height = round(art.width * 445 / 390)
    art = art.crop((0, top, art.width, top + crop_height)).resize(
        (390, 445), Image.Resampling.LANCZOS
    )
    # Each source has space for UI; blend its bottom edge into the canonical paper.
    pixels = art.load()
    base = Image.new("RGB", art.size, PAPER)
    base_pixels = base.load()
    for y in range(385, 445):
        alpha = (445 - y) / 60
        for x in range(390):
            source = pixels[x, y]
            background = base_pixels[x, y]
            pixels[x, y] = tuple(
                round(alpha * source[i] + (1 - alpha) * background[i]) for i in range(3)
            )
    canvas.paste(art, (0, 103))
    draw = ImageDraw.Draw(canvas)

    draw.text(
        (22, 555),
        "ГДАНЬСК  ·  ГІД ДЛЯ ПАЧАТКУ",
        fill=GREEN,
        font=font("GolosText_600SemiBold.ttf", 11),
    )
    draw.text(
        (22, 579),
        "Жураў і людзі порта",
        fill=INK,
        font=font("Alegreya_600SemiBold.ttf", 30),
    )
    draw.text(
        (22, 624),
        "Аўтарская гісторыя пра працу",
        fill=MUTED,
        font=font("GolosText_400Regular.ttf", 14),
    )
    draw.text(
        (22, 644),
        "і людзей горада ля вады.",
        fill=MUTED,
        font=font("GolosText_400Regular.ttf", 14),
    )
    draw.rounded_rectangle((22, 698, 368, 754), 10, fill=GREEN_DARK)
    draw.rounded_rectangle((22, 696, 368, 750), 10, fill=GREEN)
    draw.text(
        (41, 713),
        "Адкрыць гід",
        fill="#FFFFFF",
        font=font("GolosText_600SemiBold.ttf", 17),
    )
    draw.text(
        (337, 713),
        "→",
        fill="#FFFFFF",
        font=font("GolosText_600SemiBold.ttf", 18),
    )
    draw.text(
        (22, 783),
        "Усе гіды →",
        fill=INK,
        font=font("GolosText_600SemiBold.ttf", 13),
    )
    draw.text(
        (297, 783),
        "Побач →",
        fill=INK,
        font=font("GolosText_600SemiBold.ttf", 13),
    )
    return canvas


def main() -> None:
    images = []
    for name in NAMES:
        rendered = screen(name)
        rendered.save(HERE / f"{name}.png", optimize=True)
        images.append(rendered)

    sheet = Image.new("RGB", (390 * 4 + 30 * 5, 844 * 2 + 70 * 3), "#E9E7E2")
    draw = ImageDraw.Draw(sheet)
    for index, (name, image) in enumerate(zip(NAMES, images)):
        column, row = index % 4, index // 4
        left = 30 + column * 420
        top = 35 + row * 914
        sheet.paste(image, (left, top))
        draw.text(
            (left, top + 850),
            name,
            fill=INK,
            font=font("GolosText_600SemiBold.ttf", 15),
        )
    sheet.save(HERE / "all-eight.png", optimize=True)


if __name__ == "__main__":
    main()
