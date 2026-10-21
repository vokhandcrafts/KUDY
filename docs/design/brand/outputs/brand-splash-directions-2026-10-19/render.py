"""Rebuild ten mobile brand-opening sketches. These are proposals, not app assets."""

from math import cos, pi, sin
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
FONTS = HERE.parent / "G25.01" / "fonts"
W, H, S = 390, 844, 2
PAPER = "#FAF7F2"
GREEN = "#1D6B4F"
INK = "#22262B"
PALE = "#DCE9DF"
MIST = "#EDE9E1"
CLAY = "#805039"  # proposal only, never a production token


class Canvas:
    def __init__(self, color=PAPER):
        self.im = Image.new("RGB", (W * S, H * S), color)
        self.d = ImageDraw.Draw(self.im)

    def p(self, seq):
        return tuple(round(v * S) for v in seq)

    def line(self, pts, fill=INK, width=2, joint="curve"):
        self.d.line([self.p(p) for p in pts], fill=fill, width=round(width * S), joint=joint)

    def rect(self, box, fill=None, outline=None, width=1, radius=0):
        self.d.rounded_rectangle(self.p(box), radius=radius * S, fill=fill, outline=outline, width=width * S)

    def ellipse(self, box, fill=None, outline=None, width=1):
        self.d.ellipse(self.p(box), fill=fill, outline=outline, width=width * S)

    def poly(self, points, fill=None, outline=None):
        self.d.polygon([self.p(p) for p in points], fill=fill, outline=outline)

    def arc(self, box, start, end, fill=INK, width=2):
        self.d.arc(self.p(box), start, end, fill=fill, width=width * S)

    def text(self, xy, value, size=20, color=INK, weight="regular", anchor=None):
        name = {"regular": "GolosText_400Regular.ttf", "bold": "GolosText_600SemiBold.ttf", "serif": "Alegreya_600SemiBold.ttf", "hand": "Caveat_400Regular.ttf"}[weight]
        font = ImageFont.truetype(FONTS / name, size * S)
        self.d.text(self.p(xy), value, font=font, fill=color, anchor=anchor)


def base(c, number, light=False):
    color = PAPER if light else GREEN
    c.text((28, 37), f"{number:02d} / KUDY", 13, color, "bold")
    c.line([(28, 68), (362, 68)], color, 1)
    c.text((28, 807), "KUDY · ДАСЛЕДАВАННЕ АЙДЭНТЫКІ", 10, color)
    c.text((362, 807), "2026", 10, color, anchor="ra")


def word(c, y, size=70, color=GREEN, x=195):
    c.text((x, y), "KUDY", size, color, "bold", "ma")


def concept_01():
    c = Canvas()
    base(c, 1)
    c.text((30, 144), "КУДЫ?", 66, GREEN, "bold")
    c.text((31, 223), "Пытанне, з якога пачынаецца рух.", 15, INK)
    c.arc((65, 322, 330, 587), 24, 315, GREEN, 4)
    c.ellipse((284, 346, 298, 360), fill=GREEN)
    c.ellipse((139, 545, 151, 557), fill=INK)
    c.line([(145, 551), (172, 530), (195, 509), (224, 505)], GREEN, 3)
    c.poly([(220, 499), (238, 505), (223, 512)], GREEN)
    c.text((32, 666), "Гісторыі пачынаюцца", 27, INK, "serif")
    c.text((32, 700), "з твайго выбару.", 27, INK, "serif")
    c.text((32, 756), "KUDY", 36, GREEN, "bold")
    return c


def concept_02():
    c = Canvas(GREEN)
    base(c, 2, True)
    c.rect((48, 176, 342, 639), fill=PAPER, radius=3)
    c.poly([(265, 176), (342, 176), (342, 253)], fill=PALE)
    c.line([(265, 176), (265, 253), (342, 253)], GREEN, 1)
    c.text((75, 240), "KUDY", 58, GREEN, "bold")
    c.line([(77, 339), (260, 339)], INK, 2)
    c.line([(77, 361), (289, 361)], INK, 2)
    c.line([(77, 383), (200, 383)], INK, 2)
    c.ellipse((72, 459, 103, 490), outline=GREEN, width=3)
    c.line([(98, 484), (143, 528), (170, 511), (227, 549)], GREEN, 3)
    c.ellipse((222, 544, 232, 554), fill=GREEN)
    c.text((58, 685), "Адкрый сваю старонку", 27, PAPER, "serif")
    return c


