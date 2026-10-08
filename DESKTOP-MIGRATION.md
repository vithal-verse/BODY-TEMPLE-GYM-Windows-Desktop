# Body Temple Gym — Desktop migration

Migration of the existing Next.js + Supabase + Vercel web app into an offline-first Windows desktop app
(Electron + Next.js + React + TypeScript + SQLite).

> ## Status: feature-complete. Left to do: produce the installer on Windows and try it on a real PC.
>
> | Phase | Scope | State |
> |---|---|---|
> | 1 | Architecture, shared IPC contract, SQLite schema + migrations, DB manager, logger | ✅ |
> | 2 | Services (auth, members, attendance, reports, backup/restore, Sheets, importer), validated IPC, hardened Electron shell | ✅ |
> | 3 | Renderer port: every screen on `window.gym`, first-run setup, recovery, Settings | ✅ static export builds; end-to-end UI test passes |
> | 4 | Packaging: electron-builder (NSIS), icons, GitHub Actions | ✅ configured; Windows package built from Linux; ⬜ final `.exe` from CI + real-PC check |
>
> Verified by 122 automated tests, `npm run lint`, `npm run typecheck`, `npm run build`, and a 20-step end-to-end UI test in the
> real Electron app (details in §5). Nothing has been run on Windows yet.

---

## 1. Architecture

```
┌──────────────────────────── Electron app ─────────────────────────────┐
│  Renderer (Next.js static export, React UI)   — no Node, no DB access │
│        │  window.gym.<namespace>.<method>(input)                      │
│  Preload (contextBridge)  — builds window.gym ONLY from API_METHODS   │
│        │  ipcRenderer.invoke("gym:<ns>:<method>")                     │
│  Main process                                                         │
│     ipc/        zod-validates every payload, checks the admin session │
│     services/   business logic (members, auth, attendance, backup …)  │
│     database/   better-sqlite3 · WAL · FK on · versioned migrations   │
│        │                                                              │
│  %APPDATA%\Body Temple Gym\  data\gym.sqlite · backups\ · logs\       │
└───────────────────────────────────────────────────────────────────────┘
```

Layering rule: UI → (IPC) → services → database. Services never import Electron; they take a
`DatabaseManager` and a `Logger`, so they are unit-tested under plain Node/Vitest.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Next.js **static export** (`output: "export"`), served by the main process over a private `app://` protocol. No local HTTP server. | No open port, works offline, nothing for another program on the PC to talk to. |
| D2 | **better-sqlite3** in the main process only. WAL, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout`. | Mature, synchronous, ships N-API prebuilds for Windows x64/arm64 (no compiler needed on the build machine). |
| D3 | Money stored as **integer paise**; the UI still sees rupees. | Sums never drift (`0.1 + 0.2`). `shared/money.ts` converts. |
| D4 | **IDs preserved**: member/attendance/renewal/payment UUIDs stay `TEXT`; plan ids stay integers. | Lossless Supabase import; Sheets column A (member id) stays valid. |
| D5 | Postgres triggers → application code. `set_member_status` is `shared/status.ts`; `set_updated_at` is a SQLite trigger. | Same rules, no Postgres. |
| D6 | **Status is refreshed on app start, hourly, and before list reads.** | In Postgres the status trigger only ran *on write*, so a member whose end date passed stayed "active" until someone edited them. The schema comments show auto-expiry was the intent; this delivers it. (Deliberate improvement — flag if you want the old behaviour.) |
| D7 | Local auth: `admin_profiles` + `admin_credentials`, **scrypt** (Node `crypto`, no native dep), per-user salt, constant-time compare, progressive lock-out, one-time **recovery code**. Session lives in main-process memory only. | Offline password reset is impossible without email, hence the recovery code. No default password; first run shows a setup screen. |
| D8 | `[id]` dynamic routes → query-param routes (`/dashboard/members/detail/?id=…`, `/edit/`, `/renew/`, `/pay/`). | Static export cannot serve runtime-dynamic segments. |
| D9 | Dashboard keeps the web app's exact semantics: *Total revenue* = Σ `members.fees_paid`; the 6-month chart buckets that by `start_date` month. The **Revenue page** uses real `payments` rows. | Parity first. (These two can legitimately disagree; that was true in the web app too.) |
| D10 | Members list uses **server-side** search/filter/sort/pagination (10/page, as before); history 20/page; transactions 15/page. | Fast with thousands of members and large attendance tables. Name sort = `ORDER BY ulower(name)` (better-sqlite3 has no custom collations). |
| D11 | Google Sheets becomes an **optional** main-process service: service-account JWT signed with Node `crypto` + `fetch` (drops the ~190 MB `googleapis` dependency). Push = debounced after member changes + manual. Pull = manual "Pull edits" (a desktop app cannot receive webhooks). Private key encrypted with Electron `safeStorage`. SQLite stays the source of truth; failures never block the app. | Offline-first; Sheets is a mirror, not a dependency. |
| D12 | Backups use SQLite's **online backup API** (`db.backup`) → verify (open read-only + `integrity_check`) → atomic rename. Automatic + pre-migration + pre-restore + pre-import copies. Restore needs explicit confirmation and swaps via a temp file after taking a safety copy. | Never copy a live WAL database by hand; never destroy data silently. |
| D13 | Data in `app.getPath("userData")` (= `%APPDATA%\Body Temple Gym`). NSIS: `deleteAppDataOnUninstall: false`, per-user install. | Survives updates and uninstall; nothing in Program Files. |
| D14 | Electron hardening: `contextIsolation`, `sandbox`, `nodeIntegration:false`, strict CSP, navigation locked to `app://`, new windows denied, single-instance lock, zod on every IPC payload, **no generic invoke channel**. | Spec requirement. `shared/api.ts` has a compile-time check that the allow-list covers every API method. |
| D15 | All Next/React/Tailwind/Framer/Recharts packages are **devDependencies** (bundled into `out/` at build time). The only runtime dependency is `better-sqlite3`. | Small installer, small attack surface. |

