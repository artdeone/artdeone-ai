require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk').default;

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index: 'index.html'
}));

// ── Supabase (service role for server-side operations) ──
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── AI Clients ──
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ATTACHMENT_BUCKET = 'chat-attachments';
const ATTACHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ATTACHMENT_CLEANUP_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const attachmentCleanupState = new Map();

// ── Model → Provider mapping ──
const MODEL_CONFIG = {
  // Free (Groq)
  'llama-3.3-70b-versatile': { provider: 'groq', planRequired: 0 },
  'qwen/qwen3-32b': { provider: 'groq', planRequired: 0 },
  'meta-llama/llama-4-scout-17b-16e-instruct': { provider: 'groq', planRequired: 0 },
  // Student (OpenAI)
  'gpt-4.1-nano': { provider: 'openai', planRequired: 1 },
  // Pro (OpenAI + Anthropic)
  'gpt-4.1': { provider: 'openai', planRequired: 2 },
  'claude-haiku-4.5': { provider: 'anthropic', planRequired: 2, anthropicModel: 'claude-haiku-4-5-20241022' },
  // Premium (GPT-5.4 + Claude Sonnet)
  'gpt-5.4': { provider: 'openai', planRequired: 3 },
  'claude-sonnet-4.6': { provider: 'anthropic', planRequired: 3, anthropicModel: 'claude-sonnet-4-20250514' },
  // Ultra (GPT-5.4 Pro + Claude Opus)
  'gpt-5.4-pro': { provider: 'openai', planRequired: 4 },
  'claude-opus-4.6': { provider: 'anthropic', planRequired: 4, anthropicModel: 'claude-opus-4-20250514' },
};

// ── Plan config fallback + cache ──
const DEFAULT_PLAN_CONFIG = {
  0: { id: 'free', name: 'Free', daily_messages: 30, max_upload_files: 1 },
  1: { id: 'student', name: 'Student', daily_messages: 30, max_upload_files: 2 },
  2: { id: 'pro', name: 'Pro', daily_messages: 8, max_upload_files: 3 },
  3: { id: 'premium', name: 'Premium', daily_messages: 12, max_upload_files: 5 },
  4: { id: 'ultra', name: 'Ultra', daily_messages: 4, max_upload_files: null },
};

let planConfigCache = {
  expiresAt: 0,
  byLevel: DEFAULT_PLAN_CONFIG,
};

async function getPlanConfigMap() {
  if (Date.now() < planConfigCache.expiresAt) {
    return planConfigCache.byLevel;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('plans')
      .select('id,name,plan_level,daily_messages,max_upload_files,is_active');

    if (error) throw error;

    if (Array.isArray(data) && data.length > 0) {
      const merged = { ...DEFAULT_PLAN_CONFIG };
      data.forEach(plan => {
        if (typeof plan.plan_level !== 'number') return;
        merged[plan.plan_level] = {
          id: plan.id || merged[plan.plan_level]?.id,
          name: plan.name || merged[plan.plan_level]?.name || 'Plan',
          daily_messages: Number(plan.daily_messages ?? merged[plan.plan_level]?.daily_messages ?? 30),
          max_upload_files: plan.max_upload_files === null || plan.max_upload_files === undefined
            ? null
            : Number(plan.max_upload_files),
          is_active: plan.is_active ?? true,
        };
      });
      planConfigCache = {
        expiresAt: Date.now() + 60_000,
        byLevel: merged,
      };
      return merged;
    }
  } catch (error) {
    console.error('Error loading plan config:', error.message);
  }

  planConfigCache = {
    expiresAt: Date.now() + 15_000,
    byLevel: DEFAULT_PLAN_CONFIG,
  };
  return DEFAULT_PLAN_CONFIG;
}

function getPlanConfig(level, configMap) {
  return configMap[level] || DEFAULT_PLAN_CONFIG[level] || DEFAULT_PLAN_CONFIG[0];
}

