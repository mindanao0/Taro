"""Generate static card, topic, pair, article and deck landing pages, and sitemap.xml."""
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
ul.g{columns:3;padding-left:1.2em}@media(max-width:900px){ul.g{columns:2}}@media(max-width:720px){.cl{grid-template-columns:1fr;gap:16px}.cl-img{position:static}.cl-img img{width:min(260px,100%)}ul.g{columns:1}}
/* same card grid and section colours as the app (index.html) */
.k-up{--k:#9cc59a}.k-rev{--k:#dc9380}.k-love{--k:#e591a8}.k-work{--k:#8db6d9}.k-money{--k:#c9c27a}.k-health{--k:#7fc8b8}.k-advice{--k:#c8a25a}
.sec{margin:1.5em 0 0;padding-left:14px;border-left:2px solid var(--k)}.sec h2{margin:0;font-size:.95rem;font-weight:500;color:var(--k)}.sec p{margin:.25em 0 0}
.refl{margin:2em 0 0;padding-top:20px;border-top:1px solid #ffffff1c}.refl h2{margin:0;font-size:.85rem;font-weight:500;color:#9a8f7e}.refl p{margin:.3em 0 0;color:#c8a25a;font-size:1.2rem;line-height:1.6}
h2.grp{margin:2.2em 0 1em;padding-bottom:.5em;border-bottom:1px solid #ffffff1c;font-weight:500}h2.grp small{color:#9a8f7e;font-weight:400;margin-left:.6em}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:40px 26px}.tiles.wide{grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
a.tile{display:block;color:inherit;text-decoration:none}a.tile img{width:100%;aspect-ratio:560/1003;object-fit:contain;background:#14110f;border-radius:0;box-shadow:0 22px 44px -18px #000}a.tile:hover img{outline:1px solid #c8a25a;outline-offset:4px}
a.tile strong{display:block;margin-top:14px;font:400 1.4rem/1.2 "Instrument Serif",Georgia,serif}a.tile span{display:block;color:#9a8f7e;font-size:.9rem;line-height:1.5}a.tile small{display:block;margin-top:6px;color:#9a8f7e;font-size:.85rem;line-height:1.6}.tiles.wide a.tile small{color:#ece4d3;font-size:.95rem}@media(max-width:720px){.tiles,.tiles.wide{grid-template-columns:repeat(2,minmax(0,1fr));gap:28px 16px}a.tile strong{font-size:1.15rem}}</style>'''
HEADER = '<header class="site"><a class="brand" href="/">Ivory Rose Tarot</a><nav><a href="/">เลือกไพ่</a><a href="/cards/">ไพ่ทั้งสำรับ</a><a href="/pairs/">ไพ่คู่</a><a href="/articles/">บทความ</a></nav></header>'
def page(title, desc, path, body, ld=None, img=None, og_details=None):
    ld = ld if isinstance(ld, list) or ld is None else [ld]
    url = f'{SITE}/{path}'
    if 'class="cl"' not in body and 'class="g"' not in body and 'class="tiles' not in body: body = f'<div class="txt">{body}</div>'  # long text: keep a readable line length
    og_meta = '' if og_details is None else ''.join(
        f'<meta property="og:image:{key}" content="{e(str(value))}">' for key, value in og_details.items())
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
{og_meta}<meta name="twitter:card" content="summary_large_image">
{ldj}{CSS}
</head><body>{HEADER}<main>
{body}
</main></body></html>
'''
crumbs = lambda items: {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": n + 1, "name": name, "item": SITE + href} for n, (name, href) in enumerate(items)]}
def tiles(cs, note=None):
    # note: callable(card) -> text under the tile (default: the card's keywords)
    items = ''.join(f'<a class="tile" href="/cards/{slug(c)}.html"><img src="/assets/seo/thumb/{c["id"]}.webp" alt="" width="560" height="1003" loading="lazy"><strong>{e(c["name_en"])}</strong><span>{e(c["name_th"])}</span><small>{e(note(c) if note else " · ".join(c["keywords_th"]))}</small></a>' for c in cs)
    return f'<div class="tiles{" wide" if note else ""}">{items}</div>'
out = ROOT/'cards'; out.mkdir(exist_ok=True)
urls = [f'{SITE}/', f'{SITE}/cards/']
for i, c in enumerate(cards):
    s = slug(c); kw = ' · '.join(c['keywords_th'])
    title = f"ไพ่ {c['name_en']} ({c['name_th']}) ความหมายไพ่ตั้งและไพ่กลับ ความรัก การงาน - Ivory Rose Tarot"
    desc = f"ความหมายไพ่ทาโร่ {c['name_en']} ({c['name_th']}): {kw} อ่านไพ่ตั้ง ไพ่กลับ ความรัก การงาน และคำถามชวนคิด"
    prev, nxt = cards[i-1], cards[(i+1) % len(cards)]
    c = {**c, **extra[c['id']]}
    sections = [('ไพ่ตั้ง', 'upright_th', 'up'), ('ไพ่กลับ', 'reversed_th', 'rev'), ('ความรัก', 'love_th', 'love'), ('การงาน', 'work_th', 'work'), ('การเงิน', 'money_th', 'money'), ('สุขภาพและพลังใจ', 'health_th', 'health'), ('คำแนะนำ', 'advice_th', 'advice'), ('คำถามชวนคิด', 'reflection_th', '')]
    same = [x for x in cards if x['id'] != c['id'] and (x['suit'] == c['suit'] if c['suit'] else x['arcana'] == 'major')]
    rel = [same[(i + k) % len(same)] for k in (3, 7, 11)]
    faq = [(f"ไพ่ {c['name_en']} ({c['name_th']}) หมายถึงอะไร", c['upright_th']), (f"ไพ่ {c['name_en']} กลับหัวหมายถึงอะไร", c['reversed_th']), (f"ไพ่ {c['name_en']} เรื่องความรักหมายถึงอะไร", c['love_th']), (f"ไพ่ {c['name_en']} เรื่องการงานและการเงินหมายถึงอะไร", c['work_th'] + ' ' + c['money_th'])]
    relh = '<ul>' + ''.join(f'<li><a href="/cards/{slug(x)}.html">{e(x["name_en"])} ({e(x["name_th"])})</a></li>' for x in rel) + '</ul>'
    body = f'''<a href="/cards/">← ไพ่ทั้ง 78 ใบ</a>
<div class="cl"><div class="cl-img"><img src="/assets/seo/thumb/{c['id']}.webp" alt="{e(c['alt_th'])}" width="340" height="609" fetchpriority="high"></div><div class="txt">
<h1>ไพ่ {e(c['name_en'])} ({e(c['name_th'])}) ความหมาย</h1>
<p class="kw">{e(kw)}</p>
''' + ''.join((f"<div class=\"refl\"><h2>{e(c['name_en'])} {h}</h2><p>{e(c[k])}</p></div>\n" if k == 'reflection_th' else f"<div class=\"sec k-{kc}\"><h2>{e(c['name_en'])} {h}</h2><p>{e(c[k])}</p></div>\n") for h, k, kc in sections) + f'''<p class="kw">เรื่องสุขภาพเป็นการสะท้อนมุมมองเท่านั้น ไม่ใช่คำวินิจฉัยหรือคำแนะนำทางการแพทย์ หากมีอาการควรปรึกษาแพทย์</p>
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
    f'<h2 class="grp">{e(n)}<small>{len(cs)} ใบ</small></h2>' + tiles(cs) for n, cs in groups)
(out/'index.html').write_text(page('ความหมายไพ่ทาโร่ทั้ง 78 ใบ ไพ่ตั้ง ไพ่กลับ ความรัก การงาน - Ivory Rose Tarot', 'รวมความหมายไพ่ทาโร่ครบ 78 ใบ เมเจอร์และไมเนอร์อาร์คานา ไพ่ตั้ง ไพ่กลับ ความรัก การงาน เรียบเรียงเป็นภาษาไทย', 'cards/', body), encoding='utf-8')
TOPICS = [('love', 'ความรัก', 'love_th'), ('work', 'การงาน', 'work_th'), ('money', 'การเงิน', 'money_th'), ('health', 'สุขภาพและพลังใจ', 'health_th')]
(ROOT/'topics').mkdir(exist_ok=True)
for key, name, field in TOPICS:
    title = f'ความหมายไพ่ทาโร่เรื่อง{name} ครบทั้ง 78 ใบ - Ivory Rose Tarot'
    desc = f'รวมความหมายไพ่ทาโร่ทั้ง 78 ใบในเรื่อง{name} แยกตามชุด อ่านสั้น ๆ แล้วกดดูรายละเอียดแต่ละใบ'
    body = f'<a href="/cards/">← ไพ่ทั้ง 78 ใบ</a><h1>ความหมายไพ่ทาโร่เรื่อง{name}</h1><p>ไพ่แต่ละใบสะท้อนเรื่อง{name}ต่างกัน อ่านเป็นมุมมองให้ทบทวนตัวเอง ไม่ใช่คำทำนายที่แน่นอน</p><p>' + ' · '.join(f'<a href="/topics/{k}.html">{n}</a>' for k, n, _ in TOPICS if k != key) + '</p>'
    for gname, cs in groups:
        body += f'<h2 class="grp">{e(gname)}<small>{len(cs)} ใบ</small></h2>' + tiles(cs, lambda c: {**c, **extra[c['id']]}[field])
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
christmas_guide_path = 'articles/year-end-tarot-reflection.html'
christmas_guide_label = 'วิธีใช้ไพ่ทาโร่ทบทวนปลายปี: ตัวอย่าง 1 ใบและ 3 ใบ'
# ---- /articles/: hand-written guides in data/seo_articles.json (sections of paragraphs; inline HTML allowed, links are checked by seo.test.mjs)
articles = json.loads((ROOT/'data/seo_articles.json').read_text())
(ROOT/'articles').mkdir(exist_ok=True)
for art in articles:
    body = f"<a href=\"/articles/\">← บทความทั้งหมด</a><h1>{e(art['title'])}</h1>" + ''.join(f"<h2>{e(h)}</h2>" + ''.join(f'<p>{x}</p>' for x in ps) for h, ps in art['sections'])
    body += '<a class="cta" href="/">เปิดไพ่ทาโร่ด้วยตัวเอง →</a><p class="kw">เนื้อหาเพื่อการทบทวนตัวเอง ไม่ใช่คำทำนายที่แน่นอน และไม่ใช่คำแนะนำทางการแพทย์ กฎหมาย หรือการเงิน</p>'
    ld = [{"@context": "https://schema.org", "@type": "Article", "headline": art['title'], "inLanguage": "th", "datePublished": "2026-11-12", "mainEntityOfPage": f"{SITE}/articles/{art['slug']}.html", "image": f"{SITE}/assets/share.jpg", "publisher": {"@type": "Organization", "name": "Ivory Rose Tarot", "url": SITE + "/"}}, crumbs((('หน้าแรก', '/'), ('บทความ', '/articles/'), (art['title'], f"/articles/{art['slug']}.html")))]
    (ROOT/'articles'/f"{art['slug']}.html").write_text(page(art['title'] + ' - Ivory Rose Tarot', art['desc'], f"articles/{art['slug']}.html", body, ld), encoding='utf-8')
    urls.append(f"{SITE}/articles/{art['slug']}.html")
body = '<a href="/">← เปิดไพ่</a><h1>บทความไพ่ทาโร่</h1><ul>' + ''.join(f"<li><a href=\"/articles/{a['slug']}.html\">{e(a['title'])}</a><br><span class=\"kw\">{e(a['desc'])}</span></li>" for a in articles) + f'<li><a href="/{christmas_guide_path}">{christmas_guide_label}</a><br><span class="kw">ตัวอย่างการอ่านไพ่ที่จบด้วยก้าวเล็ก ๆ และวิธีเช็กผลในอีกหนึ่งสัปดาห์</span></li></ul>'
(ROOT/'articles'/'index.html').write_text(page('บทความไพ่ทาโร่ สำหรับมือใหม่ - Ivory Rose Tarot', 'บทความสอนอ่านไพ่ทาโร่ด้วยตัวเอง ไพ่ตั้งไพ่กลับ ถามเรื่องความรัก อ่านไพ่เป็นคู่ และความต่างของไพ่เมเจอร์กับไมเนอร์', 'articles/', body), encoding='utf-8')
urls.append(f'{SITE}/articles/')
# ---- /christmas-wish/: one seasonal landing page, not 78 duplicate card pages
christmas_path = 'christmas-wish/'
christmas_title = 'Christmas Wish Tarot | เปิดไพ่ทาโร่ธีมคริสต์มาสฟรี'
christmas_desc = 'ลองเปิดไพ่ Christmas Wish Tarot สำรับ 78 ใบในภาพวาดสีน้ำธีมคริสต์มาส เลือกไพ่ 1 หรือ 3 ใบฟรี เพื่อทบทวนปีที่ผ่านมาและสิ่งที่อยากพาไปสู่ปีใหม่'
christmas_share = '/assets/seo/share/christmas-wish.jpg'
christmas_img = '/assets/christmas-wish/previews/major-17-star.webp'
christmas_body = f'''<h1>เปิดไพ่ทาโร่ธีมคริสต์มาส: Christmas Wish Tarot</h1>
<div class="cl">
  <figure class="cl-img" style="margin:0"><img src="{christmas_img}" alt="ไพ่ The Star ในสำรับ Christmas Wish Tarot" width="900" height="1350" fetchpriority="high"><figcaption class="kw">The Star · Christmas Wish Tarot</figcaption></figure>
  <div class="txt">
    <p>ถ้าปลายปีทำให้คุณอยากหยุดคิดสักครู่ ลองใช้ไพ่หนึ่งใบเป็นจุดเริ่มต้น Christmas Wish Tarot เป็นสำรับ 78 ใบตามโครงสร้างทาโร่ดั้งเดิม ในภาพวาดสีน้ำธีมคริสต์มาส โครงคำอ่านใช้ร่วมกับสำรับ Gothic Ivory Rose แต่ภาพหน้าและหลังไพ่เป็นของชุด Christmas Wish</p>
    <a class="cta" href="/?deck=christmas-wish">เปิดไพ่ Christmas Wish ฟรี →</a>
    <h2>เริ่มอ่านไพ่คริสต์มาสยังไง?</h2>
    <ol>
      <li>นึกถึงคำถามที่อยากทบทวน เช่น ปีนี้มีอะไรที่ฉันอยากขอบคุณตัวเอง?</li>
      <li>เลือก 1 ใบเพื่อหาประเด็นชวนคิด หรือ 3 ใบเพื่อลองมองสถานการณ์ สิ่งที่ต้องเข้าใจ และก้าวถัดไป</li>
      <li>อ่านภาพกับความหมายของไพ่ แล้วเลือกหนึ่งเรื่องที่อยากลองทำหลังอ่านจบ</li>
    </ol>
    <h2>ลองถามตัวเองก่อนขึ้นปีใหม่</h2>
    <ul>
      <li>มีเรื่องไหนที่ฉันพร้อมวางลงแล้ว?</li>
      <li>ใครหรืออะไรช่วยให้ปีนี้ผ่านไปได้?</li>
      <li>ก้าวเล็ก ๆ ที่ฉันทำได้จริงในสัปดาห์แรกของปีคืออะไร?</li>
    </ul>
    <p>อยากเห็นคำอ่านตั้งแต่คำถามแรกถึงสิ่งที่จะลองทำ? อ่าน <a href="/{christmas_guide_path}">ตัวอย่างใช้ไพ่ 1 และ 3 ใบทบทวนปลายปี</a></p>
    <p>ถ้าอยากคุ้นกับความหมายของแต่ละใบก่อน เริ่มจาก <a href="/cards/">คู่มือความหมายไพ่ทั้ง 78 ใบ</a> ของ Ivory Rose Tarot ได้ค่ะ</p>
    <p class="kw">ใช้ไพ่เป็นเครื่องมือทบทวนตัวเอง ไม่ใช่คำทำนายที่แน่นอนหรือคำแนะนำด้านสุขภาพ กฎหมาย หรือการเงิน</p>
  </div>
</div>'''
christmas_ld = [{"@context": "https://schema.org", "@type": "WebPage",
                 "url": f"{SITE}/{christmas_path}", "name": christmas_title,
                 "description": christmas_desc, "inLanguage": "th",
                 "primaryImageOfPage": {"@type": "ImageObject", "url": SITE + christmas_img}},
                crumbs((('หน้าแรก', '/'), ('Christmas Wish Tarot', '/' + christmas_path)))]
(ROOT/christmas_path).mkdir(exist_ok=True)
(ROOT/christmas_path/'index.html').write_text(
    page(christmas_title, christmas_desc, christmas_path, christmas_body, christmas_ld, SITE + christmas_share,
         {'type': 'image/jpeg', 'width': 1200, 'height': 630, 'alt': 'Christmas Wish Tarot และภาพไพ่ The Star'}),
    encoding='utf-8')
urls.append(f'{SITE}/{christmas_path}')
# A practical companion to the seasonal landing, rather than another deck sales page.
guide_desc = 'วิธีใช้ไพ่ทาโร่ทบทวนปลายปี พร้อมตัวอย่างอ่าน 1 ใบและ 3 ใบตามตำแหน่ง ตั้งคำถามที่ลองลงมือทำได้ และกลับมาเช็กผลในอีก 7 วัน'
guide_body = f'''<a href="/articles/">← บทความไพ่ทาโร่ทั้งหมด</a>
<h1>{christmas_guide_label}</h1>
<p>ถ้าเป้าหมายปีใหม่ที่เขียนไว้ดูใหญ่เกินจะเริ่ม ลองใช้ไพ่เป็นตัวช่วยตั้งคำถาม ไม่ใช่ให้ไพ่ตัดสินแทน คู่มือนี้ชวนอ่านจากสถานการณ์สมมติเดียวกันสองแบบ แล้วเลือกก้าวที่ทำได้จริงในหนึ่งสัปดาห์</p>
<h2>เริ่มด้วยเรื่องเดียวที่อยากเปลี่ยน</h2>
<p>ตัวอย่างนี้คือ «ช่วงปลายปีงานแทรกจนแทบไม่ได้พัก ฉันจะลองจัดเวลาพักแบบไหนในสัปดาห์หน้า?» ถ้ายังนึกเรื่องไม่ออก ให้ย้อนดูหนึ่งวันที่รู้สึกฝืนมากที่สุด เขียนว่าเกิดอะไรขึ้นจริงหนึ่งประโยค แล้วถามว่ามีส่วนไหนที่ตนเองเลือกทำต่างไปได้</p>
<h2>ไพ่ 1 ใบ: มองหาเรื่องที่ควรใส่ใจ</h2>
<p>สมมติได้ <a href="/cards/the-star.html">The Star</a> ตั้งตรง อ่านเรื่องการค่อย ๆ ฟื้นกำลังใจ แล้วถามว่า «อะไรเคยช่วยให้ฉันพักได้จริง?» ในตัวอย่างนี้คำตอบคือการออกจากโต๊ะโดยไม่ถือโทรศัพท์ จึงลองพัก 15 นาทีหลังมื้อเที่ยงสองวัน แทนการตั้งเป้าว่าต้องพักทุกวันทันที</p>
<h2>ไพ่ 3 ใบ: อ่านจากสถานการณ์ไปถึงก้าวถัดไป</h2>
<p>เลือกแบบวางไพ่ «สถานการณ์และก้าวถัดไป» บนเว็บ ตัวอย่างนี้ใช้ไพ่ตั้งตรงเพื่อให้เห็นว่าความหมายเปลี่ยนตามตำแหน่งอย่างไร</p>
<ol>
  <li><strong>สถานการณ์ · <a href="/cards/the-hermit.html">The Hermit</a>:</strong> เมื่อทุกช่วงพักกลายเป็นเวลาตอบข้อความ อาจยังไม่มีช่วงเงียบพอให้สังเกตว่าตัวเองเหนื่อยตอนไหน</li>
  <li><strong>สิ่งที่ต้องเข้าใจ · <a href="/cards/temperance.html">Temperance</a>:</strong> โจทย์ไม่ใช่เลือกระหว่างทำงานกับพัก แต่คือหาจังหวะที่อยู่ได้ทั้งคู่ ลองเริ่มกับสองวันที่ปฏิทินมีช่องว่างจริง</li>
  <li><strong>ก้าวถัดไป · <a href="/cards/the-star.html">The Star</a>:</strong> เลือกการพักที่เคยได้ผล เช่น เดิน 15 นาทีหลังมื้อเที่ยงวันอังคารและพฤหัส แล้วใส่นัดไว้ก่อนงานอื่นเข้ามาแทน</li>
</ol>
<h2>กลับมาเช็กผลในอีก 7 วัน</h2>
<p>จดไว้ว่า «ทำสองครั้งตามที่ตั้งใจไหม» และ «หลังพักกลับมาทำงานง่ายขึ้นหรือไม่» ถ้าทำไม่ได้เพราะเวลาไม่ลงตัว ลองย้ายช่วงพักหรือลดเหลือ 5 นาที ถ้าทำแล้วไม่ช่วย ก็ลองวิธีพักแบบอื่น ไม่จำเป็นต้องบังคับให้เหตุการณ์ตรงกับไพ่</p>
<h2>คำถามที่มักเจอตอนลองเอง</h2>
<h3>ควรเลือก 1 ใบหรือ 3 ใบ?</h3>
<p>เลือก 1 ใบเมื่ออยากได้คำถามเดียวให้คิดต่อ เลือก 3 ใบเมื่อต้องการแยกสิ่งที่กำลังเกิด สิ่งที่ยังไม่เข้าใจ และก้าวที่ลองได้</p>
<h3>ถ้าอ่านไม่เข้ากับสถานการณ์ ต้องจั่วซ้ำไหม?</h3>
<p>ไม่ต้องค่ะ ลองเขียนแยกว่าสิ่งไหนมาจากข้อเท็จจริงและสิ่งไหนเป็นเพียงสมมติฐาน ถ้ายังไม่เห็นประโยชน์ก็หยุดได้ ไม่ต้องใช้ไพ่เพื่อยืนยันคำตอบที่อยากได้</p>
<p><a class="cta" href="/?deck=christmas-wish">ลองเปิดไพ่ Christmas Wish ฟรี →</a></p>
<p>ดู <a href="/christmas-wish/">ภาพและรายละเอียดสำรับ Christmas Wish Tarot</a> ก่อนเลือกไพ่ได้ค่ะ</p>
<p class="kw">นี่คือตัวอย่างการทบทวนตัวเอง ไม่ใช่เหตุการณ์จริง คำทำนาย หรือคำแนะนำด้านสุขภาพ กฎหมาย หรือการเงิน</p>'''
guide_url = f'{SITE}/{christmas_guide_path}'
guide_ld = [{"@context": "https://schema.org", "@type": "Article",
             "headline": christmas_guide_label, "description": guide_desc, "inLanguage": "th",
             "mainEntityOfPage": guide_url, "image": SITE + christmas_share,
             "publisher": {"@type": "Organization", "name": "Ivory Rose Tarot", "url": SITE + "/"}},
            crumbs((('หน้าแรก', '/'), ('บทความ', '/articles/'),
                    (christmas_guide_label, '/' + christmas_guide_path)))]
(ROOT/christmas_guide_path).write_text(
    page(christmas_guide_label + ' | Ivory Rose Tarot', guide_desc, christmas_guide_path, guide_body,
         guide_ld, SITE + christmas_share),
    encoding='utf-8')
urls.append(guide_url)
(ROOT/'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <url><loc>{u}</loc></url>\n' for u in urls) + '</urlset>\n')
print(f'wrote {len(cards)} card pages, hub, sitemap ({len(urls)} urls)')
