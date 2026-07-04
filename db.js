/**
 * db.js - 服装批发订货系统 数据库模块
 * 基于 JSON 文件持久化，零外部依赖，MVP 阶段完全够用
 * 数据结构：customers, products, product_skus, orders, order_items
 */

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'wholesale.json');

// ========== 数据库结构定义 ==========
const SCHEMA_SQL = `
-- 1. 客户表
CREATE TABLE IF NOT EXISTS Customer (
  id          TEXT PRIMARY KEY,          -- 客户ID
  name        TEXT NOT NULL,             -- 客户名称
  phone       TEXT NOT NULL,             -- 联系电话
  company     TEXT,                      -- 公司/店铺名称
  address     TEXT,                      -- 收货地址
  level       TEXT DEFAULT 'normal',     -- 客户等级: normal/vip
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

-- 2. 商品表
CREATE TABLE IF NOT EXISTS Product (
  id          TEXT PRIMARY KEY,          -- 商品ID
  name        TEXT NOT NULL,             -- 商品名称
  category    TEXT NOT NULL,             -- 分类: 上衣/裤子/连衣裙/外套/套装
  description TEXT,                      -- 商品描述
  image_url   TEXT,                      -- 商品图片URL
  status      TEXT DEFAULT 'on_sale',    -- 状态: on_sale(在售)/off_sale(下架)
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

-- 3. 商品SKU表（颜色+尺码组合）
CREATE TABLE IF NOT EXISTS ProductSKU (
  id              TEXT PRIMARY KEY,      -- SKU ID
  product_id      TEXT NOT NULL,         -- 关联商品ID
  sku_code        TEXT NOT NULL UNIQUE,  -- SKU编码（如: T001-RED-M）
  color           TEXT NOT NULL,         -- 颜色
  size            TEXT NOT NULL,         -- 尺码: S/M/L/XL/XXL 或 均码
  stock           INTEGER DEFAULT 0,     -- 库存数量
  wholesale_price REAL NOT NULL,         -- 批发价（元）
  retail_price    REAL,                  -- 零售价（参考）
  FOREIGN KEY (product_id) REFERENCES Product(id)
);

-- 4. 订单表
CREATE TABLE IF NOT EXISTS Orders (
  id              TEXT PRIMARY KEY,      -- 订单ID
  order_no        TEXT NOT NULL UNIQUE,  -- 订单编号: ORD-YYYYMMDD-XXX
  customer_id     TEXT NOT NULL,         -- 客户ID
  customer_name   TEXT NOT NULL,         -- 客户名称（冗余）
  customer_phone  TEXT NOT NULL,         -- 客户电话（冗余）
  shipping_address TEXT NOT NULL,        -- 收货地址
  total_amount    REAL NOT NULL,         -- 订单总金额
  total_quantity  INTEGER NOT NULL,      -- 总件数
  status          TEXT DEFAULT 'pending',-- 状态: pending/confirmed/production/shipping/delivered/cancelled
  remark          TEXT,                  -- 订单备注
  created_at      TEXT DEFAULT (datetime('now','localtime')),
  updated_at      TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (customer_id) REFERENCES Customer(id)
);

-- 5. 订单明细表
CREATE TABLE IF NOT EXISTS OrderItem (
  id          TEXT PRIMARY KEY,          -- 明细ID
  order_id    TEXT NOT NULL,             -- 关联订单ID
  product_id  TEXT NOT NULL,             -- 商品ID
  product_name TEXT NOT NULL,            -- 商品名称（冗余）
  sku_id      TEXT NOT NULL,             -- SKU ID
  sku_code    TEXT NOT NULL,             -- SKU编码（冗余）
  color       TEXT NOT NULL,            -- 颜色（冗余）
  size        TEXT NOT NULL,             -- 尺码（冗余）
  quantity    INTEGER NOT NULL,          -- 数量
  unit_price  REAL NOT NULL,             -- 单价（下单时快照）
  subtotal    REAL NOT NULL,             -- 小计 = quantity * unit_price
  FOREIGN KEY (order_id) REFERENCES Orders(id)
);
`;

