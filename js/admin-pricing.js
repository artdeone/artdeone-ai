import { supabase } from './supabase.js';
import { loadPricingConfig, formatKs } from './plan-config.js';
import { requireAdminAuth, getAdminSession } from './admin-auth.js';

const statusEl = document.getElementById('adminStatus');
const gateEl = document.getElementById('adminGate');
const appEl = document.getElementById('adminApp');
const plansForm = document.getElementById('plansForm');
const settingsForm = document.getElementById('settingsForm');
const saveBtn = document.getElementById('savePricingBtn');
const reloadBtn = document.getElementById('reloadPricingBtn');
const adminEmailEl = document.getElementById('adminEmail');
const adminUserIdEl = document.getElementById('adminUserId');
const CALCULATOR_STORAGE_KEY = 'adoai-suggested-price-costs-v1';
const DEFAULT_SUGGESTED_COSTS = {
  free: 0,
  student: 2.8,
  pro: 22.2,
  premium: 49.4,
  ultra: 222.2,
};

function loadSuggestedCostState() {
  try {
    const raw = window.localStorage.getItem(CALCULATOR_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch (_) {
    return {};
  }
}

let suggestedCostState = loadSuggestedCostState();

function setStatus(message, tone = 'muted') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function showApp(show) {
  if (gateEl) gateEl.style.display = show ? 'none' : '';
  if (appEl) appEl.style.display = show ? 'block' : 'none';
}

function formatKsValue(value, digits = 0) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0));
}

function roundSuggestedPrice(value) {
  if (value <= 0) return 0;
  return Math.ceil(value / 500) * 500;
}

function saveSuggestedCostState() {
  try {
    window.localStorage.setItem(CALCULATOR_STORAGE_KEY, JSON.stringify(suggestedCostState));
  } catch (_) { }
}

function getProfitMultiplier() {
  return Number(settingsForm?.querySelector('input[name="default_profit_multiplier"]')?.value || 1.5);
}

function calculateSuggestedPrice(dailyMessages, estimatedCostPerMessage, multiplier) {
  const daily = Number(dailyMessages || 0);
  const costPerMessage = Number(estimatedCostPerMessage || 0);
  const profitMultiplier = Number(multiplier || 1);
  return roundSuggestedPrice(daily * 30 * costPerMessage * profitMultiplier);
}

function updatePlanCalculator(section) {
  if (!section) return;

  const priceInput = section.querySelector('input[name="price_ks"]');
  const dailyInput = section.querySelector('input[name="daily_messages"]');
  const estimatedCostInput = section.querySelector('input[name="estimated_cost_per_msg"]');
  const currentPriceNoteEl = section.querySelector('[data-current-price-note]');
  const currentMsgEl = section.querySelector('[data-current-ks-per-msg]');
  const targetMsgEl = section.querySelector('[data-target-ks-per-msg]');
  const suggestedPriceEl = section.querySelector('[data-suggested-price]');
  const deltaEl = section.querySelector('[data-price-delta]');

  const price = Number(priceInput?.value || 0);
  const dailyMessages = Number(dailyInput?.value || 0);
  const estimatedCostPerMessage = Number(estimatedCostInput?.value || 0);
  const multiplier = getProfitMultiplier();
  const currentKsPerMessage = price > 0 && dailyMessages > 0 ? price / (dailyMessages * 30) : 0;
  const targetKsPerMessage = estimatedCostPerMessage * multiplier;
  const suggestedPrice = calculateSuggestedPrice(dailyMessages, estimatedCostPerMessage, multiplier);
  const delta = suggestedPrice - price;

  if (currentPriceNoteEl) {
    currentPriceNoteEl.textContent = `Current display price: ${formatKs(price)} Ks`;
  }
  if (currentMsgEl) {
    currentMsgEl.textContent = dailyMessages > 0
      ? `${formatKsValue(currentKsPerMessage, currentKsPerMessage >= 100 ? 0 : 1)} Ks`
      : '0 Ks';
  }
  if (targetMsgEl) {
    targetMsgEl.textContent = `${formatKsValue(targetKsPerMessage, targetKsPerMessage >= 100 ? 0 : 1)} Ks`;
  }
  if (suggestedPriceEl) {
    suggestedPriceEl.textContent = `${formatKs(suggestedPrice)} Ks`;
  }
  if (deltaEl) {
    const sign = delta > 0 ? '+' : '';
    deltaEl.textContent = `${sign}${formatKs(delta)} Ks`;
  }
}

