# Body Temple Gym — Desktop migration

Migration of the existing Next.js + Supabase + Vercel web app into an offline-first
Windows desktop app (Electron + Next.js + React + TypeScript + SQLite).

> ## ⚠️ Status: Checkpoint 1 of 4 — foundation only. **Not runnable yet.**
>
> | Phase | Scope | State |
> |---|---|---|
> | 1 | Architecture decisions, shared IPC contract, SQLite schema + migration runner, DB manager, logger, tests | ✅ done & tested (32 tests) |
> | 2 | Main-process services (auth, members, attendance, revenue, backup/restore, Sheets, importer), validated IPC, secure main window, preload, esbuild bundling | ⬜ not started |
> | 3 | Renderer port: replace every Supabase call with `window.gym`, auth guard + first-run setup, route changes, new Settings screens | ⬜ not started |
> | 4 | electron-builder NSIS installer, icons, GitHub Actions Windows build, full test pass, final docs | ⬜ not started |
>
> The renderer in `src/` is **still the original web UI** and several files import modules that
> were intentionally removed (`@/lib/supabase/*`), so `next build` fails until Phase 3.
> `npm test` and `npm run typecheck:electron` pass today. Everything else is below as a plan.

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

## 3. Feature-parity checklist (derived from the original repo)

Legend: ✅ in this checkpoint · ⬜ to do. "Web behaviour" is what must be reproduced.

### Auth
| Feature | Web behaviour | Desktop plan | |
|---|---|---|---|
| Login | Email + password, show/hide password, error *"That email and password don't match our records."* | `auth.login`, same copy & form | ⬜ |
| Route protection | `/dashboard/*` needs a session; `/login` bounces to dashboard if signed in; `/` redirects either way | Client guard on `auth.status` | ⬜ |
| Sign out | Top bar | `auth.logout` | ⬜ |
| Display name | `full_name` → email prefix → "Admin"; initials badge | Same | ⬜ |
| Admin creation | Done in Supabase dashboard | **First-run setup screen**, change password, recovery-code reset, manage admins | ⬜ |
| Hashing / lock-out | Supabase | scrypt + salt + progressive delay | ⬜ |

### Dashboard
| Feature | Web behaviour | |
|---|---|---|
| 5 stat cards (count-up) | Total · Active · Expired · Checked in today · Total revenue | ⬜ |
| Revenue, last 6 months | Σ `fees_paid` bucketed by member `start_date` month | ⬜ |
| Expiring soon | Active members ending today…+7 days, soonest first, top 6, red when ≤2 days, links to Renew; "View all" → `members?filter=expiring` | ⬜ |
| Today's check-ins | Local midnight→midnight, newest first, with time | ⬜ |

### Members
| Feature | Web behaviour | |
|---|---|---|
| Search | Case-insensitive substring over name, email, phone | ⬜ |
| Filters | All · Active · Expired · Paused · Expiring soon (= active & ends within 7 days); `?filter=` deep link | ⬜ |
| Sort | Name (default, asc), Start, End, Fees paid; click toggles direction | ⬜ |
| Pagination | 10 per page | ⬜ |
| Row | Plan, dates (end red if active & ≤7 days), fees paid + "₹X due", status pill, Renew / Edit / Delete | ⬜ |
| Delete | Confirm *"Remove {name} …can't be undone"*; cascades to attendance, renewals, payments | ⬜ |
| Add member | Name required; age 10–100; plan auto-fills end date (start + months) and amount due; "payment collected now" + method creates member **+ first renewal + payment** | ⬜ |
| Edit member | Corrects details and `amount_due` only — never touches `fees_paid`, never logs a payment | ⬜ |
| Detail page | Header (initials, status, plan chip, outstanding chip, paused-since, age); tiles (email, phone, window, due/paid/outstanding); notes; payment history; renewal history with total collected; last 20 check-ins ("on floor" or duration) | ⬜ |
| Renew | Default start = day after current end if still active, else today; creates renewal (+payment), then sets plan/dates/due, `fees_paid` = paid now, status active, clears pause — **atomically** (web app did 3 separate calls) | ⬜ |
| Record payment | Attaches to the member's most recent renewal; `fees_paid += x`, `renewal.amount += x`; blocked with "go to Renew" if no term exists | ⬜ |
| Pause / Resume | Pause: confirm, `paused_at = today`. Resume: `end_date += calendar days paused` | ⬜ |

### Attendance
| Feature | Web behaviour | |
|---|---|---|
| Check-in tab | Autofocused search (name/email/phone, top 8); expired/paused shows warning but still allowed; duplicate active session blocked by DB; check-out stores `duration_minutes = round(Δ/60000)` | ⬜ |
| Overview tab | Today's check-ins · Currently in · Checked out today · Avg visit today; daily(14d)/weekly(8w)/monthly(6m) bars; "On the floor now" (open sessions of **any** day) | ⬜ (bucketing ✅ in `shared/trends.ts`) |
| History tab | All visits newest first; filter by name + from/to date; 20 per page | ⬜ |