// ========== 种子数据 ==========
function generateSeedData() {
  const now = new Date().toISOString();
  const products = [
    { id: 'P001', name: '纯棉圆领短袖T恤', category: '上衣', description: '100%精梳棉，260g重磅，舒适透气', image_url: '', status: 'on_sale', created_at: now },
    { id: 'P002', name: '高腰直筒牛仔裤', category: '裤子', description: '弹力面料，修身版型，多色可选', image_url: '', status: 'on_sale', created_at: now },
    { id: 'P003', name: '法式碎花连衣裙', category: '连衣裙', description: '雪纺面料，收腰设计，春夏季爆款', image_url: '', status: 'on_sale', created_at: now },
    { id: 'P004', name: ' oversize工装外套', category: '外套', description: '宽松版型，多口袋设计，春秋季百搭', image_url: '', status: 'on_sale', created_at: now },
    { id: 'P005', name: '运动休闲套装', category: '套装', description: '速干面料，上下两件套，适合运动休闲', image_url: '', status: 'on_sale', created_at: now },
  ];

  const product_skus = [
    // P001 T恤
    { id: 'SKU001', product_id: 'P001', sku_code: 'T001-WHT-S', color: '白色', size: 'S', stock: 200, wholesale_price: 18.00, retail_price: 39.90 },
    { id: 'SKU002', product_id: 'P001', sku_code: 'T001-WHT-M', color: '白色', size: 'M', stock: 300, wholesale_price: 18.00, retail_price: 39.90 },
    { id: 'SKU003', product_id: 'P001', sku_code: 'T001-WHT-L', color: '白色', size: 'L', stock: 250, wholesale_price: 18.00, retail_price: 39.90 },
    { id: 'SKU004', product_id: 'P001', sku_code: 'T001-BLK-M', color: '黑色', size: 'M', stock: 180, wholesale_price: 18.00, retail_price: 39.90 },
    { id: 'SKU005', product_id: 'P001', sku_code: 'T001-BLK-L', color: '黑色', size: 'L', stock: 150, wholesale_price: 18.00, retail_price: 39.90 },
    // P002 牛仔裤
    { id: 'SKU006', product_id: 'P002', sku_code: 'J002-BLU-28', color: '蓝色', size: '28', stock: 100, wholesale_price: 45.00, retail_price: 89.90 },
    { id: 'SKU007', product_id: 'P002', sku_code: 'J002-BLU-30', color: '蓝色', size: '30', stock: 120, wholesale_price: 45.00, retail_price: 89.90 },
    { id: 'SKU008', product_id: 'P002', sku_code: 'J002-BLK-30', color: '黑色', size: '30', stock: 80, wholesale_price: 45.00, retail_price: 89.90 },
    { id: 'SKU009', product_id: 'P002', sku_code: 'J002-BLU-32', color: '蓝色', size: '32', stock: 60, wholesale_price: 45.00, retail_price: 89.90 },
    // P003 连衣裙
    { id: 'SKU010', product_id: 'P003', sku_code: 'D003-PNK-S', color: '粉色', size: 'S', stock: 90, wholesale_price: 55.00, retail_price: 129.00 },
    { id: 'SKU011', product_id: 'P003', sku_code: 'D003-PNK-M', color: '粉色', size: 'M', stock: 110, wholesale_price: 55.00, retail_price: 129.00 },
    { id: 'SKU012', product_id: 'P003', sku_code: 'D003-BLU-M', color: '蓝色', size: 'M', stock: 85, wholesale_price: 55.00, retail_price: 129.00 },
    // P004 外套
    { id: 'SKU013', product_id: 'P004', sku_code: 'C004-KHK-M', color: '卡其色', size: 'M', stock: 70, wholesale_price: 68.00, retail_price: 159.00 },
    { id: 'SKU014', product_id: 'P004', sku_code: 'C004-KHK-L', color: '卡其色', size: 'L', stock: 65, wholesale_price: 68.00, retail_price: 159.00 },
    { id: 'SKU015', product_id: 'P004', sku_code: 'C004-OLV-L', color: '军绿色', size: 'L', stock: 50, wholesale_price: 68.00, retail_price: 159.00 },
    // P005 套装
    { id: 'SKU016', product_id: 'P005', sku_code: 'S005-BLK-M', color: '黑色', size: 'M', stock: 100, wholesale_price: 78.00, retail_price: 189.00 },
    { id: 'SKU017', product_id: 'P005', sku_code: 'S005-GRY-L', color: '灰色', size: 'L', stock: 90, wholesale_price: 78.00, retail_price: 189.00 },
  ];

  const customers = [
    { id: 'C001', name: '张老板', phone: '13800138001', company: '杭州四季青服装城A区12号', address: '浙江省杭州市江干区四季青服装市场', level: 'vip', created_at: now },
    { id: 'C002', name: '李姐', phone: '13800138002', company: '广州十三行批发档口', address: '广东省广州市荔湾区十三行路', level: 'vip', created_at: now },
    { id: 'C003', name: '王经理', phone: '13800138003', company: '武汉汉正街服饰批发', address: '湖北省武汉市硚口区汉正街', level: 'normal', created_at: now },
  ];

  return { products, product_skus, customers, orders: [], order_items: [] };
}

