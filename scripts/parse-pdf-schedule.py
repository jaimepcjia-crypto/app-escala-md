import json
import math
import sys
from pathlib import Path

import fitz

PURPLE = (180, 167, 214)

DAYS = [
    ("MONDAY", 257.9, 308.4, "Segunda"),
    ("TUESDAY", 308.0, 355.5, "Terca"),
    ("WEDNESDAY", 355.1, 402.6, "Quarta"),
    ("THURSDAY", 402.2, 449.7, "Quinta"),
    ("FRIDAY", 449.2, 496.8, "Sexta"),
    ("SATURDAY", 532.4, 577.4, "Sabado"),
    ("SUNDAY", 607.5, 652.0, "Domingo"),
]

BANDS = [
    (90, 162, "SEDE MOURA DUBEUX", "8h-12h", "MORNING", 8),
    (163, 236, "SEDE MOURA DUBEUX", "12h-16h", "AFTERNOON", 12),
    (237, 310, "SEDE MOURA DUBEUX", "16h-20h", "NIGHT", 16),
    (313, 337, "CS MD", "9h-14h / 14h-19h", "MORNING", 9),
    (338, 361, "M CLUB", "9h-13h30 / 13h30-18h", "MORNING", 9),
    (362, 426, "QUIOSQUE", "9h-13h / 13h-17h30 / 17h30-22h", "AFTERNOON", 9),
    (427, 486, "BARRA", "9h-13h / 13h-17h30 / 17h30-22h", "AFTERNOON", 9),
    (487, 506, "STAND / SOMB", "9h-13h30 / 13h30-18h", "MORNING", 9),
    (507, 526, "LIGACAO", "8h-20h", "AFTERNOON", 8),
    (527, 552, "SEDE MD / O.A.", "17h-20h", "NIGHT", 17),
]


def rgb(fill):
    return tuple(round(c * 255) for c in fill[:3])


def hex_color(color):
    return "#" + "".join(f"{part:02X}" for part in color)


def distance(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def day_for_x(x):
    for key, x0, x1, label in DAYS:
        if x0 - 2 <= x <= x1 + 2:
            return key, label
    return None, None


def band_for_y(y):
    for y0, y1, local, time_label, shift, start_hour in BANDS:
        if y0 <= y <= y1:
            return local, time_label, shift, start_hour
    return None, None, None, None


def text_inside(words, rect):
    found = []
    for x0, y0, x1, y1, word, *_ in words:
        cx = (x0 + x1) / 2
        cy = (y0 + y1) / 2
        if rect.x0 - 1 <= cx <= rect.x1 + 1 and rect.y0 - 1 <= cy <= rect.y1 + 1:
            found.append((x0, word))
    return " ".join(word for _, word in sorted(found)).strip()


def main(path):
    doc = fitz.open(path)
    page = doc[0]
    words = page.get_text("words")
    cells = []

    for drawing in page.get_drawings():
        fill = drawing.get("fill")
        rect = drawing.get("rect")
        if not fill or not rect:
            continue
        color = rgb(fill)
        if color in [(0, 0, 0), (255, 255, 255)]:
            continue
        day, day_label = day_for_x((rect.x0 + rect.x1) / 2)
        local, time_label, shift, start_hour = band_for_y((rect.y0 + rect.y1) / 2)
        if not day or not local:
            continue
        text = text_inside(words, rect)
        owner_type = "FERREIRA_WINDOW" if distance(color, PURPLE) <= 45 else "EXTERNAL_IMPORTED"
        if owner_type != "FERREIRA_WINDOW" and not text:
            continue
        cells.append(
            {
                "rowIndex": round(rect.y0),
                "colIndex": round(rect.x0),
                "rowLabel": local,
                "colLabel": day_label,
                "localName": local,
                "timeLabel": time_label,
                "dayOfWeek": day,
                "shift": shift,
                "startHour": start_hour,
                "dateLabel": None,
                "text": text,
                "colorHex": hex_color(color),
                "ownerType": owner_type,
                "confidence": 0.86 if owner_type == "FERREIRA_WINDOW" else 0.78,
            }
        )

    payload = json.dumps({"cells": cells}, ensure_ascii=False)
    sys.stdout.buffer.write(payload.encode("utf-8"))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