function parseAttachmentCreatedAt(file) {
  const dateValue = file?.created_at || file?.updated_at || file?.last_accessed_at;
  const parsedDate = dateValue ? Date.parse(dateValue) : NaN;
  if (Number.isFinite(parsedDate)) return parsedDate;

  const nameMatch = String(file?.name || '').match(/^(\d{13})_/);
  if (nameMatch) return Number(nameMatch[1]);

  return NaN;
}

async function listAttachmentFiles(userId) {
  const files = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from(ATTACHMENT_BUCKET)
      .list(userId, { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } });

    if (error) {
      // Empty folders can surface as storage errors depending on environment.
      if (/not found|does not exist/i.test(error.message || '')) return files;
      throw error;
    }

    const page = Array.isArray(data) ? data.filter(item => item && item.name) : [];
    files.push(...page);

    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return files;
}

async function cleanupExpiredAttachmentsForUser(userId, { force = false } = {}) {
  const now = Date.now();
  const lastRun = attachmentCleanupState.get(userId) || 0;
  if (!force && now - lastRun < ATTACHMENT_CLEANUP_COOLDOWN_MS) {
    return { skipped: true, removedCount: 0 };
  }

  attachmentCleanupState.set(userId, now);

  const files = await listAttachmentFiles(userId);
  const expiredPaths = files
    .filter(file => {
      const createdAt = parseAttachmentCreatedAt(file);
      return Number.isFinite(createdAt) && now - createdAt > ATTACHMENT_TTL_MS;
    })
    .map(file => `${userId}/${file.name}`);

  if (expiredPaths.length === 0) {
    return { skipped: false, removedCount: 0 };
  }

  const { error } = await supabaseAdmin.storage
    .from(ATTACHMENT_BUCKET)
    .remove(expiredPaths);

  if (error) throw error;

  return { skipped: false, removedCount: expiredPaths.length };
}

// ── Auth middleware — verify Supabase JWT ──
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    req.planLevel = parseInt(user.user_metadata?.plan_level || '0', 10);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