// ========== 数据库操作类 ==========
class Database {
  constructor() {
    this.data = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.data = JSON.parse(raw);
      } else {
        this.data = generateSeedData();
        this.save();
      }
    } catch (err) {
      console.error('数据库加载失败，使用种子数据:', err.message);
      this.data = generateSeedData();
      this.save();
    }
  }

  save() {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  // 通用查询
  query(table, filterFn = null) {
    let rows = this.data[table] || [];
    if (filterFn) rows = rows.filter(filterFn);
    return rows;
  }

  queryOne(table, filterFn) {
    return (this.data[table] || []).find(filterFn);
  }

  insert(table, record) {
    if (!this.data[table]) this.data[table] = [];
    this.data[table].push(record);
    this.save();
    return record;
  }

  update(table, filterFn, updates) {
    const record = this.queryOne(table, filterFn);
    if (record) {
      Object.assign(record, updates, { updated_at: new Date().toISOString() });
      this.save();
    }
    return record;
  }

  // 生成订单编号
  generateOrderNo() {
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const count = this.data.orders.length + 1;
    return `ORD-${dateStr}-${String(count).padStart(3, '0')}`;
  }

  // 生成UUID
  uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // 获取商品列表（含SKU）
  getProductsWithSkus(filter = {}) {
    let products = this.data.products;
    if (filter.category) products = products.filter(p => p.category === filter.category);
    if (filter.status) products = products.filter(p => p.status === filter.status);
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase();
      products = products.filter(p => p.name.toLowerCase().includes(kw) || (p.description && p.description.toLowerCase().includes(kw)));
    }
    return products.map(p => {
      const skus = this.data.product_skus.filter(s => s.product_id === p.id);
      return { ...p, skus };
    });
  }

  // 获取单个商品（含SKU）
  getProductById(id) {
    const product = this.data.products.find(p => p.id === id);
    if (!product) return null;
    const skus = this.data.product_skus.filter(s => s.product_id === id);
    return { ...product, skus };
  }

  // 创建订单（带事务性检查）
  createOrder(orderData) {
    const { customer_id, shipping_address, remark, items } = orderData;

    // 验证客户
    const customer = this.data.customers.find(c => c.id === customer_id);
    if (!customer) throw new Error('客户不存在');

    // 验证SKU并计算金额
    let total_amount = 0;
    let total_quantity = 0;
    const order_items = [];

    for (const item of items) {
      const sku = this.data.product_skus.find(s => s.id === item.sku_id);
      if (!sku) throw new Error(`SKU ${item.sku_id} 不存在`);
      if (sku.stock < item.quantity) throw new Error(`SKU ${sku.sku_code} 库存不足（库存${sku.stock}，需${item.quantity}）`);

      const product = this.data.products.find(p => p.id === sku.product_id);
      const subtotal = sku.wholesale_price * item.quantity;
      total_amount += subtotal;
      total_quantity += item.quantity;

      order_items.push({
        id: this.uuid(),
        order_id: null, // 稍后设置
        product_id: sku.product_id,
        product_name: product.name,
        sku_id: sku.id,
        sku_code: sku.sku_code,
        color: sku.color,
        size: sku.size,
        quantity: item.quantity,
        unit_price: sku.wholesale_price,
        subtotal: subtotal,
      });
    }

    // 创建订单
    const order_id = this.uuid();
    order_items.forEach(oi => { oi.order_id = order_id; });

    const order = {
      id: order_id,
      order_no: this.generateOrderNo(),
      customer_id,
      customer_name: customer.name,
      customer_phone: customer.phone,
      shipping_address: shipping_address || customer.address,
      total_amount,
      total_quantity,
      status: 'pending',
      remark: remark || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.data.orders.push(order);
    this.data.order_items.push(...order_items);

    // 扣减库存
    for (const item of items) {
      const sku = this.data.product_skus.find(s => s.id === item.sku_id);
      sku.stock -= item.quantity;
    }

    this.save();
    return { order, items: order_items };
  }

  // 获取订单列表（含明细）
  getOrders(filter = {}) {
    let orders = [...this.data.orders];
    if (filter.status) orders = orders.filter(o => o.status === filter.status);
    if (filter.customer_id) orders = orders.filter(o => o.customer_id === filter.customer_id);
    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase();
      orders = orders.filter(o => o.order_no.toLowerCase().includes(kw) || o.customer_name.toLowerCase().includes(kw));
    }
    // 按创建时间倒序
    orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return orders;
  }

  // 获取订单详情（含明细）
  getOrderById(id) {
    const order = this.data.orders.find(o => o.id === id || o.order_no === id);
    if (!order) return null;
    const items = this.data.order_items.filter(oi => oi.order_id === order.id);
    const customer = this.data.customers.find(c => c.id === order.customer_id);
    return { ...order, items, customer };
  }

  // 更新订单状态
  updateOrderStatus(id, status) {
    const validStatuses = ['pending', 'confirmed', 'production', 'shipping', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) throw new Error(`无效状态，可选: ${validStatuses.join(', ')}`);
    const order = this.data.orders.find(o => o.id === id || o.order_no === id);
    if (!order) throw new Error('订单不存在');

    // 如果取消订单，恢复库存
    if (status === 'cancelled' && order.status !== 'cancelled') {
      const items = this.data.order_items.filter(oi => oi.order_id === order.id);
      items.forEach(item => {
        const sku = this.data.product_skus.find(s => s.id === item.sku_id);
        if (sku) sku.stock += item.quantity;
      });
    }

    // 如果从cancelled恢复为其他状态，重新扣库存
    if (order.status === 'cancelled' && status !== 'cancelled') {
      const items = this.data.order_items.filter(oi => oi.order_id === order.id);
      items.forEach(item => {
        const sku = this.data.product_skus.find(s => s.id === item.sku_id);
        if (sku) {
          if (sku.stock < item.quantity) throw new Error(`SKU ${item.sku_code} 库存不足，无法恢复订单`);
          sku.stock -= item.quantity;
        }
      });
    }

    order.status = status;
    order.updated_at = new Date().toISOString();
    this.save();
    return order;
  }

  // 仪表盘统计
  getDashboardStats() {
    const orders = this.data.orders;
    const statusCount = {};
    orders.forEach(o => { statusCount[o.status] = (statusCount[o.status] || 0) + 1; });

    const today = new Date().toDateString();
    const todayOrders = orders.filter(o => new Date(o.created_at).toDateString() === today);
    const todayRevenue = todayOrders.reduce((sum, o) => sum + o.total_amount, 0);
    const totalRevenue = orders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.total_amount, 0);

    const lowStockSkus = this.data.product_skus.filter(s => s.stock < 50);

    return {
      total_orders: orders.length,
      status_count: statusCount,
      today_orders: todayOrders.length,
      today_revenue: todayRevenue,
      total_revenue: totalRevenue,
      total_products: this.data.products.length,
      total_customers: this.data.customers.length,
      low_stock_skus: lowStockSkus,
    };
  }
}

module.exports = { Database, SCHEMA_SQL, generateSeedData };
