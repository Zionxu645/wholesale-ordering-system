'use strict';

try {
  require('dotenv').config();
} catch (_) {
  // Render 直接使用系统环境变量；本地未安装 dotenv 时也不阻止启动。
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const IMAGE_BUCKET = process.env.SUPABASE_IMAGE_BUCKET || 'product-images';
const ORDER_STATUSES = ['pending', 'confirmed', 'production', 'shipping', 'delivered', 'cancelled'];
const INQUIRY_STATUSES = ['pending', 'contacted', 'quoted', 'considering', 'converted', 'lost'];
const APP_VERSION = '3.1.0';
const BUSINESS_TIME_ZONE = 'Asia/Shanghai';
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const ORDER_STATUS_LABELS = Object.freeze({
  pending: '待确认',
  confirmed: '已确认',
  production: '生产中',
  shipping: '发货中',
  delivered: '已送达',
  cancelled: '已取消',
});

let supabase = null;
let supabaseInitError = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (error) {
    supabaseInitError = error;
    console.error('[CONFIG] Supabase 初始化失败:', error.message);
  }
}

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('该来源不允许跨域访问'));
  },
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const imageUploadParser = express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp'],
  limit: '8mb',
});

function ok(res, data = null, message = '') {
  return res.json({ code: 0, data, ...(message ? { message } : {}) });
}

function fail(res, status, message, details) {
  return res.status(status).json({ code: 1, message, ...(details ? { details } : {}) });
}

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function shanghaiDateParts(date = new Date()) {
  const values = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    yearText: values.year,
    monthText: values.month,
    dayText: values.day,
  };
}

function shanghaiDateCode(date = new Date()) {
  const parts = shanghaiDateParts(date);
  return `${parts.yearText}${parts.monthText}${parts.dayText}`;
}

function shanghaiDayStartUtc(date = new Date()) {
  const parts = shanghaiDateParts(date);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - SHANGHAI_UTC_OFFSET_MS);
}

function shanghaiMonthStartUtc(date = new Date()) {
  const parts = shanghaiDateParts(date);
  return new Date(Date.UTC(parts.year, parts.month - 1, 1) - SHANGHAI_UTC_OFFSET_MS);
}

function formatShanghaiDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function orderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status || '未知';
}

function requireDatabase(req, res, next) {
  if (!supabase) {
    return fail(
      res,
      503,
      '数据库尚未配置，请设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY',
      supabaseInitError?.message,
    );
  }
  next();
}

function requireJwtSecret(req, res, next) {
  if (JWT_SECRET.length < 32) return fail(res, 503, 'JWT_SECRET 未配置或长度不足 32 位');
  next();
}

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
}

function auth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) return fail(res, 401, '请先登录');
  try {
    req.user = verifyToken(token);
    return next();
  } catch (_) {
    return fail(res, 401, '登录已失效，请重新登录');
  }
}

function optionalAuth(req, _res, next) {
  const token = extractBearerToken(req);
  req.user = null;
  if (token && JWT_SECRET.length >= 32) {
    try {
      req.user = verifyToken(token);
    } catch (_) {
      req.user = null;
    }
  }
  next();
}

async function adminOnly(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user?.id)
      .maybeSingle();
    assertDb(error, '检查管理员权限失败');
    if (!data || data.role !== 'admin') return fail(res, 403, '需要管理员权限');
    req.user.role = 'admin';
    return next();
  } catch (error) {
    return next(error);
  }
}

function dbError(error, fallbackMessage = '数据库操作失败') {
  const wrapped = new Error(error?.message || fallbackMessage);
  wrapped.status = 500;
  wrapped.publicMessage = fallbackMessage;
  wrapped.dbDetails = error?.details || error?.hint || undefined;
  return wrapped;
}

function assertDb(error, fallbackMessage) {
  if (error) throw dbError(error, fallbackMessage);
}

