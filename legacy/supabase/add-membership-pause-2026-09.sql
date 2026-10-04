-- Adds membership pause/freeze support: a third 'paused' status alongside
-- active/expired, a paused_at column, and a fix to the auto-status
-- trigger so it never overrides an explicit pause. Safe to run once,
-- doesn't touch existing data (everyone stays active/expired as they are
-- now — nobody becomes paused just from running this).

alter table public.members drop constraint if exists members_status_check;
alter table public.members add constraint members_status_check
  check (status in ('active', 'expired', 'paused'));

alter table public.members add column if not exists paused_at date;

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

-- The trigger itself doesn't need to be re-created — updating the
-- function it points to (above) is enough since it's `create or replace`.
