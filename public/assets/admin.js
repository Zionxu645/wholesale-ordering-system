/* ============================================
   服装批发订货系统 - 后台管理逻辑
   ============================================ */

const API = '/api';
let currentOrderFilter = { status: '' };

// ============================================
// API 封装
// ============================================
async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return res.json();
}

// ============================================
// 视图切换
// ============================================
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelector(`.nav-item[data-view="${view}"]`).classList.add('active');

  if (view === 'dashboard') loadDashboard();
  if (view === 'orders') loadOrders();
  if (view === 'products') loadProductsAdmin();
  if (view === 'customers') loadCustomers();
}

// ============================================
// 仪表盘
// ============================================
async function loadDashboard() {
  const res = await api('/dashboard');
  if (res.code !== 0) return;
  const d = res.data;

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card">
      <div class="stat-card-label">今日订单</div>
      <div class="stat-card-value orders">${d.today_orders}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">今日营收</div>
      <div class="stat-card-value revenue">¥${d.today_revenue.toFixed(2)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">累计营收</div>
      <div class="stat-card-value revenue">¥${d.total_revenue.toFixed(2)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">总订单数</div>
      <div class="stat-card-value orders">${d.total_orders}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">商品总数</div>
      <div class="stat-card-value products">${d.total_products}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">客户总数</div>
      <div class="stat-card-value customers">${d.total_customers}</div>
    </div>
  `;

  // 低库存
  const lowStockList = document.getElementById('lowStockList');
  if (d.low_stock_skus.length === 0) {
    lowStockList.innerHTML = '<p style="color:#94a3b8;padding:12px">暂无低库存商品</p>';
  } else {
    lowStockList.innerHTML = d.low_stock_skus.map(s => `
      <div class="low-stock-item">
        <span>${s.sku_code} (${s.color}/${s.size})</span>
        <span style="color:#ef4444;font-weight:600">仅剩${s.stock}件</span>
      </div>
    `).join('');
  }

  // 最近订单
  const ordersRes = await api('/orders?page=1&page_size=5');
  const recentOrders = document.getElementById('recentOrders');
  if (ordersRes.data && ordersRes.data.length > 0) {
    const statusLabels = {
      pending: '待确认', confirmed: '已确认', production: '生产中',
      shipping: '发货中', delivered: '已送达', cancelled: '已取消'
    };
    recentOrders.innerHTML = ordersRes.data.map(o => `
      <div class="recent-order-item">
        <div>
          <strong>${o.order_no}</strong><br>
          <span style="color:#64748b">${o.customer_name} | ${o.total_quantity}件</span>
        </div>
        <div style="text-align:right">
          <span class="price">¥${o.total_amount.toFixed(2)}</span><br>
          <span class="badge badge-${o.status}">${statusLabels[o.status]}</span>
        </div>
      </div>
    `).join('');
  } else {
    recentOrders.innerHTML = '<p style="color:#94a3b8;padding:12px">暂无订单</p>';
  }
}

// ============================================
// 订单管理
// ============================================
async function loadOrders() {
  const params = new URLSearchParams();
  if (currentOrderFilter.status) params.set('status', currentOrderFilter.status);
  const res = await api(`/orders?${params}`);
  if (res.code !== 0) return;

  const statusLabels = {
    pending: '待确认', confirmed: '已确认', production: '生产中',
    shipping: '发货中', delivered: '已送达', cancelled: '已取消'
  };

  const body = document.getElementById('ordersBody');
  if (res.data.length === 0) {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8">暂无订单</td></tr>';
    return;
  }

  body.innerHTML = res.data.map(o => `
    <tr>
      <td><strong>${o.order_no}</strong></td>
      <td>${o.customer_name}<br><span style="color:#94a3b8;font-size:12px">${o.customer_phone}</span></td>
      <td>${o.total_quantity}件</td>
      <td class="price">¥${o.total_amount.toFixed(2)}</td>
      <td><span class="badge badge-${o.status}">${statusLabels[o.status]}</span></td>
      <td>${formatTime(o.created_at)}</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="showOrderDetail('${o.id}')">详情</button>
      </td>
    </tr>
  `).join('');
}

async function showOrderDetail(id) {
  const res = await api(`/orders/${id}`);
  if (res.code !== 0) return;
  const o = res.data;

  const statusLabels = {
    pending: '待确认', confirmed: '已确认', production: '生产中',
    shipping: '发货中', delivered: '已送达', cancelled: '已取消'
  };

  // 状态流转按钮
  const statusFlow = {
    pending: [
      { status: 'confirmed', label: '确认订单', class: 'btn-primary' },
      { status: 'cancelled', label: '取消订单', class: 'btn-danger' },
    ],
    confirmed: [
      { status: 'production', label: '开始生产', class: 'btn-primary' },
      { status: 'cancelled', label: '取消订单', class: 'btn-danger' },
    ],
    production: [
      { status: 'shipping', label: '开始发货', class: 'btn-primary' },
    ],
    shipping: [
      { status: 'delivered', label: '确认送达', class: 'btn-success' },
    ],
  };

  const actions = statusFlow[o.status] || [];
  const actionButtons = actions.map(a => `<button class="btn btn-sm ${a.class}" onclick="updateStatus('${o.id}', '${a.status}')">${a.label}</button>`).join('');

  document.getElementById('orderDetailContent').innerHTML = `
    <div class="order-detail-header">
      <div>
        <div class="order-no">${o.order_no}</div>
        <span class="badge badge-${o.status}">${statusLabels[o.status]}</span>
      </div>
      <div style="text-align:right">
        <div class="price" style="font-size:20px">¥${o.total_amount.toFixed(2)}</div>
        <div style="color:#94a3b8;font-size:12px">${o.total_quantity}件</div>
      </div>
    </div>
    <div class="order-meta">
      <div class="order-meta-item"><span class="order-meta-label">客户:</span> ${o.customer_name}</div>
      <div class="order-meta-item"><span class="order-meta-label">电话:</span> ${o.customer_phone}</div>
      <div class="order-meta-item"><span class="order-meta-label">地址:</span> ${o.shipping_address}</div>
      <div class="order-meta-item"><span class="order-meta-label">下单时间:</span> ${formatTime(o.created_at)}</div>
      ${o.remark ? `<div class="order-meta-item" style="grid-column:1/3"><span class="order-meta-label">备注:</span> ${o.remark}</div>` : ''}
    </div>
    <h3>订单明细</h3>
    <table class="order-items-table">
      <thead>
        <tr><th>商品</th><th>颜色/尺码</th><th>数量</th><th>单价</th><th>小计</th></tr>
      </thead>
      <tbody>
        ${o.items.map(item => `
          <tr>
            <td>${item.product_name}</td>
            <td>${item.color}/${item.size}</td>
            <td>${item.quantity}件</td>
            <td>¥${item.unit_price.toFixed(2)}</td>
            <td class="price">¥${item.subtotal.toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="order-status-actions">
      ${actionButtons || '<span style="color:#94a3b8">订单已完成或已取消</span>'}
    </div>
  `;
  openModal('orderDetailModal');
}

async function updateStatus(orderId, status) {
  if (!confirm(`确认将订单状态更新为: ${status}？`)) return;
  const res = await api(`/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  if (res.code === 0) {
    showToast('状态更新成功');
    closeModal('orderDetailModal');
    loadOrders();
  } else {
    alert('更新失败: ' + res.message);
  }
}

// ============================================
// 商品管理
// ============================================
async function loadProductsAdmin() {
  const res = await api('/products');
  if (res.code !== 0) return;
  const products = res.data;

  const grid = document.getElementById('productAdminGrid');
  grid.innerHTML = products.map(p => `
    <div class="product-admin-card">
      <div class="product-admin-header">
        <div>
          <div class="product-admin-title">${p.name}</div>
          <div class="product-admin-cat">${p.category} | ${p.status === 'on_sale' ? '在售' : '下架'}</div>
        </div>
        <button class="btn btn-sm btn-outline" onclick="showAddSku('${p.id}')">+SKU</button>
      </div>
      ${p.description ? `<div style="font-size:12px;color:#64748b;margin-bottom:8px">${p.description}</div>` : ''}
      <div class="sku-list">
        ${p.skus.map(s => `
          <div class="sku-row">
            <span>${s.color} / ${s.size} (${s.sku_code})</span>
            <span>
              <span class="price">¥${s.wholesale_price.toFixed(2)}</span>
              <span style="color:${s.stock < 50 ? '#ef4444' : '#94a3b8'};font-size:12px;margin-left:8px">${s.stock}件</span>
            </span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function showAddProduct() { openModal('addProductModal'); }

async function createProduct(event) {
  event.preventDefault();
  const body = {
    name: document.getElementById('pName').value,
    category: document.getElementById('pCategory').value,
    description: document.getElementById('pDesc').value,
  };
  const res = await api('/products', { method: 'POST', body: JSON.stringify(body) });
  if (res.code === 0) {
    showToast('商品创建成功');
    closeModal('addProductModal');
    document.getElementById('pName').value = '';
    document.getElementById('pDesc').value = '';
    loadProductsAdmin();
  } else {
    alert('创建失败: ' + res.message);
  }
}

function showAddSku(productId) {
  document.getElementById('skuProductId').value = productId;
  ['skuColor', 'skuSize', 'skuWholesalePrice', 'skuRetailPrice'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('skuStock').value = '0';
  openModal('addSkuModal');
}

async function addSku(event) {
  event.preventDefault();
  const productId = document.getElementById('skuProductId').value;
  const body = {
    color: document.getElementById('skuColor').value,
    size: document.getElementById('skuSize').value,
    stock: parseInt(document.getElementById('skuStock').value) || 0,
    wholesale_price: parseFloat(document.getElementById('skuWholesalePrice').value),
    retail_price: parseFloat(document.getElementById('skuRetailPrice').value) || null,
  };
  const res = await api(`/products/${productId}/skus`, { method: 'POST', body: JSON.stringify(body) });
  if (res.code === 0) {
    showToast('SKU添加成功');
    closeModal('addSkuModal');
    loadProductsAdmin();
  } else {
    alert('添加失败: ' + res.message);
  }
}

// ============================================
// 客户管理
// ============================================
async function loadCustomers() {
  const res = await api('/customers');
  if (res.code !== 0) return;

  document.getElementById('customersBody').innerHTML = res.data.map(c => `
    <tr>
      <td>${c.id}</td>
      <td>${c.name}</td>
      <td>${c.phone}</td>
      <td>${c.company || '-'}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.address || '-'}</td>
      <td><span class="badge ${c.level === 'vip' ? 'badge-delivered' : 'badge-pending'}">${c.level === 'vip' ? 'VIP' : '普通'}</span></td>
      <td>${c.order_count}</td>
      <td class="price">¥${c.total_amount.toFixed(2)}</td>
    </tr>
  `).join('');
}

function showAddCustomer() { openModal('addCustomerModal'); }

async function createCustomer(event) {
  event.preventDefault();
  const body = {
    name: document.getElementById('cName').value,
    phone: document.getElementById('cPhone').value,
    company: document.getElementById('cCompany').value,
    address: document.getElementById('cAddress').value,
  };
  const res = await api('/customers', { method: 'POST', body: JSON.stringify(body) });
  if (res.code === 0) {
    showToast('客户创建成功');
    closeModal('addCustomerModal');
    ['cName', 'cPhone', 'cCompany', 'cAddress'].forEach(id => document.getElementById(id).value = '');
    loadCustomers();
  } else {
    alert('创建失败: ' + res.message);
  }
}

// ============================================
// 工具函数
// ============================================
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function formatTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:12px 24px;border-radius:8px;z-index:300;font-size:14px';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// 状态筛选事件
document.getElementById('statusFilter').addEventListener('click', (e) => {
  if (e.target.classList.contains('status-btn')) {
    document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    currentOrderFilter.status = e.target.dataset.status;
    loadOrders();
  }
});

// 初始化
loadDashboard();