function cleanText(value, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validPhone(phone) {
  return /^\+?\d{6,20}$/.test(phone);
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function publicUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

function signUserToken(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d', algorithm: 'HS256' },
  );
}

function supplyStatus(stock) {
  const count = Number(stock || 0);
  if (count <= 0) return { code: 'restocking', label: '补货中' };
  if (count <= 20) return { code: 'limited', label: '少量' };
  return { code: 'available', label: '有货' };
}

function normalizeImage(image) {
  if (!image) return null;
  return {
    id: image.id,
    image_url: image.image_url,
    is_cover: Boolean(image.is_cover),
    sort_order: Number(image.sort_order || 0),
    created_at: image.created_at,
  };
}

function normalizeSku(sku, isAdmin = false) {
  if (!sku) return null;
  const availability = supplyStatus(sku.stock);
  const normalized = {
    id: sku.id,
    product_id: sku.product_id,
    sku_code: sku.sku_code,
    color: sku.color,
    size: sku.size,
    availability,
    created_at: sku.created_at,
    updated_at: sku.updated_at,
  };
  if (isAdmin) normalized.stock = Number(sku.stock || 0);
  return normalized;
}

function normalizeProduct(product, isAdmin = false) {
  if (!product) return null;
  const images = (product.images || product.product_images || [])
    .map(normalizeImage)
    .filter(Boolean)
    .sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.sort_order - b.sort_order);
  const skus = (product.skus || product.product_skus || []).map(sku => normalizeSku(sku, isAdmin));
  const cover = images.find(image => image.is_cover)?.image_url || product.image_url || images[0]?.image_url || null;
  const stockValues = (product.skus || product.product_skus || []).map(sku => Number(sku.stock || 0));
  const totalStock = stockValues.reduce((sum, value) => sum + value, 0);
  return {
    id: product.id,
    name: product.name,
    style_code: product.style_code,
    category: product.category,
    description: product.description,
    image_url: cover,
    images,
    status: product.status,
    availability: supplyStatus(totalStock),
    skus,
    created_at: product.created_at,
    updated_at: product.updated_at,
  };
}

function normalizeOrderItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    product_id: item.product_id,
    product_name: item.product_name,
    sku_id: item.sku_id,
    sku_code: item.sku_code,
    color: item.color,
    size: item.size,
    quantity: Number(item.quantity || 0),
    created_at: item.created_at,
  };
}

function normalizeOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    order_no: order.order_no,
    user_id: order.user_id,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    customer_company: order.customer_company,
    shipping_address: order.shipping_address,
    total_quantity: Number(order.total_quantity || 0),
    status: order.status,
    remark: order.remark,
    source_inquiry_id: order.source_inquiry_id || null,
    items: (order.items || order.order_items || []).map(normalizeOrderItem).filter(Boolean),
    created_at: order.created_at,
    updated_at: order.updated_at,
  };
}

function normalizeInquiryItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    product_id: item.product_id,
    product_name: item.product_name,
    style_code: item.style_code,
    sku_id: item.sku_id,
    sku_code: item.sku_code,
    color: item.color,
    size: item.size,
    quantity: Number(item.quantity || 0),
    created_at: item.created_at,
  };
}

function normalizeInquiry(inquiry) {
  if (!inquiry) return null;
  return {
    id: inquiry.id,
    inquiry_no: inquiry.inquiry_no,
    user_id: inquiry.user_id,
    customer_name: inquiry.customer_name,
    customer_phone: inquiry.customer_phone,
    customer_company: inquiry.customer_company,
    shipping_address: inquiry.shipping_address,
    total_quantity: Number(inquiry.total_quantity || 0),
    status: inquiry.status,
    remark: inquiry.remark,
    converted_order_id: inquiry.converted_order_id,
    items: (inquiry.items || inquiry.inquiry_items || []).map(normalizeInquiryItem).filter(Boolean),
    created_at: inquiry.created_at,
    updated_at: inquiry.updated_at,
  };
}

function makeStyleCode() {
  const date = shanghaiDateCode().slice(2);
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `EL-${date}-${suffix}`;
}

