// Lists what is still unfinished before real visitors use the site. Run: node scripts/launch-check.mjs [--strict]
// With --strict it exits 1 while anything is open (useful as a last gate in a release job).
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const open = [];
const check = (done, what, how) => { if (!done) open.push({what, how}); };

const cfg = read('scripts/config.mjs'), idx = read('index.html'), api = read('api/wrangler.toml'), log = read('wrangler.toml');
const todo = f => (read(f).match(/class="todo"/g) || []).length;
const draft = f => read(f).includes('id="draft"');

check(!/API_URL = ''/.test(cfg), 'API_URL is empty, so the account features are switched off', 'docs/DEPLOY_API_TH.md steps 1-5, then set API_URL in scripts/config.mjs');
check(!/REPLACE_WITH_ID/.test(api), 'api/wrangler.toml has no D1 database_id yet', 'wrangler d1 create taro (docs/DEPLOY_API_TH.md step 2)');
check(!/@REPLACE_WITH_YOUR_OFFICIAL_ACCOUNT_ID/.test(api), 'LINE_OA_URL is a placeholder', 'put your Official Account add-friend link in api/wrangler.toml (only needed for LINE reminders)');
check(!/REPLACE_WITH_ID/.test(log), 'wrangler.toml (question log) has no D1 database_id yet', 'docs/DEPLOY_TH.md (only needed if you want to store questions or click sequences)');
check(!/const LOG_URL = ''/.test(idx), 'LOG_URL is empty: questions are not stored (this is fine if you do not want that)', 'docs/DEPLOY_TH.md');
check(!/const TRACK_URL = ''/.test(idx), 'TRACK_URL is empty: click sequences are not stored (fine if you do not want that)', 'docs/DEPLOY_TH.md section 4.1');
for (const f of ['privacy.html', 'terms.html']) {
  check(todo(f) === 0, `${f} still has ${todo(f)} placeholder(s) in [brackets]`, 'fill them in after a legal review');
  check(!draft(f), `${f} still shows the "draft" notice`, 'remove the element with id="draft" once a lawyer has approved the text');
}
check(!/\[.*REPLACE|@example\.com/.test(api.split('\n').filter(l => /^EMAIL_FROM/.test(l)).join()), 'EMAIL_FROM looks like a placeholder', 'use an address on a domain verified in Resend');

console.log(open.length ? `${open.length} item(s) still open before launch:\n` + open.map((o, i) => `${i + 1}. ${o.what}\n   -> ${o.how}`).join('\n') : 'Nothing open: ready to launch.');
console.log('\nAlso remember (cannot be checked by a script): provider apps registered with the real redirect URIs, Resend domain verified, LINE Official Account webhook set, 2FA on the Cloudflare account.');
process.exit(process.argv.includes('--strict') && open.length ? 1 : 0);
