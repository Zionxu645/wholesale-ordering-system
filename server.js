'use strict';

try {
  require('dotenv').config();
} catch (_) {
  // Render 等环境直接使用系统环境变量；dotenv 未安装时也不阻止服务启动。
}

const fs = require('fs');
const path = require('path');
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
const ORDER_STATUSES = ['pending', 'confirmed', 'production', 'shipping', 'delivered', 'cancelled'];

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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
  if (JWT_SECRET.length < 32) {
    return fail(res, 503, 'JWT_SECRET 未配置或长度不足 32 位');
  }
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
    req.user.role = data.role;
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

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeSku(sku) {
  if (!sku) return null;
  return {
    ...sku,
    stock: Number(sku.stock || 0),
    wholesale_price: numberValue(sku.wholesale_price),
    retail_price: sku.retail_price == null ? null : numberValue(sku.retail_price),
  };
}

function normalizeProduct(product) {
  if (!product) return null;
  return {
    ...product,
    skus: (product.skus || product.product_skus || []).map(normalizeSku),
  };
}

function normalizeOrderItem(item) {
  return {
    ...item,
    quantity: Number(item.quantity || 0),
    unit_price: numberValue(item.unit_price),
    subtotal: numberValue(item.subtotal),
  };
}

function normalizeOrder(order) {
  if (!order) return null;
  return {
    ...order,
    total_amount: numberValue(order.total_amount),
    total_quantity: Number(order.total_quantity || 0),
    items: (order.items || order.order_items || []).map(normalizeOrderItem),
  };
}

function cleanText(value, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validPhone(phone) {
  return /^\+?\d{6,20}$/.test(phone);
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

async function fetchOrder(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, items:order_items(*)')
    .eq('id', orderId)
    .maybeSingle();
  assertDb(error, '读取订单失败');
  return normalizeOrder(data);
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

// 健康检查：环境变量缺失时服务仍可启动，并返回明确的配置状态。
app.get('/api/health', asyncRoute(async (_req, res) => {
  const configured = Boolean(supabase && JWT_SECRET.length >= 32);
  if (!configured) {
    return res.status(503).json({
      code: 1,
      data: {
        status: 'configuration_required',
        version: '2.0.0',
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
      data: { status: 'database_unavailable', version: '2.0.0', time: new Date().toISOString() },
      message: '数据库连接失败或尚未执行 schema.sql',
    });
  }
  return ok(res, { status: 'ok', version: '2.0.0', database_configured: true, jwt_configured: true, time: new Date().toISOString() });
}));

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

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

  const { data: existing, error: existingError } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
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

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();
  assertDb(error, '登录查询失败');
  if (!data) return fail(res, 401, '手机号或密码错误');

  const matched = await bcrypt.compare(password, data.password_hash);
  if (!matched) return fail(res, 401, '手机号或密码错误');

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
// 商品与 SKU
// =========================
app.get('/api/products', requireDatabase, optionalAuth, asyncRoute(async (req, res) => {
  const category = cleanText(req.query.category, 50);
  const keyword = cleanText(req.query.keyword, 100);
  const requestedStatus = cleanText(req.query.status, 20);
  const canSeeAll = req.user?.role === 'admin' && requestedStatus === 'all';

  let query = supabase
    .from('products')
    .select('*, skus:product_skus(*)')
    .order('created_at', { ascending: false });

  if (!canSeeAll) query = query.eq('status', requestedStatus || 'on_sale');
  if (category) query = query.eq('category', category);
  if (keyword) query = query.ilike('name', `%${keyword.replaceAll('%', '')}%`);

  const { data, error } = await query;
  assertDb(error, '读取商品列表失败');
  return ok(res, (data || []).map(normalizeProduct));
}));

app.get('/api/products/:id', requireDatabase, optionalAuth, asyncRoute(async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*, skus:product_skus(*)')
    .eq('id', req.params.id)
    .maybeSingle();
  assertDb(error, '读取商品详情失败');
  if (!data) return fail(res, 404, '商品不存在');
  if (data.status !== 'on_sale' && req.user?.role !== 'admin') return fail(res, 404, '商品不存在');
  return ok(res, normalizeProduct(data));
}));

app.post('/api/products', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const name = cleanText(req.body.name, 100);
  const category = cleanText(req.body.category, 50);
  const description = cleanText(req.body.description, 500);
  const imageUrl = cleanText(req.body.image_url, 500);
  if (!name || !category) return fail(res, 400, '商品名称和分类不能为空');

  const { data, error } = await supabase
    .from('products')
    .insert({ name, category, description, image_url: imageUrl || null, status: 'on_sale' })
    .select('*')
    .single();
  assertDb(error, '创建商品失败');
  return res.status(201).json({ code: 0, data: normalizeProduct({ ...data, skus: [] }), message: '商品创建成功' });
}));

app.patch('/api/products/:id', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const updates = {};
  if (req.body.name !== undefined) updates.name = cleanText(req.body.name, 100);
  if (req.body.category !== undefined) updates.category = cleanText(req.body.category, 50);
  if (req.body.description !== undefined) updates.description = cleanText(req.body.description, 500);
  if (req.body.image_url !== undefined) updates.image_url = cleanText(req.body.image_url, 500) || null;
  if (req.body.status !== undefined) {
    if (!['on_sale', 'off_sale'].includes(req.body.status)) return fail(res, 400, '商品状态无效');
    updates.status = req.body.status;
  }
  if (Object.keys(updates).length === 0) return fail(res, 400, '没有可更新的字段');

  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();
  assertDb(error, '更新商品失败');
  if (!data) return fail(res, 404, '商品不存在');
  return ok(res, data, '商品已更新');
}));

