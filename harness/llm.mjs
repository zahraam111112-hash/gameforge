// OpenCode Zen "go" client. One model only, as required: deepseek-v4.1-flash.
// The key is read from env (GAMEFORGE_API_KEY) and never logged.
const ENDPOINT = process.env.GAMEFORGE_LLM_ENDPOINT ?? 'https://opencode.ai/zen/go/v1/chat/completions';
export const MODEL = process.env.GAMEFORGE_MODEL ?? 'deepseek-v4.1-flash';

let seq = 0;

export async function chat({ messages, tools, maxTokens = 2048, temperature = 0.3, sessionTag = 'navara' }) {
  const key = process.env.GAMEFORGE_API_KEY;
  if (!key) throw new Error('GAMEFORGE_API_KEY is not set');
  const body = { model: MODEL, messages, max_tokens: maxTokens, temperature };
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }

  const started = Date.now();
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        'x-opencode-session': `${sessionTag}-${process.pid}-${++seq}`,
      },
      body: JSON.stringify(body),
    });
    if (r.status === 429 || r.status >= 500) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      continue;
    }
    const text = await r.text();
    if (!r.ok) throw new Error(`LLM ${r.status}: ${text.slice(0, 300)}`);
    const j = JSON.parse(text);
    const choice = j.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      toolCalls: choice?.message?.tool_calls ?? [],
      usage: j.usage ?? {},
      ms: Date.now() - started,
    };
  }
  throw new Error('LLM retries exhausted');
}

export async function jsonChat(opts) {
  const out = await chat(opts);
  const raw = out.content ?? '';
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`model did not return JSON: ${raw.slice(0, 200)}`);
  return { ...JSON.parse(candidate.slice(start, end + 1)), _usage: out.usage, _ms: out.ms };
}
