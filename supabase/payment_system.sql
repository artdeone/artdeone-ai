begin;

-- =============================================================
-- Payment Orders
-- =============================================================
create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.plans(id),
  plan_level integer not null,
  amount_ks integer not null,
  payment_method text not null check (payment_method in ('kbzpay','ayapay','uabpay','wavepay')),
  screenshot_url text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_ks > 0)
);

-- =============================================================
-- Subscriptions
-- =============================================================
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  plan_id text references public.plans(id),
  plan_level integer not null default 0,
  plan_name text not null default 'Free',
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active','expired','cancelled')),
  payment_order_id uuid references public.payment_orders(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================
-- Storage bucket (must be created manually in Supabase Dashboard)
-- =============================================================
-- Go to Supabase Dashboard > Storage > New bucket
-- Name: payment-screenshots
-- Public: false (private)
-- Allowed MIME types: image/png, image/jpeg, image/webp
-- Max file size: 5MB
-- Then add storage policies:
--   - Authenticated users can upload to their own folder: ((bucket_id = 'payment-screenshots') AND (auth.uid()::text = (storage.foldername(name))[1]))
--   - Authenticated users can read their own files
--   - Admins can read all files

-- =============================================================
-- RLS
-- =============================================================
alter table public.payment_orders enable row level security;
alter table public.subscriptions enable row level security;

-- Payment Orders: users can insert their own
drop policy if exists "Users can insert own payment orders" on public.payment_orders;
create policy "Users can insert own payment orders"
on public.payment_orders
for insert
to authenticated
with check (user_id = auth.uid());

-- Payment Orders: users can select their own
drop policy if exists "Users can view own payment orders" on public.payment_orders;
create policy "Users can view own payment orders"
on public.payment_orders
for select
to authenticated
using (user_id = auth.uid());

-- Payment Orders: admins can select all
drop policy if exists "Admins can view all payment orders" on public.payment_orders;
create policy "Admins can view all payment orders"
on public.payment_orders
for select
to authenticated
using (exists (
  select 1 from public.admins a
  where a.user_id = auth.uid()
));

-- Payment Orders: admins can update (approve/reject)
drop policy if exists "Admins can update payment orders" on public.payment_orders;
create policy "Admins can update payment orders"
on public.payment_orders
for update
to authenticated
using (exists (
  select 1 from public.admins a
  where a.user_id = auth.uid()
))
with check (exists (
  select 1 from public.admins a
  where a.user_id = auth.uid()
));

-- Subscriptions: users can select their own
drop policy if exists "Users can view own subscription" on public.subscriptions;
create policy "Users can view own subscription"
on public.subscriptions
for select
to authenticated
using (user_id = auth.uid());

-- Subscriptions: admins can manage all
drop policy if exists "Admins can manage subscriptions" on public.subscriptions;
create policy "Admins can manage subscriptions"
on public.subscriptions
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

-- =============================================================
-- Function: approve_payment_order
-- =============================================================
create or replace function public.approve_payment_order(p_order_id uuid, p_admin_id uuid)
returns public.payment_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.payment_orders;
begin
  -- Update order status
  update public.payment_orders
  set
    status = 'approved',
    reviewed_by = p_admin_id,
    reviewed_at = now()
  where id = p_order_id
    and status = 'pending'
  returning * into v_order;

  if v_order.id is null then
    raise exception 'Order not found or already processed';
  end if;

  -- Upsert subscription with 30-day expiry
  insert into public.subscriptions (
    user_id, plan_id, plan_level, plan_name,
    started_at, expires_at, status, payment_order_id
  )
  select
    v_order.user_id,
    v_order.plan_id,
    v_order.plan_level,
    p.name,
    now(),
    now() + interval '30 days',
    'active',
    v_order.id
  from public.plans p
  where p.id = v_order.plan_id
  on conflict (user_id) do update
  set
    plan_id = excluded.plan_id,
    plan_level = excluded.plan_level,
    plan_name = excluded.plan_name,
    started_at = excluded.started_at,
    expires_at = excluded.expires_at,
    status = 'active',
    payment_order_id = excluded.payment_order_id,
    updated_at = now();

  -- NOTE: user_metadata plan_level update must be done server-side
  -- via supabase.auth.admin.updateUserById(v_order.user_id, { user_metadata: { plan_level: v_order.plan_level } })

  return v_order;
end;
$$;

grant execute on function public.approve_payment_order(uuid, uuid) to authenticated;

-- =============================================================
-- Function: check_expired_subscriptions
-- =============================================================
create or replace function public.check_expired_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.subscriptions
  set
    status = 'expired',
    updated_at = now()
  where status = 'active'
    and expires_at < now();

  get diagnostics v_count = row_count;

  -- NOTE: plan_level downgrade in user_metadata must be done server-side
  -- via supabase.auth.admin.updateUserById(user_id, { user_metadata: { plan_level: 0 } })
  -- Call this function from a server-side cron job and handle the downgrade there.

  return v_count;
end;
$$;

grant execute on function public.check_expired_subscriptions() to authenticated;

-- =============================================================
-- Triggers: updated_at
-- =============================================================
-- Reuses public.touch_updated_at() from pricing_admin.sql

drop trigger if exists trg_payment_orders_touch_updated_at on public.payment_orders;
create trigger trg_payment_orders_touch_updated_at
before update on public.payment_orders
for each row execute function public.touch_updated_at();

drop trigger if exists trg_subscriptions_touch_updated_at on public.subscriptions;
create trigger trg_subscriptions_touch_updated_at
before update on public.subscriptions
for each row execute function public.touch_updated_at();

commit;
