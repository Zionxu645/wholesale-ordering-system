# Eluren 服装电子选款册 + 询价/订单管理系统 V3

这不是公开标价的网上商城，而是面向熟客批发业务的：

> 朋友圈引流 → 网站浏览全部款式 → 客户提交选款询价 → 老板线下报价和确认库存 → 转为正式订单 → 生产/发货

## 本版核心变化

- 前台、询价单、订单和后台全部隐藏价格
- 客户无需登录即可浏览和加入选款单
- 提交询价时才需要手机号登录
- 客户前台不显示精确库存，只显示“有货 / 少量 / 补货中”
- 后台保留精确库存
- 后台可直接上传商品图片到 Supabase Storage
- 每个商品有独立分享链接
- 后台可一键生成朋友圈文案和二维码
- 新增询价管理：待联系、已联系、已报价、考虑中、已成交、未成交
- 询价谈妥后转为正式订单，转换时才扣减库存
- 正式订单继续支持确认、生产、发货、送达和生产单打印
- 仪表盘改为询价、选款件数、在售款式和低库存，不再统计营收

## 目录

```text
server.js                 Express 后端
schema.sql                全新 Supabase 项目建表脚本
migration-v3.sql          已运行旧版系统时的升级脚本
seed-demo.sql             可选演示数据
public/                   客户选款册与管理后台
package.json
package-lock.json
render.yaml
.env.example
升级操作.txt
```

## 已经上线旧版时如何升级

1. 先在 Supabase SQL Editor 执行 `migration-v3.sql`。
2. 确认显示 `Success. No rows returned`。
3. 再将本项目全部文件替换到 GitHub 仓库并 Push。
4. Render 会自动部署。
5. 部署成功后进入 `/admin` 测试：
   - 新增商品并上传图片
   - 添加颜色、尺码和库存
   - 生成朋友圈素材
   - 客户提交询价
   - 后台转为正式订单

不要对已经有数据的 Supabase 项目重新执行 `schema.sql`；升级只运行 `migration-v3.sql`。

## 全新安装

1. 新建 Supabase 项目。
2. 在 SQL Editor 执行 `schema.sql`。
3. 在 Render 配置：

```env
SUPABASE_URL=你的Supabase项目URL
SUPABASE_SERVICE_ROLE_KEY=你的Secret key
JWT_SECRET=至少32位随机字符串
ADMIN_PHONE=管理员手机号
ADMIN_PASSWORD=管理员密码
ADMIN_NAME=老板
SUPABASE_IMAGE_BUCKET=product-images
```

4. Render：

```text
Build Command: npm ci
Start Command: npm start
Health Check Path: /api/health
```

## 图片规则

- 支持 JPG、PNG、WEBP
- 单张最大 8MB
- 每个商品最多 10 张
- 第一张自动设为封面
- 图片保存在 Supabase Storage 的 `product-images` 桶中，不保存在 Render 本地

## 询价与库存逻辑

客户提交询价时：

- 不显示价格
- 不扣减库存
- 仅保存款式、颜色、尺码和需求数量

老板确认价格、库存和交期后，在后台点击“转为正式订单”：

- 系统再次检查库存
- 成功后扣减库存
- 生成正式订单
- 可继续打印生产单并流转状态

## 本地检查

需要 Node.js 22：

```bash
npm ci
npm run check
npm test
npm start
```

访问：

- 客户选款册：`http://localhost:3000`
- 管理后台：`http://localhost:3000/admin`
- 健康检查：`http://localhost:3000/api/health`

## 安全说明

- 不提交 `.env`
- 不提交 `node_modules`
- Supabase Secret key 只能放在 Render 环境变量或本机 `.env`
- 浏览器不直接访问数据库
- 管理员接口必须经过 JWT 和数据库角色双重检查
- 生产单打印链接 5 分钟后失效

## V3.1 时区与生产单修复

本版本在 V3 业务流程不变的基础上修复：

- 新询价单号按中国标准时间生成日期。
- 询价转正式订单后的新订单号按中国标准时间生成日期。
- 仪表盘“今日询价”和“本月订单”按中国标准时间统计。
- 新商品自动款号中的日期按中国标准时间生成。
- 生产单状态显示中文，例如“已送达”，不再显示 `delivered`。
- 生产单打印时间固定按中国标准时间显示。
- 健康检查版本更新为 `3.1.0`。

### 已部署 V3 的升级顺序

1. 在 Supabase SQL Editor 运行 `migration-v3.1-timezone.sql`。
2. 确认显示 `Success. No rows returned`。
3. 再将本项目代码替换到 GitHub 仓库并 Push。
4. 等待 Render 显示 `Live`。
5. 新建一条测试询价并转单，确认编号日期与中国当天一致。

旧询价单号和旧订单号不会自动改名；修复只影响升级后的新数据。

