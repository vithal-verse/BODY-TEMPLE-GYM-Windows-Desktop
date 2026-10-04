-- Adds the renewals table — the history log behind membership renewals.
-- Safe to run once. Doesn't touch or require changes to existing data;
-- `members` keeps working exactly as before, this just adds a place to
-- log each term (including a helper query to backfill your existing
-- members' current term as their first history entry, at the bottom).

create table if not exists public.renewals (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  plan_id integer references public.membership_plans(id) on delete set null,
  plan_name text,
  amount numeric(10, 2) not null default 0,
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now()
);

create index if not exists idx_renewals_member_id on public.renewals(member_id);

alter table public.renewals enable row level security;

drop policy if exists "Admins can read renewals" on public.renewals;
create policy "Admins can read renewals" on public.renewals
  for select using (auth.role() = 'authenticated');

drop policy if exists "Admins can insert renewals" on public.renewals;
create policy "Admins can insert renewals" on public.renewals
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "Admins can delete renewals" on public.renewals;
create policy "Admins can delete renewals" on public.renewals
  for delete using (auth.role() = 'authenticated');

-- Optional: backfill each existing member's CURRENT term as their first
-- renewals row, so their history isn't empty the first time you open their
-- profile. Safe to run once — skips anyone who already has a renewals row.
insert into public.renewals (member_id, plan_id, plan_name, amount, start_date, end_date, created_at)
select m.id, m.plan_id, m.plan_name, m.fees_paid, m.start_date, m.end_date, m.created_at
from public.members m
where not exists (select 1 from public.renewals r where r.member_id = m.id);
