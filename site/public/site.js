const $ = (s) => document.querySelector(s);
const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

// A page that refreshes decoration on a timer must never let those requests
// pile up. Each stalled one holds a connection to this origin, and the game is
// an iframe on the same origin: a handful of stuck polls makes the play area
// wait forever behind them while the server answers every request in 45 ms.
// Aborting after a few seconds returns the connection and the next tick starts.
async function json(url, fallback, timeoutMs = 8000) {
  const ac = new AbortController();
  const abort = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
    if (!r.ok) return fallback;
    return await r.json();
  } catch { return fallback; } finally { clearTimeout(abort); }
}

async function loadVersion() {
  const v = await json('/api/version', { version: 'dev', tests: null, builds: null });
  $('#f-version').textContent = v.version ?? 'dev';
  $('#footer-version').textContent = `version ${v.version ?? 'dev'}`;
  $('#f-tests').textContent = v.tests != null ? `${v.tests.passed}/${v.tests.total}` : '—';
  $('#f-builds').textContent = v.builds != null ? String(v.builds) : '—';
  return v;
}

async function loadVersions() {
  // The picker is built from what is actually on disk, so every archived build
  // is reachable even if it predates the devlog entry that described it.
  //
  // The devlog is NOT awaited here. It is the heaviest response on the site and
  // this link loses enough packets that it often takes 30-100 s or fails; when
  // it was awaited first the picker stayed empty for that whole time and the
  // page looked like it had no games. Release notes are decoration on the
  // cards, so they arrive later and fill themselves in.
  const { builds } = await json('/api/builds', { builds: [] });
  let byVersion = new Map();
  const sel = $('#version-select');
  sel.innerHTML = '';
  for (const b of builds) {
    const opt = document.createElement('option');
    opt.value = b.version;
    const rel = byVersion.get(b.version);
    opt.textContent = b.version === 'latest' ? 'latest' : `${b.version} · ${fmtDate(rel?.at ?? b.at)}`;
    sel.appendChild(opt);
  }
  const list = $('#version-list');
  if (!builds.length) {
    list.innerHTML = '<p class="sub">No archived builds yet — the first stable release will appear here.</p>';
    return;
  }

  // Paint title/date-only cards immediately, then upgrade them in place when
  // the release notes land. Every card is already playable at this point.
  const paint = () => {
    list.innerHTML = builds.map((b) => {
      const rel = byVersion.get(b.version);
      const href = `/game/${encodeURIComponent(b.version)}/index.html`;
      return `
    <article class="card">
      <span class="tag">${escapeHtml(b.version)}</span>
      <h3><a href="${href}" target="_blank" rel="noopener">${escapeHtml(rel?.title ?? `Build ${b.version}`)}</a></h3>
      <div class="date">${fmtDate(rel?.at ?? b.at)}</div>
      ${rel?.changes ? `<ul>${rel.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>` : ''}
      <p class="card-play"><a href="${href}" target="_blank" rel="noopener">Play this build ↗</a></p>
    </article>`;
    }).join('');
  };
  paint();

  json('/api/devlog', []).then((data) => {
    if (!Array.isArray(data) || !data.length) return;
    byVersion = new Map(data.filter((e) => e.kind === 'release' || e.kind === 'build').map((e) => [e.version, e]));
    paint();
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadDevlog() {
  const data = await json('/api/devlog', []);
  const list = $('#devlog-list');
  if (!data.length) {
    list.innerHTML = '<li><p>The log is empty. The harness writes here after every build.</p></li>';
    return;
  }
  list.innerHTML = data.slice().reverse().map((e) => `
    <li>
      <div class="meta">
        <span class="kind ${escapeHtml(e.kind ?? 'improved')}">${escapeHtml(e.kind ?? 'note')}</span>
        <span>${fmtDate(e.at)}</span>
        ${e.agent ? `<span>· by ${escapeHtml(e.agent)}</span>` : ''}
        ${e.version ? `<span>· ${escapeHtml(e.version)}</span>` : ''}
      </div>
      <h3>${escapeHtml(e.title ?? '(untitled)')}</h3>
      <p>${escapeHtml(e.why ?? e.summary ?? '')}</p>
      ${e.tags ? `<div class="tags">${e.tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </li>`).join('');
}

async function loadRoadmap() {
  const v = await json('/api/version', {});
  const items = v.roadmap ?? [
    'Complete story act one with a third boss phase',
    'Ranked battle royale with server-authoritative combat',
    'Daily seeded challenge with a global leaderboard',
    'Adaptive music that reacts to tension',
  ];
  $('#roadmap').innerHTML = items.map((i) => `<li>${escapeHtml(i)}</li>`).join('');
}

async function loadLobby() {
  const s = await json('/api/lobby', { rooms: [], totalPlayers: 0 });
  $('#f-online').textContent = String(s.totalPlayers ?? 0);
  const grid = $('#lobby-grid');
  const rows = (s.rooms ?? []).map((r) => `
    <div class="lobby-card">
      <div class="count">${r.players}</div>
      <div class="label">${escapeHtml(r.key)}</div>
      <div class="date">tick ${r.frame}</div>
    </div>`).join('');
  grid.innerHTML = rows || '<div class="lobby-card"><div class="count">0</div><div class="label">no active rooms</div></div>';
}

$('#reload-game').addEventListener('click', () => {
  const v = $('#version-select').value;
  const frame = $('#gameframe');
  frame.src = v === 'latest' ? `/game/latest/index.html?v=${Date.now()}` : `/game/${encodeURIComponent(v)}/index.html?v=${Date.now()}`;
  $('#play-note').textContent = v === 'latest' ? 'Loading latest build…' : `Loading archived ${v}…`;
});
$('#version-select').addEventListener('change', () => $('#reload-game').click());

loadVersion();
loadVersions();
loadDevlog();
loadRoadmap();
loadLobby();
// Overlapping runs are pointless: json() already bounds each call, and a second
// copy of the same refresh racing the first only spends connections the play
// area needs. Each tick skips itself while the previous one is still going.
function spaced(fn, ms) {
  let running = false;
  return setInterval(async () => {
    if (running) return;
    running = true;
    try { await fn(); } finally { running = false; }
  }, ms);
}
spaced(loadLobby, 5000);
spaced(loadDevlog, 30000);