function updateAllPlanCalculators() {
  document.querySelectorAll('.plan-editor').forEach(updatePlanCalculator);
}

async function requireAdmin() {
  const logoutBtn = document.getElementById('adminLogoutBtn');

  function setupLogout() {
    if (logoutBtn) {
      logoutBtn.style.display = '';
      logoutBtn.onclick = () => { clearAdminSession(); location.reload(); };
    }
    const navBtn = document.getElementById('navToPaymentsBtn');
    if (navBtn) navBtn.style.display = 'inline-flex';
  }

  const email = await requireAdminAuth({
    gateEl,
    appEl,
    onLogin: async (adminEmail) => {
      if (adminEmailEl) adminEmailEl.textContent = adminEmail;
      if (adminUserIdEl) adminUserIdEl.textContent = 'admin_auth';
      setupLogout();
      showApp(true);
      await loadScreen();
    },
  });

  if (!email) {
    throw new Error('Awaiting admin login');
  }

  if (adminEmailEl) adminEmailEl.textContent = email;
  if (adminUserIdEl) adminUserIdEl.textContent = 'admin_auth';
  setupLogout();

  showApp(true);
}

function renderPlans(plans) {
  if (!plansForm) return;
  plansForm.innerHTML = plans.map(plan => `
    <section class="plan-editor" data-plan-id="${plan.id}">
      <div class="plan-editor-head">
        <h3>${plan.name}</h3>
        <span class="plan-meta">Plan level ${plan.plan_level}</span>
      </div>
      <label>
        <span>Price (Kyats)</span>
        <input type="number" min="0" step="100" name="price_ks" data-plan-id="${plan.id}" value="${plan.price_ks}">
      </label>
      <label>
        <span>Daily messages</span>
        <input type="number" min="0" step="1" name="daily_messages" data-plan-id="${plan.id}" value="${plan.daily_messages}">
      </label>
      <label>
        <span>Max upload files</span>
        <input type="number" min="0" step="1" name="max_upload_files" data-plan-id="${plan.id}" value="${plan.max_upload_files ?? ''}" placeholder="Leave blank for unlimited">
      </label>
      <label>
        <span>Estimated blended cost / msg (Ks)</span>
        <input type="number" min="0" step="0.1" name="estimated_cost_per_msg" data-plan-id="${plan.id}" value="${suggestedCostState[plan.id] ?? DEFAULT_SUGGESTED_COSTS[plan.id] ?? 0}">
      </label>
      <label class="checkbox-row">
        <input type="checkbox" name="is_active" data-plan-id="${plan.id}" ${plan.is_active ? 'checked' : ''}>
        <span>Plan active</span>
      </label>
      <div class="plan-note" data-current-price-note>Current display price: ${formatKs(plan.price_ks)} Ks</div>
      <div class="suggested-box">
        <div class="suggested-title">Suggested Price Calculator</div>
        <div class="suggested-grid">
          <div class="suggested-stat">
            <span class="suggested-stat-label">Current Ks / Msg</span>
            <span class="suggested-stat-value" data-current-ks-per-msg>0 Ks</span>
          </div>
          <div class="suggested-stat">
            <span class="suggested-stat-label">Target Sell / Msg</span>
            <span class="suggested-stat-value" data-target-ks-per-msg>0 Ks</span>
          </div>
          <div class="suggested-stat">
            <span class="suggested-stat-label">Suggested Monthly Price</span>
            <span class="suggested-stat-value" data-suggested-price>0 Ks</span>
          </div>
          <div class="suggested-stat">
            <span class="suggested-stat-label">Delta vs Current</span>
            <span class="suggested-stat-value" data-price-delta>0 Ks</span>
          </div>
        </div>
        <button type="button" class="use-suggested-btn" data-use-suggested>Use Suggested Price</button>
      </div>
    </section>
  `).join('');
}

