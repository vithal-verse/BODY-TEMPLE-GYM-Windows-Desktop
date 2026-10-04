-- Adds the attendance table — one row per check-in. Safe to run once,
-- doesn't touch existing data.

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  checked_in_at timestamptz not null default now()
);

create index if not exists idx_attendance_member_id on public.attendance(member_id);
create index if not exists idx_attendance_checked_in_at on public.attendance(checked_in_at);

alter table public.attendance enable row level security;

drop policy if exists "Admins can read attendance" on public.attendance;
create policy "Admins can read attendance" on public.attendance
  for select using (auth.role() = 'authenticated');

drop policy if exists "Admins can insert attendance" on public.attendance;
create policy "Admins can insert attendance" on public.attendance
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "Admins can delete attendance" on public.attendance;
create policy "Admins can delete attendance" on public.attendance
  for delete using (auth.role() = 'authenticated');
