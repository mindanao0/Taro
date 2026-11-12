"""Static SEO pages: cards/<slug>.html for each card + cards/index.html + sitemap.xml. Run after editing data/cards.public.json."""
import json, re, html
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SITE = 'https://ivoryrosetarot.online'
payload = json.loads((ROOT/'data/cards.public.json').read_text()); cards = payload['cards']
extra = json.loads((ROOT/'data/seo_extra.json').read_text())  # per-card money/health text (hand-written)
slug = lambda c: re.sub(r'[^a-z0-9]+', '-', c['name_en'].lower()).strip('-')
e = html.escape
CSS = '''<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" media="print" onload="this.media='all'" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@300;400;500;600&family=Instrument+Serif:ital@0;1&display=swap">
<style>:root{color-scheme:dark;--gut:clamp(20px,3.5vw,64px)}*{box-sizing:border-box}body{margin:0;min-height:100vh;color:#ece4d3;font:400 17px/1.75 "IBM Plex Sans Thai","Noto Sans Thai",system-ui,sans-serif;background:radial-gradient(900px 520px at 50% -120px,#241a11 0,transparent 70%) no-repeat,#0b0908}
a{color:#c8a25a}header.site{max-width:1680px;margin:0 auto;padding:20px var(--gut);display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
header.site .brand{font:italic 400 1.6rem/1 "Instrument Serif",Georgia,serif;color:#ece4d3;text-decoration:none}header.site nav{display:flex;gap:22px}header.site nav a{color:#9a8f7e;text-decoration:none}header.site nav a:hover{color:#ece4d3}
main{max-width:1680px;margin:0 auto;padding:8px var(--gut) 72px}.cl .txt{max-width:980px}.txt{max-width:760px}
h1{font:400 clamp(1.9rem,4vw,2.8rem)/1.25 "Instrument Serif","IBM Plex Sans Thai",Georgia,serif;margin:.3em 0}h2{font-size:1.15rem;color:#c8a25a;margin:1.6em 0 .2em}h3{font-size:1rem;margin:1em 0 0}
img{max-width:100%;height:auto;border-radius:8px;display:block}.kw{color:#9a8f7e}nav.p{display:flex;justify-content:space-between;gap:12px;margin-top:2.5em}.cta{display:inline-block;margin:1.5em 0;padding:.6em 1.2em;border:1px solid #c8a25a;border-radius:99px;text-decoration:none}.cta:hover{background:#c8a25a22}
.cl{display:grid;grid-template-columns:minmax(260px,400px) minmax(0,1fr);gap:48px;align-items:start}.cl-img{position:sticky;top:24px}.cl-img img{width:100%}
.pairimgs{display:flex;gap:16px;flex-wrap:wrap}.pairimgs img{width:200px}
ul.g{columns:3;padding-left:1.2em}@media(max-width:900px){ul.g{columns:2}}@media(max-width:720px){.cl{grid-template-columns:1fr;gap:16px}.cl-img{position:static}.cl-img img{width:min(260px,100%)}ul.g{columns:1}}</style>'''
HEADER = '<header class="site"><a class="brand" href="/">Ivory Rose Tarot</a><nav><a href="/">เลือกไพ่</a><a href="/cards/">ไพ่ทั้งสำรับ</a><a href="/pairs/">ไพ่คู่</a><a href="/articles/">บทความ</a></nav></header>'
def page(title, desc, path, body, ld=None, img=None):
    ld = ld if isinstance(ld, list) or ld is None else [ld]
    url = f'{SITE}/{path}'
    if 'class="cl"' not in body and 'class="g"' not in body: body = f'<div class="txt">{body}</div>'  # long text: keep a readable line length
    og = img or f'{SITE}/assets/share.jpg'
    ldj = ''.join(f'<script type="application/ld+json">{json.dumps(x,ensure_ascii=False)}</script>\n' for x in (ld or []))
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
</head><body>{HEADER}<main>
{body}
</main></body></html>
'''
crumbs = lambda items: {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": n + 1, "name": name, "item": SITE + href} for n, (name, href) in enumerate(items)]}
out = ROOT/'cards'; out.mkdir(exist_ok=True)
urls = [f'{SITE}/', f'{SITE}/cards/']
for i, c in enumerate(cards):
    s = slug(c); kw = ' · '.join(c['keywords_th'])
    title = f"ไพ่ {c['name_en']} ({c['name_th']}) ความหมายไพ่ตั้งและไพ่กลับ ความรัก การงาน - Ivory Rose Tarot"
    desc = f"ความหมายไพ่ทาโร่ {c['name_en']} ({c['name_th']}): {kw} อ่านไพ่ตั้ง ไพ่กลับ ความรัก การงาน และคำถามชวนคิด"
    prev, nxt = cards[i-1], cards[(i+1) % len(cards)]
    c = {**c, **extra[c['id']]}
    sections = [('ไพ่ตั้ง', 'upright_th'), ('ไพ่กลับ', 'reversed_th'), ('ความรัก', 'love_th'), ('การงาน', 'work_th'), ('การเงิน', 'money_th'), ('สุขภาพและพลังใจ', 'health_th'), ('คำแนะนำ', 'advice_th'), ('คำถามชวนคิด', 'reflection_th')]
    same = [x for x in cards if x['id'] != c['id'] and (x['suit'] == c['suit'] if c['suit'] else x['arcana'] == 'major')]
    rel = [same[(i + k) % len(same)] for k in (3, 7, 11)]
    faq = [(f"ไพ่ {c['name_en']} ({c['name_th']}) หมายถึงอะไร", c['upright_th']), (f"ไพ่ {c['name_en']} กลับหัวหมายถึงอะไร", c['reversed_th']), (f"ไพ่ {c['name_en']} เรื่องความรักหมายถึงอะไร", c['love_th']), (f"ไพ่ {c['name_en']} เรื่องการงานและการเงินหมายถึงอะไร", c['work_th'] + ' ' + c['money_th'])]
    relh = '<ul>' + ''.join(f'<li><a href="/cards/{slug(x)}.html">{e(x["name_en"])} ({e(x["name_th"])})</a></li>' for x in rel) + '</ul>'
    body = f'''<a href="/cards/">← ไพ่ทั้ง 78 ใบ</a>