function requestBaseUrl(req) {
  return PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

async function fetchOrder(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, items:order_items(*)')
    .eq('id', orderId)
    .maybeSingle();
  assertDb(error, '读取订单失败');
  return normalizeOrder(data);
}

async function fetchInquiry(inquiryId) {
  const { data, error } = await supabase
    .from('inquiries')
    .select('*, items:inquiry_items(*)')
    .eq('id', inquiryId)
    .maybeSingle();
  assertDb(error, '读取询价单失败');
  return normalizeInquiry(data);
}

async function ensureAdminAccount() {
  if (!supabase) return;
  const phone = cleanText(process.env.ADMIN_PHONE, 20);
  const password = String(process.env.ADMIN_PASSWORD || '');
  const name = cleanText(process.env.ADMIN_NAME || '管理员', 50);
  if (!phone || !password) {
    console.log('[ADMIN] 未设置 ADMIN_PHONE/ADMIN_PASSWORD，跳过自动创建管理员');
    return;
  }
  if (!validPhone(phone) || password.length < 8) {
    console.error('[ADMIN] 管理员手机号格式错误，或密码不足 8 位');
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const { data: existing, error: readError } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  assertDb(readError, '检查管理员账号失败');

  if (existing) {
    const { error } = await supabase
      .from('users')
      .update({ name, password_hash: passwordHash, role: 'admin', updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    assertDb(error, '更新管理员账号失败');
  } else {
    const { error } = await supabase.from('users').insert({
      phone,
      password_hash: passwordHash,
      name,
      role: 'admin',
      level: 'vip',
    });
    assertDb(error, '创建管理员账号失败');
  }
  console.log(`[ADMIN] 管理员账号已就绪: ${phone}`);
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  const configured = Boolean(supabase && JWT_SECRET.length >= 32);
  if (!configured) {
    return res.status(503).json({
      code: 1,
      data: {
        status: 'configuration_required',
        version: APP_VERSION,
        database_configured: Boolean(supabase),
        jwt_configured: JWT_SECRET.length >= 32,
        time: new Date().toISOString(),
      },
      message: '服务已启动，但环境变量尚未配置完整',
    });
  }
  const { error } = await supabase.from('users').select('id', { count: 'exact', head: true });
  if (error) {
    return res.status(503).json({
      code: 1,
      data: { status: 'database_unavailable', version: APP_VERSION, time: new Date().toISOString() },
      message: '数据库连接失败，或尚未执行 schema.sql / migration-v3.sql',
    });
  }
  return ok(res, {
    status: 'ok',
    version: APP_VERSION,
    database_configured: true,
    jwt_configured: true,
    image_bucket: IMAGE_BUCKET,
    time: new Date().toISOString(),
  });
}));

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/product/:id', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// =========================
// 用户认证
// =========================
app.post('/api/auth/register', requireDatabase, requireJwtSecret, asyncRoute(async (req, res) => {
  const phone = cleanText(req.body.phone, 20);
  const password = String(req.body.password || '');
  const name = cleanText(req.body.name, 50);
  const company = cleanText(req.body.company, 100);
  const address = cleanText(req.body.address, 300);
  if (!validPhone(phone)) return fail(res, 400, '请输入正确的手机号');
  if (password.length < 6) return fail(res, 400, '密码至少需要 6 位');
  if (!name) return fail(res, 400, '请输入客户名称');

  const { data: existing, error: existingError } = await supabase.from('users').select('id').eq('phone', phone).maybeSingle();
  assertDb(existingError, '检查手机号失败');
  if (existing) return fail(res, 409, '该手机号已经注册');

  const passwordHash = await bcrypt.hash(password, 12);
  const { data, error } = await supabase
    .from('users')
    .insert({ phone, password_hash: passwordHash, name, company, address, role: 'customer' })
    .select('id, phone, name, company, address, level, role, created_at')
    .single();
  assertDb(error, '注册失败');
  return res.status(201).json({ code: 0, data: { user: data, token: signUserToken(data) }, message: '注册成功' });
}));

app.post('/api/auth/login', requireDatabase, requireJwtSecret, asyncRoute(async (req, res) => {
  const phone = cleanText(req.body.phone, 20);
  const password = String(req.body.password || '');
  if (!phone || !password) return fail(res, 400, '请输入手机号和密码');
  const { data, error } = await supabase.from('users').select('*').eq('phone', phone).maybeSingle();
  assertDb(error, '登录查询失败');
  if (!data || !(await bcrypt.compare(password, data.password_hash))) return fail(res, 401, '手机号或密码错误');
  return ok(res, { user: publicUser(data), token: signUserToken(data) }, '登录成功');
}));

app.get('/api/auth/me', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, phone, name, company, address, level, role, created_at')
    .eq('id', req.user.id)
    .maybeSingle();
  assertDb(error, '读取账号信息失败');
  if (!data) return fail(res, 401, '账号不存在');
  return ok(res, data);
}));

// =========================
// 商品、SKU、图片与分享
// =========================
app.get('/api/products', requireDatabase, optionalAuth, asyncRoute(async (req, res) => {
  const category = cleanText(req.query.category, 50);
  const keyword = cleanText(req.query.keyword, 100).replaceAll('%', '');
  const requestedStatus = cleanText(req.query.status, 20);
  const isAdmin = req.user?.role === 'admin';
  const canSeeAll = isAdmin && requestedStatus === 'all';

  let query = supabase
    .from('products')
    .select('*, skus:product_skus(*), images:product_images(*)')
    .order('created_at', { ascending: false });
  if (!canSeeAll) query = query.eq('status', requestedStatus || 'on_sale');
  if (category) query = query.eq('category', category);
  if (keyword) query = query.or(`name.ilike.%${keyword}%,style_code.ilike.%${keyword}%`);

  const { data, error } = await query;
  assertDb(error, '读取商品列表失败');
  return ok(res, (data || []).map(product => normalizeProduct(product, isAdmin)));
}));

