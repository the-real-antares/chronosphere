# Chronosphere

**Desktop map manager for [The Real Antares](https://the-real-antares.com)** — the community archive of *Command & Conquer: Red Alert 2 — Yuri's Revenge* maps.

Chronosphere sits between the archive and your game folder. A two-pane view — the archive on the left, the maps on your disk on the right — lets you see what you have, what you're missing, and what's out of date at a glance. Installing a map to your game folder is a *chronoshift*.

## What it does

- **Two-pane reconcile** — archive ↔ your `Yuri's Revenge` folder, matched by content hash so renamed or re-zipped copies still line up.
- **Chronoshift** — install any archive map to your game folder in one action, with a clean undo.
- **Health checks** — flags broken, heavy, or mod-dependent maps before they ruin a match.
- **Previews** — the embedded map render, right in the detail panel.
- **Reviews & team layouts** — read and write reviews, see team-spawn layouts, all synced with the archive.

## Download

Grab the latest build for your platform from the [Releases page](https://github.com/the-real-antares/chronosphere/releases), or from [the-real-antares.com](https://the-real-antares.com/chronosphere).

| Platform | File |
|----------|------|
| Windows | `Chronosphere-<version>-Setup.exe` |
| macOS | `Chronosphere-<version>-<arch>.dmg` |
| Linux | `Chronosphere-<version>-<arch>.AppImage` / `.deb` |

macOS builds are signed and notarized; Windows builds are signed with Azure Trusted Signing.

## Build from source

Requires **Node 22+**.

```bash
npm install
npm run dev        # run the app in development
npm run dist       # package a distributable for your OS
```

The app is [Electron](https://www.electronjs.org/) (main process in Node) + [React](https://react.dev/) 19 (renderer, via Vite). Map parsing, hashing, and health analysis live in `packages/shared` and are shared with the archive backend.

```
apps/chronosphere/
  src/main/      Electron main process — file system, scanning, install
  src/renderer/  React UI — library, detail, flows
packages/shared/ map parser · content hashing · health verdicts
```

## Contributing

Bug reports, maps, and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GPL-3.0-or-later](LICENSE). Copyright © 2026 The Real Antares.

Chronosphere is a fan-made tool. *Command & Conquer*, *Red Alert 2*, and *Yuri's Revenge* are trademarks of their respective owners; this project is not affiliated with or endorsed by them.
