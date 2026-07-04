/**
 * server.js - 服装批发订货系统 API 服务
 * 技术栈: Node.js + Express + JSON文件存储
 * 端口: 3000
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Database, SCHEMA_SQL } = require('./db');

const app = express();
const PORT = 3000;
const db = new Database();

// ========== 中间件 ==========
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 简单请求日志
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ========== API 路由 ==========

// ------------------------------
// 健康检查
// ------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: '服装批发订货系统', version: '1.0.0' });
});

// ------------------------------
// 商品相关 API
// ------------------------------

/**
 * GET /api/products - 获取商品列表（含SKU）
 * Query: category, keyword, status
 */
app.get('/api/products', (req, res) => {
  const { category, keyword, status } = req.query;
  const products = db.getProductsWithSkus({ category, keyword, status });
  res.json({ code: 0, data: products, total: products.length });
});

/**
 * GET /api/products/:id - 获取商品详情（含SKU）
 */
app.get('/api/products/:id', (req, res) => {
  const product = db.getProductById(req.params.id);
  if (!product) return res.status(404).json({ code: 1, message: '商品不存在' });
  res.json({ code: 0, data: product });
});

/**
 * POST /api/products - 创建商品
 * Body: { name, category, description, image_url }
 */
app.post('/api/products', (req, res) => {
  const { name, category, description, image_url } = req.body;
  if (!name || !category) return res.status(400).json({ code: 1, message: '商品名称和分类为必填' });
  const product = {
    id: `P${String(db.data.products.length + 1).padStart(3, '0')}`,
    name, category, description: description || '', image_url: image_url || '',
    status: 'on_sale', created_at: new Date().toISOString(),
  };
  db.insert('products', product);
  res.json({ code: 0, data: product, message: '商品创建成功' });
});

/**
 * POST /api/products/:id/skus - 为商品添加SKU
 * Body: { color, size, stock, wholesale_price, retail_price }
 */
app.post('/api/products/:id/skus', (req, res) => {
  const product = db.data.products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ code: 1, message: '商品不存在' });
  const { color, size, stock, wholesale_price, retail_price } = req.body;
  if (!color || !size || !wholesale_price) return res.status(400).json({ code: 1, message: '颜色、尺码、批发价为必填' });
  const skuCount = db.data.product_skus.filter(s => s.product_id === product.id).length + 1;
  const skuCode = `${product.id.replace('P', '')}-${color.substring(0, 3).toUpperCase()}-${size}-${String(skuCount).padStart(2, '0')}`;
  const sku = {
    id: `SKU${String(db.data.product_skus.length + 1).padStart(3, '0')}`,
    product_id: product.id, sku_code: skuCode,
    color, size, stock: stock || 0,
    wholesale_price: parseFloat(wholesale_price), retail_price: retail_price ? parseFloat(retail_price) : null,
  };
  db.insert('product_skus', sku);
  res.json({ code: 0, data: sku, message: 'SKU添加成功' });
});

/**
 * PATCH /api/products/:id - 更新商品
 */
app.patch('/api/products/:id', (req, res) => {
  const updates = {};
  ['name', 'category', 'description', 'image_url', 'status'].forEach(f => {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  });
  const product = db.update('products', p => p.id === req.params.id, updates);
  if (!product) return res.status(404).json({ code: 1, message: '商品不存在' });
  res.json({ code: 0, data: product, message: '商品更新成功' });
});

// ------------------------------
// 订单相关 API
// ------------------------------

/**
 * POST /api/orders - 创建订单
 * Body: {
 *   customer_id: "C001",
 *   shipping_address: "收货地址（可选，默认客户地址）",
 *   remark: "备注（可选）",
 *   items: [
 *     { sku_id: "SKU001", quantity: 10 },
 *     { sku_id: "SKU006", quantity: 5 }
 *   ]
 * }
 */
app.post('/api/orders', (req, res) => {
  try {
    const { customer_id, shipping_address, remark, items } = req.body;
    if (!customer_id) return res.status(400).json({ code: 1, message: '客户ID为必填' });
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ code: 1, message: '至少需要1个商品' });
    for (const item of items) {
      if (!item.sku_id || !item.quantity || item.quantity < 1) return res.status(400).json({ code: 1, message: '每个商品需指定sku_id和有效数量' });
    }
    const result = db.createOrder({ customer_id, shipping_address, remark, items });
    res.status(201).json({ code: 0, data: result, message: `订单创建成功: ${result.order.order_no}` });
  } catch (err) {
    res.status(400).json({ code: 1, message: err.message });
  }
});

