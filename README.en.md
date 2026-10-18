# DIOS — Skill Board

[한국어](README.md)

A Windows app that keeps the skills (`SKILL.md` files) used by AI coding agents in one place: attach them with a click, read them in Korean, and keep several computers in sync.

When Claude, Codex, Cursor, Grok and others each have their own skill folder, you end up copying the same text around and forgetting which copy is newest. DIOS keeps each skill file in one place and puts only a link in every agent's folder, so editing once updates every attached agent.

![Skill board](docs/media/skill-board.png)

Intro video (≈1 min): https://youtu.be/IQigOMQEUk4

## Features

- **Skill board** — see every skill and which agents it is attached to; attach/detach with one click.
- **Korean reading view** — translate skills locally with [Ollama](https://ollama.com) (`qwen2.5:7b`, falling back to `qwen2.5:3b` while downloading). No payment or API key needed.
- **Compare computers** — compare skills across this PC, WSL and SSH hosts; sync, send or pull without overwriting identical files.
- **API key manager** — see which platform keys each project uses; scan chosen folders' `.env` files to register keys.

## Install

1. Download `DIOS-Setup.exe` from [Releases](https://github.com/ju0o/Dios/releases/latest).
2. Run it. The installer is unsigned, so if Windows SmartScreen blocks it choose **More info → Run anyway**.
3. Updates: use **Check for updates** at the bottom-left of the app.

Only a Windows installer is provided for now.

## Build from source

```bash
git clone https://github.com/ju0o/Dios.git
cd Dios
npm install
npm run dev      # development
npm test         # unit tests
npm run build    # -> release/DIOS-Setup.exe (Windows)
```

Pushing a version tag (e.g. `v0.2.8`) builds the installer on Windows CI and attaches it to GitHub Releases.

## API key handling

- **Discovery**: only `.env` / `.env.*` files inside folders you chose (plus linked projects and common project folders) are read. Example files (`.env.example`, …) and folders like `node_modules`/`.git` are skipped; depth ≤ 5, ≤ 600 files. Keys are recognised by variable name and value shape; placeholders are ignored.
- **Storage**: keys in **API key manager** are encrypted with the OS key store bound to your Windows account (Electron `safeStorage` / DPAPI) before being written to the local SQLite DB. If encryption is unavailable, the key is stored as plain text and the app says so.
- **Display**: the renderer only receives masked values such as `sk-••••••••abcd`. The raw key is decrypted only when you press **Copy** (written to the clipboard by the main process) or **Show** for that one key.
- **Logging**: activity logs and console output never contain key values (only counts).
- **Network**: keys are only sent to the provider APIs you connected, for usage/health checks. Nothing goes to a DIOS server.
- **Caveat**: keys entered for *usage tracking services* and *operations center connections* are still stored in the local DB without OS encryption. They are now masked before reaching the screen, and leaving the field empty when editing keeps the existing key. Do not share the DB file under `%APPDATA%`.

## Notes

- Skill files stay on your computer; DIOS does not upload them.
- Translations use a free local model and may read unnaturally.
- No license has been chosen yet; please ask before redistribution or commercial use.
