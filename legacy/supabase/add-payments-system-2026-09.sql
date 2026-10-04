-- Adds full payment management: amount_due tracking on members/renewals,
-- plus a payments table logging individual cash/UPI/card transactions.
-- Safe to run once. Existing data is backfilled to show zero outstanding
-- (amount_due = amount already recorded) since there's no way to know
-- historically whether a past term was a partial payment.

alter table public.members add column if not exists amount_due numeric(10, 2);
update public.members set amount_due = fees_paid where amount_due is null;
alter table public.members alter column amount_due set not null;
alter table public.members alter column amount_due set default 0;

alter table public.renewals add column if not exists amount_due numeric(10, 2);
update public.renewals set amount_due = amount where amount_due is null;
alter table public.renewals alter column amount_due set not null;
alter table public.renewals alter column amount_due set default 0;

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

-- Optional: backfill each existing renewals row (that has money recorded)
-- as a single 'cash' payment transaction, so payment history isn't
-- completely empty for members who already have a renewal on record.
-- Safe to run once — skips any renewal that already has a payment logged.
insert into public.payments (member_id, renewal_id, amount, method, paid_at)
select r.member_id, r.id, r.amount, 'cash', r.created_at
from public.renewals r
where r.amount > 0
  and not exists (select 1 from public.payments p where p.renewal_id = r.id);
