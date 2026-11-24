import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const DENY = [/\.git\//, /node_modules\//, /\.env$/, /secret/i, /\.ssh/];

export function makeTools(root) {
  const inside = (p) => {
    const abs = path.resolve(root, p);
    if (!abs.startsWith(root + path.sep) && abs !== root) throw new Error('path escapes workspace');
    if (DENY.some((re) => re.test(abs))) throw new Error('path is protected');
    return abs;
  };

  return {
    read_file: async ({ path: rel }) => {
      const abs = inside(rel);
      const data = fs.readFileSync(abs, 'utf8');
      return data.length > 60_000 ? data.slice(0, 60_000) + '\n…[truncated]' : data;
    },
    list_dir: async ({ path: rel = '.' }) => {
      const abs = inside(rel);
      return fs.readdirSync(abs, { withFileTypes: true })
        .filter((d) => !d.name.startsWith('.git'))
        .map((d) => `${d.isDirectory() ? 'd/' : 'f '} ${d.name}`).join('\n');
    },
    write_file: async ({ path: rel, content }) => {
      const abs = inside(rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (typeof content !== 'string') throw new Error('content must be a string');
      fs.writeFileSync(abs, content);
      return `wrote ${content.length} bytes to ${rel}`;
    },
    edit_file: async ({ path: rel, find, replace }) => {
      const abs = inside(rel);
      const data = fs.readFileSync(abs, 'utf8');
      const idx = data.indexOf(find);
      if (idx === -1) throw new Error('find string not present');
      if (data.indexOf(find, idx + 1) !== -1) throw new Error('find string is not unique');
      fs.writeFileSync(abs, data.slice(0, idx) + replace + data.slice(idx + find.length));
      return `edited ${rel}`;
    },
    search: async ({ pattern, ext = '' }) => {
      const { execFileSync } = await import('node:child_process');
      try {
        return execFileSync('grep', ['-rn', '--include=*' + (ext ? `.${ext}` : ''), pattern, root], { encoding: 'utf8' }).slice(0, 20_000);
      } catch (e) { return e.stdout?.toString?.().slice(0, 20_000) ?? 'no matches'; }
    },
    run: async ({ cmd, timeout = 120_000 }) => {
      const allowed = /^(npm|node|npx|git|eslint|tsc|grep|find|ls|cat|wc|playwright|bash -c 'node )/;
      // An absent cmd used to crash on cmd.split and hand the agent a TypeError
      // about "undefined" instead of telling it what to send.
      if (typeof cmd !== 'string' || !cmd.trim()) {
        throw new Error('run needs a "cmd" string, e.g. {"cmd":"node harness/verify.mjs"}');
      }
      if (!allowed.test(cmd)) throw new Error(`command not allowed: ${cmd.split(' ')[0]}`);
      return new Promise((resolve) => {
        execFile('bash', ['-lc', cmd], { cwd: root, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
          resolve({ ok: !err, code: err?.code ?? 0, stdout: (stdout ?? '').slice(-12_000), stderr: (stderr ?? '').slice(-8_000) });
        });
      });
    },
    run_sim: async ({ level = 's1', steps = 3600, seed = 1 }) => {
      // The bot simulation is the semantic test: it plays the level and reports
      // how far it got, deaths, time stuck and bugs (NaN, fell out of world).
      const { simulate } = await import('./sim.mjs');
      return simulate({ level, steps, seed });
    },
  };
}

export function toolManifest() {
  return [
    { type: 'function', function: { name: 'read_file', description: 'Read a UTF-8 file in the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
    { type: 'function', function: { name: 'list_dir', description: 'List a directory.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [] } } },
    { type: 'function', function: { name: 'write_file', description: 'Create or overwrite a file with full content.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
    { type: 'function', function: { name: 'edit_file', description: 'Replace exactly one occurrence of find with replace.', parameters: { type: 'object', properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'find', 'replace'] } } },
    { type: 'function', function: { name: 'search', description: 'Recursive code search (grep).', parameters: { type: 'object', properties: { pattern: { type: 'string' }, ext: { type: 'string' } }, required: ['pattern'] } } },
    { type: 'function', function: { name: 'run', description: 'Run a whitelisted shell command in the workspace (npm, node, git, playwright, grep…).', parameters: { type: 'object', properties: { cmd: { type: 'string' }, timeout: { type: 'number' } }, required: ['cmd'] } } },
    { type: 'function', function: { name: 'run_sim', description: 'Run the deterministic bot simulation on a level and get gameplay metrics.', parameters: { type: 'object', properties: { level: { type: 'string' }, steps: { type: 'number' }, seed: { type: 'number' } }, required: ['level'] } } },
  ];
}
