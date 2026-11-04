// Local development server for taro-api: the real Worker code on an in-memory SQLite database. Nothing is kept after it stops.
// Run:  node api/dev/server.mjs [port]      then set API_URL in scripts/config.mjs to http://localhost:<port>
// Serve the site separately (python3 -m http.server 8000); emails are not sent, they are listed at /__dev/mails.
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {makeEnv} from '../test/helpers.mjs';
import worker from '../index.js';

export function startDevServer({port = 0, webOrigin = 'http://localhost:8000', extraEnv = {}} = {}) {
  const origin = {value: webOrigin};
  const env = makeEnv({WEB_URL: webOrigin, ALLOWED_ORIGINS: webOrigin, DAILY_SECRET: 'dev-daily-secret-dev-daily-secret', COOKIE_SECRET: 'dev-cookie-secret-dev-cookie-secret', ...extraEnv});
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/__dev/mails') {
      res.writeHead(200, {'content-type': 'application/json', 'access-control-allow-origin': '*'});
      return res.end(JSON.stringify(env.mails));
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const pending = [];
    const r = await worker.fetch(new Request(url, {method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, redirect: 'manual'}), env, {waitUntil: p => pending.push(p)});
    await Promise.all(pending);
    const headers = {};
    r.headers.forEach((v, k) => { if (k !== 'set-cookie') headers[k] = v; });
    headers['set-cookie'] = r.headers.getSetCookie();
    res.writeHead(r.status, headers);
    res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(port);
  server.env = env; server.setWebOrigin = o => { origin.value = o; env.WEB_URL = o; env.ALLOWED_ORIGINS = o; };
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2]) || 8787;
  startDevServer({port, webOrigin: process.env.WEB_ORIGIN || 'http://localhost:8000'});
  console.log(`taro-api dev server on http://localhost:${port} (in-memory data; emails at /__dev/mails)`);
}
