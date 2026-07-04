# Eluren 服装电子选款册 V3.3

面向服装批发熟客业务的流程：

> 朋友圈上新 → 客户进入选款册 → 选择颜色、尺码和数量 → 提交询价 → 线下报价确认 → 转正式订单 → 生产与发货

## 核心原则

- 客户前台不显示价格和精确库存
- 浏览与选款无需登录，提交询价时才登录
- 客户只看到“有货 / 少量 / 补货中”
- 后台保留真实库存
- 询价阶段不扣库存，转正式订单时才检查并扣减库存

## V3.3 功能

- 商品多图上传、封面设置、删除和排序
- 商品资料可编辑：名称、对外款号、分类、面料、上新标签、卖点、客户说明
- 颜色、尺码、SKU 编码和库存可编辑
- 批量生成“颜色 × 尺码”规格
- 安全删除未被历史单据引用的 SKU 或商品
- 商品搜索与 SKU 折叠展示
- 朋友圈简洁版/详细版文案，可修改后复制
- 商品专属链接和二维码
- 询价管理、询价转正式订单、生产单打印
- 中国时区编号和中文订单状态

## 升级现有 V3.2

必须按顺序执行：

1. 在 Supabase SQL Editor 运行 `migration-v3.3-product-operations.sql`。
2. 确认 `Success. No rows returned`。
3. 再把本项目覆盖到 GitHub 仓库并 Push。
4. 等待 Render 显示 `Deploy live`。
5. 按 `V3.3升级操作.txt` 验证。

V3.3 脚本只新增商品字段，不删除现有商品、图片、SKU、客户、询价或订单。

## 全新安装

1. 新建 Supabase 项目并执行 `schema.sql`。
2. Render 配置：

```env
SUPABASE_URL=你的Supabase项目URL
SUPABASE_SERVICE_ROLE_KEY=你的Secret key
JWT_SECRET=至少32位随机字符串
ADMIN_PHONE=管理员手机号
ADMIN_PASSWORD=管理员密码
ADMIN_NAME=管理员名称
SUPABASE_IMAGE_BUCKET=product-images
TZ=Asia/Shanghai
```

3. Render 命令：

```text
Build Command: npm ci
Start Command: npm start
Health Check Path: /api/health
```

## 图片规则

- JPG、PNG、WEBP
- 单张最大 8MB
- 每个商品最多 10 张
- 第一张自动成为封面，后台可重新设置与排序
- 文件保存在 Supabase Storage

## 本地检查

```bash
npm ci
npm run check
npm test
npm start
```

- 客户选款册：`http://localhost:3000`
- 管理后台：`http://localhost:3000/admin`
- 健康检查：`http://localhost:3000/api/health`

## 安全

- 不提交 `.env`
- 不提交 `node_modules`
- Supabase Secret key 只放 Render 环境变量或本地 `.env`
- 管理员接口使用 JWT 和管理员角色校验
- 历史询价、订单和生产单保存提交时快照，后续修改商品或 SKU 不会覆盖历史记录
