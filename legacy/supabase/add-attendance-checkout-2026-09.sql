-- Extends the EXISTING attendance table with checkout tracking — does not
-- create a new table, does not touch or delete any existing rows. Every
-- past check-in keeps its data exactly as-is; checked_out_at and
-- duration_minutes just come back null for rows that predate this
-- migration (the UI treats that as "no checkout recorded", not an error).
--
-- Also adds the UPDATE policy this table was missing — checkout works by
-- updating the existing check-in row (setting checked_out_at), and there
-- was previously no RLS policy allowing that at all.

alter table public.attendance add column if not exists checked_out_at timestamptz;
alter table public.attendance add column if not exists duration_minutes integer;

create index if not exists idx_attendance_checked_out_at on public.attendance(checked_out_at);
-- Enforces "no duplicate active check-ins" at the database level, not
-- just as a UI convention — Postgres rejects a second insert for the same
-- member while one row still has checked_out_at null.
create unique index if not exists idx_attendance_one_active_per_member
  on public.attendance(member_id) where checked_out_at is null;

drop policy if exists "Admins can update attendance" on public.attendance;
create policy "Admins can update attendance" on public.attendance
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
