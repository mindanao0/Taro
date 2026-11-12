"""SEO images: assets/seo/thumb/<id>.webp (card page, 560px wide instead of the 937px original) and assets/seo/share/<id>.jpg (1200x630 social preview).
Needs Pillow with raqm (Thai shaping) and Noto Sans/Serif Thai; run after card art or names change, then build_seo.py."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[1]
FONTS = Path('/usr/share/fonts/google-noto-vf')
cards = json.loads((ROOT/'data/cards.public.json').read_text())['cards']
for d in ('thumb', 'share'): (ROOT/'assets/seo'/d).mkdir(parents=True, exist_ok=True)
def font(name, size, weight):
    f = ImageFont.truetype(str(FONTS/name), size)
    f.set_variation_by_axes([weight]); return f
serif, sans = 'NotoSerif[wght].ttf', 'NotoSansThai[wght].ttf'  # Noto Thai fonts have no Latin glyphs, so English uses NotoSerif
def wrap(draw, text, f, width):
    lines, cur = [], ''
    for ch in text:  # Thai has no spaces: break by pixel width
        if draw.textlength(cur + ch, font=f) > width and cur: lines.append(cur); cur = ''
        cur += ch
    return lines + [cur]
for c in cards:
    im = Image.open(ROOT/c['image_web']).convert('RGB')
    im.resize((560, round(560*im.height/im.width)), Image.LANCZOS).save(ROOT/f"assets/seo/thumb/{c['id']}.webp", 'WEBP', quality=60, method=6)
    bg = Image.new('RGB', (1200, 630), '#0b0908'); d = ImageDraw.Draw(bg)
    h = 540; art = im.resize((round(h*im.width/im.height), h), Image.LANCZOS); bg.paste(art, (70, 45))
    x = 70 + art.width + 70; w = 1200 - x - 60
    d.text((x, 70), 'IVORY ROSE TAROT', font=font(serif, 24, 500), fill='#9a8f7e')
    y = 130
    for ln in wrap(d, c['name_en'], font(serif, 74, 500), w): d.text((x, y), ln, font=font(serif, 74, 500), fill='#c8a25a'); y += 100
    d.text((x, y + 4), c['name_th'], font=font(sans, 42, 500), fill='#ece4d3'); y += 80
    for ln in wrap(d, '   '.join(c['keywords_th']), font(sans, 30, 400), w)[:3]: d.text((x, y), ln, font=font(sans, 30, 400), fill='#9a8f7e'); y += 50
    d.text((x, 555), 'ความหมายไพ่ตั้ง ไพ่กลับ ความรัก การงาน', font=font(sans, 26, 400), fill='#c8a25a')
    bg.save(ROOT/f"assets/seo/share/{c['id']}.jpg", 'JPEG', quality=84, optimize=True)
print(f'wrote {len(cards)} thumbs + share images')
