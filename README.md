<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/lockup-dark.png">
    <img src="docs/lockup-light.png" width="330" alt="LeadPitch">
  </picture>
</p>

<p align="center">
  A desktop app that finds companies likely to buy what you sell, scores each one from 1 to 10,
  and helps you reach them. Research runs through Claude Code on your computer, using your own
  Claude subscription.
</p>

![Leads with the detail panel open](docs/screenshots/leads.png)

## What it does

You describe your product, or point LeadPitch at its folder. Claude searches the web, reads
company pages and reviews, and looks for signs of need: job posts, new openings, complaints
in reviews, funding. Each company comes back with a fit score, the reason for that score, who
to contact, how to approach them and two opening lines. You can ask for up to 100 leads in one
run.

It runs the [Lead Research Assistant](https://github.com/ComposioHQ/awesome-claude-skills/tree/master/lead-research-assistant)
skill from ComposioHQ's awesome-claude-skills (Apache 2.0) and adds a pipeline, outreach
drafts and export around it.

## Screens

**Today.** Who to contact next, follow-ups that are due, and how the pipeline is moving.

![Today](docs/screenshots/today.png)

**Research.** Describe what you sell and who buys it. The run panel shows each step live:
every search, every page Claude reads, and how many leads it has found. Runs over 15 leads go
in batches, and leads are saved after each batch.

![Research](docs/screenshots/research.png)

**Pipeline.** Drag companies from Researched to Won.

![Pipeline](docs/screenshots/pipeline.png)

**Outreach.** Claude writes a first email or LinkedIn note from each lead's research, in
English, French or Arabic. Edit it, copy it, send it from your own account.

![Outreach](docs/screenshots/outreach.png)

**Search and dark mode.** Ctrl K finds any lead, view or action. The app follows your
system theme, or you can pick one.

![Command palette](docs/screenshots/palette.png)

![Dark mode](docs/screenshots/dark.png)

The leads in these screenshots are real public cafés in Sousse, Tunisia, found during a test run.

## How it connects to Claude

LeadPitch does not call the Anthropic API itself. It starts your installed Claude Code
(`claude -p --output-format stream-json`), so research uses whichever account Claude Code is
signed in with:

- **Claude subscription** (default): sign in once with `claude auth login`, or use the Sign in
  button in Settings, which opens a terminal for it.
- **API key**: paste a key in Settings. It is encrypted with the system keychain
  (Electron `safeStorage`) and passed to Claude Code only for that run.

Subscription login is meant for your own use. If you give LeadPitch to other people, they
should use their own Claude Code login or API key. A product that offers Claude subscription
login to its users needs Anthropic's approval.

## Run it

Requires Node.js 20 or later and Claude Code 2.1 or later on the PATH (or set its location
in Settings).

```bash
npm install
npm run dev        # development, hot reload
npm run build      # production build into out/
npx electron .     # run the production build
npm run package    # Windows installer into dist/
npm run icons      # regenerate the app icons and the README logo from the mark
```

## What is where

| Path | What it does |
| --- | --- |
| `src/main/index.ts` | Frameless window, IPC, CSV export |
| `src/main/research.ts` | Runs research in batches, parses the stream into steps and activity, reads `leads.json` |
| `src/main/claude.ts` | Finds Claude Code, sign-in status, one-shot prompts |
| `src/main/prompts.ts` | Skill text plus the LeadPitch output contract, draft prompts |
| `src/main/store.ts` | Local JSON store in the app data folder, atomic writes |
| `src/renderer/src` | React interface: title bar, sidebar, views, command palette |
| `resources/skill/SKILL.md` | The bundled skill |

Data stays on your computer, in `%APPDATA%/LeadPitch/leadpitch.json`. Each run keeps its
prompt and `leads.json` in `%APPDATA%/LeadPitch/runs/<id>/`.

## Keyboard

| Keys | Action |
| --- | --- |
| Ctrl K | Search leads and commands |
| Ctrl N | New research |
| Ctrl Enter | Start research from the form |
| Ctrl 1 to 6 | Switch views |
| Ctrl \ | Collapse or expand the sidebar |
| J and K | Move through leads |
| S | Star the open lead |
| X | Select the open lead |
| Esc | Close the open panel |

## Credits

The lead research method comes from the Lead Research Assistant skill by
[ComposioHQ](https://github.com/ComposioHQ/awesome-claude-skills), licensed under Apache 2.0.
A copy ships in `resources/skill/SKILL.md`.