### Deliberate differences from the web app

| Area | Web app | Desktop |
|---|---|---|
| Member status | Updated only when a row was written, so a lapsed member stayed "active" until edited | Refreshed on start, hourly, on window focus and before every read |
| New-member form | Plan pre-selected, but end date / fee / amount paid stayed blank until the plan was re-picked (a member could be saved with no end date, so never expire) | The pre-selected plan is applied immediately |
| Renewal | Three separate calls (term, payment, member update) | One transaction |
| Confirmations | Browser `confirm()` / `alert()` | In-app dialogs (native ones can leave text inputs unfocusable in Electron on Windows) |
| Sign-in | Supabase session cookie persisted | Sign in each time the app opens (the session lives only in memory) |
| Attendance-history dates | Filtered by UTC date | Filtered by the gym's local day |
| CSV export | Plain UTF-8 | UTF-8 with BOM (opens correctly in Excel) + spreadsheet-formula neutralisation |
| Plans | Edited with SQL in Supabase | Settings → Plans |
| Staff accounts | Created in the Supabase dashboard | Settings → Account (owner only) |
| Google Sheets | Supabase webhook + Apps Script | Optional; push after changes + "Fetch edits"; local data wins on conflict |

## 3. Feature-parity checklist (derived from the original repo)

Legend: ✅ implemented and covered by the automated tests and/or the end-to-end UI test. Items that touch external services (Google Sheets, Supabase) were verified against fakes only. "Web behaviour" is what is reproduced.

### Auth
| Feature | Web behaviour | Desktop plan | |
|---|---|---|---|
| Login | Email + password, show/hide password, error *"That email and password don't match our records."* | `auth.login`, same copy & form | ✅ |
| Route protection | `/dashboard/*` needs a session; `/login` bounces to dashboard if signed in; `/` redirects either way | Client guard on `auth.status` | ✅ |
| Sign out | Top bar | `auth.logout` | ✅ |
| Display name | `full_name` → email prefix → "Admin"; initials badge | Same | ✅ |
| Admin creation | Done in Supabase dashboard | **First-run setup screen**, change password, recovery-code reset, manage admins | ✅ |
| Hashing / lock-out | Supabase | scrypt + salt + progressive delay | ✅ |

### Dashboard
| Feature | Web behaviour | |
|---|---|---|
| 5 stat cards (count-up) | Total · Active · Expired · Checked in today · Total revenue | ✅ |
| Revenue, last 6 months | Σ `fees_paid` bucketed by member `start_date` month | ✅ |
| Expiring soon | Active members ending today…+7 days, soonest first, top 6, red when ≤2 days, links to Renew; "View all" → `members?filter=expiring` | ✅ |
| Today's check-ins | Local midnight→midnight, newest first, with time | ✅ |

