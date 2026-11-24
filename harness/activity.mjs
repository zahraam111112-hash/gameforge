// Append-only work stream for the public studio view.
//
// The devlog records decisions ("0.1.8 shipped", "round held back"). This records
// the *work*: every tool call the agents make, which file it touched, the command
// it ran, the code it wrote, whether it worked, how long it took. The site polls
// /api/activity and renders it as a live feed plus a code window, so an audience
// can watch a round happen instead of reading a summary of it afterwards.
//
// Every write is best-effort. Visibility must never be able to take the studio
// down, so a failure here is swallowed rather than thrown into a round.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'devlog');
const FILE = path.join(DIR, 'activity.jsonl');
const MAX_LINES = 4000;

let seq = 0;
let writes = 0;

export function emit(event) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const rec = {
      id: `${Date.now().toString(36)}-${(++seq).toString(36)}`,
      at: new Date().toISOString(),
      ...event,
    };
    // One JSON object per line: the server can tail it, and a crash mid-write
    // costs one unreadable line at the end instead of the whole file.
    fs.appendFileSync(FILE, JSON.stringify(rec) + '\n');
    if (++writes % 200 === 0) rotate();
    return rec;
  } catch {
    return null;
  }
}

function rotate() {
  try {
    const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n');
    if (lines.length > MAX_LINES) {
      fs.writeFileSync(FILE, lines.slice(-MAX_LINES).join('\n') + '\n');
    }
  } catch { /* rotation is housekeeping, not correctness */ }
}

/** Trim anything headed for the public page. Big enough to read, small enough to stream. */
export function clip(text, max = 1400) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max) + '\n…' : s;
}

export const ACTIVITY_FILE = FILE;
