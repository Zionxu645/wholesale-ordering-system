# 服装批发订货系统 MVP 方案

> 可直接运行 | 7天可上线 | 真实订单流转 | 数据结构化

## 快速启动

```bash
cd wholesale-ordering-system
npm install
npm start
```

| 入口 | 地址 |
|------|------|
| 前台订货页面 | http://localhost:3000/ |
| 后台管理面板 | http://localhost:3000/admin |
| API 健康检查 | http://localhost:3000/api/health |
| SQL 建表脚本 | http://localhost:3000/api/schema |

---

## 1️⃣ 系统架构

### 四层架构设计

```
┌─────────────────────────────────────────────────────┐
│  客户端层 (Client Layer)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ 前台订货页面  │  │ 后台管理面板  │  │ 移动端(扩展)│ │
│  │ HTML+JS      │  │ Dashboard    │  │ 小程序/H5  │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
└────────────────────────┬────────────────────────────┘
                         │ HTTP / REST API
┌────────────────────────┴────────────────────────────┐
│  API 服务层 (Express Server :3000)                   │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │
│  │商品API │ │订单API │ │客户API │ │统计API │        │
│  └────────┘ └────────┘ └────────┘ └────────┘        │
│  CORS | JSON Parser | Static Files | Logger          │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────┴─────────────┐
│  数据层 (JSON File Storage)           │  ┌────────────────────────┐
│  ┌─────────┐ ┌────────┐ ┌──────────┐ │  │ AI 自动化层             │
│  │Customer │ │Product │ │ProductSKU│ │  │ ┌─────────┐ ┌─────────┐│
│  └─────────┘ └────────┘ └──────────┘ │  │ │订单触发  │ │状态触发  ││
│  ┌─────────┐ ┌────────┐              │  │ └─────────┘ └─────────┘│
│  │ Orders  │ │OrderItem│             │  │ ┌─────────┐ ┌─────────┐│
│  └─────────┘ └────────┘              │  │ │低库存预警│ │每日汇总  ││
│  wholesale.json                       │  │ └─────────┘ └─────────┘│
│  (可平滑迁移至 SQLite/MySQL)           │  │ 飞书/企微/邮件通知      │
└───────────────────────────────────────┘  └────────────────────────┘
```

### 技术选型

| 层级 | 技术 | 选型理由 |
|------|------|----------|
| 前端 | HTML5 + Vanilla JS + CSS3 | 零构建、零依赖、即时可运行 |
| 后端 | Node.js 22 + Express 4 | 轻量、生态成熟、前后端同语言 |
| 数据 | JSON 文件存储 | 零安装、可迁移至 SQLite/MySQL |
| 部署 | 本地/云服务器 | `node server.js` 一键启动 |

---

## 2️⃣ 页面结构

### 前台页面（客户使用）

| 页面 | 功能 | 数据来源 |
|------|------|----------|
| 首页/商品列表 | 商品瀑布流展示、分类筛选、关键词搜索 | `GET /api/products` |
| 商品详情弹窗 | 展示SKU规格表(颜色/尺码/价格/库存)、输入订货数量 | `GET /api/products/:id` |
| 购物车弹窗 | 订货清单管理、修改数量、查看小计和总价 | 前端内存 cart[] |
| 下单确认弹窗 | 选择客户、确认收货地址、填写备注、查看明细汇总 | `GET /api/customers` + cart[] |
| 订单成功弹窗 | 显示订单号、金额、继续选货入口 | `POST /api/orders` 返回值 |

### 后台页面（商家使用）

| 页面 | 功能 | 数据来源 |
|------|------|----------|
| 仪表盘 | 今日订单/营收、累计营收、总商品/客户数、低库存预警、最近订单 | `GET /api/dashboard` |
| 订单管理 | 订单列表、按状态筛选、查看订单详情、更新订单状态 | `GET /api/orders` + `PATCH /api/orders/:id/status` |
| 商品管理 | 商品列表、新增商品、添加SKU、查看库存 | `GET /api/products` + `POST /api/products` |
| 客户管理 | 客户列表、新增客户、查看客户订单统计 | `GET /api/customers` + `POST /api/customers` |

