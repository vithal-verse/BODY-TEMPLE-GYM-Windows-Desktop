# Body Temple Gym — Windows Desktop

Offline-first gym management app for Body Temple Gym: members, plans, renewals, payments, attendance
(check-in / check-out) and revenue, as a native Windows desktop application. It is a migration of the original
Next.js + Supabase + Vercel admin panel: same screens, workflows and calculations, but **all data lives in a local
SQLite database** and **nothing needs the internet, Vercel or Supabase**.

> **Status:** feature-complete and verified on Linux (122 automated tests, lint, type-check, production build and a
> 20-step end-to-end UI test in the real Electron app). The Windows installer is produced by the
> *Build Windows installer* GitHub workflow (or `npm run dist:win` on a Windows PC). It has not yet been run on a real
> Windows machine — see [DESKTOP-MIGRATION.md](./DESKTOP-MIGRATION.md) §6 for the short list of what's left to check.

## Architecture

```
Renderer (Next.js static export, React)  ──window.gym──▶  Preload (contextBridge, allow-listed)
                                                               │ IPC: one validated handler per action
                                                               ▼
                    Main process: services ▶ better-sqlite3 ▶ %APPDATA%\Body Temple Gym\data\gym.sqlite
```

| Folder | Role |
|---|---|
| `src/` | The UI (React/Next.js, original look). Talks to the app only through `window.gym` |
| `shared/` | Types, the IPC contract/allow-list, money/CSV/status/trend helpers shared by both sides |
| `electron/main/` | Window, `app://` page loader (+CSP), menu, native dialogs, startup, background upkeep |
| `electron/preload/` | The `window.gym` bridge, generated from the allow-list |
| `electron/ipc/` | Input validation (zod), access control, friendly error messages |
| `electron/services/` | Business logic: auth, members, attendance, reports, backup/restore, Sheets, importer |
| `electron/database/` | Connection, versioned migrations, integrity checks |
| `tests/` | Vitest suites (run under plain Node) |
| `scripts/` | Build, dev runner, UI test, icon generator |
| `legacy/` | The original Supabase SQL and removed web files, kept for reference |

## Development

Requires Node.js 22+.

```bash
npm install --ignore-scripts   # why: see Troubleshooting
npm run setup:electron         # one-time download of the Electron binary
npm run dev                    # hot-reloading UI inside Electron; uses ./.dev-data, never real data

npm test                       # 122 unit/integration tests
npm run lint
npm run typecheck              # renderer + Electron
npm run build                  # static UI export + Electron bundles
npm run test:ui                # end-to-end test in real Electron (Linux/CI: xvfb-run -a npm run test:ui)
```

## Where data lives

`%APPDATA%\Body Temple Gym\` — never in the repository, `node_modules` or Program Files:

```
data\gym.sqlite            the live database (WAL mode, foreign keys on, synchronous=FULL)
backups\                   manual, automatic, pre-restore / pre-update / pre-import copies
logs\app-YYYY-MM-DD.log    technical errors (passwords and keys are redacted)
window-state.json          window size/position
```

Created automatically on first launch, upgraded automatically (a safety copy is taken first), and left in place by
updates *and* by uninstalling. **Settings → Data safety** shows the exact paths and has buttons to open them.

## Sign-in and accounts

No default password exists. The first launch shows a setup screen to create the **owner** account and shows a one-time
**recovery code**. Passwords and the recovery code are stored only as salted **scrypt** hashes; repeated wrong passwords
trigger a growing delay. You sign in each time the app opens. The owner can add front-desk (admin) accounts in
**Settings → Account** (admins can't restore, import or manage accounts). Forgot the password? **Log in → Forgot your
password?** and use the recovery code.

## Backup & restore

**Settings → Data safety** (also *File → Back up database now*, `Ctrl+B`):

- **Backup Database** — a verified snapshot made with SQLite's online backup API (safe while the app is in use).
- **Export a copy…** — the same, saved wherever you choose (e.g. a USB stick).
- **Automatic backups** — daily by default, newest 14 kept, with an optional second folder (USB / OneDrive).
- **Restore Database…** / the *Restore* button on any listed backup — verifies the file, asks for confirmation, saves a
  **pre-restore** copy of your current data, swaps the database, and signs everyone out. If anything fails, the previous
  data is put back. Nothing is ever replaced silently.

## Building the Windows installer

- **Easiest:** push to GitHub, open *Actions → Build Windows installer → Run workflow*. Download the
  `BodyTempleGym-Setup` artifact (the file is `BodyTempleGym-Setup.exe`). Pushing a tag like `v1.0.0` also attaches it to a release.
- **On a Windows PC:** `npm install --ignore-scripts` then `npm run dist:win` → `release\BodyTempleGym-Setup.exe`.

The installer targets Windows 10/11 (x64), installs **per user** (no administrator rights, nothing in Program Files), adds
Desktop/Start-menu shortcuts and a normal uninstaller. Running a newer installer over an old one updates the app and keeps
the database. It is **unsigned**, so Windows SmartScreen shows "Unknown publisher" the first time — *More info → Run anyway*.

## Bringing over your existing Supabase data

**Settings → Import** (owner only), either from files you exported from Supabase (one CSV/JSON per table in a folder) or
directly with the project URL + `service_role` key (used once, never saved). Members, plans, terms, payments and attendance
keep their original IDs, dates and amounts (money is converted exactly, no rounding). *Merge* adds what's missing;
*Replace* wipes first (with confirmation). A backup is taken before every import and a summary lists anything skipped.
Supabase staff logins can't be exported — create accounts in the app instead. The old schema is in `legacy/supabase/`.

## Google Sheets (optional)

**Settings → Google Sheets**: service-account email + key (encrypted with Windows DPAPI) + spreadsheet link. The local
database is always the source of truth. The app can push the Members tab after every change and fetch edits you made in the
sheet — but never overwrites a member you changed in the app since the last push. If Google is unreachable the app carries on.

## Troubleshooting

- **`npm install` fails with `gyp ERR!`** — use `npm install --ignore-scripts` (the SQLite package ships ready-made binaries, so no compiler is needed), then `npm run setup:electron`.
- **"Body Temple Gym couldn't open its database"** — nothing has been deleted. Use *Open backup folder*, then start the app and restore a backup from Settings, or contact the person who set it up. Details are in `logs\`.
- **Windows SmartScreen warning** — expected for an unsigned installer: *More info → Run anyway*.
- **Locked out** — use *Forgot your password?* with the recovery code; if that is lost too, restore a backup made before the password was changed.
- **Two copies won't open** — only one instance may use the database; the second just focuses the first.

## Security notes

Context isolation on, Node integration off, sandboxed renderer, strict CSP (the page can't make network requests),
navigation locked to the app's own `app://` origin, path-traversal-safe page loader, one zod-validated IPC handler per
allow-listed action (no generic channel), every action checked for a signed-in session (owner-only for restore/import/accounts),
parameterised SQL everywhere, secrets redacted from logs, CSV formula neutralisation, and no data, secrets or backups in the
repository (`.gitignore` blocks databases, backups and `.env*`).

## Original web version

The Supabase/Vercel version lives on the `main` branch; its SQL is in `legacy/supabase/`.