### Members
| Feature | Web behaviour | |
|---|---|---|
| Search | Case-insensitive substring over name, email, phone | ✅ |
| Filters | All · Active · Expired · Paused · Expiring soon (= active & ends within 7 days); `?filter=` deep link | ✅ |
| Sort | Name (default, asc), Start, End, Fees paid; click toggles direction | ✅ |
| Pagination | 10 per page | ✅ |
| Row | Plan, dates (end red if active & ≤7 days), fees paid + "₹X due", status pill, Renew / Edit / Delete | ✅ |
| Delete | Confirm *"Remove {name} …can't be undone"*; cascades to attendance, renewals, payments | ✅ |
| Add member | Name required; age 10–100; plan auto-fills end date (start + months) and amount due; "payment collected now" + method creates member **+ first renewal + payment** | ✅ |
| Edit member | Corrects details and `amount_due` only — never touches `fees_paid`, never logs a payment | ✅ |
| Detail page | Header (initials, status, plan chip, outstanding chip, paused-since, age); tiles (email, phone, window, due/paid/outstanding); notes; payment history; renewal history with total collected; last 20 check-ins ("on floor" or duration) | ✅ |
| Renew | Default start = day after current end if still active, else today; creates renewal (+payment), then sets plan/dates/due, `fees_paid` = paid now, status active, clears pause — **atomically** (web app did 3 separate calls) | ✅ |
| Record payment | Attaches to the member's most recent renewal; `fees_paid += x`, `renewal.amount += x`; blocked with "go to Renew" if no term exists | ✅ |
| Pause / Resume | Pause: confirm, `paused_at = today`. Resume: `end_date += calendar days paused` | ✅ |

### Attendance
| Feature | Web behaviour | |
|---|---|---|
| Check-in tab | Autofocused search (name/email/phone, top 8); expired/paused shows warning but still allowed; duplicate active session blocked by DB; check-out stores `duration_minutes = round(Δ/60000)` | ✅ |
| Overview tab | Today's check-ins · Currently in · Checked out today · Avg visit today; daily(14d)/weekly(8w)/monthly(6m) bars; "On the floor now" (open sessions of **any** day) | ✅ (bucketing ✅ in `shared/trends.ts`) |
| History tab | All visits newest first; filter by name + from/to date; 20 per page | ✅ |

### Revenue & export
| Feature | Web behaviour | |
|---|---|---|
| Date presets | Today · This week (from Sunday) · This month · Last 3 months · Custom | ✅ |
| Cards | Total revenue · Payments · Average · Pending dues (Σ max(0, due−paid) over members) | ✅ |
| Trend / by-method / transactions | Trend ignores the filter; method % bars; table with search, method filter, sort (date/amount), 15/page, CSV of the filtered rows | ✅ |
| Members CSV | 11 columns, `body-temple-gym-members-YYYY-MM-DD.csv`, 5-row preview | ✅ (CSV helpers ✅; desktop uses a native Save dialog) |

### Extras preserved
Sound effects + mute toggle · particle-network background · Framer Motion page transitions ·
Geist Sans · mobile/narrow layout · `reducedMotion="user"` · mango/ink theme. All stay as-is.

### Google Sheets
| Web | Desktop | |
|---|---|---|
| Supabase webhook → `/api/sheet-sync/push` rewrites `Members!A:K` (id,name,age,email,phone,plan_name,start_date,end_date,fees_paid,status,updated_at) | `sheets.push` (auto after changes if enabled + manual) | ✅ |
| Apps Script `onEdit` → `/api/sheet-sync/pull` `{id,field,value}`; editable: name, age, email, phone, plan_name, start_date, end_date, fees_paid, status | `sheets.pull` reads the sheet; applies those fields where the sheet changed and the local row has **not** changed since the last push (local wins on conflict, counted in the result) | ✅ |

### New for desktop (required by the brief)
Backup now · Export backup (save dialog) · Restore (confirm) · Backup verification · Auto backups ·
Integrity check · Change password · Plans management screen (the web app changed plans via SQL only) ·
Import from Supabase (live API or exported CSV/JSON folder) · log viewer shortcut.

## 4. File-by-file port map

| Original | Now |
|---|---|
| `src/lib/supabase/{client,server,middleware}.ts`, `middleware.ts` | removed → `legacy/web-app/` |
| `src/app/api/sheet-sync/*`, `src/lib/google-sheets.ts` | removed → `legacy/web-app/`; becomes `electron/services/sheets.ts` |
| `src/app/dashboard/members/[id]/{page,edit,renew,pay}` | removed → `legacy/web-app/`; become query-param routes (D8) |
| `src/types/database.ts` | replaced by `shared/types.ts` ✅ |
| `src/lib/revenue-trend.ts` (+ trend half of `attendance.ts`) | `shared/trends.ts` ✅ |
| `src/lib/{members,plans,attendance,payments,renewals}.ts` | ✅ thin `window.gym` client; SQL moves into `electron/services/*` |
| `src/lib/{utils,sounds,use-count-up,date-ranges}.ts` | unchanged |
| `src/app/{page,login/*}`, `dashboard/layout.tsx`, `top-bar.tsx` | ✅ session via IPC |
| other `src/app/dashboard/**/page.tsx` | ✅ server components → client components that load via IPC |
| components calling `createClient()` (member-form, renew-form, record-payment-form, pause-resume-action, check-in-panel, members-table, login-form, top-bar) | ✅ swap Supabase calls for `window.gym` calls; markup/classes untouched |
| `supabase/*.sql` | moved to `legacy/supabase/` ✅ |

