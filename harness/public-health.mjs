/* Public-path health, measured from this machine every 5 minutes.
 *
 * The link to the server loses a lot of packets, and a client that has to wait
 * for a 232 KB response has no way to tell a slow route from a broken server.
 * This records what a real browser experiences from outside, so a regression is
 * caught from the audience's side instead of the loopback interface.
 */
import fs from 'node:fs';
import https from 'node:https';

// Playwright is optional here: the HTTP sample is the health signal, and a box
// without a downloaded browser should still record that signal.
const chromium = await import('playwright')
  .then((m) => m.chromium)
  .catch(() => null);

const BASE = 'https://gameforge.198-44-118-189.sslip.io';
const OUT = 'devlog/public-health.jsonl';

function timedFetch(p, timeout = 20_000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.get(BASE + p, { timeout, headers: { 'accept-encoding': 'gzip' } }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; });
      res.on('end', () => resolve({ path: p, code: res.statusCode, bytes: n, ms: Date.now() - t0 }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ path: p, code: 0, ms: Date.now() - t0, err: 'timeout' }); });
    req.on('error', (e) => resolve({ path: p, code: 0, ms: Date.now() - t0, err: e.code ?? e.message }));
  });
}

async function browser() {
  if (!chromium) return { err: 'playwright not installed' };
  const b = await chromium.launch();
  try {
    const pg = await b.newPage();
    const t0 = Date.now();
    await pg.goto(BASE + '/', { waitUntil: 'commit', timeout: 45_000 });
    const result = {};
    for (const [k, expr] of [
      ['versions', "() => document.querySelectorAll('#version-select option').length"],
      ['logs', "() => document.querySelectorAll('#devlog-list li').length"],
      ['playable', "() => { const f=document.querySelector('#gameframe'); return !!(f && f.contentDocument && f.contentDocument.querySelector('canvas#game')); }"],
    ]) {
      try {
        await pg.waitForFunction(expr, null, { timeout: 40_000 });
        result[k] = await pg.evaluate(expr);
      } catch { result[k] = 'timeout'; }
    }
    result.ms = Date.now() - t0;
    return result;
  } finally { await b.close(); }
}

const sample = { at: new Date().toISOString(), http: [], browser: null };
for (const p of ['/healthz', '/api/builds', '/api/version', '/api/devlog', '/game/latest/index.html']) {
  sample.http.push(await timedFetch(p));
}
try { sample.browser = await browser(); } catch (e) { sample.browser = { err: String(e.message ?? e).slice(0, 200) }; }

fs.appendFileSync(OUT, JSON.stringify(sample) + '\n');
const slow = sample.http.filter((r) => r.err || r.ms > 8000);
console.log(JSON.stringify({ at: sample.at, slow: slow.length, browser: sample.browser }));
process.exit(slow.length ? 1 : 0);
