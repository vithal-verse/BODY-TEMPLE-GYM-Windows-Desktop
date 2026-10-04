-- =========================================================
-- Body Temple Gym — Supabase schema
-- Run this in the Supabase SQL editor (Project → SQL Editor → New query)
-- =========================================================

-- Extensions needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- membership_plans
-- ---------------------------------------------------------
create table if not exists public.membership_plans (
  id serial primary key,
  name text not null,
  duration_months integer not null,
  fee_amount numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- members
-- ---------------------------------------------------------
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  age integer,
  email text,
  phone text,
  plan_id integer references public.membership_plans(id) on delete set null,
  plan_name text, -- denormalized snapshot so history reads fine if a plan is renamed/removed
  start_date date not null default current_date,
  end_date date,
  fees_paid numeric(10, 2) not null default 0,
  amount_due numeric(10, 2) not null default 0, -- what's owed for the current term; fees_paid is the running total actually collected toward it
  status text not null default 'active' check (status in ('active', 'expired', 'paused')),
  paused_at date, -- when a pause started; null unless currently paused
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_members_status on public.members(status);
create index if not exists idx_members_end_date on public.members(end_date);
create index if not exists idx_members_name on public.members using gin (to_tsvector('simple', name));

-- Keep updated_at current on every write
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_members_updated_at on public.members;
create trigger trg_members_updated_at
  before update on public.members
  for each row execute function public.set_updated_at();

-- Auto-flip status to 'expired' once end_date has passed, on any write.
-- Paused is always an explicit, deliberate state set by the app (pause/
-- resume actions) — this trigger never infers it and never overrides it,
-- so an unrelated edit (fixing a phone number, say) can't silently wake
-- someone out of a pause.
create or replace function public.set_member_status()
returns trigger as $$
begin
  if new.status = 'paused' then
    return new;
  end if;

  if new.end_date is not null and new.end_date < current_date then
    new.status = 'expired';
  elsif new.end_date is null or new.end_date >= current_date then
    if new.status = 'expired' and (new.end_date is null or new.end_date >= current_date) then
      new.status = 'active';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_members_status on public.members;
create trigger trg_members_status
  before insert or update on public.members
  for each row execute function public.set_member_status();

-- ---------------------------------------------------------
-- attendance
-- One row per visit. checked_out_at is null while the member is still on
-- the floor — that's what "currently checked in" means everywhere this
-- table is queried. duration_minutes is filled in at checkout time
-- (rather than always computed on the fly) so history and averages don't
-- need to recompute it from two timestamps on every read.
-- ---------------------------------------------------------
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  duration_minutes integer
);

create index if not exists idx_attendance_member_id on public.attendance(member_id);
create index if not exists idx_attendance_checked_in_at on public.attendance(checked_in_at);
create index if not exists idx_attendance_checked_out_at on public.attendance(checked_out_at);
-- Enforces "no duplicate active check-ins" at the database level, not just
-- as a UI convention: Postgres rejects a second insert for the same
-- member while one row still has checked_out_at null. Doubles as the
-- index that speeds up "does this member have an active session" and
-- "who's currently checked in" lookups, both of which filter on this.
create unique index if not exists idx_attendance_one_active_per_member
  on public.attendance(member_id) where checked_out_at is null;

alter table public.attendance enable row level security;

drop policy if exists "Admins can read attendance" on public.attendance;
create policy "Admins can read attendance" on public.attendance
  for select using (auth.role() = 'authenticated');

drop policy if exists "Admins can insert attendance" on public.attendance;
create policy "Admins can insert attendance" on public.attendance
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "Admins can update attendance" on public.attendance;
create policy "Admins can update attendance" on public.attendance
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Admins can delete attendance" on public.attendance;
create policy "Admins can delete attendance" on public.attendance
  for delete using (auth.role() = 'authenticated');