def concept_03():
    c = Canvas()
    base(c, 3)
    c.text((32, 153), "НЯМА АДНОЙ", 25, GREEN, "bold")
    c.text((32, 190), "ПРАВІЛЬНАЙ", 25, GREEN, "bold")
    c.text((32, 227), "ДАРОГІ", 25, GREEN, "bold")
    for pts in [[(26, 470), (107, 398), (180, 411), (248, 352), (364, 363)],
                [(22, 543), (115, 512), (168, 534), (257, 472), (363, 497)],
                [(25, 612), (105, 639), (182, 597), (261, 634), (367, 565)]]:
        c.line(pts, GREEN, 3)
    c.ellipse((160, 521, 184, 545), fill=PAPER, outline=INK, width=3)
    c.ellipse((243, 463, 267, 487), fill=PAPER, outline=INK, width=3)
    c.ellipse((251, 620, 275, 644), fill=PAPER, outline=INK, width=3)
    word(c, 735, 54)
    return c


def concept_04():
    c = Canvas(INK)
    base(c, 4, True)
    c.text((30, 132), "Разам", 45, PAPER, "serif")
    c.text((31, 181), "але ў сваім тэмпе", 20, PAPER)
    c.arc((26, 319, 251, 594), 215, 50, PAPER, 6)
    c.arc((142, 365, 366, 630), 215, 46, PALE, 6)
    c.ellipse((118, 545, 136, 563), fill=PAPER)
    c.ellipse((254, 581, 272, 599), fill=PALE)
    c.line([(127, 554), (165, 538), (204, 548), (263, 590)], PAPER, 2)
    c.text((31, 712), "KUDY", 63, PAPER, "bold")
    return c


def concept_05():
    c = Canvas()
    base(c, 5)
    word(c, 196, 62)
    c.text((195, 281), "Малое застаецца з намі", 19, INK, "serif", "ma")
    c.ellipse((72, 350, 318, 596), fill=MIST, outline=CLAY, width=4)
    c.ellipse((94, 372, 296, 574), outline=CLAY, width=1)
    c.arc((117, 410, 273, 550), 180, 349, GREEN, 4)
    c.ellipse((128, 469, 143, 484), fill=GREEN)
    c.ellipse((249, 494, 262, 507), fill=GREEN)
    c.line([(181, 430), (192, 418), (204, 430), (215, 418)], CLAY, 2)
    c.text((195, 669), "ЗНАХОДКА", 13, CLAY, "bold", "ma")
    c.text((195, 713), "Не ўзнагарода. Успамін.", 19, INK, "serif", "ma")
    return c


def concept_06():
    c = Canvas(GREEN)
    base(c, 6, True)
    c.text((31, 165), "Месца", 45, PAPER, "serif")
    c.text((31, 213), "мае голас.", 45, PAPER, "serif")
    mid = 460
    heights = [17, 36, 59, 88, 113, 80, 42, 18, 12, 31, 52, 28, 13]
    for i, h in enumerate(heights):
        x = 37 + i * 26
        c.line([(x, mid - h / 2), (x, mid + h / 2)], PAPER, 6)
    c.text((31, 651), "KUDY", 69, PAPER, "bold")
    c.text((32, 755), "Паслухай, калі захочаш.", 15, PAPER)
    return c


def concept_07():
    c = Canvas()
    base(c, 7)
    c.text((31, 139), "Паглядзі", 45, GREEN, "serif")
    c.text((31, 190), "інакш.", 45, GREEN, "serif")
    c.rect((43, 310, 347, 624), outline=INK, width=3, radius=151)
    c.rect((66, 333, 324, 601), fill=PALE, radius=129)
    c.poly([(66, 571), (105, 518), (138, 537), (174, 470), (222, 535), (265, 486), (324, 549), (324, 601), (66, 601)], fill=GREEN)
    c.ellipse((243, 373, 271, 401), fill=PAPER)
    c.line([(68, 570), (110, 527), (136, 538), (174, 479), (218, 534), (264, 494), (322, 550)], PAPER, 2)
    c.text((31, 656), "KUDY", 66, GREEN, "bold")
    c.text((32, 759), "Кожны горад — іншая гісторыя.", 14, INK)
    return c


