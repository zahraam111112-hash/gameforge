import { chat, jsonChat } from './llm.mjs';
import { makeTools, toolManifest } from './tools.mjs';
import { emit, clip } from './activity.mjs';

const SYSTEM_CORE = `You are part of an autonomous game studio building "Navara", a 2D browser platformer
(bugs-bunny/ sonic/ shinobi inspired: fast movement, dashes, strikes, escalating bosses, mutable stages).
The repository is a javascript game: game/src/*.js is the engine (world.js physics, level.js tile maps,
render.js canvas renderer, audio.js procedural audio, main.js glue), server/*.mjs is the authoritative
multiplayer, harness/*.mjs is this studio, site/public is the public site.
Rules:
- Quality bar: the game must stay playable at 60fps and tests must pass.
- Prefer small, focused changes that can be verified. Never delete tests.
- Never touch .git, node_modules, .env, or anything under /home/dev data.
- Always explain reasoning in the final JSON field "why", written for players and future agents.
Respond with JSON only when asked for JSON.`;

export async function critic(root, context) {
  const tools = toolManifest();
  const fsTools = makeTools(root);
  const messages = [
    { role: 'system', content: SYSTEM_CORE },
    { role: 'user', content: `OBSERVE phase. Latest version: ${context.version ?? 'none'}.
Current metrics from bot simulations:
${JSON.stringify(context.metrics, null, 2)}
Recent devlog:
${(context.devlog ?? []).slice(-12).map((e) => `- [${e.kind}] ${e.title}: ${e.why}`).join('\n') || '(empty)'}
Open issues: ${JSON.stringify(context.issues ?? [])}
Inspect the code with the tools if you need to (read_file, list_dir, run_sim), then return JSON:
{"problems":[{"area":"gameplay|graphics|story|audio|net|tech","severity":"high|medium|low","detail":"..."}],"strengths":["..."],"headline":"one line summary"}` },
  ];
  return runToolLoop({ root, fsTools, tools, messages, maxTurns: 6, jsonHint: true, role: 'critic', task: 'observe' });
}

export async function director(root, context) {
  const messages = [
    { role: 'system', content: SYSTEM_CORE },
    { role: 'user', content: `DIRECT phase. You are the creative director. Based on this critique and history,
choose the 2-4 biggest improvements to make THIS round. Balance the axes so the game never stalls on one front:
story, graphics, gameplay, audio, multiplayer/tech.
Critique: ${JSON.stringify(context.critique)}
Recent devlog: ${(context.devlog ?? []).slice(-10).map((e) => `- ${e.title}`).join('\n') || '(empty)'}
Return JSON:
{"theme":"short name for this round","rationale":"why these now","tasks":[{"id":"t1","agent":"builder","area":"...","title":"...","brief":"precise instructions incl. files"}]}` },
  ];
  return jsonChat({ messages, sessionTag: 'director' });
}

export async function builder(root, task, context) {
  const tools = toolManifest();
  const fsTools = makeTools(root);
  const messages = [
    { role: 'system', content: SYSTEM_CORE },
    { role: 'user', content: `BUILD phase. Your task is:
TITLE: ${task.title}
AREA: ${task.area}
BRIEF: ${task.brief}

Use tools to make the change. When done, run "npm test" (or node --test) and "npm run build" inside the
workspace if they exist, and fix what they report. You are ONE builder; keep every change inside your area.
Finally return JSON: {"done":true,"files":["..."],"summary":"...","why":"...","tests":"pass|fail + detail"}` },
  ];
  return runToolLoop({ root, fsTools, tools, messages, maxTurns: 18, jsonHint: true, role: 'builder', task: task.title });
}

