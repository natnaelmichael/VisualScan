# VisualScan — Plan

A side pane that opens next to the AI coding session and shows viewers, live, what the model is doing behind the scenes. It is built for coding streams to entertain the audience and hold their attention.

Date: 2026-11-15

---

## 1. Goal

A pane that sits beside the chat during code generation, with three features:

1. **Model stat sheet:** facts about the model that is currently loaded.
2. **Live input tokens/sec graph:** tokens the model *consumes* (input, cache-read and cache-write), not the lower output rate.
3. **Current Action Type box:** two lines:
   ```
   Current Action Type:
   <action>
   ```
   The action comes from the model's live state. Colour coding comes later, not in v1, but the design allows for it from the start.

Later, the same state goes to a JSON file each tick so a herdr panel (or an OBS overlay) can show it.

---

## 2. Research summary: which platform

The options were a Claude Code plugin, an OpenCode plugin using the Claude API, and herdr panes.

| | Claude Code mod | Herdr mod | OpenCode plugin |
|---|---|---|---|
| Side pane | Native pane beside the chat (`$.ui.open` + `ui.render`), with a `Raster` pixel element for graphs | Native panel in JS (no HTML or canvas; graphs built from bars) | Desktop panels are experimental (`./gui-experimental`); terminal UI docs are thin |
| Live thinking / text / tool status | Yes: the `turn.step` stream tags every piece as `thinking`, `text`, `tool` or `input` | No: only the agent-reported states `idle`, `working`, `done`, `blocked`, `error` | Partly: `tool.execute.before/after` hooks; streaming events not documented |
| Token usage per request | Yes: `turn.step` result `usage` (input, cache_read, cache_creation, output, model) | None | Via the `http.response` / websocket hooks |
| Compaction | `session.compact` event | No | `compaction` hook |
| Context fill / cost / rate limits | `$.session.usage()` (the status line's figures) | No | Partial |

**Decision:** build it as a **Claude Code mod**. It's the only option that can see the live data needed for all three features, and it runs in the terminal already used for coding.

**Where herdr fits:** herdr-core (`hc`) gets status only from what an agent reports itself (OSC 7501) and never scrapes the screen, so it can't produce this data. Herdr mods (native panel scripts) can read files, `fetch` and run timers, though, so a later herdr panel can show the JSON file this mod writes (see section 6). Herdr is not installed on this machine yet.

**Marketplace check:** no existing plugin on claude.com/marketplace/plugins covers visualization, telemetry or token usage, so nothing to reuse.

---

## 3. Features in detail

### 3.1 Model stat sheet

Live, from the engine:
- Model id (from `turn.step` input `model` / result `usage.model`)
- Effort level (`turn.step` input `effort`)
- Context window: used / total and % full (`$.session.usage().context`)
- Session cost so far (`$.session.usage().cost`)
- Rate-limit windows, when on a subscription (`$.session.usage().rateLimits`)
- Session totals: requests, input tokens, cache-read tokens, output tokens

Fixed, from a small table in the mod (filled in from Anthropic's model docs, keyed by model id):
- Display name, context window size, max output tokens, price per million input/output tokens, knowledge cutoff
- Parameter counts are not published, so they are left out.

### 3.2 Live input tokens/sec graph

**Catch:** the API does not stream input tokens as it reads them. It reports one total per request, once the request is processed. So the rate is calculated:

- For each request (`turn.step`), consumed = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
- Spread that total evenly from when the request was sent to its first chunk (the time spent reading the input).
- The exact total only arrives when the response ends, so at the first chunk the graph uses the last known context size as a live estimate, then corrects it to the exact number when the response stops. The graph reacts within the time to first token instead of after the whole response.
- Store it in 1-second buckets and show a **rolling average** (about 3–5 s) so it reads as a smooth live graph, not one spike per request.
- Most of the volume will be cache reads. That's accurate, and the big numbers are fun on stream.
- v1 draws it as a text sparkline (`▁▂▃▄▅▆▇█`) over the last ~60 s, plus the current value and the peak. A `Raster` (pixel) version can follow.
- Optional second, dimmer line: output tokens/sec, for comparison.

### 3.3 Current action (feedback round 3: raw names)

The widget's title bar reads `Current action:`. The body shows the engine's own raw name for what's happening, pasted in as-is. Only `Finished` is hand-written.

| State | Shows |
|---|---|
| Request sent, no chunk yet | `turn.step` |
| Model is thinking | `thinking` (the stream's chunk kind) |
| Model is writing its reply | `text` (the stream's chunk kind) |
| Model is writing a tool call, or the tool is running | the tool's raw name: `Bash`, `Read`, `Edit`, `Write`, `Grep`, `WebSearch`, `WebFetch`, `Agent`, `mcp__…` |
| Compaction | `session.compact` |
| Turn ended | `Finished` |

- No `Tool:` prefix: the raw name is the whole label.
- While a subagent runs, its own tool calls show (`Bash`), since they're more interesting than `Agent`.
- Each state still has an internal **kind** (`inference`, `thinking`, `responding`, `codegen`, `websearch`, `tool`, `subagent`, `compaction`, `finished`), used only to colour the label later, through `theme.action`.
- **Priority:** `session.compact` > running tool > streaming chunk > `turn.step` > `Finished`.

### 3.4 Widgets (feedback round 2)

- Every element is a **widget**: a bordered box with a title bar, defined in `hooks/widgets.tsx` as `{ id, title, size, enabled, body }`.
- All three are **half width** (`size: 'half'`) and flow left to right, wrapping: Model + Tokens on the first row, Current action on the second. `'full'` exists for later.
- **Toggling and placement later** means editing that `WIDGETS` list (enabled flag, order, size), and eventually saving it per user and adding a command to toggle widgets.
- **Tokens widget:** a 4-row live bar graph that always draws (a dim baseline when idle, padded on the left), with the `now` / `peak` line and the output line under it.
- **Current action widget:** the title bar reads `Current action:`; the body is the action label.

### 3.5 Theme (feedback round 3)

All colours and borders come from `hooks/theme.ts`. The widget code reads only theme fields.

Current theme, **royalblue and goldenrod** (was cornflowerblue):
- Background: royalblue `#4169E1`, under the pane and inside every widget
- Text, titles and borders: goldenrod `#DAA520`, round borders
- Secondary text (model id, totals, output line), the empty part of the context bar and the graph baseline: white `#FFFFFF`
- Context bar fill and graph bars: goldenrod
- `theme.action` (per-action colour): empty for now, so the label is goldenrod; filling it in colours each kind

**Model loading:** on load the mod restores the model, totals and peak from the last snapshot and asks the engine for the session's model (`$.session.model()`), so the Model widget fills in before the first request of a session or after a reload.

### 3.6 Project widget (feedback round 4)

A fourth half-width widget, `Project`, next to Current action, with two lines:

- `Tests passed: x/y (n ms)`
  - **GitHub CI first:** the check runs of the current commit (`HEAD`), via `gh api repos/<owner>/<repo>/commits/<sha>/check-runs`. If a check's title or summary reports test counts ("12 passed, 1 failed"), those are summed; otherwise each check counts as one (passed = `success`; skipped/neutral/cancelled aren't counted). Time = first start to last finish. Shows `(running)` while checks are in progress. Refreshes every 30 s, every 10 s while running, and right after a `git push`/`commit`/`checkout`.
  - **Local fallback** when the commit has no checks (not pushed, no Actions, no `gh`): the last test command the agent ran in Bash (`test`, `pytest`, `jest`, `vitest`, `mocha`, …), parsed from its output: bun / `claude plugin test`, jest, vitest, pytest, cargo, mocha, `go test -v`. Time is the runner's own number, or the command's wall time.
- `Languages: A(xx.xx%), B(yy.yy%), C(zz.zz%)`: the top 3 (or fewer) languages by lines of code over the repo's tracked files (`git ls-files` + `wc -l`; outside git, `find`). Only programming and markup languages count (as on GitHub), not docs or data (Markdown, JSON, LICENSE); vendored/build folders are skipped. Refreshes every 30 s and after file edits.

### 3.7 Animation widget (feedback round 5)

A fifth widget, full width, taking every row the other widgets leave (`size: 'fill'`), that plays any animated piece from ascii-magic.com.

- **Which piece:** `ANIMATION_URL`, read from the process environment, else the project's `.env`, else the mod's own `.env`, else the default `https://www.ascii-magic.com/ascii/cpu-cores`. Re-read every 5 s, so editing `.env` switches pieces live. Only `https://www.ascii-magic.com/ascii/<slug>` URLs are accepted.
- **How pieces work:** each is an ES module (`/ascii/pieces/<slug>.js`) exporting `meta` (cols, rows, fps, palette) and `create()`, which returns `t => frame` (text plus one colour key per cell), built on `/ascii/lib/kit.js` (some also on `lib/scene.js` or `lib/image.js`). MIT-licensed (npm `ascii-magic-art`; two photo pieces are Unsplash-licensed).
- **Getting the files:** the default piece and `kit.js` ship in `ascii/` (offline, no download). Any other piece is downloaded once with `curl`, along with everything it imports, into `~/.claude/visualscan/ascii/`, and reused after that.
- **Running:** `hooks/ascii-runner.mjs` under `node --permission`, reading only the piece's folder (no network, writes or child processes), prints one JSON line per frame at the piece's fps (capped at 15).
- **Drawing:** the widget is a `Raster`; each frame is fitted (shrunk with nearest-cell sampling, aspect kept, or centred), coloured from the piece's palette on the theme background, and painted with `$.ui.blit`, without re-rendering the pane.
- **Title** is the piece's name (e.g. "World Map Pings"); errors (bad URL, failed download, no Node) show in the widget body.

## 4. Architecture

```
turn.start / turn.step (stream) / turn.complete ─┐
tool.call                                        ├─► state atom ($.state) ─► ui.render (Pane)
session.compact                                  │                       └─► state.json (throttled)
$.session.usage() (polled every 1 s)             ┘
```

- **Mod location (dev):** `~/.claude/dev-mods/<session>/visualscan/` (hot-reloads while building); copy into this repo for keeping and sharing.
- **Files:**
  - `.claude-plugin/plugin.json`: name `visualscan`, version, description, `types`
  - `hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`
  - `hooks/register.tsx`: hooks, state and pane rendering
  - `hooks/models.ts`: the fixed model specs table
  - `hooks/actions.ts`: action enum, tool label map, priority rules
  - `types/index.d.ts`: the `$.state` contract
  - `hooks/*.test.ts`: tests for action detection and the rate math
- **Pane:** opened on `session.start`; a `/visualscan` command reopens it. It opens on its own only when the terminal is wide enough (about 110–144+ columns); a wide terminal is the stream setup.
- **Hooks used:**
  - `turn.step` (async generator): note when the request was sent, set `Inference`, then pass chunks through and read each one's kind for Thinking / Responding / tool name; read `usage` from the result for the token graph.
  - `tool.call`: the tool's raw name while `next(e)` runs.
  - `session.compact`: Compaction while it runs.
  - `turn.complete`: Finished.
  - `$.clock.every(1000)`: refresh `$.session.usage()`, move the graph window forward, write JSON.
- **The mod only observes:** every hook passes events through unchanged (`next(e)` / `yield*`), so it never changes what the model sees or does.

---

## 5. State JSON for herdr (feedback #3)

Written every tick (1 s), plus right away when the action changes (at most 4 writes/s).

- Path: `~/.claude/visualscan/state.json` (fixed, so any reader finds it whatever the repo)
- Written whole each time. If partial reads turn up, switch to writing a temp file and renaming it.

```json
{
  "version": 1,
  "updatedAt": 1763200000000,
  "model": { "id": "claude-opus-5-5", "name": "Opus 5.5", "effort": "high",
             "contextWindow": 200000, "maxOutput": 64000, "knowledgeCutoff": "2026-06" },
  "context": { "used": 84213, "total": 200000, "percent": 42.1 },
  "cost": { "usd": 3.42 },
  "tokens": {
    "inputPerSec": 18400, "inputPerSecPeak": 61200, "outputPerSec": 72,
    "history": [0, 0, 12000, 18400],
    "totals": { "input": 1200, "cacheRead": 980000, "cacheWrite": 40000, "output": 21000, "requests": 37 }
  },
  "action": { "kind": "tool", "label": "Tool: Shell", "tool": "Bash", "since": 1763199998000 }
}
```

A future herdr mod reads this with `readTextFile` on a timer (or `watchFolder`) and draws its own panel. An OBS browser overlay could read the same file.

---

## 6. Later (not v1)

- Colour coding per action and per tool
- `Raster` pixel graph instead of the text sparkline
- Herdr panel mod that reads `state.json`
- OBS overlay
- Animations for actions changing (stream flair)
- Subagent detail (which helper, its own action)
- Sharing the mod as a GitHub repo others can install

---

## 7. Build steps

1. Scaffold the mod folder (manifest, hooks.json, types contract).
2. `actions.ts`: enum, label map, priority; unit tests.
3. Token-rate math (spreading, 1 s buckets, rolling average); unit tests.
4. Hooks: `turn.step`, `tool.call`, `session.compact`, `turn.complete`, 1 s clock.
5. Pane render: stat sheet, sparkline, action box.
6. `state.json` writer.
7. `claude plugin validate`, `tsc`, `claude plugin test`.
8. Load it live, run a real coding prompt, and check each action shows (thinking, a shell command, a file edit, a web search, `/compact`).

## 8. Open questions / risks

- **Rate accuracy:** the input rate is calculated, not measured (see 3.2).
- **Pane width:** the terminal needs to be wide enough for the pane to open on its own.
- **Thinking visibility:** on some models or settings, thinking may arrive summarised or hidden; the action still shows as Thinking while those chunks arrive.
- **Model specs table:** has to be kept up to date by hand as new models ship.