app.post('/api/products/:id/skus', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const color = cleanText(req.body.color, 50);
  const size = cleanText(req.body.size, 30);
  const stock = Number.parseInt(req.body.stock, 10);
  const wholesalePrice = Number(req.body.wholesale_price);
  const retailPrice = req.body.retail_price === '' || req.body.retail_price == null ? null : Number(req.body.retail_price);
  const skuCodeInput = cleanText(req.body.sku_code, 80);

  if (!color || !size) return fail(res, 400, '颜色和尺码不能为空');
  if (!Number.isInteger(stock) || stock < 0) return fail(res, 400, '库存必须是非负整数');
  if (!Number.isFinite(wholesalePrice) || wholesalePrice < 0) return fail(res, 400, '批发价无效');
  if (retailPrice != null && (!Number.isFinite(retailPrice) || retailPrice < 0)) return fail(res, 400, '零售价无效');

  const { data: product, error: productError } = await supabase.from('products').select('id').eq('id', req.params.id).maybeSingle();
  assertDb(productError, '检查商品失败');
  if (!product) return fail(res, 404, '商品不存在');

  const autoCode = `SKU-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const { data, error } = await supabase
    .from('product_skus')
    .insert({
      product_id: req.params.id,
      sku_code: skuCodeInput || autoCode,
      color,
      size,
      stock,
      wholesale_price: wholesalePrice,
      retail_price: retailPrice,
    })
    .select('*')
    .single();
  if (error?.code === '23505') return fail(res, 409, 'SKU 编码已存在');
  assertDb(error, '添加 SKU 失败');
  return res.status(201).json({ code: 0, data: normalizeSku(data), message: 'SKU 添加成功' });
}));

app.patch('/api/skus/:id', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const updates = {};
  if (req.body.stock !== undefined) {
    const stock = Number.parseInt(req.body.stock, 10);
    if (!Number.isInteger(stock) || stock < 0) return fail(res, 400, '库存必须是非负整数');
    updates.stock = stock;
  }
  if (req.body.wholesale_price !== undefined) {
    const price = Number(req.body.wholesale_price);
    if (!Number.isFinite(price) || price < 0) return fail(res, 400, '批发价无效');
    updates.wholesale_price = price;
  }
  if (Object.keys(updates).length === 0) return fail(res, 400, '没有可更新的字段');
  const { data, error } = await supabase.from('product_skus').update(updates).eq('id', req.params.id).select('*').maybeSingle();
  assertDb(error, '更新 SKU 失败');
  if (!data) return fail(res, 404, 'SKU 不存在');
  return ok(res, normalizeSku(data), 'SKU 已更新');
}));

// =========================
// 数据库购物车
// =========================
app.get('/api/cart', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const { data, error } = await supabase
    .from('cart_items')
    .select('id, quantity, sku:product_skus(id, sku_code, color, size, stock, wholesale_price, product:products(id, name, status))')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: true });
  assertDb(error, '读取购物车失败');

  const items = (data || []).filter(row => row.sku?.product).map(row => ({
    id: row.id,
    sku_id: row.sku.id,
    product_id: row.sku.product.id,
    product_name: row.sku.product.name,
    product_status: row.sku.product.status,
    sku_code: row.sku.sku_code,
    color: row.sku.color,
    size: row.sku.size,
    stock: Number(row.sku.stock || 0),
    quantity: Number(row.quantity || 0),
    unit_price: numberValue(row.sku.wholesale_price),
    subtotal: numberValue(row.sku.wholesale_price) * Number(row.quantity || 0),
  }));
  return ok(res, items);
}));

app.post('/api/cart/add', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const skuId = cleanText(req.body.sku_id, 50);
  const addQuantity = Number.parseInt(req.body.quantity ?? req.body.qty, 10);
  if (!skuId || !Number.isInteger(addQuantity) || addQuantity <= 0) return fail(res, 400, 'SKU 和数量无效');

  const { data: sku, error: skuError } = await supabase
    .from('product_skus')
    .select('id, stock, product:products(status)')
    .eq('id', skuId)
    .maybeSingle();
  assertDb(skuError, '检查 SKU 失败');
  if (!sku || sku.product?.status !== 'on_sale') return fail(res, 404, 'SKU 不存在或商品已下架');

  const { data: existing, error: existingError } = await supabase
    .from('cart_items')
    .select('id, quantity')
    .eq('user_id', req.user.id)
    .eq('sku_id', skuId)
    .maybeSingle();
  assertDb(existingError, '检查购物车失败');

  const newQuantity = Number(existing?.quantity || 0) + addQuantity;
  if (newQuantity > Number(sku.stock)) return fail(res, 409, `库存不足，当前最多可订 ${sku.stock} 件`);

  let result;
  if (existing) {
    result = await supabase.from('cart_items').update({ quantity: newQuantity }).eq('id', existing.id).select('*').single();
  } else {
    result = await supabase.from('cart_items').insert({ user_id: req.user.id, sku_id: skuId, quantity: newQuantity }).select('*').single();
  }
  assertDb(result.error, '加入购物车失败');
  return ok(res, result.data, '已加入购物车');
}));

app.patch('/api/cart/:skuId', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const quantity = Number.parseInt(req.body.quantity, 10);
  if (!Number.isInteger(quantity) || quantity < 0) return fail(res, 400, '数量必须是非负整数');
  if (quantity === 0) {
    const { error } = await supabase.from('cart_items').delete().eq('user_id', req.user.id).eq('sku_id', req.params.skuId);
    assertDb(error, '移除购物车商品失败');
    return ok(res, null, '已移除');
  }

  const { data: sku, error: skuError } = await supabase.from('product_skus').select('stock').eq('id', req.params.skuId).maybeSingle();
  assertDb(skuError, '检查库存失败');
  if (!sku) return fail(res, 404, 'SKU 不存在');
  if (quantity > Number(sku.stock)) return fail(res, 409, `库存不足，当前最多可订 ${sku.stock} 件`);

  const { data, error } = await supabase
    .from('cart_items')
    .update({ quantity })
    .eq('user_id', req.user.id)
    .eq('sku_id', req.params.skuId)
    .select('*')
    .maybeSingle();
  assertDb(error, '更新购物车失败');
  if (!data) return fail(res, 404, '购物车商品不存在');
  return ok(res, data, '数量已更新');
}));

app.delete('/api/cart/:skuId', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const { error } = await supabase.from('cart_items').delete().eq('user_id', req.user.id).eq('sku_id', req.params.skuId);
  assertDb(error, '移除购物车商品失败');
  return ok(res, null, '已移除');
}));

app.delete('/api/cart', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const { error } = await supabase.from('cart_items').delete().eq('user_id', req.user.id);
  assertDb(error, '清空购物车失败');
  return ok(res, null, '购物车已清空');
}));
app.post('/api/cart/clear', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const { error } = await supabase.from('cart_items').delete().eq('user_id', req.user.id);
  assertDb(error, '清空购物车失败');
  return ok(res, null, '购物车已清空');
}));
app.post('/api/cart/remove', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const skuId = cleanText(req.body.sku_id, 50);
  if (!skuId) return fail(res, 400, '缺少 sku_id');
  const { error } = await supabase.from('cart_items').delete().eq('user_id', req.user.id).eq('sku_id', skuId);
  assertDb(error, '移除购物车商品失败');
  return ok(res, null, '已移除');
}));

// =========================
// 订单
// =========================
app.post('/api/orders', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const shippingAddress = cleanText(req.body.shipping_address ?? req.body.address, 300);
  const remark = cleanText(req.body.remark, 500);
  if (!shippingAddress) return fail(res, 400, '收货地址不能为空');

  const { data, error } = await supabase.rpc('create_order_from_cart', {
    p_user_id: req.user.id,
    p_shipping_address: shippingAddress,
    p_remark: remark || null,
  });
  if (error) {
    const message = error.message || '';
    if (message.includes('购物车为空') || message.includes('库存不足') || message.includes('已下架')) {
      return fail(res, 409, message.replace(/^.*?:\s*/, ''));
    }
    throw dbError(error, '创建订单失败');
  }
  const order = normalizeOrder(data?.order || data);
  return res.status(201).json({ code: 0, data: { order, items: order.items || [] }, message: `订单创建成功: ${order.order_no}` });
}));
app.post('/api/order/create', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const shippingAddress = cleanText(req.body.shipping_address ?? req.body.address, 300);
  const remark = cleanText(req.body.remark, 500);
  if (!shippingAddress) return fail(res, 400, '收货地址不能为空');
  const { data, error } = await supabase.rpc('create_order_from_cart', {
    p_user_id: req.user.id,
    p_shipping_address: shippingAddress,
    p_remark: remark || null,
  });
  if (error) return fail(res, 409, error.message || '创建订单失败');
  return res.status(201).json({ code: 0, data: normalizeOrder(data?.order || data), message: '订单创建成功' });
}));

app.get('/api/orders', requireDatabase, requireJwtSecret, auth, asyncRoute(async (req, res) => {
  const status = cleanText(req.query.status, 20);
  if (status && !ORDER_STATUSES.includes(status)) return fail(res, 400, '订单状态无效');
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.page_size, 10) || 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .range(from, to);
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
  const { data, error } = await supabase.rpc('set_order_status', {
    p_order_id: req.params.id,
    p_new_status: status,
  });
  if (error) return fail(res, 409, error.message || '订单状态更新失败');
  return ok(res, normalizeOrder(data), '订单状态已更新');
}));

// ERP 兼容接口
app.get('/api/erp/orders', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const status = cleanText(req.query.status, 20);
  let query = supabase.from('orders').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  assertDb(error, '读取 ERP 订单失败');
  return ok(res, (data || []).map(normalizeOrder));
}));
app.patch('/api/erp/order/status', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const status = cleanText(req.body.status, 20);
  const orderId = cleanText(req.body.order_id, 50);
  if (!orderId || !ORDER_STATUSES.includes(status)) return fail(res, 400, '订单 ID 或状态无效');
  const { data, error } = await supabase.rpc('set_order_status', { p_order_id: orderId, p_new_status: status });
  if (error) return fail(res, 409, error.message || '订单状态更新失败');
  return ok(res, normalizeOrder(data));
}));

// =========================
// ERP 客户和仪表盘
// =========================
app.get('/api/customers', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (_req, res) => {
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, name, phone, company, address, level, role, created_at')
    .eq('role', 'customer')
    .order('created_at', { ascending: false });
  assertDb(usersError, '读取客户列表失败');

  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('user_id, total_amount')
    .neq('status', 'cancelled');
  assertDb(ordersError, '统计客户订单失败');

  const stats = new Map();
  for (const order of orders || []) {
    const current = stats.get(order.user_id) || { order_count: 0, total_amount: 0 };
    current.order_count += 1;
    current.total_amount += numberValue(order.total_amount);
    stats.set(order.user_id, current);
  }
  return ok(res, (users || []).map(user => ({ ...user, ...(stats.get(user.id) || { order_count: 0, total_amount: 0 }) })));
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
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const [ordersResult, productsResult, customersResult, lowStockResult] = await Promise.all([
    supabase.from('orders').select('id, status, total_amount, created_at'),
    supabase.from('products').select('id', { count: 'exact', head: true }),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
    supabase.from('product_skus').select('id, sku_code, color, size, stock').lt('stock', 50).order('stock', { ascending: true }).limit(20),
  ]);
  assertDb(ordersResult.error, '统计订单失败');
  assertDb(productsResult.error, '统计商品失败');
  assertDb(customersResult.error, '统计客户失败');
  assertDb(lowStockResult.error, '读取低库存失败');

  const validOrders = (ordersResult.data || []).filter(order => order.status !== 'cancelled');
  const todayOrders = validOrders.filter(order => new Date(order.created_at) >= start);
  return {
    today_orders: todayOrders.length,
    today_revenue: todayOrders.reduce((sum, order) => sum + numberValue(order.total_amount), 0),
    total_revenue: validOrders.reduce((sum, order) => sum + numberValue(order.total_amount), 0),
    total_orders: (ordersResult.data || []).length,
    total_products: productsResult.count || 0,
    total_customers: customersResult.count || 0,
    pending: (ordersResult.data || []).filter(order => order.status === 'pending').length,
    low_stock_skus: (lowStockResult.data || []).map(normalizeSku),
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
    remark: order.remark,
    total_quantity: order.total_quantity,
    items: order.items,
    print_time: new Date().toISOString(),
  });
}));
app.get('/api/print/:id', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const order = await fetchOrder(req.params.id);
  if (!order) return fail(res, 404, '订单不存在');
  return ok(res, { order_id: order.id, order_no: order.order_no, items: order.items, print_time: new Date().toISOString() });
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
  if (payload.type !== 'print' || payload.order_id !== req.params.id) {
    return res.status(403).send('<h1>无权访问该生产单</h1>');
  }
  const order = await fetchOrder(req.params.id);
  if (!order) return res.status(404).send('<h1>订单不存在</h1>');

  const rows = order.items.map(item => `
    <tr>
      <td>${escapeHtml(item.product_name)}</td>
      <td>${escapeHtml(item.sku_code)}</td>
      <td>${escapeHtml(item.color)}</td>
      <td>${escapeHtml(item.size)}</td>
      <td>${item.quantity}</td>
    </tr>`).join('');

  return res.type('html').send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>生产单 ${escapeHtml(order.order_no)}</title>
<style>
body{font-family:Arial,"Microsoft YaHei",sans-serif;margin:24px;color:#111}h1{text-align:center;margin:0 0 20px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px}.full{grid-column:1/3}table{width:100%;border-collapse:collapse}th,td{border:1px solid #222;padding:9px;text-align:center}th{background:#eee}.footer{margin-top:20px;display:flex;justify-content:space-between}@media print{.no-print{display:none}body{margin:0}}
</style></head><body>
<button class="no-print" onclick="window.print()">打印</button>
<h1>服装生产单</h1>
<div class="meta">
<div><strong>订单号：</strong>${escapeHtml(order.order_no)}</div>
<div><strong>状态：</strong>${escapeHtml(order.status)}</div>
<div><strong>客户：</strong>${escapeHtml(order.customer_name)}</div>
<div><strong>电话：</strong>${escapeHtml(order.customer_phone)}</div>
<div class="full"><strong>收货地址：</strong>${escapeHtml(order.shipping_address)}</div>
<div class="full"><strong>备注：</strong>${escapeHtml(order.remark || '无')}</div>
</div>
<table><thead><tr><th>商品</th><th>SKU</th><th>颜色</th><th>尺码</th><th>生产数量</th></tr></thead><tbody>${rows}</tbody></table>
<div class="footer"><strong>总件数：${order.total_quantity}</strong><span>打印时间：${escapeHtml(new Date().toLocaleString('zh-CN'))}</span></div>
<script>window.addEventListener('load',()=>window.print())</script>
</body></html>`);
}));

app.get('/api/schema', requireJwtSecret, auth, adminOnly, asyncRoute(async (_req, res) => {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = await fs.promises.readFile(schemaPath, 'utf8');
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
    console.log(`[START] 服装批发 ERP 已启动: http://localhost:${PORT}`);
    console.log(`[START] Supabase: ${supabase ? '已配置' : '未配置'}`);
    console.log(`[START] JWT: ${JWT_SECRET.length >= 32 ? '已配置' : '未配置/过短'}`);
    ensureAdminAccount().catch(error => console.error('[ADMIN] 初始化管理员失败:', error.message));
  });
  return server;
}

if (require.main === module) startServer();

module.exports = { app, startServer };
