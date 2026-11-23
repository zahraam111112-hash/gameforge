import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const DIR = path.join(ROOT, 'devlog');
const FILE = path.join(DIR, 'log.jsonl');

export function append(entry) {
  fs.mkdirSync(DIR, { recursive: true });
  const rec = { at: new Date().toISOString(), ...entry };
  fs.appendFileSync(FILE, JSON.stringify(rec) + '\n');
  return rec;
}

export function read(limit = 200) {
  try {
    return fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

export function lastVersion() {
  for (const e of read(500).reverse()) {
    if (e.kind === 'release' || e.kind === 'build') return e.version;
  }
  return null;
}