// ── Admin auth middleware ──
async function adminAuthMiddleware(req, res, next) {
  try {
    const adminIds = process.env.ADMIN_USER_IDS?.split(',') || [];
    let isAdmin = adminIds.includes(req.user.id);
    
    console.log('[AdminCheck] User ID:', req.user.id);
    console.log('[AdminCheck] In ENV?:', isAdmin);

    // Check if user is in 'admins' table
    if (!isAdmin) {
      const { data, error } = await supabaseAdmin
        .from('admins')
        .select('user_id')
        .eq('user_id', req.user.id)
        .maybeSingle();
      
      console.log('[AdminCheck] Supabase Data:', data, 'Error:', error);
      if (data) isAdmin = true;
    }

    if (!isAdmin) {
      console.log('[AdminCheck] FAILED - returning 403');
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    console.log('[AdminCheck] SUCCESS');
    next();
  } catch (err) {
    console.error('[AdminCheck] Middleware Exception:', err);
    return res.status(500).json({ error: 'Admin authorization failed' });
  }
}

// ── Get today's usage count (server-side) ──
async function getDailyUsage(userId) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const { data, error } = await supabaseAdmin
    .from('daily_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('usage_date', today)
    .maybeSingle();

  if (error) {
    console.error('Error fetching daily usage:', error);
    return 0;
  }
  return data?.count || 0;
}

// ── Increment daily usage ──
async function incrementDailyUsage(userId) {
  const today = new Date().toISOString().slice(0, 10);
  // Upsert: insert or increment
  const { error } = await supabaseAdmin.rpc('increment_daily_usage', {
    p_user_id: userId,
    p_date: today
  });
  if (error) {
    console.error('Error incrementing usage:', error);
    // Fallback: try direct upsert
    const current = await getDailyUsage(userId);
    await supabaseAdmin
      .from('daily_usage')
      .upsert({
        user_id: userId,
        usage_date: today,
        count: current + 1
      }, { onConflict: 'user_id,usage_date' });
  }
}

// ══════════════════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════════════════

// ── POST /api/ai-chat — Main chat endpoint ──
app.post('/api/ai-chat', authMiddleware, async (req, res) => {
  try {
    const { model, messages } = req.body;
    const userId = req.user.id;
    const planLevel = req.planLevel;
    const planConfigMap = await getPlanConfigMap();

    cleanupExpiredAttachmentsForUser(userId).catch(error => {
      console.error('Attachment cleanup error:', error.message);
    });

    // Validate model
    const config = MODEL_CONFIG[model];
    if (!config) {
      return res.status(400).json({ error: 'Invalid model selected' });
    }

    // Check plan access
    if (config.planRequired > planLevel) {
      const requiredPlan = getPlanConfig(config.planRequired, planConfigMap);
      return res.status(403).json({
        error: `This model requires the ${requiredPlan.name || 'higher'} plan or above`
      });
    }

    // Check daily usage for ALL models
    const usage = await getDailyUsage(userId);
    const activePlan = getPlanConfig(planLevel, planConfigMap);
    const limit = Number(activePlan.daily_messages ?? 30);
    if (Number.isFinite(limit) && usage >= limit) {
      return res.status(429).json({
        error: 'Daily message limit reached. Your limit resets at midnight.',
        usage, limit
      });
    }

    // Validate messages
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    let reply = '';

    // ── Route to provider ──
    if (config.provider === 'groq') {
      const completion = await groq.chat.completions.create({
        model: model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: 0.7,
        max_tokens: 4096,
      });
      reply = completion.choices[0]?.message?.content || '';

    } else if (config.provider === 'openai') {
      const completion = await openai.chat.completions.create({
        model: model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: 0.7,
        max_tokens: 4096,
      });
      reply = completion.choices[0]?.message?.content || '';

    } else if (config.provider === 'anthropic') {
      // Anthropic uses a different format
      const anthropicModel = config.anthropicModel || model;

      // Separate system message if present
      const systemMsg = messages.find(m => m.role === 'system');
      const chatMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }));

      const params = {
        model: anthropicModel,
        max_tokens: 4096,
        messages: chatMessages,
      };
      if (systemMsg) {
        params.system = systemMsg.content;
      }

      const response = await anthropic.messages.create(params);
      reply = response.content[0]?.text || '';
    }

    // Increment usage for ALL models (free + paid)
    await incrementDailyUsage(userId);

    // Log usage (non-blocking, fire and forget)
    supabaseAdmin.from('usage_logs').insert({
      user_id: userId,
      model: model,
      plan_level: planLevel,
      tokens_approx: reply.length,
    }).then(() => { }).catch(() => { });

    res.json({ reply });

  } catch (err) {
    console.error('AI Chat Error:', err);
    res.status(500).json({
      error: err.message || 'Failed to get AI response'
    });
  }
});