/**
 * GET /api/orders - 获取订单列表
 * Query: status, customer_id, keyword, page, page_size
 */
app.get('/api/orders', (req, res) => {
  const { status, customer_id, keyword, page = 1, page_size = 20 } = req.query;
  let orders = db.getOrders({ status, customer_id, keyword });
  // 分页
  const pageNum = parseInt(page);
  const pageSize = parseInt(page_size);
  const start = (pageNum - 1) * pageSize;
  const paged = orders.slice(start, start + pageSize);
  res.json({ code: 0, data: paged, total: orders.length, page: pageNum, page_size: pageSize });
});

/**
 * GET /api/orders/:id - 获取订单详情（含明细）
 */
app.get('/api/orders/:id', (req, res) => {
  const order = db.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ code: 1, message: '订单不存在' });
  res.json({ code: 0, data: order });
});

/**
 * PATCH /api/orders/:id/status - 更新订单状态
 * Body: { status: "confirmed" }
 * 状态流转: pending → confirmed → production → shipping → delivered
 *           pending/confirmed → cancelled
 */
app.patch('/api/orders/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ code: 1, message: 'status为必填' });
    const order = db.updateOrderStatus(req.params.id, status);
    res.json({ code: 0, data: order, message: `订单状态已更新为: ${status}` });
  } catch (err) {
    res.status(400).json({ code: 1, message: err.message });
  }
});

// ------------------------------
// 客户相关 API
// ------------------------------

/**
 * GET /api/customers - 获取客户列表
 */
app.get('/api/customers', (req, res) => {
  let customers = db.query('customers');
  // 附带订单统计
  customers = customers.map(c => {
    const orders = db.data.orders.filter(o => o.customer_id === c.id);
    return { ...c, order_count: orders.length, total_amount: orders.reduce((s, o) => s + o.total_amount, 0) };
  });
  res.json({ code: 0, data: customers });
});

/**
 * POST /api/customers - 创建客户
 * Body: { name, phone, company, address }
 */
app.post('/api/customers', (req, res) => {
  const { name, phone, company, address } = req.body;
  if (!name || !phone) return res.status(400).json({ code: 1, message: '客户名称和电话为必填' });
  const customer = {
    id: `C${String(db.data.customers.length + 1).padStart(3, '0')}`,
    name, phone, company: company || '', address: address || '',
    level: 'normal', created_at: new Date().toISOString(),
  };
  db.insert('customers', customer);
  res.json({ code: 0, data: customer, message: '客户创建成功' });
});

// ------------------------------
// 仪表盘统计 API
// ------------------------------

/**
 * GET /api/dashboard - 获取仪表盘统计数据
 */
app.get('/api/dashboard', (req, res) => {
  const stats = db.getDashboardStats();
  res.json({ code: 0, data: stats });
});

// ------------------------------
// SQL DDL 导出（供开发者参考）
// ------------------------------
app.get('/api/schema', (req, res) => {
  res.type('text/plain').send(SCHEMA_SQL);
});

// ========== 前端路由 ==========
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/order', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== 错误处理 ==========
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ code: 1, message: '服务器内部错误', error: err.message });
});

// ========== 启动服务 ==========
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('========================================');
  console.log('  服装批发订货系统 MVP 已启动');
  console.log('========================================');
  console.log(`  📦 前台订货页面:  http://localhost:${PORT}/`);
  console.log(`  🛠️  后台管理页面:  http://localhost:${PORT}/admin`);
  console.log(`  🔌 API 接口:      http://localhost:${PORT}/api/`);
  console.log(`  📊 仪表盘API:     http://localhost:${PORT}/api/dashboard`);
  console.log(`  📋 SQL建表语句:    http://localhost:${PORT}/api/schema`);
  console.log('========================================');
  console.log('');
  console.log('  订单状态流转:');
  console.log('  pending(待确认) → confirmed(已确认) → production(生产中)');
  console.log('  → shipping(发货中) → delivered(已送达)');
  console.log('  pending/confirmed → cancelled(已取消)');
  console.log('========================================');
  console.log('');
});
