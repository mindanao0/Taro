"""Create an offline HTML reading guide from the delivered Markdown documents."""
import html,re
from pathlib import Path
root=Path(__file__).resolve().parents[1]
def inline(s):
 s=html.escape(s)
 s=re.sub(r'`([^`]+)`',r'<code>\1</code>',s)
 s=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',s)
 s=re.sub(r'(https?://[^\s]+)',r'<a href="\1">\1</a>',s)
 return s
parts=['<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>คู่มือสำรับกอทิกงาช้างและกุหลาบ</title><style>body{font:17px/1.85 system-ui;background:#eee4d0;color:#29231f;max-width:980px;margin:auto;padding:24px}h1,h2,h3{line-height:1.4}h1{border-bottom:1px solid #89745b;padding-bottom:12px}section{margin:52px 0}a{color:#762c32}code{background:#ddd0b8;padding:2px 5px;overflow-wrap:anywhere}li{margin:8px 0}p{overflow-wrap:anywhere}nav{padding:18px;background:#e0d1b5;border-radius:8px}@media print{body{background:white;max-width:none;font-size:11pt}section{break-before:page}nav{display:none}h2,h3{break-after:avoid}p,li{orphans:3;widows:3}}</style><header><h1>สำรับกอทิกงาช้างและกุหลาบ</h1><p>คู่มือภาษาไทย · 78 ใบ · Digital Review Edition</p><nav><a href="previews/catalog.html">เปิดดูภาพไพ่ทั้งสำรับ</a> · <a href="#reading">วิธีอ่าน</a> · <a href="#meanings">ความหมายทุกใบ</a> · <a href="#web">ข้อมูลทำเว็บ</a></nav></header>']
ids={'01':'reading','02':'meanings','03':'art','04':'web','05':'sources','06':'qa'}
for p in sorted((root/'docs').glob('*.md')):
 parts.append('<section id="'+ids.get(p.name[:2],p.stem)+'">'); in_list=False; paragraph=[]
 def flush():
  if paragraph: parts.append('<p>'+inline(' '.join(paragraph))+'</p>'); paragraph.clear()
 for line in p.read_text().splitlines():
  if not line.strip():
   flush()
   if in_list: parts.append('</ul>'); in_list=False
  elif line.startswith('#'):
   flush()
   if in_list: parts.append('</ul>');in_list=False
   n=min(4,len(line)-len(line.lstrip('#')));parts.append(f'<h{n}>'+inline(line.lstrip('#').strip())+f'</h{n}>')
  elif line.startswith('- ') or re.match(r'^\d+\. ',line):
   flush()
   if not in_list: parts.append('<ul>');in_list=True
   parts.append('<li>'+inline(re.sub(r'^(?:- |\d+\. )','',line))+'</li>')
  else: paragraph.append(line)
 flush()
 if in_list: parts.append('</ul>')
 parts.append('</section>')
parts.append('</html>');(root/'START_HERE.html').write_text('\n'.join(parts))
print('Offline HTML guide built')