app.get('/api/products/:id/share', requireDatabase, asyncRoute(async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*, skus:product_skus(*), images:product_images(*)')
    .eq('id', req.params.id)
    .eq('status', 'on_sale')
    .maybeSingle();
  assertDb(error, '读取分享信息失败');
  if (!data) return fail(res, 404, '商品不存在或已下架');
  const product = normalizeProduct(data, false);
  const colors = [...new Set(product.skus.map(sku => sku.color))].join('、') || '详询';
  const sizes = [...new Set(product.skus.map(sku => sku.size))].join('、') || '详询';
  const url = `${requestBaseUrl(req)}/product/${product.id}`;
  const description = product.description ? `${product.description}\n` : '';
  const copy = `今日新款｜${product.name}\n款号：${product.style_code}\n${description}颜色：${colors}\n尺码：${sizes}\n\n更多现有款式与规格请进入 Eluren 电子选款册：\n${url}\n\n需要报价或确认库存，可提交选款单或直接私聊。`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encodeURIComponent(url)}`;
  return ok(res, { url, copy, qr_url: qrUrl, product });
}));

app.get('/api/products/:id', requireDatabase, optionalAuth, asyncRoute(async (req, res) => {
  const isAdmin = req.user?.role === 'admin';
  const { data, error } = await supabase
    .from('products')
    .select('*, skus:product_skus(*), images:product_images(*)')
    .eq('id', req.params.id)
    .maybeSingle();
  assertDb(error, '读取商品详情失败');
  if (!data) return fail(res, 404, '商品不存在');
  if (data.status !== 'on_sale' && !isAdmin) return fail(res, 404, '商品不存在');
  return ok(res, normalizeProduct(data, isAdmin));
}));

app.post('/api/products', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 100);
  const category = cleanText(req.body.category, 50);
  const description = cleanText(req.body.description, 1000);
  const styleCode = cleanText(req.body.style_code, 80).toUpperCase() || makeStyleCode();
  if (!name || !category) return fail(res, 400, '商品名称和分类不能为空');
  const { data, error } = await supabase
    .from('products')
    .insert({ name, style_code: styleCode, category, description: description || null, status: 'on_sale' })
    .select('*')
    .single();
  if (error?.code === '23505') return fail(res, 409, '款号已存在，请更换款号');
  assertDb(error, '创建商品失败');
  return res.status(201).json({ code: 0, data: normalizeProduct({ ...data, skus: [], images: [] }, true), message: '商品创建成功' });
}));

app.patch('/api/products/:id', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const updates = {};
  if (req.body.name !== undefined) updates.name = cleanText(req.body.name, 100);
  if (req.body.style_code !== undefined) updates.style_code = cleanText(req.body.style_code, 80).toUpperCase();
  if (req.body.category !== undefined) updates.category = cleanText(req.body.category, 50);
  if (req.body.description !== undefined) updates.description = cleanText(req.body.description, 1000) || null;
  if (req.body.status !== undefined) {
    if (!['on_sale', 'off_sale'].includes(req.body.status)) return fail(res, 400, '商品状态无效');
    updates.status = req.body.status;
  }
  if (Object.keys(updates).length === 0) return fail(res, 400, '没有可更新的字段');
  const { data, error } = await supabase.from('products').update(updates).eq('id', req.params.id).select('*').maybeSingle();
  if (error?.code === '23505') return fail(res, 409, '款号已存在');
  assertDb(error, '更新商品失败');
  if (!data) return fail(res, 404, '商品不存在');
  return ok(res, data, '商品已更新');
}));

app.post('/api/products/:id/images', requireDatabase, requireJwtSecret, auth, adminOnly, imageUploadParser, asyncRoute(async (req, res) => {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(contentType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    return fail(res, 400, '请选择 JPG、PNG 或 WEBP 图片');
  }
  const { data: product, error: productError } = await supabase.from('products').select('id').eq('id', req.params.id).maybeSingle();
  assertDb(productError, '检查商品失败');
  if (!product) return fail(res, 404, '商品不存在');
  const { data: existing, error: existingError } = await supabase.from('product_images').select('id, is_cover, sort_order').eq('product_id', req.params.id);
  assertDb(existingError, '检查商品图片失败');
  if ((existing?.length || 0) >= 10) return fail(res, 400, '每个商品最多保留 10 张图片');
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const storagePath = `${req.params.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(IMAGE_BUCKET).upload(storagePath, req.body, { contentType, cacheControl: '31536000', upsert: false });
  assertDb(uploadError, '上传商品图片失败');
  try {
    const { data: publicData } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(storagePath);
    const isCover = !(existing || []).some(image => image.is_cover);
    const { data: row, error: rowError } = await supabase.from('product_images').insert({
      product_id: req.params.id, storage_path: storagePath, image_url: publicData.publicUrl,
      is_cover: isCover, sort_order: existing?.length || 0,
    }).select('*').single();
    assertDb(rowError, '保存商品图片失败');
    if (isCover) {
      const { error: coverError } = await supabase.from('products').update({ image_url: publicData.publicUrl }).eq('id', req.params.id);
      assertDb(coverError, '更新封面失败');
    }
    return res.status(201).json({ code: 0, data: normalizeImage(row), message: '图片上传成功' });
  } catch (error) {
    await supabase.storage.from(IMAGE_BUCKET).remove([storagePath]).catch(() => {});
    throw error;
  }
}));

