#!/usr/bin/env python3
"""Увеличенный кроп части картинки — для посимвольного чтения текста.

    python tools/zoom.py <картинка> <x0> <y0> <x1> <y1> [масштаб]

Координаты — в пикселях оригинала. Результат кладётся в .work/crops/ и
печатается в stdout (путь можно сразу открыть в image-viewer).
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Нужен Pillow: pip install pillow")


def main():
    if len(sys.argv) < 6:
        sys.exit(__doc__)

    src = sys.argv[1]
    x0, y0, x1, y1 = (int(v) for v in sys.argv[2:6])
    scale = float(sys.argv[6]) if len(sys.argv) > 6 else 6.0

    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".work", "crops")
    os.makedirs(out_dir, exist_ok=True)

    im = Image.open(src).convert("RGB")
    box = (max(0, x0), max(0, y0), min(im.width, x1), min(im.height, y1))
    crop = im.crop(box)
    crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
    path = os.path.join(out_dir, "zoom_%d_%d_%d_%d.png" % (x0, y0, x1, y1))
    crop.save(path)
    print(path)
    print("размер кропа: %dx%d (масштаб x%g)" % (crop.width, crop.height, scale))


if __name__ == "__main__":
    main()
