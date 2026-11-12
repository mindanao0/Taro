"""Static SEO pages: cards/<slug>.html for each card + cards/index.html + sitemap.xml. Run after editing data/cards.public.json."""
import json, re, html
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SITE = 'https://ivoryrosetarot.online'
cards = json.loads((ROOT/'data/cards.public.json').read_text())['cards']
slug = lambda c: re.sub(r'[^a-z0-9]+', '-', c['name_en'].lower()).strip('-')
e = html.escape
CSS = '''<style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0908;color:#ece4d3;font:400 17px/1.75 "IBM Plex Sans Thai","Noto Sans Thai",system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}a{color:#c8a25a}h1{font:400 2rem/1.3 "Instrument Serif","IBM Plex Sans Thai",Georgia,serif;margin:.3em 0}h2{font-size:1.15rem;color:#c8a25a;margin:1.6em 0 .2em}
img{width:min(280px,100%);height:auto;border-radius:8px;display:block}.kw{color:#9a8f7e}nav.p{display:flex;justify-content:space-between;gap:12px;margin-top:2em}.cta{display:inline-block;margin:1.5em 0;padding:.6em 1.2em;border:1px solid #c8a25a;border-radius:99px;text-decoration:none}
ul.g{columns:2;padding-left:1.2em}@media(max-width:520px){ul.g{columns:1}}</style>'''
def page(title, desc, path, body, ld=None, img=None):
    url = f'{SITE}/{path}'
    og = img or f'{SITE}/assets/share.jpg'
    ldj = f'<script type="application/ld+json">{json.dumps(ld,ensure_ascii=False)}</script>\n' if ld else ''
    return f'''<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}">
<link rel="icon" type="image/png" href="/assets/favicon.png">
<meta property="og:type" content="article"><meta property="og:locale" content="th_TH"><meta property="og:site_name" content="Ivory Rose Tarot">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}"><meta property="og:url" content="{url}"><meta property="og:image" content="{og}">
<meta name="twitter:card" content="summary_large_image">
{ldj}{CSS}
</head><body><main>
{body}
</main></body></html>
'''
out = ROOT/'cards'; out.mkdir(exist_ok=True)
urls = [f'{SITE}/', f'{SITE}/cards/']
for i, c in enumerate(cards):
    s = slug(c); kw = ' · '.join(c['keywords_th'])
    title = f"ไพ่ {c['name_en']} ({c['name_th']}) ความหมายไพ่ตั้งและไพ่กลับ ความรัก การงาน - Ivory Rose Tarot"
    desc = f"ความหมายไพ่ทาโร่ {c['name_en']} ({c['name_th']}): {kw} อ่านไพ่ตั้ง ไพ่กลับ ความรัก การงาน และคำถามชวนคิด"
    prev, nxt = cards[i-1], cards[(i+1) % len(cards)]
    sections = [('ไพ่ตั้ง', 'upright_th'), ('ไพ่กลับ', 'reversed_th'), ('ความรัก', 'love_th'), ('การงาน', 'work_th'), ('คำแนะนำ', 'advice_th'), ('คำถามชวนคิด', 'reflection_th')]
    body = f'''<a href="/cards/">← ไพ่ทั้ง 78 ใบ</a>
<h1>ไพ่ {e(c['name_en'])} ({e(c['name_th'])}) ความหมาย</h1>
<p class="kw">{e(kw)}</p>
<img src="/{c['image_web']}" alt="{e(c['alt_th'])}" width="280" height="480">
''' + ''.join(f"<h2>{e(c['name_en'])} {h}</h2><p>{e(c[k])}</p>\n" for h, k in sections) + f'''<a class="cta" href="/">เปิดไพ่ทาโร่ด้วยตัวเอง →</a>
<p class="kw">{e(json.loads((ROOT/'data/cards.public.json').read_text())['meaning_policy'])}</p>
<nav class="p"><a href="/cards/{slug(prev)}.html">← {e(prev['name_en'])}</a><a href="/cards/{slug(nxt)}.html">{e(nxt['name_en'])} →</a></nav>'''
    ld = {"@context": "https://schema.org", "@type": "Article", "headline": title, "inLanguage": "th", "image": f"{SITE}/{c['image_web']}", "mainEntityOfPage": f"{SITE}/cards/{s}.html", "publisher": {"@type": "Organization", "name": "Ivory Rose Tarot", "url": SITE + "/"}}
    (out/f'{s}.html').write_text(page(title, desc, f'cards/{s}.html', body, ld, f"{SITE}/{c['image_web']}"), encoding='utf-8')
    urls.append(f'{SITE}/cards/{s}.html')
groups = [('ไพ่เมเจอร์อาร์คานา', [c for c in cards if c['arcana'] == 'major'])] + [(n, [c for c in cards if c['suit'] == k]) for k, n in (('wands', 'ไพ่ชุดไม้เท้า (Wands)'), ('cups', 'ไพ่ชุดถ้วย (Cups)'), ('swords', 'ไพ่ชุดดาบ (Swords)'), ('pentacles', 'ไพ่ชุดเหรียญ (Pentacles)'))]
body = '<a href="/">← เปิดไพ่</a><h1>ความหมายไพ่ทาโร่ทั้ง 78 ใบ</h1><p>ความหมายไพ่ตั้งและไพ่กลับ ความรัก การงาน ของสำรับ Gothic Ivory Rose แยกตามชุด</p>' + ''.join(
    f'<h2>{e(n)}</h2><ul class="g">' + ''.join(f"<li><a href=\"/cards/{slug(c)}.html\">{e(c['name_en'])} ({e(c['name_th'])})</a></li>" for c in cs) + '</ul>' for n, cs in groups)
(out/'index.html').write_text(page('ความหมายไพ่ทาโร่ทั้ง 78 ใบ ไพ่ตั้ง ไพ่กลับ ความรัก การงาน - Ivory Rose Tarot', 'รวมความหมายไพ่ทาโร่ครบ 78 ใบ เมเจอร์และไมเนอร์อาร์คานา ไพ่ตั้ง ไพ่กลับ ความรัก การงาน เรียบเรียงเป็นภาษาไทย', 'cards/', body), encoding='utf-8')
(ROOT/'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <url><loc>{u}</loc></url>\n' for u in urls) + '</urlset>\n')
print(f'wrote {len(cards)} card pages, hub, sitemap ({len(urls)} urls)')
