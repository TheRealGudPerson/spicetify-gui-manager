# SpiceDeck

SpiceDeck is a cross-platform desktop GUI for managing a local Spicetify installation. It uses Tauri 2, React, TypeScript, and a small Rust backend. The official Spicetify CLI remains the source of truth.

## Current features
- Detect Spicetify and report basic Spotify installation status.
- Run explicit apply, backup, restore, and configuration-inspection actions.
- Discover local themes, extensions, and custom apps.
- First-run setup wizard with automatic Spotify and Spicetify downloads, OS-aware installation, and post-install verification.
- Browse community repositories by Spicetify GitHub topic, with search, source links, stars, and update dates.
- Select an installed theme and discover color-scheme sections from its `color.ini`.
- Enable or disable discovered extensions and custom apps through Spicetify config.
- Edit an allowlist of common configuration values.
- View the local backup directory and export activity logs.
- Show command output and errors rather than silently claiming success.

The v0.3.0 setup wizard detects the current OS and installs Spotify and Spicetify from official sources where supported. Windows uses Spotify's hosted setup executable; macOS downloads Spotify's official DMG and installs into the current user's Applications folder; Debian/Ubuntu-based Linux installs from Spotify's official APT repository with the OS authorization prompt, while other Linux systems use a user-scoped Flathub install when Flatpak is available. Spicetify is downloaded from the official GitHub release for the current OS and CPU architecture and installed in the user profile. Existing installations are checked before installation; unsupported Linux configurations return an actionable error instead of silently switching to an unknown package source. Marketplace browsing is being introduced in v0.3.0. The current discovery view is read-only; downloading, installing, updating, and removing third-party customizations remain in development. The local library views manage items already installed on the computer.

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

## In-app updater

SpiceDeck includes a top-right update control and an in-app notice when a newer signed release is available. Choosing **Install and restart** downloads the platform-specific update, verifies its signature, installs it, and relaunches SpiceDeck. Production update checks are automatic at launch; development builds do not poll for releases.

### One-time release signing setup

Tauri refuses unsigned updates. Before publishing releases, configure a signing key:

1. Generate a key pair locally. Keep the private key private and backed up:
   ```bash
   npm run tauri signer generate -- -w ~/.tauri/spicedeck.key
   ```
2. Copy the contents of `~/.tauri/spicedeck.key.pub` into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, replacing `REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY`.
3. In GitHub, open **Settings → Secrets and variables → Actions** for this repository and add:
   - `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.tauri/spicedeck.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password used when generating the key (leave it empty only if you generated an unencrypted key).
4. Keep the private key and password out of the repository. Do not commit the private key or paste it into issues/chats.
5. Bump the version in both `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` to the same new semantic version, commit the change, then push a matching tag such as `v0.2.0`. The GitHub Actions workflow builds Windows, Linux, and macOS release artifacts and publishes the signed updater metadata.

The updater cannot work in installed builds until the public key and GitHub Actions secrets are configured and the first signed GitHub Release has been published. The public key is safe to commit; the private key is not.

## Safety notes
- Routine operations run as the current user and do not automatically elevate privileges.
- Only fixed maintenance actions and allowlisted configuration keys are exposed by the Rust backend.
- Applying or restoring Spotify resources can change files managed by Spotify or Spicetify. Review command output before proceeding.
- Third-party themes, extensions, and custom apps can execute code inside Spotify. Install only sources you trust.

## Development notes
See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## License
MIT
