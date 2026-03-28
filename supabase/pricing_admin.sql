begin;

create table if not exists public.plans (
  id text primary key,
  name text not null,
  plan_level integer not null unique,
  price_ks integer not null default 0,
  daily_messages integer not null default 30,
  max_upload_files integer,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  check (price_ks >= 0),
  check (daily_messages >= 0),
  check (max_upload_files is null or max_upload_files >= 0)
);

create table if not exists public.pricing_settings (
  id integer primary key default 1,
  usd_to_mmk_rate numeric(12,2) not null default 5000,
  default_profit_multiplier numeric(8,2) not null default 1.50,
  updated_at timestamptz not null default now(),
  check (usd_to_mmk_rate > 0),
  check (default_profit_multiplier > 0)
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.plans (id, name, plan_level, price_ks, daily_messages, max_upload_files, is_active)
values
  ('free', 'Free', 0, 0, 30, 1, true),
  ('student', 'Student', 1, 5000, 40, 2, true),
  ('pro', 'Pro', 2, 20000, 17, 3, true),
  ('premium', 'Premium', 3, 40000, 19, 5, true),
  ('ultra', 'Ultra', 4, 80000, 7, null, true)
on conflict (id) do update
set
  name = excluded.name,
  plan_level = excluded.plan_level,
  price_ks = excluded.price_ks,
  daily_messages = excluded.daily_messages,
  max_upload_files = excluded.max_upload_files,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.pricing_settings (id, usd_to_mmk_rate, default_profit_multiplier)
values (1, 5000, 1.50)
on conflict (id) do update
set
  usd_to_mmk_rate = excluded.usd_to_mmk_rate,
  default_profit_multiplier = excluded.default_profit_multiplier,
  updated_at = now();

alter table public.plans enable row level security;
alter table public.pricing_settings enable row level security;
alter table public.admins enable row level security;

drop policy if exists "Public can read active plans" on public.plans;
create policy "Public can read active plans"
on public.plans
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Admins can manage plans" on public.plans;
create policy "Admins can manage plans"
on public.plans
for all
to authenticated
using (exists (
  select 1 from public.admins a
  where a.user_id = auth.uid()
))
with check (exists (
  select 1 from public.admins a
  where a.user_id = auth.uid()
));

drop policy if exists "Public can read pricing settings" on public.pricing_settings;
create policy "Public can read pricing settings"
on public.pricing_settings
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage pricing settings" on public.pricing_settings;
create policy "Admins can manage pricing settings"
on public.pricing_settings
for all
to authenticated
using (exists (
  select 1 from public.admins a
  where a.user_id = auth.uid()
))
with check (exists (
  select 1 from public.admins a
  where a.user_id = auth.uid()
));

drop policy if exists "Users can read own admin row" on public.admins;
create policy "Users can read own admin row"
on public.admins
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Admins can manage admins" on public.admins;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admins
    where user_id = auth.uid()
  );
$$;

grant execute on function public.is_current_user_admin() to authenticated;

drop trigger if exists trg_plans_touch_updated_at on public.plans;
create trigger trg_plans_touch_updated_at
before update on public.plans
for each row execute function public.touch_updated_at();

drop trigger if exists trg_pricing_settings_touch_updated_at on public.pricing_settings;
create trigger trg_pricing_settings_touch_updated_at
before update on public.pricing_settings
for each row execute function public.touch_updated_at();

commit;

-- After running this SQL, insert your own user id as admin:
-- insert into public.admins (user_id) values ('YOUR_AUTH_USER_ID_HERE')
-- on conflict (user_id) do nothing;
-- Manage admins manually from SQL Editor instead of from the browser.