---

## 3️⃣ 数据库设计

### ER 关系

```
Customer (1) ──< (N) Orders (1) ──< (N) OrderItem (N) >── (1) ProductSKU (N) >── (1) Product
```

### 完整建表 SQL

> 完整 SQL 见 `schema.sql` 文件，或访问 `http://localhost:3000/api/schema`

#### Customer 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 客户ID (C001) |
| name | TEXT NOT NULL | 客户名称 |
| phone | TEXT NOT NULL | 联系电话 |
| company | TEXT | 公司/店铺名称 |
| address | TEXT | 收货地址 |
| level | TEXT | 等级: normal/vip |
| created_at | TEXT | 创建时间 |

#### Product 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 商品ID (P001) |
| name | TEXT NOT NULL | 商品名称 |
| category | TEXT NOT NULL | 分类: 上衣/裤子/连衣裙/外套/套装 |
| description | TEXT | 商品描述 |
| image_url | TEXT | 商品图片URL |
| status | TEXT | 状态: on_sale/off_sale |
| created_at | TEXT | 创建时间 |

#### ProductSKU 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | SKU ID (SKU001) |
| product_id | TEXT FK | 关联商品ID |
| sku_code | TEXT UNIQUE | SKU编码 (T001-WHT-M) |
| color | TEXT NOT NULL | 颜色 |
| size | TEXT NOT NULL | 尺码 |
| stock | INTEGER | 库存数量 |
| wholesale_price | REAL NOT NULL | 批发价 |
| retail_price | REAL | 零售价(参考) |

#### Orders 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 订单UUID |
| order_no | TEXT UNIQUE | 订单编号 (ORD-YYYYMMDD-XXX) |
| customer_id | TEXT FK | 客户ID |
| customer_name | TEXT | 客户名称(冗余) |
| customer_phone | TEXT | 客户电话(冗余) |
| shipping_address | TEXT | 收货地址 |
| total_amount | REAL | 订单总金额 |
| total_quantity | INTEGER | 总件数 |
| status | TEXT | pending→confirmed→production→shipping→delivered / cancelled |
| remark | TEXT | 备注 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

#### OrderItem 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 明细UUID |
| order_id | TEXT FK | 关联订单ID |
| product_id | TEXT | 商品ID |
| product_name | TEXT | 商品名称(快照) |
| sku_id | TEXT | SKU ID |
| sku_code | TEXT | SKU编码(快照) |
| color | TEXT | 颜色(快照) |
| size | TEXT | 尺码(快照) |
| quantity | INTEGER | 数量 |
| unit_price | REAL | 单价(下单时快照) |
| subtotal | REAL | 小计 = quantity × unit_price |

---

## 4️⃣ API 设计

### 基础信息

| 项目 | 值 |
|------|-----|
| Base URL | `http://localhost:3000/api` |
| 请求格式 | JSON |
| 响应格式 | `{ code: 0, data: {}, message: "" }` |
| 错误响应 | `{ code: 1, message: "错误描述" }` |

### API 列表

