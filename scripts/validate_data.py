"""Consistency checks across data/ and docs/. Run: python3 scripts/validate_data.py (exit 1 on any problem)."""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
load = lambda p: json.loads((ROOT / p).read_text(encoding='utf-8'))
errors = []
err = lambda m: errors.append(m)

cards = load('data/cards.json')['cards']
by = {c['id']: c for c in cards}
if len(cards) != 78 or len(by) != 78: err(f'expected 78 unique cards, got {len(cards)}/{len(by)}')

REQUIRED = ['name_en', 'name_th', 'display_mark', 'upright_th', 'reversed_th', 'love_th', 'work_th', 'advice_th',
            'reflection_th', 'alt_th', 'image', 'image_web']
for c in cards:
    for k in REQUIRED:
        if not str(c.get(k) or '').strip(): err(f"{c['id']}: empty {k}")
    for k in ('image', 'image_web'):
        if c.get(k) and not (ROOT / c[k]).exists(): err(f"{c['id']}: missing file {c[k]}")

# the public file must be the same cards minus internal prompt fields
pub = {c['id']: c for c in load('data/cards.public.json')['cards']}
if set(pub) != set(by): err('cards.public.json ids differ from cards.json')
for i, p in pub.items():
    for k, v in p.items():
        if i in by and by[i].get(k) != v: err(f'{i}: public.{k} differs from cards.json')

# docs/02 must repeat the JSON text exactly
md = (ROOT / 'docs/02_CARD_MEANINGS_TH.md').read_text(encoding='utf-8')
seen = set()
for m in re.finditer(r'## (.+?) — (.+?)\n\nรหัส `(.+?)`.*?\n\n(.*?)(?=\n## |\Z)', md, re.S):
    en, th, i, body = m.groups(); seen.add(i); c = by.get(i)
    if not c: err(f'docs/02: unknown id {i}'); continue
    if (c['name_en'], c['name_th']) != (en, th): err(f'docs/02: {i} name differs')
    for lab, k in [('ตั้งตรง', 'upright_th'), ('กลับหัว', 'reversed_th'), ('ความรัก', 'love_th'), ('แนวทาง', 'advice_th')]:
        mm = re.search(rf'- {lab}: (.*)', body)
        if not mm or mm.group(1).strip() != c[k].strip(): err(f'docs/02: {i} {lab} differs from cards.json')
if seen != set(by): err(f'docs/02 covers {len(seen)} cards, missing {sorted(set(by) - seen)[:5]}')

# spreads and the major-arcana position meanings must line up
spreads = load('data/spreads.json')['spreads']
slots = {f"{s['id']}:{p['id']}" for s in spreads for p in s['positions']}
pm = load('data/position_meanings_major.json')
if set(pm['roles']) != slots: err('position_meanings roles differ from spreads.json positions')
majors = {i for i, c in by.items() if c['arcana'] == 'major'}
if set(pm['cards']) != majors: err('position_meanings must cover exactly the 22 major cards')
roles = set(pm['roles'].values())
for i, entry in pm['cards'].items():
    if set(entry) != roles: err(f'position_meanings {i}: roles {sorted(set(entry) ^ roles)} mismatch')
    for r, v in entry.items():
        for k in ('up', 'rev'):
            if not str(v.get(k) or '').strip(): err(f'position_meanings {i}.{r}.{k} empty')

print('FAIL' if errors else 'PASS: cards, docs/02, public data, images, spreads, position meanings agree')
for e in errors[:50]: print(' -', e)
sys.exit(1 if errors else 0)
