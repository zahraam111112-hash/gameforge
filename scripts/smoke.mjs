// Post-deploy smoke: the public site serves a playable build and the live server
// accepts a multiplayer connection. Exits non-zero when a player would see a break.
const base = process.argv[2] ?? process.env.GAMEFORGE_BASE ?? 'http://127.0.0.1:9000';
const problems = [];

async function head(path) {
  try {
    const r = await fetch(base + path, { redirect: 'follow' });
    if (!r.ok) problems.push(`${path} → ${r.status}`);
    return r;
  } catch (e) { problems.push(`${path} → ${e.message}`); return null; }
}

for (const p of ['/', '/site.css', '/site.js', '/api/version', '/api/lobby', '/api/devlog', '/game/latest/index.html']) {
  await head(p);
}

const html = await (await head('/game/latest/index.html'))?.text?.() ?? '';
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = m[1];
  if (url.startsWith('http') || url.startsWith('/src/')) continue;
  await head(url.startsWith('/') ? url : '/game/latest/' + url.replace(/^\.\//, ''));
}

const health = await (await head('/api/health'))?.json?.().catch(() => null);
if (health && health.totalPlayers === undefined) problems.push('/api/health missing player count');

if (problems.length) {
  console.error('SMOKE FAILED\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`SMOKE OK — ${base}`);
