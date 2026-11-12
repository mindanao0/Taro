// SEO pages are generated (scripts/build_seo.py): every page needs its own canonical + title, files must match sitemap.xml, images must exist.  node scripts/seo.test.mjs
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('..', import.meta.url).pathname, SITE = 'https://ivoryrosetarot.online';
const read = f => readFileSync(root + f, 'utf8');
const pages = [...readdirSync(root + 'cards').map(f => 'cards/' + f), ...readdirSync(root + 'topics').map(f => 'topics/' + f)];
const titles = new Set(), ids = JSON.parse(read('data/cards.public.json')).cards.map(c => c.id);
for (const f of pages) {
  const h = read(f), url = SITE + '/' + f.replace(/index\.html$/, '');
  assert.equal(h.match(/<link rel="canonical" href="([^"]+)"/)?.[1], url, `${f}: canonical`);
  const t = h.match(/<title>([^<]+)/)?.[1]; assert.ok(t && !titles.has(t), `${f}: missing or duplicate title`); titles.add(t);
  assert.ok(/<meta name="description" content="[^"]{40,}/.test(h), `${f}: description`);
  assert.ok(!/noindex/.test(h), `${f}: noindex`);
  for (const m of h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)) JSON.parse(m[1]);
}
const sitemap = [...read('sitemap.xml').matchAll(/<loc>([^<]+)/g)].map(m => m[1]).sort();
assert.deepEqual(sitemap, [SITE + '/', ...pages.map(f => SITE + '/' + f.replace(/index\.html$/, ''))].sort(), 'sitemap.xml out of sync: run python3 scripts/build_seo.py');
for (const id of ids) for (const f of [`assets/seo/thumb/${id}.webp`, `assets/seo/share/${id}.jpg`]) assert.ok(existsSync(root + f), `missing ${f}`);
assert.equal(pages.length, 78 + 1 + 4);
console.log(`PASS: ${pages.length} SEO pages (canonical, unique title, valid JSON-LD), sitemap in sync, ${ids.length * 2} images present`);
