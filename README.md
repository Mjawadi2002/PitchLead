# Leadpitch

A desktop app that finds, scores and helps you win leads with Claude. It runs the
[Lead Research Assistant](https://github.com/ComposioHQ/awesome-claude-skills/tree/master/lead-research-assistant)
skill (ComposioHQ, Apache 2.0) through Claude Code on your computer.

## How it connects to Claude

Leadpitch does not call the Anthropic API itself. It starts your installed Claude Code
(`claude -p --output-format stream-json`), so research uses whichever account Claude Code is
signed in with:

- **Claude subscription** (default): sign in once with `claude auth login`, or use the Sign in
  button in Settings, which opens a terminal for it.
- **API key**: paste a key in Settings. It is encrypted with the system keychain
  (Electron `safeStorage`) and passed to Claude Code only for that run.

Subscription login is meant for your own use. If you hand Leadpitch to other people, they
should use their own API key, unless Anthropic has approved subscription login for your product.

## Run it

```bash
npm install
npm run dev        # development, hot reload
npm run build      # production build into out/
npx electron .     # run the production build
npm run package    # Windows installer into dist/
npm run icons      # regenerate build/icon.png and build/icon.ico from the logo
```

Requires Claude Code 2.1 or later on the PATH (or set its location in Settings).

## What is where

| Path | What it does |
| --- | --- |
| `src/main/index.ts` | Frameless window, IPC, CSV export |
| `src/main/research.ts` | Starts a run, parses the stream into phases and activity, reads `leads.json` |
| `src/main/claude.ts` | Finds Claude Code, sign-in status, one-shot prompts |
| `src/main/prompts.ts` | Skill text plus the Leadpitch output contract, draft prompts |
| `src/main/store.ts` | Local JSON store in the app data folder, atomic writes |
| `src/renderer/src` | React interface: title bar, sidebar, views, command palette |
| `resources/skill/SKILL.md` | The bundled skill |

Data lives in `%APPDATA%/Leadpitch/leadpitch.json`. Each run keeps its prompt and
`leads.json` in `%APPDATA%/Leadpitch/runs/<id>/`.

## Keyboard

Ctrl K search, Ctrl N new research, Ctrl Enter start research, Ctrl 1 to 6 switch views,
Ctrl \ collapse the sidebar, J and K move through leads, S star, X select, Esc close.
