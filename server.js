const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// =========================
// 🧠 CONFIG
// =========================
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
);

// =========================
// 🔐 AUTH
// =========================
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ code: 1, message: '未登录' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ code: 1, message: 'token失效' });
  }
}

// =========================
// 👤 用户系统
// =========================
app.post('/api/auth/register', async (req, res) => {
  const { phone, password } = req.body;

  const hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('users')
    .insert([{ phone, password: hash }]);

  if (error) return res.status(400).json(error);

  res.json({ code: 0, data });
});

app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;

  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!data) return res.status(400).json({ message: '用户不存在' });

  const ok = await bcrypt.compare(password, data.password);
  if (!ok) return res.status(400).json({ message: '密码错误' });

  const token = jwt.sign(
    { id: data.id, phone: data.phone },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ code: 0, token });
});

// =========================
// 📦 商品系统
// =========================
app.get('/api/products', async (req, res) => {
  const { data } = await supabase.from('products').select('*');
  res.json({ code: 0, data });
});

// =========================
// 🛒 购物车（数据库）
// =========================
app.post('/api/cart/add', auth, async (req, res) => {
  const { sku_id, qty } = req.body;

  const { data } = await supabase
    .from('cart')
    .insert([
      {
        user_id: req.user.id,
        sku_id,
        qty
      }
    ]);

  res.json({ code: 0, data });
});

app.get('/api/cart', auth, async (req, res) => {
  const { data } = await supabase
    .from('cart')
    .select('*')
    .eq('user_id', req.user.id);

  res.json({ code: 0, data });
});

// =========================
// 🧾 下单（核心ERP）
// =========================
app.post('/api/order/create', auth, async (req, res) => {
  const { address, remark } = req.body;

  const { data: cart } = await supabase
    .from('cart')
    .select('*')
    .eq('user_id', req.user.id);

  if (!cart.length) {
    return res.status(400).json({ code: 1, message: '购物车为空' });
  }

  const { data: order } = await supabase
    .from('orders')
    .insert([
      {
        user_id: req.user.id,
        status: 'pending',
        address,
        remark
      }
    ])
    .select()
    .single();

  const items = cart.map(i => ({
    order_id: order.id,
    sku_id: i.sku_id,
    qty: i.qty
  }));

  await supabase.from('order_items').insert(items);

  await supabase.from('cart').delete().eq('user_id', req.user.id);

  res.json({ code: 0, data: order });
});

// =========================
// 📦 订单系统
// =========================
app.get('/api/orders', auth, async (req, res) => {
  const { data } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('user_id', req.user.id);

  res.json({ code: 0, data });
});

// =========================
// 🏭 ERP后台（你爸妈用）
// =========================
app.get('/api/erp/orders', auth, async (req, res) => {
  const { data } = await supabase.from('orders').select('*');
  res.json({ code: 0, data });
});

app.patch('/api/erp/order/status', auth, async (req, res) => {
  const { order_id, status } = req.body;

  const { data } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', order_id);

  res.json({ code: 0, data });
});

// =========================
// 📊 ERP Dashboard
// =========================
app.get('/api/erp/dashboard', auth, async (req, res) => {
  const { data: orders } = await supabase.from('orders').select('*');
  const { data: users } = await supabase.from('users').select('*');

  res.json({
    code: 0,
    data: {
      total_orders: orders.length,
      total_users: users.length,
      pending: orders.filter(o => o.status === 'pending').length
    }
  });
});

// =========================
// 🖨 生产单（API版）
// =========================
app.get('/api/print/:order_id', auth, async (req, res) => {
  const { data: order } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', req.params.order_id)
    .single();

  res.json({
    code: 0,
    data: {
      order_id: order.id,
      items: order.order_items,
      print_time: new Date()
    }
  });
});

// =========================
// 🖨 生产单（可打印HTML）
// =========================
app.get('/print/:order_id', async (req, res) => {
  const { data: order } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', req.params.order_id)
    .single();

  const html = `
  <html>
  <body>
    <h1>服装生产单</h1>
    <p>订单号: ${order.id}</p>
    <p>状态: ${order.status}</p>

    <h3>商品</h3>
    <ul>
      ${order.order_items.map(i =>
        `<li>SKU: ${i.sku_id} | 数量: ${i.qty}</li>`
      ).join('')}
    </ul>

    <script>
      window.onload = () => window.print();
    </script>
  </body>
  </html>
  `;

  res.send(html);
});

// =========================
// 🚀 启动
// =========================
app.listen(PORT, () => {
  console.log('ERP SYSTEM RUNNING:', PORT);
});