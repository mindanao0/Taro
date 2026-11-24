"""Build the landscape social card from the unchanged Christmas Wish The Star art."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = Path('/usr/share/fonts/google-noto-vf')
ART = ROOT / 'assets/christmas-wish/previews/major-17-star.webp'
OUT = ROOT / 'assets/seo/share/christmas-wish.jpg'


def font(name, size, weight):
    result = ImageFont.truetype(str(FONTS / name), size)
    result.set_variation_by_axes([weight])
    return result


def main():
    # Text stays inside the centered 630×630 crop. The card remains uncropped
    # in the intended 1200×630 display and retains its original aspect ratio.
    image = Image.new('RGB', (1200, 630), '#251b1e')
    d = ImageDraw.Draw(image)
    gold, ivory = '#d6ad78', '#f6e7d6'
    d.rounded_rectangle((34, 34, 1166, 596), radius=20, outline='#6c4b43', width=2)
    d.line((99, 128, 335, 128), fill='#7c5148', width=1)
    d.line((99, 502, 335, 502), fill='#7c5148', width=1)
    d.ellipse((130, 220, 136, 226), fill=gold)
    d.ellipse((220, 396, 228, 404), fill=gold)
    d.ellipse((174, 329, 178, 333), fill=gold)
    d.ellipse((1107, 484, 1113, 490), fill=gold)
    d.line((529, 450, 571, 450), fill=gold, width=2)
    serif = 'NotoSerif[wght].ttf'
    sans = 'NotoSansThai[wght].ttf'
    d.text((550, 157), 'IVORY ROSE TAROT', font=font(serif, 26, 500), fill=gold, anchor='mm')
    d.text((550, 241), 'Christmas', font=font(serif, 65, 500), fill=ivory, anchor='mm')
    d.text((550, 321), 'Wish Tarot', font=font(serif, 65, 500), fill=ivory, anchor='mm')
    d.text((550, 401), 'December 1–31, 2026', font=font(serif, 30, 500), fill=gold, anchor='mm')
    with Image.open(ART) as source:
        h = 468
        art = source.convert('RGB').resize((round(h * source.width / source.height), h), Image.Resampling.LANCZOS)
    x, y = 785, 81
    d.rounded_rectangle((x - 6, y - 6, x + art.width + 5, y + h + 5), radius=10, fill='#a67f5b')
    image.paste(art, (x, y))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT, 'JPEG', quality=86, optimize=True)


if __name__ == '__main__':
    main()