| 方法 | 路径 | 说明 | 请求参数 | 响应数据 |
|------|------|------|----------|----------|
| GET | `/products` | 获取商品列表(含SKU) | query: category, keyword, status | Product[] |
| GET | `/products/:id` | 获取商品详情(含SKU) | path: id | Product |
| POST | `/products` | 创建商品 | body: name, category, description | Product |
| POST | `/products/:id/skus` | 添加SKU | body: color, size, stock, wholesale_price | SKU |
| PATCH | `/products/:id` | 更新商品 | body: name, category, status | Product |
| POST | `/orders` | **创建订单** | body: customer_id, items[{sku_id, quantity}] | {order, items} |
| GET | `/orders` | **获取订单列表** | query: status, customer_id, keyword | Order[] |
| GET | `/orders/:id` | 获取订单详情(含明细) | path: id | Order + items[] |
| PATCH | `/orders/:id/status` | **更新订单状态** | body: status | Order |
| GET | `/customers` | 获取客户列表 | - | Customer[] |
| POST | `/customers` | 创建客户 | body: name, phone, company, address | Customer |
| GET | `/dashboard` | 仪表盘统计 | - | Stats |
| GET | `/health` | 健康检查 | - | {status, version} |
| GET | `/schema` | 获取SQL建表脚本 | - | SQL text |

### 核心 API 示例

#### 创建订单

```
POST /api/orders
Content-Type: application/json

{
  "customer_id": "C001",
  "shipping_address": "浙江省杭州市江干区四季青服装市场",
  "remark": "加急订单，3天内发货",
  "items": [
    { "sku_id": "SKU001", "quantity": 10 },
    { "sku_id": "SKU006", "quantity": 5 }
  ]
}

Response 201:
{
  "code": 0,
  "data": {
    "order": {
      "id": "uuid-xxx",
      "order_no": "ORD-20260704-001",
      "customer_name": "张老板",
      "total_amount": 405.00,
      "total_quantity": 15,
      "status": "pending"
    },
    "items": [
      { "sku_code": "T001-WHT-S", "quantity": 10, "unit_price": 18.00, "subtotal": 180.00 },
      { "sku_code": "J002-BLU-28", "quantity": 5, "unit_price": 45.00, "subtotal": 225.00 }
    ]
  },
  "message": "订单创建成功: ORD-20260704-001"
}
```

#### 更新订单状态

```
PATCH /api/orders/:id/status
Content-Type: application/json

{ "status": "confirmed" }

Response:
{
  "code": 0,
  "data": { "id": "xxx", "status": "confirmed", ... },
  "message": "订单状态已更新为: confirmed"
}
```

---

## 5️⃣ MVP 实现方案

### 选择路径：Web 开发方案

| 对比项 | Web方案(本方案) | 飞书低代码 | 小程序方案 |
|--------|-----------------|-----------|-----------|
| 开发周期 | 3-5天 | 2-3天 | 5-7天 |
| 技术门槛 | 低(全栈JS) | 极低 | 中(需小程序开发经验) |
| 可定制性 | 高 | 低 | 中 |
| 部署成本 | 0元(本地) / 低(云) | 0元 | 需服务器+认证费 |
| 扩展性 | 高(可迁移任何后端) | 低(锁定飞书) | 中 |

### 技术栈明细

| 组件 | 技术 | 版本 |
|------|------|------|
| 运行时 | Node.js | 22.x |
| Web框架 | Express | 4.18 |
| 跨域 | cors | 2.8 |
| 存储 | JSON文件 | - |
| 前端 | HTML5 + Vanilla JS | 原生 |
| 样式 | CSS3 (CSS Variables) | 原生 |

### 开发周期排期（5天）

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 1 | 数据库设计 + API骨架 | db.js + 基础路由 |
| Day 2 | 核心API开发 + 单元测试 | 完整CRUD接口 |
| Day 3 | 前台订货页面 | 商品浏览+下单流程 |
| Day 4 | 后台管理页面 | 仪表盘+订单管理+商品管理 |
| Day 5 | 联调测试 + 部署上线 | 可用系统 |

### 成本估算

| 项目 | 费用 | 说明 |
|------|------|------|
| 开发 | ¥0 | 自主开发 |
| 服务器 | ¥0~50/月 | 本地运行0元；云服务器约50元/月 |
| 域名 | ¥0~55/年 | 可选，用IP访问则0元 |
| 数据库 | ¥0 | JSON文件存储，后续可迁移SQLite(免费) |
| **合计** | **¥0** | MVP阶段零成本 |

