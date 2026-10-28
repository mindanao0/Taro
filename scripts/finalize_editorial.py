"""Record final artistic adaptations and export a lightweight website payload."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'data/cards.json'; data=json.loads(p.read_text())
changes={
 'wands-six': 'Six scene staffs arranged as two groups of three around a small victorious mounted figure without a held staff; laurel wreath above.',
 'wands-nine': 'Nine short staffs in a three-by-three symbolic protective screen above a seated watchful guardian with empty hands.',
 'wands-ten': 'A burdened adult carries two bundles of five wooden staffs, ten total, toward a distant town.'}
for c in data['cards']:
 if c['id'] in changes:
  c['scene_prompt']=changes[c['id']]
  c['visual_adaptation']='จัดกลุ่มสัญลักษณ์ให้จำนวนแยกอ่านได้ชัด เป็นภาพตีความใหม่ ไม่ใช่ฉาก RWS ตรงตัว'
  c['generation_prompt']='Original prompt was refined during visual review. Final scene: '+changes[c['id']]+' Same Gothic Ivory Rose style reference.'
p.write_text(json.dumps(data,ensure_ascii=False,indent=2))
(root/'data/generation_jobs.json').write_text(json.dumps([{'id':c['id'],'prompt':c['generation_prompt']} for c in data['cards'] if c['id'] not in ['major-13','major-18']],ensure_ascii=False,indent=2))
public={k:v for k,v in data.items() if k!='cards'}
private={'scene_prompt','generation_prompt','source_id','visual_adaptation','interpretation_origin'}
public['cards']=[{k:v for k,v in c.items() if k not in private} for c in data['cards']]
(root/'data/cards.public.json').write_text(json.dumps(public,ensure_ascii=False,indent=2))
(root/'data/art_revisions.json').write_text(json.dumps({'notes_th':'ภาพที่แก้ไขระหว่างตรวจแบบ; คำสั่งเริ่มต้นอยู่ใน generation_jobs.json ส่วนฉากสุดท้ายอยู่ใน cards.json','revised_scenes':changes,'hanged_man':'Upright adult with inverted water reflection, no physical suspension.','back':'AI-designed near-rotational decorative back; not certified pixel-exact symmetry.'},ensure_ascii=False,indent=2))
print('Final editorial data and lightweight website JSON exported')
