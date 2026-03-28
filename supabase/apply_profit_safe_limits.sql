begin;

update public.pricing_settings
set
  usd_to_mmk_rate = 5000,
  updated_at = now()
where id = 1;

insert into public.pricing_settings (id, usd_to_mmk_rate, default_profit_multiplier)
values (1, 5000, 1.50)
on conflict (id) do update
set
  usd_to_mmk_rate = excluded.usd_to_mmk_rate,
  default_profit_multiplier = coalesce(public.pricing_settings.default_profit_multiplier, excluded.default_profit_multiplier),
  updated_at = now();

update public.plans
set
  price_ks = case id
    when 'free' then 0
    when 'student' then 6000
    when 'pro' then 20000
    when 'premium' then 40000
    when 'ultra' then 80000
    else price_ks
  end,
  daily_messages = case id
    when 'free' then 30
    when 'student' then 40
    when 'pro' then 17
    when 'premium' then 19
    when 'ultra' then 7
    else daily_messages
  end,
  max_upload_files = case id
    when 'free' then 1
    when 'student' then 2
    when 'pro' then 3
    when 'premium' then 5
    when 'ultra' then null
    else max_upload_files
  end,
  updated_at = now()
where id in ('free', 'student', 'pro', 'premium', 'ultra');

commit;
