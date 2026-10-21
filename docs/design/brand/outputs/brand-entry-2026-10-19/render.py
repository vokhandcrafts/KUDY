"""Compare the optional in-app loading state with the ready KUDY Explore screen."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONTS = HERE.parent / "G25.01" / "fonts"
S = 3
PAPER = "#FAF7F2"
WHITE = "#FFFDF9"
INK = "#22262B"
GREEN = "#1D6B4F"
MUTED = "#59635D"
HAIRLINE = "#D9D6CD"


def at(*values):
    return tuple(round(v * S) for v in values)


def face(filename, size):
    return ImageFont.truetype(str(FONTS / filename), round(size * S))


def put(draw, xy, value, size, color=INK, display=False, strong=False):
    filename = "Alegreya_600SemiBold.ttf" if display else (
        "GolosText_600SemiBold.ttf" if strong else "GolosText_400Regular.ttf"
    )
    draw.text(at(*xy), value, font=face(filename, size), fill=color)


def base(with_header=True):
    image = Image.new("RGB", at(390, 844), PAPER)
    draw = ImageDraw.Draw(image)
    if with_header:
        put(draw, (22, 57), "KUDY", 30, GREEN, strong=True)
        draw.line(at(22, 105, 368, 105), fill=HAIRLINE, width=2)
    draw.rounded_rectangle(at(319, 18, 323, 27), radius=2 * S, fill=INK)
    draw.rounded_rectangle(at(325, 16, 329, 27), radius=2 * S, fill=INK)
    draw.rounded_rectangle(at(331, 14, 335, 27), radius=2 * S, fill=INK)
    draw.rounded_rectangle(at(337, 12, 341, 27), radius=2 * S, fill=INK)
    draw.rounded_rectangle(at(352, 16, 368, 27), radius=3 * S, outline=INK, width=2)
    draw.rectangle(at(355, 19, 363, 24), fill=INK)
    put(draw, (22, 15), "9:41", 13, strong=True)
    return image


def page_card(draw, y, title, subline):
    draw.rounded_rectangle(at(22, y, 368, y + 91), radius=12 * S, fill=WHITE, outline=HAIRLINE, width=2)
    draw.rounded_rectangle(at(22, y + 12, 27, y + 79), radius=2 * S, fill=GREEN)
    put(draw, (43, y + 16), title, 20, strong=True)
    put(draw, (43, y + 52), subline, 12, MUTED)
    draw.line(at(340, y + 43, 348, y + 50, 340, y + 57), fill=GREEN, width=4)


def nav(draw):
    draw.rectangle(at(0, 755, 390, 844), fill=WHITE)
    draw.line(at(0, 755, 390, 755), fill=HAIRLINE, width=2)
    draw.rounded_rectangle(at(23, 770, 178, 817), radius=11 * S, fill="#E8F0E9")
    put(draw, (56, 783), "Explore", 15, GREEN, strong=True)
    put(draw, (243, 783), "My KUDY", 15, MUTED, strong=True)


def screen(ready):
    image = base(ready)
    draw = ImageDraw.Draw(image)
    if not ready:
        # An app-owned waiting surface, shown only if data actually takes time.
        draw.rounded_rectangle(at(77, 253, 329, 518), radius=10 * S, fill="#DFE8DF", outline=HAIRLINE, width=2)
        draw.rounded_rectangle(at(62, 238, 314, 503), radius=10 * S, fill="#EFECE4", outline=HAIRLINE, width=2)
        draw.rounded_rectangle(at(47, 222, 299, 487), radius=10 * S, fill=WHITE, outline=HAIRLINE, width=2)
        draw.rounded_rectangle(at(47, 250, 54, 317), radius=2 * S, fill=GREEN)
        draw.polygon([at(268, 222), at(299, 222), at(299, 253)], fill="#D8E5D8")
        draw.line(at(268, 222, 268, 253, 299, 253), fill=HAIRLINE, width=2)
        word = "KUDY"
        word_font = face("GolosText_600SemiBold.ttf", 49)
        width = draw.textbbox((0, 0), word, font=word_font)[2]
        draw.text(((image.width - width) // 2 - 16 * S, 333 * S), word, font=word_font, fill=GREEN)
        draw.line(at(167, 416, 230, 416), fill=GREEN, width=5)
        put(draw, (115, 553), "Рыхтуем матэрыялы…", 13, MUTED)
    else:
        draw.rounded_rectangle(at(254, 124, 368, 168), radius=10 * S, fill=WHITE, outline=HAIRLINE, width=2)
        put(draw, (268, 136), "Гданьск", 13, strong=True)
        draw.line(at(344, 142, 350, 148, 356, 142), fill=INK, width=3)
        put(draw, (22, 131), "Куды сёння?", 30, display=True)
        put(draw, (23, 192), "Абяры, што цікава табе ў горадзе.", 14, MUTED)
        put(draw, (23, 238), "АДКРЫВАЙ ПА-СВОЙМУ", 11, GREEN, strong=True)
        page_card(draw, 267, "Гіды", "Аўтарскія гісторыі")
        page_card(draw, 371, "Побач", "Месцы і моманты вакол")
        page_card(draw, 475, "Чым заняцца", "Гарадскія падборкі і парады")
        put(draw, (23, 617), "Можна пачаць з любой тэмы.", 13, MUTED)
        nav(draw)
    result = image.resize((390, 844), Image.Resampling.LANCZOS)
    result.save(HERE / ("02-ready.png" if ready else "01-loading.png"), optimize=True)
    return result


def main():
    loading = screen(False)
    ready = screen(True)
    board = Image.new("RGB", (844, 904), "#E9E7E2")
    board.paste(loading, (20, 20))
    board.paste(ready, (434, 20))
    draw = ImageDraw.Draw(board)
    small = ImageFont.truetype(str(FONTS / "GolosText_600SemiBold.ttf"), 14)
    draw.text((20, 871), "01 · Калі чакаем змест", fill=INK, font=small)
    draw.text((434, 871), "02 · Калі Explore гатовы", fill=INK, font=small)
    board.save(HERE / "entry-pair.png", optimize=True)


if __name__ == "__main__":
    main()
