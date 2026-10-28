"""Validate and package digital deck assets; originals are never modified."""
import argparse, collections, csv, hashlib, html, io, json, zipfile, subprocess, sys
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
def dump(path, data):
    (ROOT/path).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--check-only',action='store_true'); args=parser.parse_args()
    payload=json.loads((ROOT/'data/cards.json').read_text()); cards=payload['cards']
    assert len(cards)==78 and len({c['id'] for c in cards})==78
    assert collections.Counter(c['arcana'] for c in cards)=={'major':22,'minor':56}
    for suit in ['wands','cups','swords','pentacles']: assert sum(c['suit']==suit for c in cards)==14
    records=[]; missing=[]; hashes=set()
    for c in cards:
        p=ROOT/c['image']
        if not p.exists(): missing.append(c['id']); continue
        b=p.read_bytes(); digest=hashlib.sha256(b).hexdigest()
        assert digest not in hashes, f'Duplicate artwork: {c["id"]}'
        hashes.add(digest)
        with Image.open(p) as im:
            im.load(); w,h=im.size
            assert w>=700 and h>w, f'Invalid portrait image: {p}'
            if not args.check_only:
                # Format conversion only: same pixels, no resize/crop/retouch.
                im.convert('RGB').save(ROOT/c['image_web'],'WEBP',quality=90,method=4)
        records.append(dict(id=c['id'],image=c['image'],width=w,height=h,bytes=len(b),sha256=digest))
    if missing: raise SystemExit('Missing images: '+', '.join(missing))
    if args.check_only:
        print('PASS: 78 unique cards and unique readable portrait PNG files; 22 major, 14 per suit'); return
    dump('data/manifest.json',dict(schema_version='1.0.0',count=len(records),edition='digital-review',cards=records))
    table=io.StringIO(); writer=csv.writer(table); writer.writerow(['id','name_en','name_th','arcana','suit','rank','image','upright_th','reversed_th','love_th','advice_th'])
    for c in cards: writer.writerow([c.get(k) for k in ['id','name_en','name_th','arcana','suit','rank','image','upright_th','reversed_th','love_th','advice_th']])
    (ROOT/'data/cards.csv').write_text(table.getvalue(),encoding='utf-8-sig')
    guide=['# ความหมายครบ 78 ใบ\n\nความหมายภาษาไทยเรียบเรียงสมัยใหม่บนฐาน RWS ไม่ใช่คำแปลตรงจาก Waite ภาพมืดไม่ได้แปลว่าคำอ่านทุกใบเป็นด้านลบ\n']
    for c in cards:
        guide.append(f"\n## {c['name_en']} — {c['name_th']}\n\nรหัส `{c['id']}` · หมวด {c['suit'] or 'Major Arcana'} · เครื่องหมาย {c['display_mark']}\n\n- ตั้งตรง: {c['upright_th']}\n- กลับหัว: {c['reversed_th']}\n- ความรัก: {c['love_th']}\n- งาน/ทรัพยากร: {c['work_th']}\n- แนวทาง: {c['advice_th']}\n- ชวนคิด: {c['reflection_th']}\n\nภาพที่ออกแบบ: {c['scene_prompt']}\n")
    (ROOT/'docs/02_CARD_MEANINGS_TH.md').write_text('\n'.join(guide),encoding='utf-8')
    # Catalog is an offline review document, not a hosted application.
    chunks=['<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gothic Ivory Rose — ไพ่ 78 ใบ</title><style>body{background:#171410;color:#e3d4b7;font:16px/1.7 system-ui;margin:24px}h1{font-size:26px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:24px}figure{margin:0;border:1px solid #6b5945;padding:12px;border-radius:8px}img{width:100%;height:380px;object-fit:contain}h2{font-size:18px}p{margin:8px 0}small{color:#c9bca7}a{color:#eed9ae}@media print{body{background:white;color:black}figure{break-inside:avoid}main{grid-template-columns:repeat(3,1fr)}img{height:250px}}</style><h1>สำรับกอทิกงาช้างและกุหลาบ · 78 ใบ</h1><p>Digital Review Edition · ภาพแยกครบทุกใบ · เปิดดูในเครื่องได้ · รายละเอียดเพิ่มเติมอยู่ใน docs/</p><main>']
    for c in cards:
        esc=html.escape
        chunks.append(f'<figure><a href="../{c["image"]}"><img loading="lazy" src="../{c["image_web"]}" alt="{esc(c["alt_th"])}"></a><figcaption><h2>{esc(c["name_en"])}<br>{esc(c["name_th"])}</h2><small>{c["id"]}</small><p>ตั้งตรง: {esc(c["upright_th"])}</p><p>กลับหัว: {esc(c["reversed_th"])}</p><p>{esc(c["advice_th"])}</p></figcaption></figure>')
    chunks.append('</main></html>'); (ROOT/'previews/catalog.html').write_text('\n'.join(chunks),encoding='utf-8')
    subprocess.run([sys.executable, str(ROOT/"scripts/build_guide.py")], check=True)
    # Content integrity list covers every deliverable, excluding itself.
    lines=[]
    for p in sorted(ROOT.rglob('*')):
        if p.is_file() and p.name!='SHA256SUMS.txt' and '__pycache__' not in p.parts and p.name!='completed.txt' and 'source' not in p.relative_to(ROOT).parts:
            lines.append(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(ROOT).as_posix())
    (ROOT/'SHA256SUMS.txt').write_text('\n'.join(lines)+'\n')
    target=ROOT.parent/'Gothic_Ivory_Rose_Tarot_78.zip'
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in sorted(ROOT.rglob('*')):
            if p.is_file() and '__pycache__' not in p.parts and p.name!='completed.txt' and 'source' not in p.relative_to(ROOT).parts: z.write(p,Path(ROOT.name)/p.relative_to(ROOT))
    with zipfile.ZipFile(target) as z: assert z.testzip() is None
    print(json.dumps(dict(zip=str(target),bytes=target.stat().st_size,cards=len(records),files=len(lines)+1)))
if __name__=='__main__': main()
