"""Lays screenshots side by side into one image: python3 scripts/sheet.py out.png a.png b.png ..."""
import sys
from PIL import Image

out, paths = sys.argv[1], sys.argv[2:]
images = [Image.open(p).convert('RGB') for p in paths]
height = max(i.height for i in images)
gap = 16
sheet = Image.new('RGB', (sum(i.width for i in images) + gap * (len(images) + 1), height + 2 * gap), (220, 216, 205))
x = gap
for image in images:
    sheet.paste(image, (x, gap))
    x += image.width + gap
sheet.save(out)
