'use strict';

const API = '/api';
const ADMIN_TOKEN_KEY = 'wholesale_admin_token';
let adminToken = localStorage.getItem(ADMIN_TOKEN_KEY) || '';
let adminUser = null;
let currentOrderFilter = { status: '' };

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function money(value) { return Number(value || 0).toFixed(2); }

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  let response;
  try {
    response = await fetch(`${API}${path}`, { ...options, headers });
  } catch (_) {
    throw new Error('网络连接失败，请检查服务是否启动');
  }
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : { code: 1, message: await response.text() };
  if (response.status === 401 && !path.startsWith('/auth/login')) showAdminLogin('登录已失效，请重新登录');
  return result;
}

function showAdminLogin(message = '') {
  adminToken = '';
  adminUser = null;
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  document.getElementById('adminLoginError').textContent = message;
  document.getElementById('adminLoginModal').style.display = 'flex';
  document.getElementById('adminSummary').textContent = '未登录';
  document.getElementById('adminLogout').style.display = 'none';
}

async function initializeAdmin() {
  if (!adminToken) return showAdminLogin();
  const result = await api('/auth/me');
  if (result.code !== 0 || result.data.role !== 'admin') return showAdminLogin('该账号没有管理员权限');
  adminUser = result.data;
  document.getElementById('adminSummary').textContent = `${adminUser.name} · ${adminUser.phone}`;
  document.getElementById('adminLogout').style.display = '';
  document.getElementById('adminLoginModal').style.display = 'none';
  await loadDashboard();
}

async function loginAdmin(event) {
  event.preventDefault();
  const error = document.getElementById('adminLoginError');
  error.textContent = '';
  const result = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone: document.getElementById('adminPhone').value.trim(), password: document.getElementById('adminPassword').value }),
  });
  if (result.code !== 0) return error.textContent = result.message || '登录失败';
  if (result.data.user.role !== 'admin') return error.textContent = '该账号不是管理员';
  adminToken = result.data.token;
  adminUser = result.data.user;
  localStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
  document.getElementById('adminSummary').textContent = `${adminUser.name} · ${adminUser.phone}`;
  document.getElementById('adminLogout').style.display = '';
  document.getElementById('adminLoginModal').style.display = 'none';
  await loadDashboard();
}

function logoutAdmin() { showAdminLogin('已退出后台'); }

