# GameForge — Navara

A 2D platformer that a fleet of agents builds, tests and ships continuously, in public.

- **Play:** https://gameforge.198-44-118-189.sslip.io
- **Repo:** https://github.com/zahraam111112-hash/gameforge

Every round the studio observes the current build, decides what matters most, writes the
change, runs three deterministic gates, and — only if all three pass — bumps the version,
archives the playable build and pushes it.

## The loop

| Phase | What happens | Where |
| --- | --- | --- |
| Observe | A critic reads bot metrics and the devlog, and can inspect code itself | `harness/agents.mjs` |
| Direct | A director picks 2–4 changes so no single axis (story, graphics, gameplay, audio, net) starves | `harness/agents.mjs` |
| Build | Builders write code through a small, sandboxed tool set | `harness/tools.mjs` |
| Verify | `npm test` + `harness/verify.mjs` + `vite build` — the agents' self-report is never trusted | `harness/orchestrator.mjs` |
| Ship | Version bump, archive to `site/public/game/<version>`, git commit, push | `harness/orchestrator.mjs` |

A round that fails a gate leaves no trace: the working tree is reverted before the next one
starts, so quality cannot drift downward. Every round writes to `devlog/log.jsonl`, which the
public site renders at `/api/devlog` — including the rounds that failed and why.

## The gates

1. **Unit + room tests** (`npm test`) — physics, scoring, and authoritative multiplayer rooms.
2. **`harness/verify.mjs`** — every level parses, has a spawn and an exit, the exit is not
   sealed inside solid tiles, and a headless bot can make real progress.
3. **Production build** (`npm run build`) — what actually gets served.

The bot gate is the semantic one. It runs the real engine at a fixed timestep and reports
progress, deaths per tile column, coins, kills and stuck time. Its behaviour is deterministic:
same seed, same result.

## Architecture

The game core is shared verbatim between the browser and the server.

```
game/src/world.js     physics, combat, scoring — imported by both sides
game/src/level.js     tile maps (s1, s2, s3, arena)
game/src/render.js    canvas renderer
game/src/audio.js     procedural audio
server/rooms.mjs      authoritative rooms, 30Hz, fixed-step
server/index.mjs      static site + HTTP API + WebSocket upgrade
harness/              the agent studio
site/public/          the public site (index.html, devlog, version picker)
```

`world.js` is the single source of truth for rules. A headless bot run and a browser session
score identically because the bounty is awarded inside `damageEnemy`, not in the renderer.

## Modes

- **Story** — three stages and a boss, checkpointed.
- **Endless** — enemy surges, escalating.
- **Co-op** — shared authoritative room, players respawn.
- **Battle royale** — single elimination, up to 200 players, last one standing wins.

## Running it

The studio runs in Docker on the server, in its own folder with its own bridge network and
hard CPU/memory/pids ceilings.

```powershell
ssh hermes
```

```powershell
cd /mnt/data/gameforge/app && ./scripts/server.sh status
```

Commands: `up`, `down`, `restart`, `status`, `logs`, `smoke`, `load`.

- `smoke` — HTTP checks over the public surface and every asset the game page references.
- `load` — a fleet of 200 WebSocket bots joining real rooms and asserting they stay in sync.

Configuration lives in `.env` (`GAMEFORGE_API_KEY`), never in the repo. The harness talks to
one provider and one model: OpenCode Zen's `go` endpoint with `deepseek-v4.1-flash`.

## Local development

```powershell
npm install
```

```powershell
npm test
```

```powershell
npm run dev
```

The dev server serves the same site and authoritative rooms as production.

## Notes on the harness

- `deepseek-v4.1-flash` is a reasoning model: it spends tokens on `reasoning_content` before
  writing `content`, and both count against `max_tokens`. The client starts modest and
  escalates the budget when it sees `finish_reason: "length"` with empty content.
- Every model request has a deadline. A stalled connection retries instead of parking the
  forever-loop.
- Every tool call is logged. A round that takes twenty minutes should look like work, not
  like a hang.
