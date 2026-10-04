# Body Temple Gym — Windows Desktop

Offline-first gym management app for Body Temple Gym: members, plans, renewals, payments,
attendance (check-in / check-out) and revenue — as a native Windows desktop application.
It is a migration of the original Next.js + Supabase + Vercel admin panel, keeping its UI,
workflows and calculations, but with **all data stored locally in SQLite** and **no internet,
Vercel or Supabase required**.

> **Status: Checkpoint 1 — foundation only (not runnable yet).** The database layer, schema,
> migrations, shared IPC contract, logger and tests are done. The Electron main process, the
> renderer port and the installer are still to come. See [DESKTOP-MIGRATION.md](./DESKTOP-MIGRATION.md)
> for the exact status, decisions, feature-parity checklist and remaining work.

## Architecture

```
Renderer (Next.js static export, React)  ──window.gym──▶  Preload (contextBridge)
                                                              │ IPC (allow-listed, validated)
                                                              ▼
                                   Main process: services ▶ better-sqlite3 ▶ %APPDATA%\Body Temple Gym\
```

| Folder | Role |
|---|---|
| `src/` | Renderer — the original React UI (being ported to talk to `window.gym`) |
| `shared/` | Types, IPC contract, money/CSV/status/trend helpers used by both sides |
| `electron/database/` | Connection, versioned migrations, integrity checks |
| `electron/services/` | Business logic (logger today; auth, members, backup… in Phase 2) |
| `tests/` | Vitest suites (run under plain Node) |
| `legacy/` | Original Supabase SQL + removed web files, kept for reference |

## Development setup

Requirements: Node.js 22+.

```bash
npm install --ignore-scripts   # why: see the note below
npm test                       # database + helper tests
npm run typecheck:electron     # strict type-check of electron/ and shared/
npm run setup:electron         # downloads the Electron binary (only needed once Phase 3 lands)
```

**Why `--ignore-scripts`?** `better-sqlite3` 13 ships ready-made binaries, but when installing from a
lockfile npm can still decide to compile it with `node-gyp`, which needs a C++ toolchain (Xcode Command
Line Tools on macOS, Visual Studio Build Tools on Windows) and access to nodejs.org. Skipping install
scripts avoids that and the bundled binary is used. If you prefer the plain `npm install` and it works on
your machine, that is fine too.

`npm run dev`, `build` and `dist:win` arrive with Phases 3–4 (see the migration doc).

## Where data lives *(implemented in Phase 2)*

`%APPDATA%\Body Temple Gym\` — never in the repository, `node_modules` or Program Files:

```
data\gym.sqlite      the live database (WAL mode)
backups\             automatic + manual + pre-restore/pre-migration copies
logs\app-YYYY-MM-DD.log   technical errors; passwords and keys are redacted
```

Created automatically on first launch, migrated automatically on update, and left in place by
updates and uninstalls.

## Authentication *(Phase 2)*

No default password. The first launch shows a setup screen to create the owner account.
Passwords and the one-time recovery code are stored only as salted **scrypt** hashes; repeated wrong
passwords trigger a growing delay. Forgot the password? Use the recovery code shown at setup.

## Backup & restore *(Phase 2)*

Settings → Data safety: **Backup Database** (snapshot via SQLite's online backup API, verified before it is
kept), export a copy anywhere, automatic periodic backups, and **Restore Database** which asks for
confirmation and first saves a safety copy of the current data. Nothing is ever overwritten silently.

## Windows installer *(Phase 4)*

`npm run dist:win` → `release/BodyTempleGym-Setup.exe` (NSIS, Windows 10/11 x64, per-user install,
shortcuts, clean uninstall, database preserved). Build on a Windows PC or with the GitHub Actions
`windows-latest` job; the installer is unsigned (SmartScreen will warn once).

## Importing existing Supabase data *(Phase 2)*

Settings → Import: pull directly from Supabase (URL + service key, used once and never stored) or load an
exported folder. Members, plans, renewals, payments and attendance keep their original IDs and timestamps; a
backup is taken first and a summary lists anything skipped. The old schema is in `legacy/supabase/`.

## Google Sheets *(optional, Phase 2)*

Local SQLite is always the source of truth. Sheets sync is an optional mirror configured in Settings
(service-account email, key, spreadsheet ID). The app works identically without it or without internet.

## Troubleshooting

- **`npm install` fails with `gyp ERR!` on `better-sqlite3`** — run `npm install --ignore-scripts` (the package ships prebuilt binaries, so no compiler is needed), then `npm run setup:electron`. Node 22+ is required.
- **Tests can't find `@shared/...`** — run Vitest from the repo root so `vitest.config.mts` is picked up.
- **Windows SmartScreen warning** — expected for an unsigned installer: *More info → Run anyway*.

## Security notes

`contextIsolation` on, `nodeIntegration` off, sandboxed renderer, strict CSP, navigation locked to the app's
own protocol, one validated IPC handler per allow-listed method (no generic channel), local-only data, no
secrets in the repository (`.gitignore` blocks databases, backups and `.env*`).

## Original web version

The Supabase/Vercel version lives on the `main` branch; its SQL is in `legacy/supabase/`.
