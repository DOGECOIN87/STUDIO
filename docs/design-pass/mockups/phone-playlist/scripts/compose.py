# Usage: python3 compose.py out.png "file|title|subtitle" ...
import sys
from PIL import Image, ImageDraw, ImageFont
out, items = sys.argv[1], [a.split('|') for a in sys.argv[2:]]
fp = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
f1 = ImageFont.truetype(fp, 44); f2 = ImageFont.truetype(fp.replace('-Bold', ''), 30)
imgs = [Image.open(i[0]) for i in items]
w, h = imgs[0].size; gap = 40; head = 130
img = Image.new('RGB', (len(imgs) * w + (len(imgs) + 1) * gap, h + head + gap), (14, 14, 22))
d = ImageDraw.Draw(img)
for k, (im, it) in enumerate(zip(imgs, items)):
    x = gap + k * (w + gap)
    d.text((x, 22), it[1], font=f1, fill=(246, 248, 252))
    d.text((x, 78), it[2], font=f2, fill=(166, 170, 192))
    img.paste(im, (x, head))
img.save(out); print(out, img.size)
