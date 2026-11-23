// OpenCode Zen "go" client. One model only, as required: deepseek-v4.1-flash.
// The key is read from env (GAMEFORGE_API_KEY) and never logged.
//
// deepseek-v4.1-flash is a reasoning model: it writes reasoning_content before
// content, and both count against max_tokens. A JSON answer therefore needs a
// budget far larger than the answer itself — with 2048 it regularly runs out
// mid-thought and returns finish_reason "length" with an empty content string.
const ENDPOINT = process.env.GAMEFORGE_LLM_ENDPOINT ?? 'https://opencode.ai/zen/go/v1/chat/completions';
export const MODEL = process.env.GAMEFORGE_MODEL ?? 'deepseek-v4.1-flash';
const MAX_TOKENS_CAP = 16_000;

let seq = 0;

async function post(body, sessionTag) {
  const key = process.env.GAMEFORGE_API_KEY;
  if (!key) throw new Error('GAMEFORGE_API_KEY is not set');
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      'x-opencode-session': `${sessionTag}-${process.pid}-${++seq}`,
    },
    body: JSON.stringify(body),
  });
  if (r.status === 429 || r.status >= 500) return { retry: true, status: r.status };
  const text = await r.text();
  if (!r.ok) throw new Error(`LLM ${r.status}: ${text.slice(0, 300)}`);
  return { retry: false, json: JSON.parse(text) };
}

export async function chat({ messages, tools, maxTokens = 4096, temperature = 0.3, sessionTag = 'navara' }) {
  const started = Date.now();
  let budget = maxTokens;
  let lastEmpty = null;

  for (let attempt = 0; attempt < 6; attempt++) {
    const body = { model: MODEL, messages, max_tokens: budget, temperature };
    if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }

    const res = await post(body, sessionTag);
    if (res.retry) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }

    const choice = res.json.choices?.[0];
    const content = choice?.message?.content ?? '';
    const toolCalls = choice?.message?.tool_calls ?? [];
    const finish = choice?.finish_reason;
    const reasoning = choice?.message?.reasoning_content ?? '';

    // Starved by its own reasoning: give it more room and ask again.
    if (finish === 'length' && !content && !toolCalls.length && budget < MAX_TOKENS_CAP) {
      lastEmpty = { finish, reasoning: reasoning.slice(0, 200) };
      budget = Math.min(MAX_TOKENS_CAP, budget * 2);
      continue;
    }

    if (process.env.GAMEFORGE_DEBUG_LLM === '1' && !content && !toolCalls.length) {
      console.warn('[llm] empty content — finish_reason:', finish,
        'reasoning:', reasoning.slice(0, 200),
        'usage:', JSON.stringify(res.json.usage?.completion_tokens_details ?? {}));
    }

    return { content, toolCalls, usage: res.json.usage ?? {}, finish, reasoning, ms: Date.now() - started };
  }

  throw new Error(`LLM returned no content after retries${lastEmpty ? ` (last finish=${lastEmpty.finish})` : ''}`);
}

export async function jsonChat(opts) {
  let out = await chat(opts);
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = out.content ?? '';
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = (fenced ? fenced[1] : raw).trim();
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      try { return { ...JSON.parse(candidate.slice(start, end + 1)), _usage: out.usage, _ms: out.ms }; }
      catch { /* fall through and ask again */ }
    }
    if (attempt === 0) {
      out = await chat({
        ...opts,
        messages: [
          ...opts.messages,
          ...(out.content ? [{ role: 'assistant', content: out.content }] : []),
          { role: 'user', content: 'Return ONLY the JSON object. No prose, no reasoning, no code fence.' },
        ],
        sessionTag: `${opts.sessionTag ?? 'navara'}-reask`,
      });
    }
  }
  throw new Error(`model did not return JSON: ${String(out.content ?? '').slice(0, 200)}`);
}