// ── GET /api/usage — Get current daily usage ──
app.get('/api/usage', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const planLevel = req.planLevel;
    const planConfigMap = await getPlanConfigMap();

    cleanupExpiredAttachmentsForUser(userId).catch(error => {
      console.error('Attachment cleanup error:', error.message);
    });

    const usage = await getDailyUsage(userId);
    const activePlan = getPlanConfig(planLevel, planConfigMap);
    const limit = Number(activePlan.daily_messages ?? 30);

    res.json({
      used: usage,
      limit: limit,
      planLevel: planLevel,
      planName: activePlan.name || 'Free',
      remaining: Math.max(0, limit - usage),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

// ── POST /api/attachments/cleanup — Delete old uploaded files ──
app.post('/api/attachments/cleanup', authMiddleware, async (req, res) => {
  try {
    const result = await cleanupExpiredAttachmentsForUser(req.user.id, { force: true });
    res.json({
      success: true,
      removedCount: result.removedCount || 0,
      ttlDays: 7,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to clean attachments' });
  }
});

// ── POST /api/admin/upgrade — Admin: upgrade user plan ──
app.post('/api/admin/upgrade', authMiddleware, adminAuthMiddleware, async (req, res) => {
  try {
    const { targetUserId, planLevel } = req.body;
    if (!targetUserId || planLevel === undefined) {
      return res.status(400).json({ error: 'targetUserId and planLevel are required' });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      user_metadata: { plan_level: planLevel }
    });

    if (error) throw error;

    // Also record in subscriptions table
    await supabaseAdmin.from('subscriptions').upsert({
      user_id: targetUserId,
      plan_level: planLevel,
      plan_name: ['Free', 'Student', 'Pro', 'Premium', 'Ultra'][planLevel] || 'Free',
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      status: 'active',
    }, { onConflict: 'user_id' });

    res.json({ success: true, message: `User upgraded to plan level ${planLevel}` });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to upgrade user' });
  }
});

// ── POST /api/payment/submit — Submit a payment order ──
app.post('/api/payment/submit', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { plan_id, payment_method, screenshot_url } = req.body;

    // Validate payment_method
    const validMethods = ['kbzpay', 'ayapay', 'uabpay', 'wavepay'];
    if (!validMethods.includes(payment_method)) {
      return res.status(400).json({ error: `Invalid payment method. Must be one of: ${validMethods.join(', ')}` });
    }

    // Validate plan_id exists
    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .select('id, plan_level, price_ks, name')
      .eq('id', plan_id)
      .maybeSingle();

    if (planError || !plan) {
      return res.status(400).json({ error: 'Invalid plan_id' });
    }

    // Check for existing pending order
    const { data: pendingOrder } = await supabaseAdmin
      .from('payment_orders')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();

    if (pendingOrder) {
      return res.status(409).json({ error: 'You already have a pending payment order. Please wait for it to be reviewed.' });
    }

    // Insert payment order
    const { data: order, error: insertError } = await supabaseAdmin
      .from('payment_orders')
      .insert({
        user_id: userId,
        plan_id: plan.id,
        plan_level: plan.plan_level,
        amount_ks: plan.price_ks,
        payment_method,
        screenshot_url: screenshot_url || null,
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) throw insertError;

    res.json({ success: true, order });
  } catch (err) {
    console.error('Payment submit error:', err);
    res.status(500).json({ error: err.message || 'Failed to submit payment' });
  }
});

// ── GET /api/payment/my-orders — Get current user's payment orders ──
app.get('/api/payment/my-orders', authMiddleware, async (req, res) => {
  try {
    const { data: orders, error } = await supabaseAdmin
      .from('payment_orders')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch orders' });
  }
});

// ── GET /api/admin/payment-orders — Admin: list all payment orders ──
app.get('/api/admin/payment-orders', authMiddleware, adminAuthMiddleware, async (req, res) => {
  try {
    let query = supabaseAdmin
      .from('payment_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (req.query.status) {
      query = query.eq('status', req.query.status);
    }

    const { data: orders, error } = await query;
    if (error) throw error;

    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch payment orders' });
  }
});

// ── POST /api/admin/payment/approve — Admin: approve a payment order ──
app.post('/api/admin/payment/approve', authMiddleware, adminAuthMiddleware, async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) {
      return res.status(400).json({ error: 'order_id is required' });
    }

    // Fetch the order
    const { data: order, error: fetchError } = await supabaseAdmin
      .from('payment_orders')
      .select('*')
      .eq('id', order_id)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ error: `Order is already ${order.status}` });
    }

    // Update order status
    console.log('[AdminApprove] Order ID:', order_id, 'User ID:', order.user_id, 'Plan Level:', order.plan_level);
    
    const { error: updateError } = await supabaseAdmin
      .from('payment_orders')
      .update({
        status: 'approved',
        reviewed_by: req.user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', order_id);

    if (updateError) {
      console.error('[AdminApprove] updateError:', updateError);
      throw updateError;
    }

    // Upgrade user plan
    console.log('[AdminApprove] Updating user metadata...');
    const { error: userError } = await supabaseAdmin.auth.admin.updateUserById(order.user_id, {
      user_metadata: { plan_level: order.plan_level }
    });

    if (userError) {
      console.error('[AdminApprove] userError:', userError);
      throw userError;
    }
    console.log('[AdminApprove] User metadata updated successfully.');

    // Upsert subscription with 30-day expiry
    console.log('[AdminApprove] Upserting subscription...');
    const { error: subError } = await supabaseAdmin.from('subscriptions').upsert({
      user_id: order.user_id,
      plan_id: order.plan_id,
      plan_level: order.plan_level,
      plan_name: ['Free', 'Student', 'Pro', 'Premium', 'Ultra'][order.plan_level] || 'Free',
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      payment_order_id: order_id,
    }, { onConflict: 'user_id' });
    
    if (subError) {
      console.error('[AdminApprove] subError:', subError);
      throw subError;
    }
    console.log('[AdminApprove] Subscription upserted successfully.');

    res.json({ success: true });
  } catch (err) {
    console.error('Payment approve error:', err);
    res.status(500).json({ error: err.message || 'Failed to approve payment' });
  }
});

