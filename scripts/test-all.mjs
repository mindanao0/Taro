// Runs every fast test (no browser) one after another and prints one line each. Exit 1 if any fails.   node scripts/test-all.mjs
// The browser tests are separate because they need Playwright and take minutes:  npm run test:e2e  /  npm run test:a11y
import {spawnSync} from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const node = ['scripts/reading-core.test.mjs', 'scripts/reading-guide.test.mjs', 'scripts/position-meanings.test.mjs', 'scripts/topic-model.test.mjs', 'scripts/all-spreads.test.mjs', 'scripts/track.test.mjs', 'scripts/api-client.test.mjs', 'scripts/policy.test.mjs', 'scripts/seo.test.mjs',
  'worker/index.test.mjs', 'worker/events.test.mjs', 'worker/click-events.test.mjs', 'api/test/auth.test.mjs', 'api/test/social.test.mjs', 'api/test/account.test.mjs', 'api/test/hardening.test.mjs', 'api/test/readings.test.mjs', 'api/test/line.test.mjs'];
const python = [['scripts/validate_data.py'], ['scripts/package_deck.py', '--check-only']];

let failed = 0;
const run = (label, cmd, args) => {
  const r = spawnSync(cmd, args, {cwd: root, encoding: 'utf8', env: {...process.env, NODE_NO_WARNINGS: '1'}});
  const line = (r.stdout || '').split('\n').find(l => l.startsWith('PASS')) || '';
  if (r.status === 0 && line) console.log(`ok    ${label}: ${line.slice(0, 110)}`);
  else { failed++; console.log(`FAIL  ${label}\n${((r.stdout || '') + (r.stderr || '')).split('\n').slice(-14).join('\n')}`); }
};
for (const f of node) run(f, process.execPath, [f]);
if (spawnSync('python3', ['--version']).status === 0) for (const a of python) run(a.join(' '), 'python3', a);
else console.log('skip  python checks (python3 not found)');
console.log(failed ? `${failed} FAILED` : 'All fast tests passed.');
process.exit(failed ? 1 : 0);
