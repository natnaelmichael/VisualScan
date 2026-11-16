# VisualScan

A visual agentic-coding plugin, which allows you to see the exact state of your AI Agent.

VisualScan is a Claude Code mod: a side pane that opens next to the chat and shows, live, what the model is doing behind the scenes. It's built for coding streams, to give viewers something to watch while the agent works.

## Widgets

- **Model:** the loaded model's name and id, effort level, max output, price per million tokens, context-window fill, session cost and request totals.
- **Tokens consumed / sec:** a live bar graph of the input tokens the model reads per second (input + cache reads + cache writes), with the current and peak rate and the output rate.
- **Current action:** the engine's raw name for what is happening right now: `turn.step` (request sent, waiting for the first token), `thinking`, `text`, a tool's built-in name (`Bash`, `Read`, `Edit`, `WebSearch`, `Agent`, `mcp__…`), `session.compact`, or `Finished` when the turn ends.

- **Animation:** any animated piece from [ASCII Magic](https://www.ascii-magic.com/ascii), full width, filling the rest of the pane.

The first four widgets are half the pane's width. Colours and borders live in `hooks/theme.ts` (default: royalblue background with goldenrod text and borders).

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install visualscan --marketplace natnaelmichael/VisualScan
```

Answer `y` to add the marketplace, then pick a scope. The pane opens on its own when the terminal is wide enough; otherwise run `/visualscan`.

## Choosing the animation

Set `ANIMATION_URL` in your project's `.env` (see `.env.example`) to any piece page:

```
ANIMATION_URL=https://www.ascii-magic.com/ascii/world-map-pings
```

Unset, it plays `https://www.ascii-magic.com/ascii/cpu-cores`, which ships with the mod. An environment variable of the same name wins over the `.env`; edits to `.env` are picked up within about 5 seconds.

A piece other than the default is downloaded once from ascii-magic.com, with the modules it imports, into `~/.claude/visualscan/ascii/`. It runs under Node.js (needed for this widget) with Node's permission model: it can read only its own folder, with no network, no file writes and no child processes. Pieces are shrunk to fit the widget when they're bigger than it, and centred when they're smaller.

## State file

Every second (and whenever the action changes) the mod writes its full state to `~/.claude/visualscan/state.json`, so other displays, such as a herdr panel or an OBS overlay, can show the same data.

## Notes

- The input rate is calculated: the API reports each request's input total once, so it's spread over the time before the first token and smoothed over a few seconds.
- See `plan.md` for the design and roadmap.

## License

VisualScan is free software, licensed under the [GNU General Public License v3.0](LICENSE).

The bundled ASCII Magic files in `ascii/` are MIT-licensed by ASCII Magic; see `ascii/README.md`.
