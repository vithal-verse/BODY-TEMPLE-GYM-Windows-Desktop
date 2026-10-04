# legacy/

Reference material from the original Supabase + Vercel web app. **Nothing in this
folder is built, linted, type-checked or shipped** — it exists so the migration
never loses the original behaviour.

- `supabase/` — the original Postgres schema and dated SQL migrations (also the
  source of truth for the Supabase → SQLite importer).
- `web-app/` — the original server-side files that were removed from `src/`:
  Supabase clients, auth middleware, the Google Sheets webhook routes, and the
  member detail / edit / renew / pay pages (which were dynamic `[id]` routes).
- `web-app/package.original.json` — the original dependency list.

The complete original app is also untouched on the `main` branch of the GitHub repo.