function switchView(view) {
  document.querySelectorAll('.view').forEach(element => element.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(element => element.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelector(`.nav-item[data-view="${view}"]`).classList.add('active');
  if (view === 'dashboard') loadDashboard();
  if (view === 'orders') loadOrders();
  if (view === 'products') loadProductsAdmin();
  if (view === 'customers') loadCustomers();
}

async function loadDashboard() {
  if (!adminToken) return;
  const result = await api('/dashboard');
  if (result.code !== 0) return showDataError('statsGrid', result.message);
  const data = result.data;
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-card-label">今日订单</div><div class="stat-card-value orders">${data.today_orders}</div></div>
    <div class="stat-card"><div class="stat-card-label">今日营收</div><div class="stat-card-value revenue">¥${money(data.today_revenue)}</div></div>
    <div class="stat-card"><div class="stat-card-label">累计营收</div><div class="stat-card-value revenue">¥${money(data.total_revenue)}</div></div>
    <div class="stat-card"><div class="stat-card-label">待处理订单</div><div class="stat-card-value orders">${data.pending}</div></div>
    <div class="stat-card"><div class="stat-card-label">商品总数</div><div class="stat-card-value products">${data.total_products}</div></div>
    <div class="stat-card"><div class="stat-card-label">客户总数</div><div class="stat-card-value customers">${data.total_customers}</div></div>`;
  document.getElementById('lowStockList').innerHTML = data.low_stock_skus.length
    ? data.low_stock_skus.map(sku => `<div class="low-stock-item"><span>${escapeHtml(sku.sku_code)}（${escapeHtml(sku.color)}/${escapeHtml(sku.size)}）</span><span class="danger-text">仅剩${sku.stock}件</span></div>`).join('')
    : '<p class="empty-state">暂无低库存商品</p>';

  const orders = await api('/orders?page=1&page_size=5');
  const labels = statusLabels();
  document.getElementById('recentOrders').innerHTML = orders.code === 0 && orders.data.length
    ? orders.data.map(order => `<div class="recent-order-item"><div><strong>${escapeHtml(order.order_no)}</strong><br><span>${escapeHtml(order.customer_name)} · ${order.total_quantity}件</span></div><div class="text-right"><span class="price">¥${money(order.total_amount)}</span><br><span class="badge badge-${order.status}">${labels[order.status]}</span></div></div>`).join('')
    : '<p class="empty-state">暂无订单</p>';
}

async function loadOrders() {
  const params = new URLSearchParams();
  if (currentOrderFilter.status) params.set('status', currentOrderFilter.status);
  const result = await api(`/orders?${params}`);
  const body = document.getElementById('ordersBody');
  if (result.code !== 0) return body.innerHTML = `<tr><td colspan="7" class="form-error">${escapeHtml(result.message)}</td></tr>`;
  const labels = statusLabels();
  body.innerHTML = result.data.length ? result.data.map(order => `<tr>
    <td><strong>${escapeHtml(order.order_no)}</strong></td>
    <td>${escapeHtml(order.customer_name)}<br><span class="muted-text">${escapeHtml(order.customer_phone)}</span></td>
    <td>${order.total_quantity}件</td><td class="price">¥${money(order.total_amount)}</td>
    <td><span class="badge badge-${order.status}">${labels[order.status] || order.status}</span></td>
    <td>${escapeHtml(formatTime(order.created_at))}</td>
    <td><button class="btn btn-sm btn-outline" onclick="showOrderDetail('${order.id}')">详情</button></td>
  </tr>`).join('') : '<tr><td colspan="7" class="empty-state">暂无订单</td></tr>';
}

async function showOrderDetail(id) {
  const result = await api(`/orders/${id}`);
  if (result.code !== 0) return alert(result.message || '读取订单失败');
  const order = result.data;
  const labels = statusLabels();
  const flow = {
    pending: [{ status: 'confirmed', label: '确认订单', className: 'btn-primary' }, { status: 'cancelled', label: '取消订单', className: 'btn-danger' }],
    confirmed: [{ status: 'production', label: '开始生产', className: 'btn-primary' }, { status: 'cancelled', label: '取消订单', className: 'btn-danger' }],
    production: [{ status: 'shipping', label: '开始发货', className: 'btn-primary' }],
    shipping: [{ status: 'delivered', label: '确认送达', className: 'btn-success' }],
  };
  const actions = (flow[order.status] || []).map(action => `<button class="btn btn-sm ${action.className}" onclick="updateStatus('${order.id}','${action.status}')">${action.label}</button>`).join('');
  document.getElementById('orderDetailContent').innerHTML = `
    <div class="order-detail-header"><div><div class="order-no">${escapeHtml(order.order_no)}</div><span class="badge badge-${order.status}">${labels[order.status]}</span></div><div class="text-right"><div class="price large-price">¥${money(order.total_amount)}</div><div class="muted-text">${order.total_quantity}件</div></div></div>
    <div class="order-meta"><div class="order-meta-item"><span class="order-meta-label">客户：</span>${escapeHtml(order.customer_name)}</div><div class="order-meta-item"><span class="order-meta-label">电话：</span>${escapeHtml(order.customer_phone)}</div><div class="order-meta-item full-row"><span class="order-meta-label">地址：</span>${escapeHtml(order.shipping_address)}</div><div class="order-meta-item"><span class="order-meta-label">下单时间：</span>${escapeHtml(formatTime(order.created_at))}</div>${order.remark ? `<div class="order-meta-item full-row"><span class="order-meta-label">备注：</span>${escapeHtml(order.remark)}</div>` : ''}</div>
    <h3>订单明细</h3><table class="order-items-table"><thead><tr><th>商品</th><th>SKU</th><th>颜色/尺码</th><th>数量</th><th>单价</th><th>小计</th></tr></thead><tbody>${order.items.map(item => `<tr><td>${escapeHtml(item.product_name)}</td><td>${escapeHtml(item.sku_code)}</td><td>${escapeHtml(item.color)}/${escapeHtml(item.size)}</td><td>${item.quantity}件</td><td>¥${money(item.unit_price)}</td><td class="price">¥${money(item.subtotal)}</td></tr>`).join('')}</tbody></table>
    <div class="order-status-actions"><button class="btn btn-sm btn-outline" onclick="printProduction('${order.id}')">打印生产单</button>${actions || '<span class="muted-text">订单已完成或已取消</span>'}</div>`;
  openModal('orderDetailModal');
}

async function updateStatus(orderId, status) {
  if (!confirm(`确认更新订单状态为“${statusLabels()[status]}”？`)) return;
  const result = await api(`/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  if (result.code !== 0) return alert(`更新失败：${result.message}`);
  closeModal('orderDetailModal');
  showToast('状态更新成功');
  await Promise.all([loadOrders(), loadDashboard()]);
}

async function printProduction(orderId) {
  const result = await api(`/orders/${orderId}/print-token`, { method: 'POST' });
  if (result.code !== 0) return alert(`生成打印单失败：${result.message}`);
  window.open(result.data.url, '_blank', 'noopener');
}

async function loadProductsAdmin() {
  const result = await api('/products?status=all');
  const grid = document.getElementById('productAdminGrid');
  if (result.code !== 0) return grid.innerHTML = `<p class="form-error">${escapeHtml(result.message)}</p>`;
  grid.innerHTML = result.data.length ? result.data.map(product => `<div class="product-admin-card">
    <div class="product-admin-header"><div><div class="product-admin-title">${escapeHtml(product.name)}</div><div class="product-admin-cat">${escapeHtml(product.category)} · ${product.status === 'on_sale' ? '在售' : '已下架'}</div></div><div><button class="btn btn-sm btn-outline" onclick="toggleProductStatus('${product.id}','${product.status}')">${product.status === 'on_sale' ? '下架' : '上架'}</button> <button class="btn btn-sm btn-outline" onclick="showAddSku('${product.id}')">+ SKU</button></div></div>
    ${product.description ? `<div class="muted-text product-description">${escapeHtml(product.description)}</div>` : ''}
    <div class="sku-list">${product.skus.length ? product.skus.map(sku => `<div class="sku-row"><span>${escapeHtml(sku.color)} / ${escapeHtml(sku.size)}（${escapeHtml(sku.sku_code)}）</span><span><span class="price">¥${money(sku.wholesale_price)}</span><span class="${sku.stock < 50 ? 'danger-text' : 'muted-text'} sku-stock">${sku.stock}件</span> <button class="btn btn-sm btn-outline" onclick="editSku('${sku.id}',${sku.stock},${sku.wholesale_price})">编辑</button></span></div>`).join('') : '<div class="empty-state">暂无 SKU</div>'}</div>
  </div>`).join('') : '<p class="empty-state">暂无商品，请先新增商品</p>';
}


async function toggleProductStatus(productId, currentStatus) {
  const nextStatus = currentStatus === 'on_sale' ? 'off_sale' : 'on_sale';
  if (!confirm(`确认${nextStatus === 'on_sale' ? '上架' : '下架'}该商品？`)) return;
  const result = await api(`/products/${productId}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
  if (result.code !== 0) return alert(`操作失败：${result.message}`);
  showToast('商品状态已更新');
  loadProductsAdmin();
}

async function editSku(skuId, currentStock, currentPrice) {
  const stockInput = prompt('请输入新库存数量：', String(currentStock));
  if (stockInput === null) return;
  const priceInput = prompt('请输入新批发价：', String(currentPrice));
  if (priceInput === null) return;
  const stock = Number.parseInt(stockInput, 10);
  const wholesalePrice = Number(priceInput);
  if (!Number.isInteger(stock) || stock < 0 || !Number.isFinite(wholesalePrice) || wholesalePrice < 0) return alert('库存或价格格式无效');
  const result = await api(`/skus/${skuId}`, { method: 'PATCH', body: JSON.stringify({ stock, wholesale_price: wholesalePrice }) });
  if (result.code !== 0) return alert(`更新失败：${result.message}`);
  showToast('SKU 已更新');
  loadProductsAdmin();
}

function showAddProduct() { openModal('addProductModal'); }
async function createProduct(event) {
  event.preventDefault();
  const result = await api('/products', { method: 'POST', body: JSON.stringify({ name: document.getElementById('pName').value.trim(), category: document.getElementById('pCategory').value, description: document.getElementById('pDesc').value.trim(), image_url: document.getElementById('pImage').value.trim() }) });
  if (result.code !== 0) return alert(`创建失败：${result.message}`);
  closeModal('addProductModal');
  event.target.reset();
  showToast('商品创建成功');
  loadProductsAdmin();
}
function showAddSku(productId) {
  document.getElementById('skuProductId').value = productId;
  document.getElementById('skuCode').value = '';
  document.getElementById('skuColor').value = '';
  document.getElementById('skuSize').value = '';
  document.getElementById('skuStock').value = '0';
  document.getElementById('skuWholesalePrice').value = '';
  document.getElementById('skuRetailPrice').value = '';
  openModal('addSkuModal');
}
async function addSku(event) {
  event.preventDefault();
  const productId = document.getElementById('skuProductId').value;
  const result = await api(`/products/${productId}/skus`, { method: 'POST', body: JSON.stringify({ sku_code: document.getElementById('skuCode').value.trim(), color: document.getElementById('skuColor').value.trim(), size: document.getElementById('skuSize').value.trim(), stock: Number(document.getElementById('skuStock').value), wholesale_price: Number(document.getElementById('skuWholesalePrice').value), retail_price: document.getElementById('skuRetailPrice').value }) });
  if (result.code !== 0) return alert(`添加失败：${result.message}`);
  closeModal('addSkuModal');
  showToast('SKU 添加成功');
  loadProductsAdmin();
}

async function loadCustomers() {
  const result = await api('/customers');
  const body = document.getElementById('customersBody');
  if (result.code !== 0) return body.innerHTML = `<tr><td colspan="8" class="form-error">${escapeHtml(result.message)}</td></tr>`;
  body.innerHTML = result.data.length ? result.data.map(customer => `<tr><td>${escapeHtml(customer.id.slice(0, 8))}</td><td>${escapeHtml(customer.name)}</td><td>${escapeHtml(customer.phone)}</td><td>${escapeHtml(customer.company || '-')}</td><td class="address-cell">${escapeHtml(customer.address || '-')}</td><td><span class="badge ${customer.level === 'vip' ? 'badge-delivered' : 'badge-pending'}">${customer.level === 'vip' ? 'VIP' : '普通'}</span></td><td>${customer.order_count}</td><td class="price">¥${money(customer.total_amount)}</td></tr>`).join('') : '<tr><td colspan="8" class="empty-state">暂无客户</td></tr>';
}
function showAddCustomer() { openModal('addCustomerModal'); }
async function createCustomer(event) {
  event.preventDefault();
  const result = await api('/customers', { method: 'POST', body: JSON.stringify({ name: document.getElementById('cName').value.trim(), phone: document.getElementById('cPhone').value.trim(), password: document.getElementById('cPassword').value, company: document.getElementById('cCompany').value.trim(), address: document.getElementById('cAddress').value.trim() }) });
  if (result.code !== 0) return alert(`创建失败：${result.message}`);
  closeModal('addCustomerModal');
  event.target.reset();
  showToast('客户创建成功');
  loadCustomers();
}

function statusLabels() { return { pending: '待确认', confirmed: '已确认', production: '生产中', shipping: '发货中', delivered: '已送达', cancelled: '已取消' }; }
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function formatTime(iso) { return new Date(iso).toLocaleString('zh-CN', { hour12: false }); }
function showDataError(id, message) { document.getElementById(id).innerHTML = `<p class="form-error">${escapeHtml(message || '加载失败')}</p>`; }
function showToast(message) { const toast = document.createElement('div'); toast.className = 'toast-message'; toast.textContent = message; document.body.appendChild(toast); setTimeout(() => toast.remove(), 2000); }

document.getElementById('statusFilter').addEventListener('click', event => {
  if (!event.target.classList.contains('status-btn')) return;
  document.querySelectorAll('.status-btn').forEach(button => button.classList.remove('active'));
  event.target.classList.add('active');
  currentOrderFilter.status = event.target.dataset.status;
  loadOrders();
});

initializeAdmin();