<div class="cl"><div class="cl-img"><img src="/assets/seo/thumb/{c['id']}.webp" alt="{e(c['alt_th'])}" width="340" height="609" fetchpriority="high"></div><div class="txt">
<h1>ไพ่ {e(c['name_en'])} ({e(c['name_th'])}) ความหมาย</h1>
<p class="kw">{e(kw)}</p>
''' + ''.join(f"<h2>{e(c['name_en'])} {h}</h2><p>{e(c[k])}</p>\n" for h, k in sections) + f'''<p class="kw">เรื่องสุขภาพเป็นการสะท้อนมุมมองเท่านั้น ไม่ใช่คำวินิจฉัยหรือคำแนะนำทางการแพทย์ หากมีอาการควรปรึกษาแพทย์</p>
<h2>ไพ่ที่เกี่ยวข้อง</h2>{relh}
<p>อ่านทุกใบแยกตามเรื่อง: <a href="/topics/love.html">ความรัก</a> · <a href="/topics/work.html">การงาน</a> · <a href="/topics/money.html">การเงิน</a> · <a href="/topics/health.html">สุขภาพ</a></p>
<a class="cta" href="/">เปิดไพ่ทาโร่ด้วยตัวเอง →</a>
<p class="kw">{e(payload['meaning_policy'])}</p>
<nav class="p"><a href="/cards/{slug(prev)}.html">← {e(prev['name_en'])}</a><a href="/cards/{slug(nxt)}.html">{e(nxt['name_en'])} →</a></nav></div></div>'''
    ld = [{"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]}, {"@context": "https://schema.org", "@type": "Article", "headline": title, "inLanguage": "th", "image": f"{SITE}/assets/seo/share/{c['id']}.jpg", "mainEntityOfPage": f"{SITE}/cards/{s}.html", "publisher": {"@type": "Organization", "name": "Ivory Rose Tarot", "url": SITE + "/"}}]
    ld.append(crumbs((('หน้าแรก', '/'), ('ไพ่ทั้ง 78 ใบ', '/cards/'), (c['name_en'], f'/cards/{s}.html'))))
    (out/f'{s}.html').write_text(page(title, desc, f'cards/{s}.html', body, ld, f"{SITE}/assets/seo/share/{c['id']}.jpg"), encoding='utf-8')
    urls.append(f'{SITE}/cards/{s}.html')
groups = [('ไพ่เมเจอร์อาร์คานา', [c for c in cards if c['arcana'] == 'major'])] + [(n, [c for c in cards if c['suit'] == k]) for k, n in (('wands', 'ไพ่ชุดไม้เท้า (Wands)'), ('cups', 'ไพ่ชุดถ้วย (Cups)'), ('swords', 'ไพ่ชุดดาบ (Swords)'), ('pentacles', 'ไพ่ชุดเหรียญ (Pentacles)'))]
body = '<a href="/">← เปิดไพ่</a><h1>ความหมายไพ่ทาโร่ทั้ง 78 ใบ</h1><p>ความหมายไพ่ตั้งและไพ่กลับ ความรัก การงาน ของสำรับ Gothic Ivory Rose แยกตามชุด</p><p>อ่านแยกตามเรื่อง: <a href="/topics/love.html">ความรัก</a> · <a href="/topics/work.html">การงาน</a> · <a href="/topics/money.html">การเงิน</a> · <a href="/topics/health.html">สุขภาพ</a> · <a href="/pairs/">ไพ่ออกคู่กัน</a> · <a href="/articles/">บทความ</a></p>' + ''.join(
    f'<h2>{e(n)}</h2><ul class="g">' + ''.join(f"<li><a href=\"/cards/{slug(c)}.html\">{e(c['name_en'])} ({e(c['name_th'])})</a></li>" for c in cs) + '</ul>' for n, cs in groups)
(out/'index.html').write_text(page('ความหมายไพ่ทาโร่ทั้ง 78 ใบ ไพ่ตั้ง ไพ่กลับ ความรัก การงาน - Ivory Rose Tarot', 'รวมความหมายไพ่ทาโร่ครบ 78 ใบ เมเจอร์และไมเนอร์อาร์คานา ไพ่ตั้ง ไพ่กลับ ความรัก การงาน เรียบเรียงเป็นภาษาไทย', 'cards/', body), encoding='utf-8')
TOPICS = [('love', 'ความรัก', 'love_th'), ('work', 'การงาน', 'work_th'), ('money', 'การเงิน', 'money_th'), ('health', 'สุขภาพและพลังใจ', 'health_th')]
(ROOT/'topics').mkdir(exist_ok=True)
for key, name, field in TOPICS:
    title = f'ความหมายไพ่ทาโร่เรื่อง{name} ครบทั้ง 78 ใบ - Ivory Rose Tarot'
    desc = f'รวมความหมายไพ่ทาโร่ทั้ง 78 ใบในเรื่อง{name} แยกตามชุด อ่านสั้น ๆ แล้วกดดูรายละเอียดแต่ละใบ'
    body = f'<a href="/cards/">← ไพ่ทั้ง 78 ใบ</a><h1>ความหมายไพ่ทาโร่เรื่อง{name}</h1><p>ไพ่แต่ละใบสะท้อนเรื่อง{name}ต่างกัน อ่านเป็นมุมมองให้ทบทวนตัวเอง ไม่ใช่คำทำนายที่แน่นอน</p><p>' + ' · '.join(f'<a href="/topics/{k}.html">{n}</a>' for k, n, _ in TOPICS if k != key) + '</p>'
    for gname, cs in groups:
        body += f'<h2>{e(gname)}</h2>'
        for c in cs:
            x = {**c, **extra[c['id']]}
            body += f"<h3><a href=\"/cards/{slug(c)}.html\">{e(c['name_en'])} ({e(c['name_th'])})</a></h3><p>{e(x[field])}</p>"
    body += '<a class="cta" href="/">เปิดไพ่ทาโร่ด้วยตัวเอง →</a>'
    ld = [crumbs((('หน้าแรก', '/'), ('ไพ่ทั้ง 78 ใบ', '/cards/'), (f'ไพ่เรื่อง{name}', f'/topics/{key}.html')))]
    (ROOT/'topics'/f'{key}.html').write_text(page(title, desc, f'topics/{key}.html', body, ld), encoding='utf-8')
    urls.append(f'{SITE}/topics/{key}.html')
# ---- /pairs/: curated pairs (scripts/seo_pairs.py). Elements duplicate scripts/reading-guide.mjs MAJOR_ELEMENT/SUIT_ELEMENT (ponytail: two copies, move to a JSON file if they ever change)
import sys; sys.path.insert(0, str(ROOT/'scripts'))
from seo_pairs import PAIRS
MAJOR_EL = dict(zip((f'major-{i:02d}' for i in range(22)), 'air air water earth fire earth air water fire earth fire air water water fire earth fire air water fire fire earth'.split()))
SUIT_EL = {'wands': 'fire', 'cups': 'water', 'swords': 'air', 'pentacles': 'earth'}
EL_TH = {'fire': 'ไฟ', 'water': 'น้ำ', 'air': 'ลม', 'earth': 'ดิน'}
el = lambda c: MAJOR_EL[c['id']] if c['arcana'] == 'major' else SUIT_EL[c['suit']]
byid = {c['id']: c for c in cards}
def relation_th(a, b):
    ea, eb = el(a), el(b)
    if ea == eb: return f"ทั้งสองใบเป็นธาตุ{EL_TH[ea]}เหมือนกัน เรื่องราวจึงไปทางเดียวกันและเสริมน้ำหนักกัน ลองสังเกตว่ามีอะไรที่วนซ้ำอยู่"
    k = ''.join(sorted([ea, eb]))
    if k in ('airfire', 'earthwater'): return f"{a['name_en']} (ธาตุ{EL_TH[ea]}) กับ {b['name_en']} (ธาตุ{EL_TH[eb]}) เป็นธาตุที่หนุนกัน พลังของสองใบต่อกันได้ง่าย สิ่งหนึ่งช่วยให้อีกสิ่งเดินต่อ"
    if k in ('firewater', 'airearth'): return f"{a['name_en']} (ธาตุ{EL_TH[ea]}) กับ {b['name_en']} (ธาตุ{EL_TH[eb]}) เป็นธาตุที่ขัดกัน สองเรื่องดึงไปคนละทาง ควรถามว่าอะไรสำคัญกว่าก่อนตัดสินใจ"
    return f"{a['name_en']} (ธาตุ{EL_TH[ea]}) กับ {b['name_en']} (ธาตุ{EL_TH[eb]}) ไม่ขัดและไม่ต่อกันตรง ๆ เป็นสองมุมของเรื่องเดียวกัน ให้อ่านแยกกันแล้วดูว่ามุมไหนที่ยังมองข้าม"
(ROOT/'pairs').mkdir(exist_ok=True)
pair_links = []
for ia, ib, why in PAIRS:
    a, b = byid[ia], byid[ib]; ps = f'{slug(a)}-and-{slug(b)}'
    title = f"ไพ่ {a['name_en']} + {b['name_en']} ความหมายเมื่อออกคู่กัน - Ivory Rose Tarot"
    desc = f"ความหมายไพ่ทาโร่ {a['name_en']} ({a['name_th']}) คู่กับ {b['name_en']} ({b['name_th']}): {why}"
    sec = ''.join(f"<h2>{e(c['name_en'])} ({e(c['name_th'])})</h2><p>{e(c['upright_th'])}</p><p class=\"kw\">คำสำคัญ: {e(' · '.join(c['keywords_th']))}</p><p><a href=\"/cards/{slug(c)}.html\">อ่านความหมายเต็มของ {e(c['name_en'])}</a></p>" for c in (a, b))
    body = f'''<a href="/cards/">← ไพ่ทั้ง 78 ใบ</a><h1>ไพ่ {e(a['name_en'])} + {e(b['name_en'])} เมื่อออกคู่กัน</h1><p>{e(why)}</p>