app.patch('/api/products/:productId/images/:imageId/cover', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const { data: image, error: imageError } = await supabase
    .from('product_images')
    .select('*')
    .eq('id', req.params.imageId)
    .eq('product_id', req.params.productId)
    .maybeSingle();
  assertDb(imageError, '读取图片失败');
  if (!image) return fail(res, 404, '图片不存在');
  const { error: clearError } = await supabase.from('product_images').update({ is_cover: false }).eq('product_id', req.params.productId);
  assertDb(clearError, '重置封面失败');
  const { error: setError } = await supabase.from('product_images').update({ is_cover: true }).eq('id', image.id);
  assertDb(setError, '设置封面失败');
  const { error: productError } = await supabase.from('products').update({ image_url: image.image_url }).eq('id', req.params.productId);
  assertDb(productError, '更新商品封面失败');
  return ok(res, normalizeImage({ ...image, is_cover: true }), '封面已更新');
}));

app.delete('/api/products/:productId/images/:imageId', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const { data: image, error: imageError } = await supabase
    .from('product_images')
    .select('*')
    .eq('id', req.params.imageId)
    .eq('product_id', req.params.productId)
    .maybeSingle();
  assertDb(imageError, '读取图片失败');
  if (!image) return fail(res, 404, '图片不存在');
  if (image.storage_path) {
    const { error: storageError } = await supabase.storage.from(IMAGE_BUCKET).remove([image.storage_path]);
    assertDb(storageError, '删除存储图片失败');
  }
  const { error: deleteError } = await supabase.from('product_images').delete().eq('id', image.id);
  assertDb(deleteError, '删除图片记录失败');
  if (image.is_cover) {
    const { data: nextImage, error: nextError } = await supabase
      .from('product_images')
      .select('*')
      .eq('product_id', req.params.productId)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    assertDb(nextError, '选择新封面失败');
    if (nextImage) {
      await supabase.from('product_images').update({ is_cover: true }).eq('id', nextImage.id);
      await supabase.from('products').update({ image_url: nextImage.image_url }).eq('id', req.params.productId);
    } else {
      await supabase.from('products').update({ image_url: null }).eq('id', req.params.productId);
    }
  }
  return ok(res, null, '图片已删除');
}));

