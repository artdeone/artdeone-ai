import { supabase } from './supabase.js';
import { loadPricingConfig, formatKs } from './plan-config.js';

function setText(selector, value) {
  document.querySelectorAll(selector).forEach(el => {
    el.textContent = value;
  });
}

function formatPerMessage(priceKs, dailyMessages) {
  const daily = Number(dailyMessages || 0);
  const price = Number(priceKs || 0);
  if (price <= 0 || daily <= 0) return 'Capped free access';

  const perMessage = price / (daily * 30);
  const rounded = perMessage >= 100
    ? Math.round(perMessage)
    : Math.round(perMessage * 10) / 10;

  return `~${formatKs(rounded)} ks / msg cap`;
}

function updatePlanCard(plan) {
  const card = document.querySelector(`[data-plan-card="${plan.id}"]`);
  if (!card) return;

  const priceEl = card.querySelector('[data-plan-price-value]');
  const dailyEl = card.querySelector('[data-plan-daily-label]');
  const priceUnitEl = card.querySelector(`[data-plan-price-unit="${plan.id}"]`);
  const msgCostEl = card.querySelector(`[data-plan-msg-cost="${plan.id}"]`);

  if (priceEl) priceEl.textContent = formatKs(plan.price_ks);
  if (dailyEl) dailyEl.textContent = `${plan.daily_messages} messages / day`;
  if (priceUnitEl) priceUnitEl.textContent = `/ month · ${formatPerMessage(plan.price_ks, plan.daily_messages)}`;
  if (msgCostEl) msgCostEl.textContent = formatPerMessage(plan.price_ks, plan.daily_messages);
}

async function boot() {
  const { plans } = await loadPricingConfig(supabase);
  plans.forEach(plan => {
    updatePlanCard(plan);
    setText(`[data-comp-price="${plan.id}"]`, `${formatKs(plan.price_ks)} ks`);
    setText(`[data-comp-daily="${plan.id}"]`, String(plan.daily_messages));
  });
}

boot();
