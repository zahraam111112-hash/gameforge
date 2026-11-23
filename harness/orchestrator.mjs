// The forever loop. One round = Observe → Direct → Build (parallel) → Verify → Ship.
// Each round ends in either a new stable version (tagged, archived, pushed) or a
// recorded failure with the reason — never a silent stall.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { critic, director, builder, verifier, reviewer } from './agents.mjs';
import { simulate } from './sim.mjs';
import * as devlog from './devlog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHED = path.join(ROOT, 'site', 'public', 'game');
const ROUND_SLEEP = Number(process.env.GAMEFORGE_ROUND_SLEEP_MS ?? 60_000);
const MAX_ROUNDS = Number(process.env.GAMEFORGE_MAX_ROUNDS ?? 0); // 0 = forever
const LEVELS_TO_SIM = ['s1', 's2', 's3', 'arena'];

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60_000, ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code ?? 0, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

function readVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')); }
  catch { return { version: '0.1.0', builds: 0 }; }
}

function writeVersion(v) {
  fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify(v, null, 2));
}

function bump(v) {
  const [a, b, c] = String(v.version ?? '0.1.0').split('.').map(Number);
  return { version: `${a}.${b}.${(c || 0) + 1}`, builds: (v.builds ?? 0) + 1, updatedAt: new Date().toISOString() };
}

async function metrics() {
  const out = {};
  for (const level of LEVELS_TO_SIM) {
    try { out[level] = simulate({ level, steps: 5400, seed: 7 }); }
    catch (e) { out[level] = { error: String(e.message ?? e) }; }
  }
  return out;
}

async function git(args) {
  return run('git', args);
}

async function ensureGit() {
  const status = await git(['status', '--short']);
  return status.stdout;
}

