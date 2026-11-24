// Live studio view: the harness's own work stream, rendered as it happens.
//
// Polls /api/activity with a byte cursor so each event is shown once, keeps a
// short in-memory history, and shows the most recent thing the agents touched in
// a code window. Everything here is read-only — this page watches the studio, it
// cannot steer it.
(() => {
  const $ = (s) => document.querySelector(s);
  const MAX_ROWS = 160;
  const POLL_MS = 2500;

  const stream = $('#stream');
  const nowEl = $('#now-what');
  const whoEl = $('#now-who');
  const badge = $('#live-badge');
  const badgeLabel = $('#live-label');
  const codeEl = $('#code');
  const codeTitle = $('#code-title');
  const pinBtn = $('#code-pin');
  const phasesEl = $('#phases');
  const gatesEl = $('#gates');
  const criticEl = $('#critic');

  let cursor = null;   // null until the first poll returns the tail
  let rows = [];       // { key, el, ev }
  let pinned = false;  // a clicked event stops the window following the newest one
  let selected = null;
  let newest = null;   // newest event overall (players' "now working on")
  let phaseState = {}; // phase -> { status, detail }
  let gateState = {};  // gate name -> event
  let timers = [];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortPath = (p) => String(p ?? '').replace(/^.*?\/app\//, '');
  const rel = (iso) => {
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
  };

  function log(msg) { if (window.console) console.debug('[studio]', msg); }

  // ── the feed ────────────────────────────────────────────────────────────
  function lineFor(ev) {
    if (ev.kind === 'phase') {
      const what = ev.phase === 'build' ? `build ${ev.index ?? ''}/${ev.total ?? ''} — ${ev.task ?? ''}` : ev.phase;
      return { role: ev.phase === 'direct' ? 'director' : ev.phase, tag: ev.phase.toUpperCase(),
        html: ev.status === 'start'
          ? `<b>${esc(what)}</b> <span style="color:#8b99b5">started</span>`
          : `<b>${esc(what)}</b> ${esc(ev.status === 'done' ? 'done' : ev.status)}`, st: '' };
    }
    if (ev.kind === 'gate') {
      const cls = ev.status === 'pass' ? 'good' : ev.status === 'fail' ? 'bad' : '';
      const label = `${ev.label ?? ev.name}`;
      return { role: 'system', tag: 'GATE',
        html: `<code>${esc(label)}</code> <span style="color:#8b99b5">${esc(ev.status)}</span>`,
        st: ev.status === 'running' ? '…' : `${((ev.ms ?? 0) / 1000).toFixed(1)}s`, stCls: cls };
    }
    if (ev.kind === 'round') {
      const t = ev.phase === 'start' ? `round ${ev.round} started`
        : ev.phase === 'shipped' ? `round ${ev.round} shipped ${esc(ev.version ?? '')} — ${esc(ev.theme ?? '')}`
        : ev.phase === 'held_back' ? `round ${ev.round} held back — ${esc(ev.why ?? '')}`
        : `round ${ev.round} failed — ${esc(ev.why ?? '')}`;
      return { role: 'system', tag: 'ROUND', html: t, st: '', stCls: ev.phase === 'shipped' ? 'good' : (ev.phase === 'failed' || ev.phase === 'held_back') ? 'bad' : '' };
    }
    if (ev.kind === 'git') {
      return { role: 'system', tag: 'GIT', html: `commit <code>${esc(ev.commit ?? '')}</code> ${ev.pushed ? 'pushed to GitHub' : 'not pushed'}`, st: '' };
    }
    if (ev.kind === 'metrics') {
      const parts = Object.entries(ev.metrics ?? {}).map(([k, v]) => `${esc(k)} ${v?.progress ?? '?'}%`).join(' · ');
      return { role: 'system', tag: 'SIM', html: `bot simulation: ${parts || 'no data'}`, st: '' };
    }
    if (ev.kind === 'tool') {
      const wrote = ev.tool === 'write_file';
      const cls = ev.ok === false ? 'bad' : wrote ? 'good' : '';
      const tgt = shortPath(ev.target);
      const verb = ev.tool === 'run' ? 'run' : ev.tool === 'run_sim' ? 'sim' : ev.tool === 'search' ? 'search' : ev.tool;
      return {
        role: ev.role === 'director' ? 'director' : ev.role ?? 'builder',
        tag: String(ev.role ?? 'tool').slice(0, 8).toUpperCase(),
        html: `${wrote ? 'writing' : verb} <code>${esc(tgt)}</code>${ev.task ? ` <span style="color:#8b99b5">· ${esc(ev.task.slice(0, 40))}</span>` : ''}`,
        st: ev.ok === false ? 'fail' : ev.ms != null ? `${(ev.ms / 1000).toFixed(1)}s` : 'ok',
        stCls: cls,
      };
    }
    return { role: 'system', tag: String(ev.kind ?? '?').toUpperCase(), html: esc(ev.title ?? ev.why ?? ''), st: '' };
  }

  function addRow(ev) {
    // The placeholder is markup, not history: the first real event replaces it.
    // Left in place it sat above a hundred live rows saying nothing had happened.
    stream.querySelector('.empty')?.remove();
    const line = lineFor(ev);
    const li = document.createElement('li');
    li.className = 'ev';
    li.innerHTML = `<span class="role ${esc(line.role)}">${esc(line.tag)}</span>` +
      `<span class="msg">${line.html}</span>` +
      `<span class="st ${line.stCls ?? ''}">${esc(line.st)}</span>`;
    li.addEventListener('click', () => {
      pinned = true;
      pinBtn.textContent = 'follow latest';
      pinBtn.classList.add('pinned');
      select(ev);
    });
    stream.append(li);
    rows.push({ ev, el: li });
    while (rows.length > MAX_ROWS) {
      const old = rows.shift();
      old.el.remove();
    }
  }

  function refreshTimes() {
    // Durations on rows are static; ages are not. Only re-render the "now" card
    // and batch the list, so a quiet stretch does not repaint 160 rows a second.
    if (newest) whoEl.textContent = renderWho(newest);
  }

  function renderWho(ev) {
    if (!ev) return '';
    if (ev.kind === 'tool') return `${ev.role ?? 'agent'} · ${shortPath(ev.target)} · ${rel(ev.at)} ago`;
    if (ev.kind === 'phase') return `${ev.phase} · ${rel(ev.at)} ago`;
    if (ev.kind === 'round') return `round ${ev.round} ${ev.phase} · ${rel(ev.at)} ago`;
    if (ev.kind === 'gate') return `${ev.label ?? ev.name}: ${ev.status} · ${rel(ev.at)} ago`;
    return `${ev.kind} · ${rel(ev.at)} ago`;
  }

  function nowLine(ev) {
    if (!ev) return 'waiting for the studio to write its first step…';
    if (ev.kind === 'tool') {
      const t = shortPath(ev.target);
      if (ev.tool === 'write_file') return `writing ${t}`;
      if (ev.tool === 'edit_file') return `editing ${t}`;
      if (ev.tool === 'read_file') return `reading ${t}`;
      if (ev.tool === 'run') return `running ${t}`;
      if (ev.tool === 'run_sim') return `simulating ${t || 'a level'}`;
      if (ev.tool === 'search') return `searching for ${ev.target}`;
      return `${ev.tool} ${t}`;
    }
    if (ev.kind === 'phase') {
      if (ev.phase === 'observe') return ev.status === 'start' ? 'critic is playing the build and reading the log' : `critique: ${ev.headline ?? ''}`;
      if (ev.phase === 'direct') return ev.status === 'start' ? 'director is choosing this round' : `round theme: ${ev.theme ?? ''}`;
      if (ev.phase === 'build') return `builder ${ev.index ?? ''}/${ev.total ?? ''}: ${ev.task ?? ''}`;
    }
    if (ev.kind === 'gate') return `${ev.label ?? ev.name}: ${ev.status}`;
    if (ev.kind === 'round') return `round ${ev.round} — ${ev.phase}`;
    if (ev.kind === 'git') return `committed ${ev.commit ?? ''}`;
    if (ev.kind === 'metrics') return 'bot simulation finished';
    return ev.title ?? ev.kind ?? '';
  }

  // ── the code window ─────────────────────────────────────────────────────
  function select(ev) {
    selected = ev;
    for (const r of rows) r.el.classList.toggle('sel', r.ev === ev);
    renderCode(ev);
  }

  function renderCode(ev) {
    if (!ev) { codeEl.innerHTML = '<div class="row"><span class="n"></span><span class="s">Nothing written yet this round.</span></div>'; codeTitle.textContent = '—'; return; }
    codeTitle.textContent = `${ev.tool ?? ev.kind} ${shortPath(ev.target ?? ev.label ?? '')}`;
    const text = ev.code ?? ev.output ?? '';
    if (!text) {
      codeEl.innerHTML = '<div class="row"><span class="n"></span><span class="s">' +
        esc(ev.summary ?? ev.headline ?? 'This step did not produce text to display.') + '</span></div>';
      return;
    }
    const lang = ev.lang ?? (String(ev.target ?? '').endsWith('.py') ? 'py' : 'js');
    codeEl.innerHTML = highlight(text, lang);
    codeEl.scrollTop = 0;
  }

  // Small, dependency-free highlighter, done in ONE tokenizing pass.
  // The first version escaped text, inserted <span> markup, then ran a keyword
  // regex over the result — which matched "class" inside class="t-s" and tore the
  // markup apart. Tokens are classified here before any markup exists, and every
  // piece is escaped exactly once.
  const KW_JS = new Set('const let var function return if else for while class new import export from async await try catch finally throw typeof instanceof of in null undefined true false this super switch case break continue default delete do static get set yield'.split(' '));
  const KW_PY = new Set('def class return if elif else for while import from as with try except finally pass lambda and or not in is None True False async await yield raise global'.split(' '));

  // A grep hit inside a built bundle is ONE line of ~6 KB. Rendered whole it pushes
  // every real line out of the window, so each line is capped and the elision is
  // stated instead of pretending the line ended there.
  const MAX_COL = 200;

  function highlight(src, lang) {
    const kw = lang === 'py' ? KW_PY : KW_JS;
    const all = String(src).split('\n');
    const lines = all.slice(0, 400);
    let out = '';
    const re = /(["'`])(?:\\.|(?!\1).)*\1|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b/g;
    lines.forEach((raw0, i) => {
      const over = raw0.length > MAX_COL;
      const raw = over ? raw0.slice(0, MAX_COL) : raw0;
      let rest = raw;
      const cIdx = lang === 'py' ? rest.indexOf('#') : rest.indexOf('//');
      let comment = '';
      // A comment marker inside a string is not a comment; the token pass below
      // would catch it, so only strip a trailing comment when it is not quoted.
      if (cIdx >= 0) {
        const before = rest.slice(0, cIdx);
        const quotes = (before.match(/["'`]/g) ?? []).length;
        if (quotes % 2 === 0) { comment = rest.slice(cIdx); rest = before; }
      }
      const parts = [];
      let last = 0;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(rest))) {
        if (m.index > last) parts.push(esc(rest.slice(last, m.index)));
        const tok = m[0];
        let cls = '';
        if (/^["'`]/.test(tok)) cls = 't-s';
        else if (/^\d/.test(tok)) cls = 't-n';
        else if (kw.has(tok)) cls = 't-k';
        else if (/^\s*\(/.test(rest.slice(m.index + tok.length))) cls = 't-f';
        parts.push(cls ? `<span class="${cls}">${esc(tok)}</span>` : esc(tok));
        last = m.index + tok.length;
      }
      let body = parts.join('') + esc(rest.slice(last));
      if (comment) body += `<span class="t-c">${esc(comment)}</span>`;
      if (over) body += `<span class="t-c"> … +${raw0.length - MAX_COL} chars on this line</span>`;
      out += `<div class="row"><span class="n">${i + 1}</span><span class="s">${body || ' '}</span></div>`;
    });
    if (all.length > lines.length) {
      out += `<div class="row"><span class="n">…</span><span class="s t-c">${all.length - lines.length} more lines not shown</span></div>`;
    }
    return out;
  }

  pinBtn.addEventListener('click', () => {
    pinned = !pinned;
    pinBtn.classList.toggle('pinned', pinned);
    pinBtn.textContent = pinned ? 'follow latest' : 'pin latest';
    if (!pinned) select(newest);
  });
  pinBtn.textContent = 'pin latest';

  // ── phases / gates / critique ───────────────────────────────────────────
  function renderPhases() {
    const order = ['observe', 'direct', 'build', 'verify', 'ship'];
    phasesEl.innerHTML = order.map((name) => {
      const s = phaseState[name] ?? {};
      const cls = s.status === 'done' ? 'done' : s.status === 'active' ? 'active' : s.status === 'failed' ? 'failed' : '';
      const label = { observe: 'Observe', direct: 'Direct', build: 'Build', verify: 'Verify', ship: 'Ship' }[name];
      return `<div class="phase ${cls}"><div class="pn">${label}</div><div class="pv">${esc(s.detail ?? (cls ? '' : 'waiting'))}</div></div>`;
    }).join('');
  }

  function renderGates() {
    const names = ['test', 'verify', 'build'];
    gatesEl.innerHTML = names.map((n) => {
      const g = gateState[n];
      const cls = g ? (g.status === 'pass' ? 'pass' : g.status === 'fail' ? 'fail' : 'running') : '';
      const res = !g ? '—' : g.status === 'pass' ? 'pass' : g.status === 'fail' ? 'fail' : 'running';
      const ms = g?.ms != null ? `${(g.ms / 1000).toFixed(1)}s` : g && g.status !== 'running' ? '' : '';
      const label = { test: 'npm test', verify: 'verify gate', build: 'vite build' }[n];
      return `<div class="gate ${cls}"><div class="name">${label}</div><div class="res">${res}</div><div class="ms">${ms}</div></div>`;
    }).join('');
  }

  function renderCritic(c) {
    if (!c) { criticEl.innerHTML = '<div><h3>Critic</h3><p class="none">No critique in this round yet.</p></div><div><h3>Strengths</h3><p class="none">—</p></div>'; return; }
    const problems = (c.problems ?? []).map((p) =>
      `<li><span class="sev ${esc(p.severity ?? 'low')}">${esc(p.severity ?? '')}</span>${esc(String(p.detail ?? '').slice(0, 320))}</li>`).join('');
    const strengths = (c.strengths ?? []).map((s) => `<li>${esc(s)}</li>`).join('');
    criticEl.innerHTML =
      `<div><h3>What has problems</h3>${problems ? `<ul>${problems}</ul>` : '<p class="none">Nothing flagged.</p>'}</div>` +
      `<div><h3>What is working</h3>${strengths ? `<ul>${strengths}</ul>` : '<p class="none">—</p>'}</div>`;
  }

  // ── poll ────────────────────────────────────────────────────────────────
  function apply(ev) {
    newest = ev;
    addRow(ev);
    if (ev.kind === 'phase') {
      phaseState[ev.phase] = {
        status: ev.status === 'start' ? 'active' : 'done',
        detail: ev.phase === 'build' ? (ev.task ?? '') : ev.phase === 'direct' ? (ev.theme ?? '') : ev.phase === 'observe' ? (ev.headline ?? '') : '',
      };
      // Each phase starting means the previous one finished even if its own
      // "done" never got written (a round can die between two emits).
      const order = ['observe', 'direct', 'build', 'verify', 'ship'];
      const i = order.indexOf(ev.phase);
      if (i > 0 && ev.status === 'start') for (const p of order.slice(0, i)) if (phaseState[p]?.status === 'active') phaseState[p].status = 'done';
      if (ev.phase === 'observe' && ev.status === 'done') renderCritic(ev);
      renderPhases();
    }
    if (ev.kind === 'gate') { gateState[ev.name] = ev; renderGates(); }
    if (ev.kind === 'round') {
      if (ev.phase === 'start') { phaseState = {}; gateState = {}; renderPhases(); renderGates(); renderCritic(null); }
      if (ev.phase === 'shipped' || ev.phase === 'failed' || ev.phase === 'held_back') {
        phaseState.ship = { status: ev.phase === 'shipped' ? 'done' : 'failed', detail: ev.phase === 'shipped' ? `v${ev.version}` : ev.phase };
        renderPhases();
      }
    }
    nowEl.textContent = nowLine(ev);
    whoEl.textContent = renderWho(ev);
    if (!pinned) select(newest);
  }

  // One request in flight at a time, and never for longer than the poll interval.
  //
  // A 2.5 s timer with no guard and no timeout piles requests up as soon as the
  // link slows: each stalled request holds one of the browser's six connections
  // to this origin, so after ~15 s of stalls the pool is full and the game
  // iframe — a different URL on the same origin — queues behind them forever.
  // Measured from outside: page with this script live took 121 s and never
  // showed the game; with /api/activity blocked, 2.5 s. The audience saw a blank
  // play area and blamed the game.
  let inFlight = false;
  async function poll() {
    if (inFlight) return;
    inFlight = true;
    // A stalled poll must give its connection back, or the next one cannot start.
    const ac = new AbortController();
    const abort = setTimeout(() => ac.abort(), POLL_MS * 2);
    try {
      const q = cursor == null ? '?limit=80' : `?from=${cursor}`;
      const r = await fetch(`/api/activity${q}`, { cache: 'no-store', signal: ac.signal });
      if (!r.ok) throw new Error(`http ${r.status}`);
      const data = await r.json();
      for (const ev of data.events ?? []) apply(ev);
      if (data.cursor != null) cursor = data.cursor;
      badge.classList.toggle('on', !!data.active);
      badgeLabel.textContent = data.active ? 'live — a round is running' : 'idle — between rounds';
    } catch (e) {
      log(e.name === 'AbortError' ? 'slow — retrying' : e.message);
      badge.classList.remove('on');
      badgeLabel.textContent = e.name === 'AbortError' ? 'reconnecting' : 'offline';
    } finally {
      clearTimeout(abort);
      inFlight = false;
    }
  }

  renderPhases();
  renderGates();
  renderCritic(null);
  // The studio is a side panel, not the point of the page: let the hero, the
  // version picker and the play area have the first few seconds of the link.
  timers.push(setTimeout(poll, 1500));
  timers.push(setInterval(poll, POLL_MS));
  timers.push(setInterval(refreshTimes, 1000));
})();