export async function verifier(root, context) {
  const tools = toolManifest();
  const fsTools = makeTools(root);
  const messages = [
    { role: 'system', content: SYSTEM_CORE },
    { role: 'user', content: `VERIFY phase. Run these yourself with tools, in order:
1) run {cmd:"npm test"}  2) run {cmd:"node harness/verify.mjs"}  3) run_sim for level s1 (and s2 if it exists).
Report any failure. Then return JSON:
{"pass":true|false,"tests":"...","sim":"...","regressions":["..."],"notes":"what you verified"}` },
  ];
  return runToolLoop({ root, fsTools, tools, messages, maxTurns: 8, jsonHint: true, role: 'verifier', task: 'verify' });
}

export async function reviewer(root, context) {
  const messages = [
    { role: 'system', content: SYSTEM_CORE },
    { role: 'user', content: `RELEASE-NOTES phase. Build is verified. Write the devlog entries the public site
will show for this round. One "decision" entry explaining choices, one "improved|added|fixed" entry per
task that changed player-facing behaviour.
Round: ${JSON.stringify(context.round)}
Verification: ${JSON.stringify(context.verification)}
Return JSON: {"entries":[{"kind":"decision|improved|added|fixed","title":"...","why":"...","tags":["gameplay"]}]}` },
  ];
  return jsonChat({ messages, sessionTag: 'reviewer' });
}

async function runToolLoop({ root, fsTools, tools, messages, maxTurns, jsonHint, role = 'agent', task = '' }) {
  let last = '';
  for (let turn = 0; turn < maxTurns; turn++) {
    const out = await chat({ messages, tools, maxTokens: 6000, sessionTag: 'build' });
    if (!out.toolCalls.length) { last = out.content; break; }
    messages.push({ role: 'assistant', content: out.content || null, tool_calls: out.toolCalls });
    for (const call of out.toolCalls) {
      let result;
      const args = (() => { try { return JSON.parse(call.function.arguments || '{}'); } catch { return {}; } })();
      // One line per action: the round is long enough that without this the
      // container log is silent for minutes and looks like a hang.
      const target = args.path ?? args.cmd ?? args.pattern ?? args.level ?? '';
      const label = `${call.function.name}${target ? ` ${String(target).slice(0, 90)}` : ''}`;
      console.log(`  · ${label}`);
      const started = Date.now();
      try {
        const fn = fsTools[call.function.name];
        if (!fn) throw new Error(`unknown tool ${call.function.name}`);
        result = await fn(args);
      } catch (e) {
        result = { error: String(e.message ?? e) };
      }
      // The public work stream: what was attempted, what came back, and the
      // actual source when the agent wrote code. This is the thing an audience
      // watches, so it records the payload — not just the fact of a tool call.
      const failed = result && typeof result === 'object' && (result.error || result.ok === false);
      const wrote = call.function.name === 'write_file' && typeof args.content === 'string';
      emit({
        kind: 'tool',
        role, task,
        tool: call.function.name,
        target: String(target).slice(0, 160),
        ok: !failed,
        ms: Date.now() - started,
        code: wrote ? clip(args.content, 2600) : undefined,
        lang: wrote ? langOf(args.path) : undefined,
        // A shell command's output is the evidence a reader needs to trust the
        // step; a read_file's echo of the source is redundant with the file.
        output: (call.function.name === 'run' || call.function.name === 'run_sim' || failed)
          ? clip(typeof result === 'string' ? result : JSON.stringify(result?.stdout ?? result), 1600)
          : undefined,
      });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
  }
  if (jsonHint) {
    // The model reasons before answering, so the finalize turn needs the same
    // generous budget as the working turns — at 4096 it runs out mid-thought.
    const j = await jsonChat({
      messages: [...messages, { role: 'user', content: 'Now return ONLY the JSON object requested above.' }],
      sessionTag: 'finalize',
      maxTokens: 6000,
    });
    return j;
  }
  return { content: last };
}

function langOf(file) {
  const ext = String(file ?? '').split('.').pop().toLowerCase();
  return ({ js: 'js', mjs: 'js', ts: 'ts', json: 'json', html: 'html', css: 'css', py: 'py', md: 'md' })[ext] ?? 'text';
}
