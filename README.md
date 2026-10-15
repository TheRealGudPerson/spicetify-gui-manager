# SpiceDeck

A cross-platform desktop manager for Spicetify, built with Tauri, React, and TypeScript.

> Early development: the initial scaffold focuses on a safe dashboard, Spicetify detection, command execution, configuration inspection, and maintenance actions. Marketplace-style browsing and richer profile management are planned.

## Goals

- One consistent GUI for Windows, macOS, and Linux.
- Use the official Spicetify CLI as the engine rather than reimplementing it.
- Show command output and useful diagnostics.
- Make backup, restore, apply, and configuration workflows accessible.
- Never silently overwrite user configuration or run privileged commands.

## Stack

- Tauri 2 (Rust desktop backend)
- React + TypeScript + Vite
- Lucide icons

## Development

Prerequisites: Node.js 20+, npm, Rust stable, and the Tauri prerequisites for your operating system.

```bash
npm install
npm run tauri dev
```

To run the frontend alone while working on UI:

```bash
npm run dev
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for platform setup and [docs/ROADMAP.md](docs/ROADMAP.md) for planned features.

## Safety

SpiceDeck invokes the `spicetify` executable available to the current user. It does not request administrator/root access. Actions that modify Spotify or Spicetify state are explicit, and command output is shown in the app.

## License

MIT. See [LICENSE](LICENSE).