async function main() {
  if (!process.env.GAMEFORGE_API_KEY) {
    console.error('GAMEFORGE_API_KEY missing — refusing to start.');
    process.exit(2);
  }
  console.log(`[harness] starting in ${ROOT}`);
  devlog.append({ kind: 'decision', agent: 'orchestrator', title: 'Harness online', why: 'Beginning the continuous build loop.' });

  for (let round = 1; MAX_ROUNDS === 0 || round <= MAX_ROUNDS; round++) {
    const started = Date.now();
    const vBefore = readVersion();
    console.log(`\n=== round ${round} (current ${vBefore.version}) ===`);
    try {
      const m = await metrics();
      const history = devlog.read(80);

      const c = await critic(ROOT, { version: vBefore.version, metrics: m, devlog: history });
      devlog.append({ kind: 'note', agent: 'critic', title: c.headline ?? 'critique', why: JSON.stringify(c.problems ?? []), tags: ['critique'] });
      console.log('[critic]', c.headline);

      const plan = await director(ROOT, { critique: c, devlog: history });
      console.log('[director]', plan.theme, plan.tasks?.length, 'tasks');

      const tasks = (plan.tasks ?? []).slice(0, 4);
      const built = [];
      for (const t of tasks) {
        console.log(`[builder] ${t.title}`);
        const res = await builder(ROOT, t, { version: vBefore.version });
        built.push({ task: t, res });
        if (res.tests?.startsWith?.('fail')) console.warn('[builder] reported failing tests:', res.tests);
      }

      // Deterministic gates — never trust the agents' self-report alone.
      const test = await run('npm', ['test']);
      const verify = await run('node', ['harness/verify.mjs']);
      // vite.config writes into game/.stage, so an unverified build never reaches the site.
      const build = await run('npm', ['run', 'build']);
      const allGreen = test.ok && build.ok && verify.ok;

      const notes = await reviewer(ROOT, { round: { theme: plan.theme, rationale: plan.rationale, tasks }, verification: { allGreen } });
      for (const e of notes.entries ?? []) {
        devlog.append({ kind: e.kind, agent: 'reviewer', title: e.title, why: e.why, tags: e.tags });
      }

      if (!allGreen) {
        devlog.append({
          kind: 'decision', agent: 'orchestrator', title: `Round ${round} held back`,
          why: `Verification failed. tests=${test.ok} build=${build.ok} verify=${verify.ok}. ${(test.stderr || build.stderr || '').slice(-400)}`,
        });
        console.log('[harness] held back — code not shipped');
        fs.rmSync(path.join(ROOT, 'game', '.stage'), { recursive: true, force: true });
        if (process.env.GAMEFORGE_REVERT_ON_FAIL !== '0') await revertToHead();
        await sleep(ROUND_SLEEP);
        continue;
      }

      const vNext = bump(vBefore);
      const tests = countTests();
      vNext.tests = { total: tests.total, passed: tests.passed };
      vNext.theme = plan.theme;
      vNext.round = round;
      vNext.roadmap = vBefore.roadmap ?? vNext.roadmap;
      writeVersion(vNext);

      // Archive the playable build so the site can serve older versions.
      // Builds land in game/.stage; only a verified build is promoted.
      const stage = path.join(ROOT, 'game', '.stage');
      const latest = path.join(PUBLISHED, 'latest');
      fs.mkdirSync(latest, { recursive: true });
      if (fs.existsSync(stage)) {
        for (const name of fs.readdirSync(stage)) {
          const from = path.join(stage, name);
          const to = path.join(latest, name);
          if (fs.statSync(from).isDirectory()) { fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(from, to, { recursive: true }); }
          else fs.copyFileSync(from, to);
        }
      }
      fs.rmSync(stage, { recursive: true, force: true });
      const archive = path.join(PUBLISHED, vNext.version);
      if (fs.existsSync(latest)) {
        fs.rmSync(archive, { recursive: true, force: true });
        fs.mkdirSync(archive, { recursive: true });
        copyDir(latest, archive);
      }

      devlog.append({
        kind: 'release', agent: 'orchestrator', version: vNext.version,
        title: `${vNext.version} — ${plan.theme ?? 'round ' + round}`,
        changes: (built.map((b) => b.res.summary).filter(Boolean)),
        why: plan.rationale,
      });

      fs.writeFileSync(path.join(ROOT, 'VERSIONS.md'), versionsIndex());

      if (await git(['rev-parse', '--is-inside-work-tree']).then((r) => r.ok)) {
        await git(['add', '-A']);
        const msg = `feat: ${vNext.version} — ${plan.theme ?? 'round ' + round}\n\n${plan.rationale ?? ''}\n\nCo-Authored-By: Navara Harness <harness@gameforge.local>`;
        await git(['commit', '-m', msg]);
        const push = await git(['push', 'origin', 'HEAD:main']);
        console.log('[harness] pushed:', push.ok ? 'ok' : push.stderr.slice(0, 200));
      }

      console.log(`[harness] shipped ${vNext.version} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
    } catch (e) {
      console.error('[harness] round failed:', e.message ?? e);
      devlog.append({ kind: 'decision', agent: 'orchestrator', title: `Round ${round} failed`, why: String(e.message ?? e).slice(0, 800) });
      // A round that dies mid-build leaves half-finished edits behind; the next
      // round must start from the last shipped state or quality drifts downward.
      if (process.env.GAMEFORGE_REVERT_ON_FAIL !== '0') await revertToHead();
    }
    await sleep(ROUND_SLEEP);
  }
}

/** Reject-and-return: a round that fails the gates leaves no trace in the next round. */
async function revertToHead() {
  const st = await git(['status', '--porcelain']);
  if (!st.stdout.trim()) return;
  await git(['checkout', '--', '.']);
  const clean = await git(['clean', '-fd', 'game', 'harness', 'server', 'site', 'scripts', 'test']);
  console.log('[harness] reverted working tree:', clean.ok ? 'ok' : clean.stderr.slice(0, 160));
}

function versionsIndex() {
  const releases = devlog.read(1000).filter((e) => e.kind === 'release');
  const lines = ['# Navara — shipped versions', '',
    'Every entry below passed the unit suite, the bot simulation gate, and the production build.',
    'Play any archived build from the site\'s version selector.', ''];
  for (const r of releases.slice().reverse()) {
    lines.push(`## ${r.version ?? 'build'} — ${r.title ?? ''}`, '', `_${r.at}_`, '');
    for (const c of r.changes ?? []) lines.push(`- ${c}`);
    if (r.why) lines.push('', `**Why:** ${r.why}`);
    lines.push('');
  }
  return lines.join('\n');
}

function countTests() {
  try {
    const out = execFileSync('node', ['--test', '--test-reporter', 'json', 'test/world.test.mjs'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const last = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
    const report = JSON.parse(last ?? '{}');
    const total = report.tests?.length ?? 0;
    return { total, passed: report.tests?.filter((t) => t.ok).length ?? 0 };
  } catch { return { total: 0, passed: 0 }; }
}

function copyDir(src, dest) {
  for (const d of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, d.name);
    const t = path.join(dest, d.name);
    if (d.isDirectory()) { fs.mkdirSync(t, { recursive: true }); copyDir(s, t); }
    else fs.copyFileSync(s, t);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
main();