def concept_08():
    c = Canvas()
    base(c, 8)
    c.rect((26, 114, 363, 717), outline=INK, width=1)
    c.line([(77, 114), (77, 717)], GREEN, 2)
    c.text((97, 152), "KUDY", 63, GREEN, "bold")
    c.text((98, 245), "ГОРАД / ГІСТОРЫІ", 11, INK, "bold")
    c.line([(97, 274), (334, 274)], INK, 1)
    c.text((98, 332), "Заўваж", 43, INK, "serif")
    c.text((98, 380), "сваё.", 43, INK, "serif")
    c.line([(97, 458), (321, 458)], PALE, 11)
    c.line([(97, 490), (287, 490)], PALE, 11)
    c.line([(97, 522), (303, 522)], PALE, 11)
    c.line([(97, 554), (223, 554)], PALE, 11)
    c.line([(97, 625), (240, 625)], GREEN, 2)
    c.text((97, 660), "01 / НЕ СПЯШАЙСЯ", 12, GREEN, "bold")
    return c


def concept_09():
    c = Canvas(GREEN)
    base(c, 9, True)
    c.text((32, 141), "ТВОЙ ВЫБАР", 28, PAPER, "bold")
    c.text((33, 183), "ад самага пачатку", 17, PAPER)
    c.line([(54, 322), (54, 584)], PAPER, 2)
    for y, length, label in [(331, 260, "Гісторыі"), (443, 310, "Месцы"), (555, 220, "Ідэі")]:
        c.ellipse((46, y - 8, 62, y + 8), fill=PAPER)
        c.line([(68, y), (length, y)], PAPER, 2)
        c.text((72, y + 13), label, 27, PAPER, "serif")
    c.text((37, 704), "KUDY", 69, PAPER, "bold")
    return c


def concept_10():
    c = Canvas()
    base(c, 10)
    c.text((31, 137), "Не ўсё", 47, INK, "serif")
    c.text((31, 191), "на паверхні.", 47, INK, "serif")
    # An abstract clay impression: no claim of likeness to the figurine.
    for radius in (54, 78, 103, 128):
        c.arc((195 - radius, 465 - radius, 195 + radius, 465 + radius), 205, 338, CLAY, 2)
        c.arc((195 - radius, 465 - radius, 195 + radius, 465 + radius), 23, 148, CLAY, 2)
    for angle in range(0, 360, 30):
        a = angle * pi / 180
        c.line([(195 + 139 * cos(a), 465 + 139 * sin(a)), (195 + 153 * cos(a), 465 + 153 * sin(a))], CLAY, 1)
    c.ellipse((183, 453, 207, 477), fill=GREEN)
    c.text((31, 659), "KUDY", 66, GREEN, "bold")
    c.text((32, 760), "Адчуй дэталь месца.", 16, INK)
    return c


CONCEPTS = [concept_01, concept_02, concept_03, concept_04, concept_05,
            concept_06, concept_07, concept_08, concept_09, concept_10]
SLUGS = ["question", "open-page", "free-paths", "companion", "keepsake",
         "voice", "window", "editorial", "choice", "imprint"]


def main():
    thumbs = Image.new("RGB", (5 * 254, 2 * 576), "#E9E6DF")
    d = ImageDraw.Draw(thumbs)
    label = ImageFont.truetype(FONTS / "GolosText_600SemiBold.ttf", 16)
    for index, (fn, slug) in enumerate(zip(CONCEPTS, SLUGS)):
        c = fn()
        c.im.save(HERE / f"{index + 1:02d}-{slug}.png", optimize=True)
        thumb = c.im.resize((234, 506), Image.Resampling.LANCZOS)
        x = index % 5 * 254 + 10
        y = index // 5 * 576 + 10
        thumbs.paste(thumb, (x, y))
        d.text((x, y + 517), f"{index + 1:02d}  {slug}", font=label, fill=INK)
    thumbs.save(HERE / "all-ten.png", optimize=True)
    print("Rendered 10 screens at 390 x 844 logical pixels and contact sheet")


if __name__ == "__main__":
    main()