app.post('/api/products/:id/skus', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const color = cleanText(req.body.color, 50);
  const size = cleanText(req.body.size, 30);
  const stock = Number.parseInt(req.body.stock, 10);
  const skuCodeInput = cleanText(req.body.sku_code, 80).toUpperCase();
  if (!color || !size) return fail(res, 400, '颜色和尺码不能为空');
  if (!Number.isInteger(stock) || stock < 0) return fail(res, 400, '库存必须是非负整数');
  const { data: product, error: productError } = await supabase.from('products').select('id').eq('id', req.params.id).maybeSingle();
  assertDb(productError, '检查商品失败');
  if (!product) return fail(res, 404, '商品不存在');
  const autoCode = `SKU-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const { data, error } = await supabase
    .from('product_skus')
    .insert({ product_id: req.params.id, sku_code: skuCodeInput || autoCode, color, size, stock, wholesale_price: 0, retail_price: null })
    .select('*')
    .single();
  if (error?.code === '23505') return fail(res, 409, 'SKU 编码或颜色尺码组合已存在');
  assertDb(error, '添加 SKU 失败');
  return res.status(201).json({ code: 0, data: normalizeSku(data, true), message: 'SKU 添加成功' });
}));

app.patch('/api/skus/:id', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const stock = Number.parseInt(req.body.stock, 10);
  if (!Number.isInteger(stock) || stock < 0) return fail(res, 400, '库存必须是非负整数');
  const { data, error } = await supabase.from('product_skus').update({ stock }).eq('id', req.params.id).select('*').maybeSingle();
  assertDb(error, '更新 SKU 失败');
  if (!data) return fail(res, 404, 'SKU 不存在');
  return ok(res, normalizeSku(data, true), '库存已更新');
}));

// =========================
// 询价单：客户选款后提交，不含价格、不扣库存
// =========================
app.post('/api/inquiries', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (rawItems.length === 0 || rawItems.length > 100) return fail(res, 400, '选款单必须包含 1 至 100 个规格');
  const items = rawItems.map(item => ({ sku_id: cleanText(item.sku_id, 50), quantity: Number.parseInt(item.quantity, 10) }));
  if (items.some(item => !validUuid(item.sku_id) || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 99999)) {
    return fail(res, 400, '选款单中存在无效规格或数量');
  }
  const shippingAddress = cleanText(req.body.shipping_address, 300);
  const remark = cleanText(req.body.remark, 1000);
  const { data, error } = await supabase.rpc('create_inquiry', {
    p_user_id: req.user.id,
    p_items: items,
    p_shipping_address: shippingAddress || null,
    p_remark: remark || null,
  });
  if (error) return fail(res, 409, error.message || '提交询价失败');
  const inquiry = normalizeInquiry(data?.inquiry || data);
  return res.status(201).json({ code: 0, data: inquiry, message: `询价单已提交：${inquiry.inquiry_no}` });
}));

app.get('/api/inquiries', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const status = cleanText(req.query.status, 20);
  if (status && !INQUIRY_STATUSES.includes(status)) return fail(res, 400, '询价状态无效');
  let query = supabase
    .from('inquiries')
    .select('*, items:inquiry_items(*)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (req.user.role !== 'admin') query = query.eq('user_id', req.user.id);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  assertDb(error, '读取询价单失败');
  return ok(res, (data || []).map(normalizeInquiry));
}));

app.get('/api/inquiries/:id', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const inquiry = await fetchInquiry(req.params.id);
  if (!inquiry) return fail(res, 404, '询价单不存在');
  if (req.user.role !== 'admin' && inquiry.user_id !== req.user.id) return fail(res, 403, '无权查看该询价单');
  return ok(res, inquiry);
}));

app.patch('/api/inquiries/:id/status', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const status = cleanText(req.body.status, 20);
  if (!INQUIRY_STATUSES.includes(status) || status === 'converted') return fail(res, 400, '询价状态无效');
  const { data, error } = await supabase.rpc('set_inquiry_status', { p_inquiry_id: req.params.id, p_new_status: status });
  if (error) return fail(res, 409, error.message || '询价状态更新失败');
  return ok(res, normalizeInquiry(data), '询价状态已更新');
}));

app.post('/api/inquiries/:id/convert', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const { data, error } = await supabase.rpc('convert_inquiry_to_order', { p_inquiry_id: req.params.id });
  if (error) return fail(res, 409, error.message || '转为正式订单失败');
  const order = normalizeOrder(data?.order || data);
  return res.status(201).json({ code: 0, data: order, message: `已转为正式订单：${order.order_no}` });
}));

// =========================
// 正式订单：由询价单确认后转换
// =========================
app.get('/api/orders', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const status = cleanText(req.query.status, 20);
  if (status && !ORDER_STATUSES.includes(status)) return fail(res, 400, '订单状态无效');
  let query = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(100);
  if (req.user.role !== 'admin') query = query.eq('user_id', req.user.id);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  assertDb(error, '读取订单列表失败');
  return ok(res, (data || []).map(normalizeOrder));
}));

app.get('/api/orders/:id', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const order = await fetchOrder(req.params.id);
  if (!order) return fail(res, 404, '订单不存在');
  if (req.user.role !== 'admin' && order.user_id !== req.user.id) return fail(res, 403, '无权查看该订单');
  return ok(res, order);
}));

app.patch('/api/orders/:id/status', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const status = cleanText(req.body.status, 20);
  if (!ORDER_STATUSES.includes(status)) return fail(res, 400, '订单状态无效');
  const { data, error } = await supabase.rpc('set_order_status', { p_order_id: req.params.id, p_new_status: status });
  if (error) return fail(res, 409, error.message || '订单状态更新失败');
  return ok(res, normalizeOrder(data), '订单状态已更新');
}));

// =========================
// 客户与仪表盘
// =========================
app.get('/api/customers', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (_req, res) => {
  const [usersResult, inquiriesResult, ordersResult] = await Promise.all([
    supabase.from('users').select('id, name, phone, company, address, level, role, created_at').eq('role', 'customer').order('created_at', { ascending: false }),
    supabase.from('inquiries').select('user_id, created_at'),
    supabase.from('orders').select('user_id').neq('status', 'cancelled'),
  ]);
  assertDb(usersResult.error, '读取客户列表失败');
  assertDb(inquiriesResult.error, '统计客户询价失败');
  assertDb(ordersResult.error, '统计客户订单失败');
  const stats = new Map();
  for (const inquiry of inquiriesResult.data || []) {
    const current = stats.get(inquiry.user_id) || { inquiry_count: 0, order_count: 0, last_inquiry_at: null };
    current.inquiry_count += 1;
    if (!current.last_inquiry_at || inquiry.created_at > current.last_inquiry_at) current.last_inquiry_at = inquiry.created_at;
    stats.set(inquiry.user_id, current);
  }
  for (const order of ordersResult.data || []) {
    const current = stats.get(order.user_id) || { inquiry_count: 0, order_count: 0, last_inquiry_at: null };
    current.order_count += 1;
    stats.set(order.user_id, current);
  }
  return ok(res, (usersResult.data || []).map(user => ({ ...user, ...(stats.get(user.id) || { inquiry_count: 0, order_count: 0, last_inquiry_at: null }) })));
}));

app.post('/api/customers', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const phone = cleanText(req.body.phone, 20);
  const password = String(req.body.password || '12345678');
  const name = cleanText(req.body.name, 50);
  const company = cleanText(req.body.company, 100);
  const address = cleanText(req.body.address, 300);
  if (!validPhone(phone) || !name) return fail(res, 400, '客户名称或手机号无效');
  if (password.length < 6) return fail(res, 400, '初始密码至少需要 6 位');
  const passwordHash = await bcrypt.hash(password, 12);
  const { data, error } = await supabase
    .from('users')
    .insert({ phone, password_hash: passwordHash, name, company, address, role: 'customer' })
    .select('id, name, phone, company, address, level, role, created_at')
    .single();
  if (error?.code === '23505') return fail(res, 409, '该手机号已经存在');
  assertDb(error, '创建客户失败');
  return res.status(201).json({ code: 0, data, message: '客户创建成功' });
}));

async function getDashboardData() {
  const today = shanghaiDayStartUtc();
  const monthStart = shanghaiMonthStartUtc();
  const [inquiriesResult, ordersResult, productsResult, customersResult, lowStockResult] = await Promise.all([
    supabase.from('inquiries').select('id, inquiry_no, customer_name, status, total_quantity, created_at').order('created_at', { ascending: false }),
    supabase.from('orders').select('id, status, total_quantity, created_at'),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'on_sale'),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
    supabase.from('product_skus').select('id, sku_code, color, size, stock, product:products(name, style_code)').lt('stock', 20).order('stock', { ascending: true }).limit(20),
  ]);
  assertDb(inquiriesResult.error, '统计询价失败');
  assertDb(ordersResult.error, '统计订单失败');
  assertDb(productsResult.error, '统计商品失败');
  assertDb(customersResult.error, '统计客户失败');
  assertDb(lowStockResult.error, '读取低库存失败');
  const inquiries = inquiriesResult.data || [];
  const orders = ordersResult.data || [];
  const todayInquiries = inquiries.filter(item => new Date(item.created_at) >= today);
  return {
    today_inquiries: todayInquiries.length,
    pending_inquiries: inquiries.filter(item => item.status === 'pending').length,
    today_selected_quantity: todayInquiries.reduce((sum, item) => sum + Number(item.total_quantity || 0), 0),
    monthly_orders: orders.filter(item => item.status !== 'cancelled' && new Date(item.created_at) >= monthStart).length,
    on_sale_products: productsResult.count || 0,
    total_customers: customersResult.count || 0,
    low_stock_skus: (lowStockResult.data || []).map(sku => ({
      id: sku.id,
      sku_code: sku.sku_code,
      color: sku.color,
      size: sku.size,
      stock: Number(sku.stock || 0),
      product_name: sku.product?.name || '',
      style_code: sku.product?.style_code || '',
    })),
    recent_inquiries: inquiries.slice(0, 8).map(normalizeInquiry),
  };
}

app.get('/api/dashboard', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (_req, res) => ok(res, await getDashboardData())));
app.get('/api/erp/dashboard', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (_req, res) => ok(res, await getDashboardData())));

// =========================
// 生产单 JSON 与打印页
// =========================
app.get('/api/orders/:id/production', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const order = await fetchOrder(req.params.id);
  if (!order) return fail(res, 404, '订单不存在');
  return ok(res, {
    order_id: order.id,
    order_no: order.order_no,
    customer: { name: order.customer_name, phone: order.customer_phone },
    shipping_address: order.shipping_address,
    status: order.status,
    status_label: orderStatusLabel(order.status),
    remark: order.remark,
    total_quantity: order.total_quantity,
    items: order.items,
    print_time: new Date().toISOString(),
    print_time_local: formatShanghaiDateTime(),
  });
}));

app.post('/api/orders/:id/print-token', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const order = await fetchOrder(req.params.id);
  if (!order) return fail(res, 404, '订单不存在');
  const token = jwt.sign({ type: 'print', order_id: order.id }, JWT_SECRET, { expiresIn: '5m', algorithm: 'HS256' });
  return ok(res, { url: `/print/${order.id}?token=${encodeURIComponent(token)}`, expires_in: 300 });
}));

app.get('/print/:id', requireDatabase, requireJwtSecret, asyncRoute(async (req, res) => {
  let payload;
  try {
    payload = verifyToken(String(req.query.token || ''));
  } catch (_) {
    return res.status(401).send('<h1>打印链接已失效</h1><p>请返回管理后台重新生成。</p>');
  }
  if (payload.type !== 'print' || payload.order_id !== req.params.id) return res.status(403).send('<h1>无权访问该生产单</h1>');
  const order = await fetchOrder(req.params.id);
  if (!order) return res.status(404).send('<h1>订单不存在</h1>');
  const rows = order.items.map(item => `<tr><td>${escapeHtml(item.product_name)}</td><td>${escapeHtml(item.sku_code)}</td><td>${escapeHtml(item.color)}</td><td>${escapeHtml(item.size)}</td><td>${item.quantity}</td></tr>`).join('');
  return res.type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>生产单 ${escapeHtml(order.order_no)}</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;margin:24px;color:#111}h1{text-align:center;margin:0 0 20px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px}.full{grid-column:1/3}table{width:100%;border-collapse:collapse}th,td{border:1px solid #222;padding:9px;text-align:center}th{background:#eee}.footer{margin-top:20px;display:flex;justify-content:space-between}@media print{.no-print{display:none}body{margin:0}}</style></head><body><button class="no-print" onclick="window.print()">打印</button><h1>服装生产单</h1><div class="meta"><div><strong>订单号：</strong>${escapeHtml(order.order_no)}</div><div><strong>状态：</strong>${escapeHtml(orderStatusLabel(order.status))}</div><div><strong>客户：</strong>${escapeHtml(order.customer_name)}</div><div><strong>电话：</strong>${escapeHtml(order.customer_phone)}</div><div class="full"><strong>收货地址：</strong>${escapeHtml(order.shipping_address || '未填写')}</div><div class="full"><strong>备注：</strong>${escapeHtml(order.remark || '无')}</div></div><table><thead><tr><th>商品</th><th>SKU</th><th>颜色</th><th>尺码</th><th>生产数量</th></tr></thead><tbody>${rows}</tbody></table><div class="footer"><strong>总件数：${order.total_quantity}</strong><span>打印时间：${escapeHtml(formatShanghaiDateTime())}</span></div><script>window.addEventListener('load',()=>window.print())</script></body></html>`);
}));

app.get('/api/schema', requireJwtSecret, auth, adminOnly, asyncRoute(async (_req, res) => {
  const schema = await fs.promises.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  res.type('text/plain; charset=utf-8').send(schema);
}));

app.use('/api', (req, res) => fail(res, 404, `接口不存在: ${req.method} ${req.originalUrl}`));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((error, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.originalUrl}`, error);
  if (res.headersSent) return;
  const status = Number(error.status) || 500;
  const message = error.publicMessage || (status < 500 ? error.message : '服务器内部错误');
  return fail(res, status, message, process.env.NODE_ENV === 'development' ? (error.dbDetails || error.message) : undefined);
});

function startServer() {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[START] Eluren 电子选款册已启动: http://localhost:${PORT}`);
    console.log(`[START] Supabase: ${supabase ? '已配置' : '未配置'}`);
    console.log(`[START] JWT: ${JWT_SECRET.length >= 32 ? '已配置' : '未配置/过短'}`);
    ensureAdminAccount().catch(error => console.error('[ADMIN] 初始化管理员失败:', error.message));
  });
  return server;
}

if (require.main === module) startServer();
module.exports = { app, startServer };
