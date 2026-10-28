import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'data/cards.json'; data=json.loads(p.read_text())
for c in data['cards']:
 c['reflection_th']=f"ประเด็น ‘{c['upright_th']}’ ปรากฏในสถานการณ์ของฉันอย่างไร และก้าวเล็กที่สุดที่ทำได้คืออะไร?"
 if c['id']=='major-12':
  c['scene_prompt']='A peaceful fully clothed adult stands upright on a safe stone bridge and contemplates their inverted reflection in a still pool; reflected halo and T-shaped tree branches symbolize pause and changed perspective. No physical suspension.'
  c['visual_adaptation']='ใช้เงาสะท้อนกลับหัวแทนคนห้อยจากต้นไม้ รักษาแกนหยุดและเปลี่ยนมุมมอง แต่ไม่ใช่ฉาก RWS ตรงตัว'
  c['generation_prompt']='Same-deck gothic black/ivory/oxblood engraving; top XII; '+c['scene_prompt']
p.write_text(json.dumps(data,ensure_ascii=False,indent=2))
q=root/'data/generation_jobs.json'; jobs=json.loads(q.read_text())
for j in jobs:
 if j['id']=='major-12': j['prompt']=next(c['generation_prompt'] for c in data['cards'] if c['id']=='major-12')
q.write_text(json.dumps(jobs,ensure_ascii=False,indent=2))
(root/'data/sources.json').write_text(json.dumps({'waite-symbolism':{'author':'Arthur Edward Waite','illustrator_of_historical_system':'Pamela Colman Smith','title':'The Pictorial Key to the Tarot','edition_note':'Early 1910/1911 editions; see source edition','url':'https://original.sacred-texts.com/tarot/pkt/index.htm','use':'Historical structure and symbolism; Thai meanings are original modern editorial adaptations'},'waite-celtic-cross':{'url':'https://original.sacred-texts.com/tarot/pkt/pkt0307.htm','use':'Adapted 10-position structure, no separate significator'}},ensure_ascii=False,indent=2))
