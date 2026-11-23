const $ = (s) => document.querySelector(s);
const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

async function json(url, fallback) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return fallback;
    return await r.json();
  } catch { return fallback; }
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
  const data = await json('/api/devlog', []);
  const builds = [];
  const sel = $('#version-select');
  for (const e of data) {
    if (e.kind !== 'release' && e.kind !== 'build') continue;
    const opt = document.createElement('option');
    opt.value = e.version ?? 'latest';
    opt.textContent = `${e.version ?? 'build'} · ${fmtDate(e.at)}`;
    sel.appendChild(opt);
    builds.push(e);
  }
  const list = $('#version-list');
  if (!builds.length) {
    list.innerHTML = '<p class="sub">No archived builds yet — the first stable release will appear here.</p>';
    return;
  }
  list.innerHTML = builds.slice().reverse().map((b) => `
    <article class="card">
      <span class="tag">${b.version ?? 'build'}</span>
      <h3>${escapeHtml(b.title ?? 'Release')}</h3>
      <div class="date">${fmtDate(b.at)}</div>
      ${b.changes ? `<ul>${b.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>` : ''}
    </article>`).join('');
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
setInterval(loadLobby, 5000);
setInterval(loadDevlog, 30000);
