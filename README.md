# 服装批发订货 + ERP 管理系统

这是统一修复后的 Supabase 版本，包含：

- 客户手机号注册、登录、JWT 鉴权
- 商品与 SKU（颜色、尺码、库存、批发价）
- 数据库购物车
- 购物车下单、订单明细、库存扣减
- 客户数据隔离
- ERP 管理员后台
- 订单状态流转
- 仪表盘统计和低库存提醒
- 生产单 JSON 和 HTML 打印
- GitHub / Render 部署配置

## 目录

```text
.
├─ public/
│  ├─ index.html            客户订货前台
│  ├─ admin.html            ERP 管理后台
│  └─ assets/
├─ tests/smoke.js           无数据库启动测试
├─ server.js                Express 后端
├─ schema.sql               Supabase 正式建表脚本
├─ seed-demo.sql            可选演示商品
├─ .env.example             环境变量示例
├─ .gitignore               Git 忽略规则
├─ render.yaml              Render 配置
├─ package.json
└─ package-lock.json
```

## 一、创建 Supabase 数据库

1. 登录 Supabase，新建一个项目。
2. 打开左侧 **SQL Editor**。
3. 新建查询，复制 `schema.sql` 的全部内容并执行。
4. 正式使用前可以不执行 `seed-demo.sql`。需要测试页面时才执行它。
5. 进入 **Project Settings → API**，准备：
   - Project URL
   - `service_role` key

`service_role` key 只能放在 Render 环境变量或本机 `.env` 中，不能放进前端，也不能提交到 GitHub。

## 二、本地运行

需要 Node.js 22。

```bash
npm ci
```

复制环境变量文件：

```bash
copy .env.example .env
```

编辑 `.env`，至少填写：

```env
SUPABASE_URL=你的项目URL
SUPABASE_SERVICE_ROLE_KEY=你的service_role密钥
JWT_SECRET=至少32位的随机字符串
ADMIN_PHONE=管理员手机号
ADMIN_PASSWORD=管理员密码，至少8位
ADMIN_NAME=老板
```

启动：

```bash
npm start
```

访问：

- 客户前台：`http://localhost:3000`
- ERP 后台：`http://localhost:3000/admin`
- 健康检查：`http://localhost:3000/api/health`

首次启动时，如果设置了 `ADMIN_PHONE` 和 `ADMIN_PASSWORD`，服务会自动创建或更新管理员账号。

## 三、部署 Render

### Render 环境变量

在 Render 服务的 Environment 中添加：

| Key | Value |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
| `JWT_SECRET` | 至少 32 位随机字符串 |
| `ADMIN_PHONE` | 管理员手机号 |
| `ADMIN_PASSWORD` | 管理员密码，至少 8 位 |
| `ADMIN_NAME` | 管理员名称 |
| `NODE_VERSION` | `22.16.0` |

Render 配置：

```text
Build Command: npm ci
Start Command: npm start
Health Check Path: /api/health
```

仓库中已包含 `render.yaml`，也可以使用 Blueprint 创建。

## 四、订单状态规则

```text
pending → confirmed → production → shipping → delivered
    └──────── cancelled
confirmed ─── cancelled
```

- 下单时会在 PostgreSQL 事务中检查库存、创建订单、扣减库存、清空购物车。
- `pending` 或 `confirmed` 状态取消订单时，系统会自动归还库存。
- 已进入生产或发货的订单不能直接取消，避免库存和生产数据混乱。

## 五、API 响应格式

成功：

```json
{ "code": 0, "data": {} }
```

失败：

```json
{ "code": 1, "message": "错误说明" }
```

主要接口：

```text
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me

GET    /api/products
GET    /api/products/:id
POST   /api/products                 管理员
PATCH  /api/products/:id             管理员
POST   /api/products/:id/skus        管理员
PATCH  /api/skus/:id                 管理员

GET    /api/cart
POST   /api/cart/add
PATCH  /api/cart/:skuId
DELETE /api/cart/:skuId
DELETE /api/cart

POST   /api/orders
GET    /api/orders
GET    /api/orders/:id
PATCH  /api/orders/:id/status        管理员

GET    /api/dashboard                管理员
GET    /api/customers                管理员
POST   /api/customers                管理员
GET    /api/orders/:id/production    管理员
POST   /api/orders/:id/print-token   管理员
```

## 六、检查命令

```bash
npm run check
npm test
npm audit --omit=dev
```

`npm test` 会验证：

- 未配置 Supabase 时服务不会启动崩溃
- 健康检查会明确返回配置缺失
- 前台和后台静态页面可以打开
- 未知 API 返回统一 JSON 错误

完整数据库流程需要在执行 `schema.sql` 并配置 Supabase 后测试。

## 七、安全说明

- 不要提交 `.env`。
- 不要提交 `node_modules`。
- 不要把 `service_role` key 写进 HTML 或浏览器 JavaScript。
- 正式上线必须修改 `JWT_SECRET` 和管理员密码。
- 管理员打印链接使用 5 分钟有效的临时令牌。
- Supabase 表已启用 RLS，浏览器不直接访问数据库，业务数据由 Node.js 服务端处理。