### Revenue & export
| Feature | Web behaviour | |
|---|---|---|
| Date presets | Today · This week (from Sunday) · This month · Last 3 months · Custom | ⬜ |
| Cards | Total revenue · Payments · Average · Pending dues (Σ max(0, due−paid) over members) | ⬜ |
| Trend / by-method / transactions | Trend ignores the filter; method % bars; table with search, method filter, sort (date/amount), 15/page, CSV of the filtered rows | ⬜ |
| Members CSV | 11 columns, `body-temple-gym-members-YYYY-MM-DD.csv`, 5-row preview | ⬜ (CSV helpers ✅; desktop uses a native Save dialog) |

### Extras preserved
Sound effects + mute toggle · particle-network background · Framer Motion page transitions ·
Geist Sans · mobile/narrow layout · `reducedMotion="user"` · mango/ink theme. All stay as-is.

### Google Sheets
| Web | Desktop | |
|---|---|---|
| Supabase webhook → `/api/sheet-sync/push` rewrites `Members!A:K` (id,name,age,email,phone,plan_name,start_date,end_date,fees_paid,status,updated_at) | `sheets.push` (auto after changes if enabled + manual) | ⬜ |
| Apps Script `onEdit` → `/api/sheet-sync/pull` `{id,field,value}`; editable: name, age, email, phone, plan_name, start_date, end_date, fees_paid, status | `sheets.pull` reads the sheet; applies those fields where the sheet changed and the local row has **not** changed since the last push (local wins on conflict, counted in the result) | ⬜ |

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
| `src/lib/{members,plans,attendance,payments,renewals}.ts` | ⬜ thin `window.gym` client; SQL moves into `electron/services/*` |
| `src/lib/{utils,sounds,use-count-up,date-ranges}.ts` | unchanged |
| `src/app/{page,login/*}`, `dashboard/layout.tsx`, `top-bar.tsx` | ⬜ session via IPC |
| other `src/app/dashboard/**/page.tsx` | ⬜ server components → client components that load via IPC |
| components calling `createClient()` (member-form, renew-form, record-payment-form, pause-resume-action, check-in-panel, members-table, login-form, top-bar) | ⬜ swap Supabase calls for `window.gym` calls; markup/classes untouched |
| `supabase/*.sql` | moved to `legacy/supabase/` ✅ |

## 5. What exists in this checkpoint

```
shared/        types.ts (domain + DTOs) · api.ts (IPC contract + allow-list) · errors.ts · money.ts
               csv.ts · trends.ts · status.ts
electron/      database/{connection,manager,migrate}.ts · database/migrations/001_initial.ts
               services/logger.ts (daily files, secret redaction)
tests/         database.test.ts (18) · shared.test.ts (14)
legacy/        original Supabase SQL + removed web files (reference only)
```

Verified here (Linux sandbox): schema creates on first launch incl. missing folders; WAL/FK/synchronous
pragmas; seed plans; one-active-check-in rule; cascades; `ON DELETE SET NULL` keeps `plan_name`;
CHECK constraints; failed migration rolls back fully; newer-schema databases are refused; damaged file →
friendly error; money/CSV/status/trend helpers; logs never contain passwords. Electron 44's bundled Node
loads `better-sqlite3` 13 correctly.

**Not verified (cannot be, from this sandbox):** any Windows build, the installer, UI behaviour,
an in-place update on a real PC.

## 6. Remaining work

**Phase 2 — main process.** Services: `auth` (setup/login/lockout/recovery/change password/admins),
`plans`, `members` (create/update/renew/pause/resume/payment/delete, all in `runInTransaction`),
`attendance`, `dashboard`, `revenue`, `exports` (native Save dialog), `backup` (online backup, verify,
rotate, restore swap, auto schedule, secondary folder), `sheets`, `importer`
(Supabase REST with service key, or CSV/JSON folder; `merge`/`replace`; pre-import backup; summary of
skipped rows). `ipc/` registers one zod-validated handler per `API_METHODS` entry and returns
`Result<T>`; SQLite errors map to friendly messages and are logged. `main/`: single-instance lock, window,
`app://` protocol with path-traversal guard, CSP, permission denial, startup error dialog, status sweep.
`preload/`: builds `window.gym` from `API_METHODS`. `scripts/build-electron.mjs` (esbuild; `better-sqlite3`
external). Add a test file per service plus an IPC allow-list test.

**Phase 3 — renderer.** `src/lib/api.ts` (unwrap `Result`, typed `AppError`), auth provider + guard,
setup/login screens, query-param member routes, convert pages to client loaders, swap Supabase calls,
Settings (Plans · Data safety · Google Sheets · Import · Account), `scripts/dev.mjs`.
Then run the checklist in §3 top-to-bottom against the original screens.

**Phase 4 — Windows.** `electron-builder` (NSIS, x64, `perMachine:false`, `deleteAppDataOnUninstall:false`,
artifact `BodyTempleGym-Setup.exe`), `.ico` generated from `public/brand/logo-512.png`,
`.github/workflows/build-windows.yml` (`windows-latest`), update-in-place test (install v1 → add data →
install v2 → data intact), README final pass.

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
npm test                       # 32 tests
npm run typecheck:electron
```
Then implement Phase 2 in the order listed in §6 (auth → plans → members → attendance → dashboard/revenue →
backup → ipc/main/preload → sheets → importer), keeping `npm test` green after each service.
