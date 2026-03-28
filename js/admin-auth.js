/**
 * Shared Admin Authentication Module
 * Uses Supabase admin_auth table with hashed passwords.
 * Stores session in sessionStorage (clears on tab/browser close).
 */
import { supabase } from './supabase.js';

const SESSION_KEY = 'adoai-admin-session';

/* ── Session helpers ── */
export function getAdminSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAdminSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function saveAdminSession(email) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    email,
    loginAt: Date.now(),
  }));
}

/* ── Login verification via RPC ── */
async function verifyLogin(email, password) {
  const { data, error } = await supabase.rpc('verify_admin_login', {
    p_email: email,
    p_password: password,
  });

  if (error) throw new Error(error.message || 'Verification failed');
  return !!data;
}

/* ── Render login form into a container ── */
function renderLoginForm(container) {
  container.innerHTML = `
    <h2 style="font-family:'Instrument Serif',serif;font-size:28px;margin:0 0 8px;">Admin Login</h2>
    <p style="color:var(--text-sub);font-size:14px;margin:0 0 24px;line-height:1.6;">
      Secure admin access required. Enter your admin credentials to continue.
    </p>
    <form id="adminLoginForm" autocomplete="off" style="display:flex;flex-direction:column;gap:14px;">
      <label style="display:flex;flex-direction:column;gap:7px;font-size:13px;color:var(--text-sub);margin:0;">
        Email
        <input type="email" id="adminLoginEmail" required placeholder="admin@example.com"
          style="width:100%;border:1px solid var(--border);border-radius:12px;background:var(--bg-alt);color:var(--text);padding:12px 14px;font:inherit;">
      </label>
      <label style="display:flex;flex-direction:column;gap:7px;font-size:13px;color:var(--text-sub);margin:0;">
        Password
        <input type="password" id="adminLoginPassword" required placeholder="••••••••"
          style="width:100%;border:1px solid var(--border);border-radius:12px;background:var(--bg-alt);color:var(--text);padding:12px 14px;font:inherit;">
      </label>
      <div id="adminLoginError" style="display:none;color:#f87171;font-size:13px;padding:8px 12px;border-radius:10px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.18);"></div>
      <button type="submit" id="adminLoginBtn"
        style="margin-top:6px;border:none;border-radius:999px;padding:13px 24px;font:inherit;font-weight:700;cursor:pointer;background:var(--accent,#a7e169);color:#11170a;font-size:15px;transition:background .2s;">
        Sign In
      </button>
    </form>
  `;
}

/**
 * Main entry: check admin session, show login form if needed.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.gateEl   - The gate/login container element
 * @param {HTMLElement} opts.appEl    - The main app content element
 * @param {Function}    opts.onLogin  - Callback after successful login (receives email)
 * @returns {Promise<string|null>}    - Admin email if already logged in, null if showing login form
 */
export async function requireAdminAuth({ gateEl, appEl, onLogin }) {
  const session = getAdminSession();

  if (session && session.email) {
    // Already logged in — show app
    if (gateEl) gateEl.style.display = 'none';
    if (appEl) appEl.style.display = 'block';
    if (onLogin) onLogin(session.email);
    return session.email;
  }

  // Not logged in — show login form
  if (gateEl) {
    gateEl.style.display = '';
    renderLoginForm(gateEl);
  }
  if (appEl) appEl.style.display = 'none';

  // Attach form handler
  const form = document.getElementById('adminLoginForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const emailInput = document.getElementById('adminLoginEmail');
      const passwordInput = document.getElementById('adminLoginPassword');
      const errorEl = document.getElementById('adminLoginError');
      const btn = document.getElementById('adminLoginBtn');

      const email = emailInput?.value?.trim();
      const password = passwordInput?.value;

      if (!email || !password) return;

      btn.disabled = true;
      btn.textContent = 'Verifying...';
      if (errorEl) errorEl.style.display = 'none';

      try {
        const ok = await verifyLogin(email, password);
        if (!ok) {
          throw new Error('Invalid email or password');
        }

        saveAdminSession(email);

        // Show app
        if (gateEl) gateEl.style.display = 'none';
        if (appEl) appEl.style.display = 'block';
        if (onLogin) onLogin(email);
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message || 'Login failed';
          errorEl.style.display = 'block';
        }
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });
  }

  return null;
}