-- ---------------------------------------------------------
-- renewals
-- One row per payment/term — including the member's initial signup.
-- `members` always reflects the current/most-recent term (plan, dates,
-- fees); this table is the append-only history behind it, so renewing
-- never erases what came before.
-- ---------------------------------------------------------
create table if not exists public.renewals (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  plan_id integer references public.membership_plans(id) on delete set null,
  plan_name text,
  amount numeric(10, 2) not null default 0, -- running total actually paid toward this term
  amount_due numeric(10, 2) not null default 0, -- what's owed for this term
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

-- ---------------------------------------------------------
-- payments
-- Individual payment transactions against a term (a renewals row).
-- Several of these can sum toward one term's amount_due — that's what
-- makes partial payments and an outstanding balance possible.
-- ---------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  renewal_id uuid not null references public.renewals(id) on delete cascade,
  amount numeric(10, 2) not null,
  method text not null check (method in ('cash', 'upi', 'card', 'other')),
  paid_at timestamptz not null default now(),
  notes text
);

create index if not exists idx_payments_member_id on public.payments(member_id);
create index if not exists idx_payments_renewal_id on public.payments(renewal_id);

alter table public.payments enable row level security;

drop policy if exists "Admins can read payments" on public.payments;
create policy "Admins can read payments" on public.payments
  for select using (auth.role() = 'authenticated');

drop policy if exists "Admins can insert payments" on public.payments;
create policy "Admins can insert payments" on public.payments
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "Admins can delete payments" on public.payments;
create policy "Admins can delete payments" on public.payments
  for delete using (auth.role() = 'authenticated');

-- ---------------------------------------------------------
-- admin_profiles
-- Supabase Auth (auth.users) already handles credentials/hashing.
-- This table just stores the display name + role shown in the dashboard.
-- A row is created automatically for every new authenticated user.
-- ---------------------------------------------------------
create table if not exists public.admin_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'admin' check (role in ('admin', 'owner')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_admin()
returns trigger as $$
begin
  insert into public.admin_profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_admin();

-- ---------------------------------------------------------
-- Row Level Security
-- Any authenticated user counts as an admin (matches the brief: single
-- admin role for now). Anonymous / unauthenticated access is denied.
-- ---------------------------------------------------------
alter table public.members enable row level security;
alter table public.membership_plans enable row level security;
alter table public.admin_profiles enable row level security;

drop policy if exists "Admins can read members" on public.members;
create policy "Admins can read members" on public.members
  for select using (auth.role() = 'authenticated');

drop policy if exists "Admins can insert members" on public.members;
create policy "Admins can insert members" on public.members
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "Admins can update members" on public.members;
create policy "Admins can update members" on public.members
  for update using (auth.role() = 'authenticated');

drop policy if exists "Admins can delete members" on public.members;
create policy "Admins can delete members" on public.members
  for delete using (auth.role() = 'authenticated');

drop policy if exists "Admins can read plans" on public.membership_plans;
create policy "Admins can read plans" on public.membership_plans
  for select using (auth.role() = 'authenticated');

drop policy if exists "Admins can manage plans" on public.membership_plans;
create policy "Admins can manage plans" on public.membership_plans
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "Admins can read own profile" on public.admin_profiles;
create policy "Admins can read own profile" on public.admin_profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "Admins can update own profile" on public.admin_profiles;
create policy "Admins can update own profile" on public.admin_profiles
  for update using (auth.uid() = id);

-- ---------------------------------------------------------
-- Seed starter plans (safe to re-run)
-- ---------------------------------------------------------
insert into public.membership_plans (name, duration_months, fee_amount)
select v.name, v.duration_months, v.fee_amount
from (values
  ('1 Month', 1, 1500),
  ('2 Months', 2, 2000),
  ('3 Months', 3, 2500),
  ('4 Months', 4, 3200)
) as v(name, duration_months, fee_amount)
where not exists (select 1 from public.membership_plans p where p.name = v.name);

-- ---------------------------------------------------------
-- Realtime (optional, powers the live-updating dashboard)
-- ---------------------------------------------------------
alter publication supabase_realtime add table public.members;
