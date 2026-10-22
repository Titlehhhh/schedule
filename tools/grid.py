#!/usr/bin/env python3
"""Разбор сетки таблицы расписания: где строки, где дни, где половинки ячеек.

    python tools/grid.py <картинка>

Печатает:
  * полноширинные горизонтальные линии (= границы ячеек),
  * жирные линии (= границы между днями),
  * для каждого дня: строки, подпись времени в колонке времени,
    разделители половинок внутри строки и высоту текстового блока в каждой
    половинке (по ней видно, где текст, а где пусто).

Текст читать кропами: python tools/zoom.py <картинка> x0 y0 x1 y1 7
"""
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Нужен Pillow: pip install pillow")


def groups(seq, gap=2):
    out = []
    for v in seq:
        if out and v - out[-1][-1] <= gap:
            out[-1].append(v)
        else:
            out.append([v])
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    im = Image.open(path).convert("RGB")
    W, H = im.size
    px = im.load()
    print("картинка: %dx%d" % (W, H))

    def darkness(y, x0, x1, thr=150):
        d = 0
        for x in range(x0, x1):
            r, g, b = px[x, y]
            if (r + g + b) / 3 < thr:
                d += 1
        return d

    # --- вертикальные линии = границы колонок -------------------------------
    vlines = []
    for x in range(W):
        col = sum(1 for y in range(0, H, 3) if darkness(y, x, x + 1) > 0.6)
        if col > (H / 3) * 0.6:
            vlines.append(x)
    vlines = [g[0] for g in groups(vlines, 2)]
    print("границы колонок (x):", vlines)
    if len(vlines) < 2:
        print("не нашёл колонки — разбор ненадёжен, проверь вручную")
        return

    # крайние границы таблицы часто совпадают с краем картинки
    bounds = [0] + vlines + [W]
    ranges = [(bounds[i] + 2, bounds[i + 1] - 2) for i in range(len(bounds) - 1)]
    print("колонки (x):", ranges)
    if len(ranges) < 3:
        print("мало колонок — разбор ненадёжен, проверь вручную")
        return

    time_x0, time_x1 = ranges[1]
    cont_x0, cont_x1 = ranges[2]
    print("колонка времени: x %d..%d | колонка содержимого: x %d..%d"
          % (time_x0, time_x1, cont_x0, cont_x1))

    # --- горизонтальные линии в колонке содержимого --------------------------
    hs = [y for y in range(H) if darkness(y, cont_x0, cont_x1) > (cont_x1 - cont_x0) * 0.9]
    rows = []
    for g in groups(hs, 2):
        rows.append((g[0], g[-1], g[-1] - g[0] >= 2))   # (y0, y1, толстая?)
    print("\nгоризонтальные границы (y, толстая = граница дня):")
    for y0, y1, thick in rows:
        print("   %4d%s" % (y0, "  <-- граница дня" if thick else ""))

    # --- подписи времени ------------------------------------------------------
    bands = []
    cur = None
    gapcnt = 0
    for y in range(H):
        d = sum(1 for x in range(time_x0, time_x1) if darkness(y, x, x + 1) > 0.5)
        if d >= 2:
            if cur is None:
                cur = [y, y]
            else:
                cur[1] = y
            gapcnt = 0
        else:
            if cur is not None:
                gapcnt += 1
                if gapcnt > 4:
                    bands.append(tuple(cur))
                    cur = None
    if cur:
        bands.append(tuple(cur))
    print("\nтекст в колонке времени (y-полосы, только настоящий текст):")
    for a, b in bands:
        if b - a < 7:
            continue
        print("   %4d-%4d  центр %4d" % (a, b, (a + b) // 2))

    # --- структура по дням ----------------------------------------------------
    day_bounds = [y0 for y0, y1, thick in rows if thick]
    if not day_bounds:
        print("\nграницы дней не найдены")
        return
    edges = [rows[0][0]] + day_bounds + [H]
    print("\nструктура по дням (высота текстового блока в половинках):")
    for d in range(len(edges) - 1):
        y0, y1 = edges[d], edges[d + 1]
        inner = [y for y, _, _ in rows if y0 < y < y1]
        bounds = [y0] + inner + [y1]
        print("  ДЕНЬ %d (y %d..%d)" % (d + 1, y0, y1))
        for i in range(len(bounds) - 1):
            a, b = bounds[i], bounds[i + 1]
            subs = [y for y in inner if a < y < b]
            txt = 0
            for y in range(a, b):
                if darkness(y, cont_x0 + 10, cont_x1 - 10) > 3:
                    txt += 1
            print("     строка %d  y %4d-%4d  половинок %d  текст %4d px %s"
                  % (i + 1, a, b, len(subs) + 1, txt,
                     "<-- ПУСТО" if txt <= 2 else ""))
            for s in subs:
                print("            разделитель половинок: y=%d" % s)


if __name__ == "__main__":
    main()
