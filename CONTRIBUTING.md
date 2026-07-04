# Contributing to Chronosphere

Thanks for helping improve the map manager for The Real Antares. Contributions of all kinds are welcome — bug reports, fixes, features, and maps.

## Ground rules

- Be civil. This is a community project for a game people love.
- One change per pull request. Small, focused PRs get reviewed faster.
- By contributing, you agree your work is licensed under [GPL-3.0-or-later](LICENSE).

## Getting set up

Requires **Node 22+**.

```bash
git clone https://github.com/the-real-antares/chronosphere.git
cd chronosphere
npm install
npm run dev
```

`npm run dev` launches the app against the live archive at `the-real-antares.com`. Point it at your own backend by changing the API base in the app's settings.

## Project layout

```
apps/chronosphere/
  src/main/      Electron main process — file system, scanning, install, IPC
  src/renderer/  React UI — library / detail / flows
  scripts/       dev + production build (esbuild + Vite)
  build/         app icon + macOS entitlements
packages/shared/ map parsing · content hashing · health verdicts (no UI, no I/O)
```

Keep platform code in `main/`, UI in `renderer/`, and pure map logic in `packages/shared`. The renderer talks to the main process only through the typed IPC bridge in `src/ipc.ts` — never reach into Node from the UI.

## Before you open a PR

```bash
npm run typecheck   # TS strict, exactOptionalPropertyTypes — must pass
npm test            # vitest
```

- Match the surrounding style: TypeScript strict mode, no `any` without cause, small pure functions.
- Add or update tests for behavior changes — parsing, hashing, and reconcile logic all have unit tests.
- Write commit messages in the imperative mood ("Fix broken-map detection on compressed IsoMapPack5"), and describe the *why* in the PR body.

## Reporting bugs

Open an issue with your OS, the app version, and the steps to reproduce. If it's about a specific map, include the map's content hash (shown in the detail panel) — that pins it exactly.

## Adding maps

Maps are contributed through the app or the website, not this repo. Use the **Contribute** flow in Chronosphere, or the archive at [the-real-antares.com](https://the-real-antares.com).
