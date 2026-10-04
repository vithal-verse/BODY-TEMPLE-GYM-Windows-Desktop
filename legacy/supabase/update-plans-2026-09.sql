-- Replace the old plans with the new pricing structure.
-- Safe to run even if members are already assigned to the old plans:
-- each member keeps a `plan_name` snapshot, so their history stays intact —
-- they just lose the live link to a plan that no longer exists, and you can
-- reassign them to a new one from the edit-member screen if you want to.

delete from public.membership_plans;

insert into public.membership_plans (name, duration_months, fee_amount) values
  ('1 Month', 1, 1500),
  ('2 Months', 2, 2000),
  ('3 Months', 3, 2500),
  ('4 Months', 4, 3200);
