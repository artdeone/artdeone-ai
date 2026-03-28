-- ============================================================
-- admin_auth table + verify_admin_login RPC
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable pgcrypto for password hashing
create extension if not exists pgcrypto;

-- Admin auth table
create table if not exists public.admin_auth (
  id bigint generated always as identity primary key,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- Enable RLS and block all direct access
alter table public.admin_auth enable row level security;

-- No RLS policies = nobody can SELECT/INSERT/UPDATE/DELETE via the API
-- Only security-definer functions can access the table

-- RPC function to verify admin login
-- Uses pgcrypto crypt() to compare hashed passwords
create or replace function public.verify_admin_login(p_email text, p_password text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  stored_hash text;
begin
  select password_hash into stored_hash
  from public.admin_auth
  where lower(email) = lower(p_email);

  if stored_hash is null then
    return false;
  end if;

  return stored_hash = crypt(p_password, stored_hash);
end;
$$;

-- Allow anon and authenticated to call the RPC
grant execute on function public.verify_admin_login(text, text) to anon, authenticated;

-- ============================================================
-- INSERT ADMIN ACCOUNT
-- Change the email and password below to your own values
-- ============================================================
-- insert into public.admin_auth (email, password_hash)
-- values (
--   'your-admin@email.com',
--   crypt('your-secure-password', gen_salt('bf'))
-- );
--
-- To update password:
-- update public.admin_auth
-- set password_hash = crypt('new-password', gen_salt('bf'))
-- where email = 'your-admin@email.com';