---

## 6️⃣ AI 自动化设计

### 自动化场景

| 序号 | 场景 | 触发条件 | 输出结果 |
|------|------|----------|----------|
| 1 | 新订单通知 | `POST /api/orders` 创建成功 | 飞书/企微机器人推送订单详情(客户/商品/金额) |
| 2 | 订单状态变更通知 | `PATCH /api/orders/:id/status` | 推送状态变更通知给相关客户和仓库 |
| 3 | 低库存预警 | 定时检查 stock < 50 | 推送低库存SKU列表给采购 |
| 4 | 每日订单汇总 | 每日定时(如18:00) | 汇总当日订单数/金额/待处理项 |
| 5 | 生产排单自动生成 | 订单状态→confirmed | 根据订单明细生成生产任务清单 |
| 6 | 发货通知 | 订单状态→shipping | 自动生成快递信息推送给客户 |

### Webhook 实现方案

在 `server.js` 的订单创建和状态更新接口中，添加 Webhook 调用：

```javascript
// 订单创建后自动推送
async function notifyNewOrder(order) {
  const webhookUrl = process.env.WEBHOOK_URL; // 飞书/企微机器人URL
  if (!webhookUrl) return;

  const message = {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: `📦 新订单: ${order.order_no}` } },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: `**客户:** ${order.customer_name}\n**金额:** ¥${order.total_amount}\n**件数:** ${order.total_quantity}件\n**备注:** ${order.remark || '无'}` } },
        { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看详情' }, url: `http://localhost:3000/admin`, type: 'primary' }] }
      ]
    }
  };

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
}
```

### 自动化触发流程

```
客户下单 (POST /api/orders)
    │
    ├─→ [Webhook] 飞书机器人推送新订单通知
    │
    ├─→ [定时任务] 18:00 每日汇总推送到商家群
    │
    └─→ 订单确认 (PATCH status=confirmed)
            │
            ├─→ [Webhook] 推送确认通知给客户
            │
            └─→ 订单排产 (PATCH status=production)
                    │
                    └─→ [自动生成] 生产任务清单 (按SKU汇总数量)
                            │
                            └─→ 发货 (PATCH status=shipping)
                                    │
                                    └─→ [Webhook] 推送发货通知给客户
```

---

## 项目文件结构

```
wholesale-ordering-system/
├── server.js              # Express 服务器 + API 路由
├── db.js                  # 数据库模块 (JSON存储 + 种子数据)
├── schema.sql             # SQL建表脚本 (SQLite/MySQL兼容)
├── package.json           # 项目依赖配置
├── README.md              # 本文件
├── data/
│   └── wholesale.json     # 数据文件 (自动生成)
└── public/
    ├── index.html         # 前台订货页面
    ├── admin.html         # 后台管理页面
    └── assets/
        ├── style.css      # 全局样式
        ├── app.js         # 前台JS逻辑
        └── admin.js       # 后台JS逻辑
```

---

## 订单状态流转

```
pending (待确认)
   │  确认订单
   ├─→ confirmed (已确认)
   │      │  排产
   │      ├─→ production (生产中)
   │      │      │  发货
   │      │      ├─→ shipping (发货中)
   │      │      │      │  送达确认
   │      │      │      └─→ delivered (已送达) ✓ 完成
   │      │      │
   │  取消  ↓
   └──→ cancelled (已取消) — 库存自动回退
```

### 状态说明

| 状态 | 含义 | 可执行操作 |
|------|------|-----------|
| pending | 客户已下单，等待商家确认 | 确认订单 / 取消订单 |
| confirmed | 商家已确认，准备排产 | 开始生产 / 取消订单 |
| production | 生产中 | 开始发货 |
| shipping | 发货中 | 确认送达 |
| delivered | 已送达 | 无 (终态) |
| cancelled | 已取消 (库存回退) | 无 (终态) |
