# SpiceDeck

SpiceDeck is a cross-platform desktop GUI for managing a local Spicetify installation. It uses Tauri 2, React, TypeScript, and a small Rust backend. The official Spicetify CLI remains the source of truth.

## Current features
- Detect Spicetify and report basic Spotify installation status.
- Run explicit apply, backup, restore, and configuration-inspection actions.
- Discover local themes, extensions, and custom apps.
- Select an installed theme and discover color-scheme sections from its `color.ini`.
- Enable or disable discovered extensions and custom apps through Spicetify config.
- Edit an allowlist of common configuration values.
- View the local backup directory and export activity logs.
- Show command output and errors rather than silently claiming success.

Marketplace browsing and downloading/installing third-party customizations are not implemented yet. The local library views manage items already installed on the computer.

## Requirements
- Node.js and npm
- Rust toolchain
- Tauri 2 system dependencies for your operating system
- Spicetify CLI for live management features

### Fedora
```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel
```

## Development
```bash
git clone https://github.com/TheRealGudPerson/spicetify-gui-manager.git
cd spicetify-gui-manager
npm install
npm run tauri dev
```

Build the frontend:
```bash
npm run build
```

Build a desktop bundle:
```bash
npm run tauri build
```

## Safety notes
- Routine operations run as the current user and do not automatically elevate privileges.
- Only fixed maintenance actions and allowlisted configuration keys are exposed by the Rust backend.
- Applying or restoring Spotify resources can change files managed by Spotify or Spicetify. Review command output before proceeding.
- Third-party themes, extensions, and custom apps can execute code inside Spotify. Install only sources you trust.

## Development notes
See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## License
MIT
