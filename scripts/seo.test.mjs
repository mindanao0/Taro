// SEO pages are generated (scripts/build_seo.py): every page needs its own canonical + title, files must match sitemap.xml, images must exist.  node scripts/seo.test.mjs
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('..', import.meta.url).pathname, SITE = 'https://ivoryrosetarot.online';
const read = f => readFileSync(root + f, 'utf8');
const DIRS = ['cards', 'topics', 'pairs', 'articles', 'christmas-wish'];
const pages = DIRS.flatMap(d => readdirSync(root + d).map(f => d + '/' + f));
const titles = new Set(), ids = JSON.parse(read('data/cards.public.json')).cards.map(c => c.id);
for (const f of pages) {
  const h = read(f), url = SITE + '/' + f.replace(/index\.html$/, '');
  assert.equal(h.match(/<link rel="canonical" href="([^"]+)"/)?.[1], url, `${f}: canonical`);
  const t = h.match(/<title>([^<]+)/)?.[1]; assert.ok(t && !titles.has(t), `${f}: missing or duplicate title`); titles.add(t);
  assert.ok(/<meta name="description" content="[^"]{40,}/.test(h), `${f}: description`);
  assert.ok(!/noindex/.test(h), `${f}: noindex`);
  for (const [, href] of h.matchAll(/href="(\/[^"#]*)"/g)) {
    const {pathname} = new URL(href, SITE);
    assert.ok(existsSync(root + pathname.slice(1) + (pathname.endsWith('/') ? 'index.html' : '')), `${f}: broken link ${href}`);
  }
  for (const m of h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)) JSON.parse(m[1]);
}
const christmas = read('christmas-wish/index.html');
assert.ok(christmas.includes('class="cta" href="/"'), 'seasonal landing CTA must lead to the main reader');
assert.match(christmas, /2026-12-01.*2026-12-31/, 'season dates must be readable and machine-compatible');
assert.doesNotMatch(christmas, /[?]deck=/, 'seasonal landing must not expose a theme switch');
const og = christmas.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
const ogUrl = new URL(og);
assert.equal(ogUrl.origin, SITE);
assert.equal(ogUrl.pathname, '/assets/seo/share/christmas-wish.jpg');
const social = readFileSync(root + ogUrl.pathname.slice(1));
assert.equal(social.readUInt16BE(0), 0xffd8, 'social image must be a JPEG');
let dimensions;
for (let i = 2; i + 9 < social.length && social[i] === 0xff;) {
  const marker = social[i + 1];
  if ([0xc0, 0xc1, 0xc2].includes(marker)) {
    dimensions = [social.readUInt16BE(i + 7), social.readUInt16BE(i + 5)];
    break;
  }
  i += 2 + social.readUInt16BE(i + 2);
}
assert.deepEqual(dimensions, [1200, 630], 'Christmas Wish social image dimensions');
assert.match(christmas, /<meta property="og:image:width" content="1200">/);
assert.match(christmas, /<meta property="og:image:height" content="630">/);
assert.match(christmas, /<meta property="og:image:alt" content="[^"]*The Star">/);
assert.ok(existsSync(root + 'assets/christmas-wish/previews/major-17-star.webp'), 'Christmas Wish hero must exist');
const guidePath = 'articles/year-end-tarot-reflection.html';
const guide = read(guidePath);
for (const [sourceName, source] of [['seasonal landing', christmas], ['articles hub', read('articles/index.html')]]) {
  assert.ok(source.includes(`href="/${guidePath}"`), `${sourceName} must link to the guide`);
}
assert.match(guide, /href="\/christmas-wish\/"/, 'guide must link back to seasonal landing');
assert.ok(guide.includes('class="cta" href="/"'), 'guide CTA must lead to the main reader');
assert.doesNotMatch(guide, /[?]deck=/, 'guide must not expose a theme switch');
assert.equal([...guide.matchAll(/<h1>/g)].length, 1, 'guide must have a single descriptive h1');
assert.doesNotMatch(guide, /"@type":\s*"FAQPage"/, 'reader questions are not a rich-results claim');
const sitemap = [...read('sitemap.xml').matchAll(/<loc>([^<]+)/g)].map(m => m[1]).sort();
assert.deepEqual(sitemap, [SITE + '/', ...pages.map(f => SITE + '/' + f.replace(/index\.html$/, ''))].sort(), 'sitemap.xml out of sync: run python3 scripts/build_seo.py');
for (const id of ids) for (const f of [`assets/seo/thumb/${id}.webp`, `assets/seo/share/${id}.jpg`]) assert.ok(existsSync(root + f), `missing ${f}`);
assert.ok(pages.length >= 78 + 1 + 4 + 30 + 5, 'expected cards, topics, pairs and articles');
console.log(`PASS: ${pages.length} SEO pages (canonical, unique title, valid JSON-LD), sitemap in sync, ${ids.length * 2} images present`);
