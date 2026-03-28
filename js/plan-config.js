export const PLAN_ORDER = ['free', 'student', 'pro', 'premium', 'ultra'];

export const DEFAULT_PLANS = [
  { id: 'free', name: 'Free', plan_level: 0, price_ks: 0, daily_messages: 30, max_upload_files: 1, is_active: true },
  { id: 'student', name: 'Student', plan_level: 1, price_ks: 6000, daily_messages: 40, max_upload_files: 2, is_active: true },
  { id: 'pro', name: 'Pro', plan_level: 2, price_ks: 20000, daily_messages: 8, max_upload_files: 3, is_active: true },
  { id: 'premium', name: 'Premium', plan_level: 3, price_ks: 40000, daily_messages: 12, max_upload_files: 5, is_active: true },
  { id: 'ultra', name: 'Ultra', plan_level: 4, price_ks: 150000, daily_messages: 4, max_upload_files: null, is_active: true },
];

export const DEFAULT_PRICING_SETTINGS = {
  id: 1,
  usd_to_mmk_rate: 5000,
  default_profit_multiplier: 1.5,
};

export function cloneDefaultPlans() {
  return DEFAULT_PLANS.map(plan => ({ ...plan }));
}

export function formatKs(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat('en-US').format(numeric);
}

export function normalizePlan(plan, fallback = {}) {
  return {
    ...fallback,
    ...plan,
    price_ks: Number(plan?.price_ks ?? fallback.price_ks ?? 0),
    daily_messages: Number(plan?.daily_messages ?? fallback.daily_messages ?? 0),
    max_upload_files: plan?.max_upload_files === null || plan?.max_upload_files === undefined || plan?.max_upload_files === ''
      ? null
      : Number(plan.max_upload_files),
    is_active: plan?.is_active ?? fallback.is_active ?? true,
  };
}

export async function loadPricingConfig(supabase) {
  const fallbackPlans = cloneDefaultPlans();
  const fallbackSettings = { ...DEFAULT_PRICING_SETTINGS };

  let plans = fallbackPlans;
  let settings = fallbackSettings;

  try {
    const { data, error } = await supabase
      .from('plans')
      .select('id,name,plan_level,price_ks,daily_messages,max_upload_files,is_active')
      .order('plan_level', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      const merged = fallbackPlans.map(fallbackPlan => {
        const dbPlan = data.find(row => row.id === fallbackPlan.id || row.plan_level === fallbackPlan.plan_level);
        return dbPlan ? normalizePlan(dbPlan, fallbackPlan) : fallbackPlan;
      });
      plans = merged;
    }
  } catch (_) {
    plans = fallbackPlans;
  }

  try {
    const { data, error } = await supabase
      .from('pricing_settings')
      .select('id,usd_to_mmk_rate,default_profit_multiplier')
      .eq('id', 1)
      .maybeSingle();

    if (!error && data) {
      settings = {
        id: 1,
        usd_to_mmk_rate: Number(data.usd_to_mmk_rate ?? fallbackSettings.usd_to_mmk_rate),
        default_profit_multiplier: Number(data.default_profit_multiplier ?? fallbackSettings.default_profit_multiplier),
      };
    }
  } catch (_) {
    settings = fallbackSettings;
  }

  return {
    plans,
    settings,
    planById: Object.fromEntries(plans.map(plan => [plan.id, plan])),
    planByLevel: Object.fromEntries(plans.map(plan => [plan.plan_level, plan])),
  };
}