// ── POST /api/admin/payment/reject — Admin: reject a payment order ──
app.post('/api/admin/payment/reject', authMiddleware, adminAuthMiddleware, async (req, res) => {
  try {
    const { order_id, admin_note } = req.body;
    if (!order_id) {
      return res.status(400).json({ error: 'order_id is required' });
    }

    const { error } = await supabaseAdmin
      .from('payment_orders')
      .update({
        status: 'rejected',
        reviewed_by: req.user.id,
        reviewed_at: new Date().toISOString(),
        admin_note: admin_note || null,
      })
      .eq('id', order_id)
      .eq('status', 'pending');

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to reject payment' });
  }
});

// ── POST /api/payment/upload-screenshot — Upload payment screenshot ──
app.post('/api/payment/upload-screenshot', authMiddleware, async (req, res) => {
  try {
    const { image_base64, file_name } = req.body;
    if (!image_base64 || !file_name) {
      return res.status(400).json({ error: 'image_base64 and file_name are required' });
    }

    const buffer = Buffer.from(image_base64, 'base64');
    const filePath = `${req.user.id}/${Date.now()}_${file_name}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('payment-screenshots')
      .upload(filePath, buffer, {
        contentType: 'image/png',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabaseAdmin.storage
      .from('payment-screenshots')
      .getPublicUrl(filePath);

    res.json({ url: urlData.publicUrl });
  } catch (err) {
    console.error('Screenshot upload error:', err);
    res.status(500).json({ error: err.message || 'Failed to upload screenshot' });
  }
});

// ── GET /api/subscription/check — Check and enforce subscription expiry ──
app.get('/api/subscription/check', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: sub, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (sub && sub.status === 'active' && sub.expires_at && new Date(sub.expires_at) < new Date()) {
      // Subscription expired — downgrade
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { plan_level: 0 }
      });

      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'expired', plan_level: 0 })
        .eq('user_id', userId);

      return res.json({
        status: 'expired',
        message: 'Your subscription has expired. You have been downgraded to the Free plan.',
      });
    }

    res.json({
      status: sub?.status || 'none',
      plan_level: sub?.plan_level ?? 0,
      expires_at: sub?.expires_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to check subscription' });
  }
});

// ── POST /api/cron/check-expirations — Cron: expire subscriptions ──
app.post('/api/cron/check-expirations', async (req, res) => {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const provided = req.headers['x-cron-secret'] || req.body.cron_secret;
    if (!cronSecret || provided !== cronSecret) {
      return res.status(401).json({ error: 'Invalid or missing cron secret' });
    }

    const now = new Date().toISOString();

    const { data: expiredSubs, error } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id, plan_level')
      .eq('status', 'active')
      .lt('expires_at', now);

    if (error) throw error;

    let expiredCount = 0;
    for (const sub of expiredSubs || []) {
      await supabaseAdmin.auth.admin.updateUserById(sub.user_id, {
        user_metadata: { plan_level: 0 }
      });

      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'expired', plan_level: 0 })
        .eq('user_id', sub.user_id);

      expiredCount++;
    }

    res.json({ success: true, expired_count: expiredCount });
  } catch (err) {
    console.error('Cron expiration check error:', err);
    res.status(500).json({ error: err.message || 'Failed to check expirations' });
  }
});

// ── Catch-all: serve HTML files (Express 5) ──
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start server ──
app.listen(PORT, () => {
  console.log(`\n  🚀 ADO AI Server running at http://localhost:${PORT}\n`);
});