<div class="pairimgs"><img src="/assets/seo/thumb/{a['id']}.webp" alt="{e(a['alt_th'])}" width="200" height="358"><img src="/assets/seo/thumb/{b['id']}.webp" alt="{e(b['alt_th'])}" width="200" height="358"></div>
<h2>ธาตุของสองใบนี้</h2><p>{e(relation_th(a, b))}</p>{sec}
<h2>ถ้าเป็นเรื่องความรักและการงาน</h2><p><b>ความรัก:</b> {e(a['love_th'])} ส่วนอีกใบ: {e(b['love_th'])}</p><p><b>การงาน:</b> {e(a['work_th'])} ส่วนอีกใบ: {e(b['work_th'])}</p>
<p class="kw">การอ่านเป็นคู่ขึ้นกับคำถาม ตำแหน่งในการวางไพ่ และว่าใบไหนกลับหัว ใช้เป็นแนวคิดเพื่อทบทวนตัวเอง ไม่ใช่คำทำนายที่แน่นอน</p>
<a class="cta" href="/">เปิดไพ่ทาโร่ด้วยตัวเอง →</a>'''
    ld = [crumbs((('หน้าแรก', '/'), ('ไพ่ทั้ง 78 ใบ', '/cards/'), (f"{a['name_en']} + {b['name_en']}", f'/pairs/{ps}.html')))]
    (ROOT/'pairs'/f'{ps}.html').write_text(page(title, desc, f'pairs/{ps}.html', body, ld, f"{SITE}/assets/seo/share/{a['id']}.jpg"), encoding='utf-8')
    urls.append(f'{SITE}/pairs/{ps}.html'); pair_links.append(f'<li><a href="/pairs/{ps}.html">{e(a["name_en"])} + {e(b["name_en"])}</a></li>')
body = '<a href="/cards/">← ไพ่ทั้ง 78 ใบ</a><h1>ความหมายไพ่ทาโร่เมื่อออกคู่กัน</h1><p>คู่ไพ่ที่คนมักค้นหา อ่านความสัมพันธ์ของสองใบผ่านธาตุและความหมายของแต่ละใบ</p><ul>' + ''.join(pair_links) + '</ul>'
(ROOT/'pairs'/'index.html').write_text(page('ความหมายไพ่ทาโร่เมื่อออกคู่กัน คู่ยอดนิยม - Ivory Rose Tarot', 'รวมความหมายไพ่ทาโร่เมื่อออกคู่กัน เช่น The Lovers + The Devil, Death + The Tower อ่านผ่านธาตุและความหมายของแต่ละใบ', 'pairs/', body), encoding='utf-8')
urls.append(f'{SITE}/pairs/')
# ---- /articles/: hand-written guides in data/seo_articles.json (sections of paragraphs; inline HTML allowed, links are checked by seo.test.mjs)
articles = json.loads((ROOT/'data/seo_articles.json').read_text())
(ROOT/'articles').mkdir(exist_ok=True)
for art in articles:
    body = f"<a href=\"/articles/\">← บทความทั้งหมด</a><h1>{e(art['title'])}</h1>" + ''.join(f"<h2>{e(h)}</h2>" + ''.join(f'<p>{x}</p>' for x in ps) for h, ps in art['sections'])
    body += '<a class="cta" href="/">เปิดไพ่ทาโร่ด้วยตัวเอง →</a><p class="kw">เนื้อหาเพื่อการทบทวนตัวเอง ไม่ใช่คำทำนายที่แน่นอน และไม่ใช่คำแนะนำทางการแพทย์ กฎหมาย หรือการเงิน</p>'
    ld = [{"@context": "https://schema.org", "@type": "Article", "headline": art['title'], "inLanguage": "th", "datePublished": "2026-11-12", "mainEntityOfPage": f"{SITE}/articles/{art['slug']}.html", "image": f"{SITE}/assets/share.jpg", "publisher": {"@type": "Organization", "name": "Ivory Rose Tarot", "url": SITE + "/"}}, crumbs((('หน้าแรก', '/'), ('บทความ', '/articles/'), (art['title'], f"/articles/{art['slug']}.html")))]
    (ROOT/'articles'/f"{art['slug']}.html").write_text(page(art['title'] + ' - Ivory Rose Tarot', art['desc'], f"articles/{art['slug']}.html", body, ld), encoding='utf-8')
    urls.append(f"{SITE}/articles/{art['slug']}.html")
body = '<a href="/">← เปิดไพ่</a><h1>บทความไพ่ทาโร่</h1><ul>' + ''.join(f"<li><a href=\"/articles/{a['slug']}.html\">{e(a['title'])}</a><br><span class=\"kw\">{e(a['desc'])}</span></li>" for a in articles) + '</ul>'
(ROOT/'articles'/'index.html').write_text(page('บทความไพ่ทาโร่ สำหรับมือใหม่ - Ivory Rose Tarot', 'บทความสอนอ่านไพ่ทาโร่ด้วยตัวเอง ไพ่ตั้งไพ่กลับ ถามเรื่องความรัก อ่านไพ่เป็นคู่ และความต่างของไพ่เมเจอร์กับไมเนอร์', 'articles/', body), encoding='utf-8')
urls.append(f'{SITE}/articles/')
(ROOT/'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <url><loc>{u}</loc></url>\n' for u in urls) + '</urlset>\n')
print(f'wrote {len(cards)} card pages, hub, sitemap ({len(urls)} urls)')
