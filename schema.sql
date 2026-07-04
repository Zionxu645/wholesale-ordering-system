-- ============================================
-- 服装批发订货系统 - 数据库建表脚本 (SQLite / MySQL 兼容)
-- 文件: schema.sql
-- ============================================

-- 1. 客户表
CREATE TABLE IF NOT EXISTS Customer (
  id          TEXT PRIMARY KEY,            -- 客户ID: C001, C002...
  name        TEXT NOT NULL,               -- 客户名称
  phone       TEXT NOT NULL,               -- 联系电话
  company     TEXT,                        -- 公司/店铺名称
  address     TEXT,                        -- 收货地址
  level       TEXT DEFAULT 'normal',       -- 客户等级: normal(普通) / vip
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

-- 2. 商品表
CREATE TABLE IF NOT EXISTS Product (
  id          TEXT PRIMARY KEY,            -- 商品ID: P001, P002...
  name        TEXT NOT NULL,               -- 商品名称
  category    TEXT NOT NULL,               -- 分类: 上衣/裤子/连衣裙/外套/套装
  description TEXT,                        -- 商品描述
  image_url   TEXT,                        -- 商品图片URL
  status      TEXT DEFAULT 'on_sale',      -- 状态: on_sale(在售) / off_sale(下架)
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);

-- 3. 商品SKU表 (颜色+尺码组合)
CREATE TABLE IF NOT EXISTS ProductSKU (
  id              TEXT PRIMARY KEY,        -- SKU ID: SKU001, SKU002...
  product_id      TEXT NOT NULL,           -- 关联商品ID
  sku_code        TEXT NOT NULL UNIQUE,    -- SKU编码: T001-WHT-M
  color           TEXT NOT NULL,           -- 颜色
  size            TEXT NOT NULL,           -- 尺码: S/M/L/XL/XXL 或 28/30/32 或 均码
  stock           INTEGER DEFAULT 0,       -- 库存数量
  wholesale_price REAL NOT NULL,           -- 批发价 (元)
  retail_price    REAL,                    -- 零售价 (元, 参考)
  FOREIGN KEY (product_id) REFERENCES Product(id)
);

-- 4. 订单表
CREATE TABLE IF NOT EXISTS Orders (
  id              TEXT PRIMARY KEY,        -- 订单UUID
  order_no        TEXT NOT NULL UNIQUE,    -- 订单编号: ORD-YYYYMMDD-XXX
  customer_id     TEXT NOT NULL,           -- 客户ID
  customer_name   TEXT NOT NULL,           -- 客户名称 (冗余, 加速查询)
  customer_phone  TEXT NOT NULL,           -- 客户电话 (冗余)
  shipping_address TEXT NOT NULL,          -- 收货地址
  total_amount    REAL NOT NULL,           -- 订单总金额
  total_quantity  INTEGER NOT NULL,        -- 总件数
  status          TEXT DEFAULT 'pending',  -- pending/confirmed/production/shipping/delivered/cancelled
  remark          TEXT,                    -- 订单备注
  created_at      TEXT DEFAULT (datetime('now','localtime')),
  updated_at      TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (customer_id) REFERENCES Customer(id)
);

-- 5. 订单明细表
CREATE TABLE IF NOT EXISTS OrderItem (
  id          TEXT PRIMARY KEY,            -- 明细UUID
  order_id    TEXT NOT NULL,               -- 关联订单ID
  product_id  TEXT NOT NULL,               -- 商品ID
  product_name TEXT NOT NULL,              -- 商品名称 (快照)
  sku_id      TEXT NOT NULL,               -- SKU ID
  sku_code    TEXT NOT NULL,               -- SKU编码 (快照)
  color       TEXT NOT NULL,               -- 颜色 (快照)
  size        TEXT NOT NULL,               -- 尺码 (快照)
  quantity    INTEGER NOT NULL,            -- 数量
  unit_price  REAL NOT NULL,               -- 单价 (下单时快照, 不随后续改价变化)
  subtotal    REAL NOT NULL,               -- 小计 = quantity * unit_price
  FOREIGN KEY (order_id) REFERENCES Orders(id)
);

-- ============================================
-- 索引 (提升查询性能)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_sku_product ON ProductSKU(product_id);
CREATE INDEX IF NOT EXISTS idx_order_customer ON Orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_status ON Orders(status);
CREATE INDEX IF NOT EXISTS idx_orderitem_order ON OrderItem(order_id);
CREATE INDEX IF NOT EXISTS idx_order_created ON Orders(created_at);

-- ============================================
-- 种子数据 (可选, 用于初始演示)
-- ============================================

INSERT INTO Customer (id, name, phone, company, address, level) VALUES
('C001', '张老板', '13800138001', '杭州四季青服装城A区12号', '浙江省杭州市江干区四季青服装市场', 'vip'),
('C002', '李姐', '13800138002', '广州十三行批发档口', '广东省广州市荔湾区十三行路', 'vip'),
('C003', '王经理', '13800138003', '武汉汉正街服饰批发', '湖北省武汉市硚口区汉正街', 'normal');

INSERT INTO Product (id, name, category, description, status) VALUES
('P001', '纯棉圆领短袖T恤', '上衣', '100%精梳棉，260g重磅，舒适透气', 'on_sale'),
('P002', '高腰直筒牛仔裤', '裤子', '弹力面料，修身版型，多色可选', 'on_sale'),
('P003', '法式碎花连衣裙', '连衣裙', '雪纺面料，收腰设计，春夏季爆款', 'on_sale'),
('P004', 'oversize工装外套', '外套', '宽松版型，多口袋设计，春秋季百搭', 'on_sale'),
('P005', '运动休闲套装', '套装', '速干面料，上下两件套，适合运动休闲', 'on_sale');

INSERT INTO ProductSKU (id, product_id, sku_code, color, size, stock, wholesale_price, retail_price) VALUES
('SKU001', 'P001', 'T001-WHT-S', '白色', 'S', 200, 18.00, 39.90),
('SKU002', 'P001', 'T001-WHT-M', '白色', 'M', 300, 18.00, 39.90),
('SKU003', 'P001', 'T001-WHT-L', '白色', 'L', 250, 18.00, 39.90),
('SKU004', 'P001', 'T001-BLK-M', '黑色', 'M', 180, 18.00, 39.90),
('SKU005', 'P001', 'T001-BLK-L', '黑色', 'L', 150, 18.00, 39.90),
('SKU006', 'P002', 'J002-BLU-28', '蓝色', '28', 100, 45.00, 89.90),
('SKU007', 'P002', 'J002-BLU-30', '蓝色', '30', 120, 45.00, 89.90),
('SKU008', 'P002', 'J002-BLK-30', '黑色', '30', 80, 45.00, 89.90),
('SKU009', 'P002', 'J002-BLU-32', '蓝色', '32', 60, 45.00, 89.90),
('SKU010', 'P003', 'D003-PNK-S', '粉色', 'S', 90, 55.00, 129.00),
('SKU011', 'P003', 'D003-PNK-M', '粉色', 'M', 110, 55.00, 129.00),
('SKU012', 'P003', 'D003-BLU-M', '蓝色', 'M', 85, 55.00, 129.00),
('SKU013', 'P004', 'C004-KHK-M', '卡其色', 'M', 70, 68.00, 159.00),
('SKU014', 'P004', 'C004-KHK-L', '卡其色', 'L', 65, 68.00, 159.00),
('SKU015', 'P004', 'C004-OLV-L', '军绿色', 'L', 50, 68.00, 159.00),
('SKU016', 'P005', 'S005-BLK-M', '黑色', 'M', 100, 78.00, 189.00),
('SKU017', 'P005', 'S005-GRY-L', '灰色', 'L', 90, 78.00, 189.00);