## 5. What exists and what was verified

```
shared/      domain types · IPC contract + allow-list · errors · money · csv · trends · status · validation
electron/
  database/  connection · versioned migrations · integrity checks · manager
  services/  auth · plans · members · attendance · reports (dashboard, revenue, CSV) · backup & restore
             sheets · importer · settings · logger · platform interface
  ipc/       zod schemas + one handler per API method · dispatcher (access control) · error translation · registration
  main/      paths · app:// protocol (+ CSP) · hardened window & menu · native dialogs / secret storage · entry point
  preload/   the window.gym bridge (generated from the allow-list)
src/         the UI: original screens on window.gym, plus setup / recovery / Settings
scripts/     build-electron.mjs · dev.mjs · ui-test.mjs · make-icons.py
tests/       122 tests in 10 files
build/       icon.ico / icon.png          electron-builder.yml          .github/workflows/{ci,build-windows}.yml
legacy/      original Supabase SQL + removed web files (reference only)
```

**Verified here (Linux sandbox)**
- **122 automated tests**: schema + constraints, migration rollback, auth (hashing, lock-out, recovery code, roles), members
  (create / edit / renew / pause / payment / status expiry / search / sort / pagination), attendance, dashboard + revenue figures,
  CSV export, backup & restore (online backup under concurrent writes, rollback on a failed swap, older-schema migration),
  Google Sheets against a fake Google (JWT signature, push, pull, conflicts), Supabase import (exact money, id preservation,
  orphan skipping, paging, errors), and the IPC pipeline (allow-list exhaustive, access levels frozen, untrusted senders blocked,
  injection-style input rejected).
- `npm run lint` (clean) · `npm run typecheck` (renderer + Electron, clean) · `npm run build` (18 static routes + Electron bundles).
- **End-to-end UI test** (`npm run test:ui`, real Electron, 20 steps): first-run setup (weak-password and mismatch checks, recovery
  code), add / edit / search / filter / sort / paginate members, record a payment, renew, pause / resume, check-in / check-out with
  overview and history, revenue totals, CSV export, plans, backup → verify → restore (session ends, data returns to the backup),
  password change, signed-out guard, wrong-password refusal, and persistence across an app restart.
- The **same UI test also passes when the app runs from a packed `app.asar`** with the native SQLite binary unpacked beside it — the
  layout the installed app uses — which proves the `app://` page loader and the database driver work from inside the archive.
- **Windows package built from Linux** with electron-builder: a real `Body Temple Gym.exe` (PE32+ x86-64); a 5 MB app archive holding
  only the UI, the main/preload scripts and better-sqlite3, with the `win32-x64` native binary unpacked beside it; the NSIS script
  compiled and produced the installer stub.

**Not verified (cannot be, from this sandbox)**
- Running on Windows at all; the finished `BodyTempleGym-Setup.exe` (its last step, writing the uninstaller, needs Wine or Windows —
  the GitHub workflow does it natively); installing over an older version; Google Sheets against real Google; a Supabase import
  against a real project.

## 6. Remaining work (short)

1. Run the **Build Windows installer** workflow (Actions tab) or `npm run dist:win` on a Windows PC; install the result on a real PC.
2. On that PC, click through the §3 checklist once (the UI test already does this on Linux), including *install over an older
   version keeps the database* and *uninstall keeps `%APPDATA%\Body Temple Gym`*.
3. Try **Settings → Import** with real Supabase exports (start with the folder option) and **Settings → Google Sheets** with a real
   service account.
4. Optional: a code-signing certificate (removes the SmartScreen "Unknown publisher" prompt); an auto-updater.

## 7. Known limitations to expect

- The installer will be **unsigned**, so Windows SmartScreen shows "Unknown publisher" on first run
  (More info → Run anyway). Removing it requires a paid code-signing certificate.
- Building the `.exe` from macOS/Linux is unreliable; use the GitHub Actions Windows job or a Windows PC.
- No auto-updater is planned; updating = run the newer `BodyTempleGym-Setup.exe` over the old one.
- Multi-PC / shared database is out of scope: one PC owns one database file.
- Installing from the lockfile can make npm try to compile `better-sqlite3` with `node-gyp` even though a
  prebuilt binary ships in the package (observed with npm 10.9). Use `npm install --ignore-scripts` locally and
  in CI, then `npm run setup:electron` to fetch the Electron binary. Phase 4's CI job must do the same.

## 8. Continue from here

```bash
npm install --ignore-scripts   # avoids an unnecessary node-gyp compile of better-sqlite3 (see README)
npm run setup:electron         # one-time Electron download
npm run dev                    # hot-reloading app, data in ./.dev-data
npm test && npm run lint && npm run typecheck
npm run build && npm run test:ui
```