function renderSettings(settings) {
  if (!settingsForm) return;
  settingsForm.innerHTML = `
    <label>
      <span>USD to MMK reference rate</span>
      <input type="number" min="1" step="1" name="usd_to_mmk_rate" value="${settings.usd_to_mmk_rate}">
    </label>
    <label>
      <span>Default profit multiplier</span>
      <input type="number" min="1" step="0.01" name="default_profit_multiplier" value="${settings.default_profit_multiplier}">
    </label>
  `;
}

async function loadScreen() {
  setStatus('Loading pricing data...');
  const config = await loadPricingConfig(supabase);
  renderPlans(config.plans);
  renderSettings(config.settings);
  updateAllPlanCalculators();
  setStatus('Pricing loaded. Change values and press Save.', 'success');
}

async function savePricing() {
  if (!saveBtn) return;
  saveBtn.disabled = true;
  setStatus('Saving pricing changes...');

  try {
    const planSections = Array.from(document.querySelectorAll('.plan-editor'));
    const planPayload = planSections.map(section => {
      const priceInput = section.querySelector('input[name="price_ks"]');
      const dailyInput = section.querySelector('input[name="daily_messages"]');
      const uploadInput = section.querySelector('input[name="max_upload_files"]');
      const activeInput = section.querySelector('input[name="is_active"]');
      const planId = priceInput.dataset.planId;
      const planName = section.querySelector('h3').textContent.trim();
      const planLevel = Number(section.querySelector('.plan-meta').textContent.replace(/\D+/g, ''));

      return {
        id: planId,
        name: planName,
        plan_level: planLevel,
        price_ks: Number(priceInput.value || 0),
        daily_messages: Number(dailyInput.value || 0),
        max_upload_files: uploadInput.value === '' ? null : Number(uploadInput.value),
        is_active: !!activeInput.checked,
      };
    });

    const settingsPayload = {
      id: 1,
      usd_to_mmk_rate: Number(settingsForm.querySelector('input[name="usd_to_mmk_rate"]').value || 5000),
      default_profit_multiplier: Number(settingsForm.querySelector('input[name="default_profit_multiplier"]').value || 1.5),
    };

    const { error: plansError } = await supabase
      .from('plans')
      .upsert(planPayload, { onConflict: 'id' });
    if (plansError) throw plansError;

    const { error: settingsError } = await supabase
      .from('pricing_settings')
      .upsert(settingsPayload, { onConflict: 'id' });
    if (settingsError) throw settingsError;

    setStatus('Pricing updated successfully.', 'success');
    await loadScreen();
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Failed to save pricing.', 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

saveBtn?.addEventListener('click', savePricing);
reloadBtn?.addEventListener('click', loadScreen);
plansForm?.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.name === 'estimated_cost_per_msg' && target.dataset.planId) {
    suggestedCostState[target.dataset.planId] = Number(target.value || 0);
    saveSuggestedCostState();
  }

  const section = target.closest('.plan-editor');
  if (section) updatePlanCalculator(section);
});

settingsForm?.addEventListener('input', () => {
  updateAllPlanCalculators();
});

plansForm?.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const button = target.closest('[data-use-suggested]');
  if (!button) return;

  const section = button.closest('.plan-editor');
  if (!section) return;

  const dailyInput = section.querySelector('input[name="daily_messages"]');
  const estimatedCostInput = section.querySelector('input[name="estimated_cost_per_msg"]');
  const priceInput = section.querySelector('input[name="price_ks"]');
  if (!(dailyInput instanceof HTMLInputElement) || !(estimatedCostInput instanceof HTMLInputElement) || !(priceInput instanceof HTMLInputElement)) return;

  const suggestedPrice = calculateSuggestedPrice(
    Number(dailyInput.value || 0),
    Number(estimatedCostInput.value || 0),
    getProfitMultiplier()
  );

  priceInput.value = String(suggestedPrice);
  updatePlanCalculator(section);
});

try {
  await requireAdmin();
  await loadScreen();
} catch (_) {
  // Gate / status already handled above.
}
