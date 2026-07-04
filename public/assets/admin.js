'use strict';

const API = '/api';
const TOKEN_KEY = 'wholesale_admin_token';
let token = localStorage.getItem(TOKEN_KEY) || '';
let adminUser = null;
let currentInquiryFilter = '';
let currentOrderFilter = '';
let productsCache = [];
let currentShareData = null;
let currentShareTemplate = 'short';
let imageManagerProduct = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API}${path}`, { ...options, headers });
  } catch (_) {
    throw new Error('网络连接失败，请稍后重试');
  }
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : { code: 1, message: await response.text() };
  if (response.status === 401 && !path.startsWith('/auth/login')) logoutAdmin(true);
  return result;
}

async function apiFile(path, file) {
  const headers = { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name || 'image') };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, { method: 'POST', body: file, headers });
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : { code: 1, message: await response.text() };
  if (response.status === 401) logoutAdmin(true);
  return result;
}

async function uploadFiles(productId, files) {
  const uploaded = [];
  for (const file of files) {
    if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} 超过 8MB`);
    const result = await apiFile(`/products/${productId}/images`, file);
    if (result.code !== 0) throw new Error(result.message || `${file.name} 上传失败`);
    uploaded.push(result.data);
  }
  return uploaded;
}

function renderAdminSession() {
  const loggedIn = Boolean(adminUser);
  document.getElementById('adminSummary').textContent = loggedIn ? `${adminUser.name}（管理员）` : '未登录';
  document.getElementById('adminLogout').style.display = loggedIn ? '' : 'none';
  document.getElementById('adminLoginModal').style.display = loggedIn ? 'none' : 'flex';
}

async function initializeAdmin() {
  if (!token) return renderAdminSession();
  try {
    const result = await api('/auth/me');
    if (result.code !== 0 || result.data.role !== 'admin') return logoutAdmin(true);
    adminUser = result.data;
    renderAdminSession();
    await loadDashboard();
  } catch (_) {
    logoutAdmin(true);
  }
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
  token = result.data.token;
  adminUser = result.data.user;
  localStorage.setItem(TOKEN_KEY, token);
  renderAdminSession();
  showToast('登录成功');
  loadDashboard();
}

function logoutAdmin(silent = false) {
  token = '';
  adminUser = null;
  localStorage.removeItem(TOKEN_KEY);
  renderAdminSession();
  if (!silent) showToast('已退出后台');
}

function switchView(view) {
  document.querySelectorAll('.view').forEach(item => item.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelector(`.nav-item[data-view="${view}"]`).classList.add('active');
  if (view === 'dashboard') loadDashboard();
  if (view === 'inquiries') loadInquiries();
  if (view === 'orders') loadOrders();
  if (view === 'products') loadProductsAdmin();
  if (view === 'customers') loadCustomers();
}

async function loadDashboard() {
  const result = await api('/dashboard');
  if (result.code !== 0) return showDataError('statsGrid', result.message);
  const data = result.data;
  const cards = [
    ['今日新增询价', data.today_inquiries, '💬'],
    ['待联系客户', data.pending_inquiries, '📞'],
    ['今日选款件数', data.today_selected_quantity, '👕'],
    ['本月正式订单', data.monthly_orders, '📦'],
    ['在售款式', data.on_sale_products, '🗂️'],
    ['客户数量', data.total_customers, '👥'],
  ];
  document.getElementById('statsGrid').innerHTML = cards.map(card => `<div class="stat-card"><div class="stat-icon">${card[2]}</div><div><div class="stat-value">${card[1]}</div><div class="stat-label">${card[0]}</div></div></div>`).join('');
  document.getElementById('lowStockList').innerHTML = data.low_stock_skus.length
    ? data.low_stock_skus.map(item => `<div class="low-stock-item"><div><strong>${escapeHtml(item.product_name || item.sku_code)}</strong><span>${escapeHtml(item.style_code || '')} · ${escapeHtml(item.color)}/${escapeHtml(item.size)}</span></div><b class="${item.stock <= 0 ? 'danger-text' : ''}">${item.stock}件</b></div>`).join('')
    : '<div class="empty-state">暂无低库存 SKU</div>';
  const labels = inquiryStatusLabels();
  document.getElementById('recentInquiries').innerHTML = data.recent_inquiries.length
    ? data.recent_inquiries.map(item => `<div class="recent-order-item"><div><strong>${escapeHtml(item.inquiry_no)}</strong><span>${escapeHtml(item.customer_name)} · ${item.total_quantity}件</span></div><span class="badge inquiry-${item.status}">${labels[item.status]}</span></div>`).join('')
    : '<div class="empty-state">暂无询价</div>';
}

async function loadInquiries() {
  const params = currentInquiryFilter ? `?status=${encodeURIComponent(currentInquiryFilter)}` : '';
  const result = await api(`/inquiries${params}`);
  const body = document.getElementById('inquiriesBody');
  if (result.code !== 0) return body.innerHTML = `<tr><td colspan="6" class="form-error">${escapeHtml(result.message)}</td></tr>`;
  const labels = inquiryStatusLabels();
  body.innerHTML = result.data.length ? result.data.map(inquiry => `<tr>
    <td><strong>${escapeHtml(inquiry.inquiry_no)}</strong></td>
    <td>${escapeHtml(inquiry.customer_name)}<br><span class="muted-text">${escapeHtml(inquiry.customer_phone)}</span></td>
    <td>${inquiry.total_quantity}件</td>
    <td><span class="badge inquiry-${inquiry.status}">${labels[inquiry.status]}</span></td>
    <td>${escapeHtml(formatTime(inquiry.created_at))}</td>
    <td><button class="btn btn-sm btn-outline" onclick="showInquiryDetail('${inquiry.id}')">详情</button></td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty-state">暂无询价单</td></tr>';
}

async function showInquiryDetail(id) {
  const result = await api(`/inquiries/${id}`);
  if (result.code !== 0) return alert(result.message || '读取失败');
  const inquiry = result.data;
  const labels = inquiryStatusLabels();
  const nextActions = {
    pending: [['contacted', '标记已联系'], ['lost', '标记未成交']],
    contacted: [['quoted', '标记已报价'], ['considering', '客户考虑中'], ['lost', '标记未成交']],
    quoted: [['considering', '客户考虑中'], ['contacted', '返回已联系'], ['lost', '标记未成交']],
    considering: [['quoted', '重新报价'], ['contacted', '返回已联系'], ['lost', '标记未成交']],
  };
  const statusButtons = (nextActions[inquiry.status] || []).map(([status, label]) => `<button class="btn btn-sm ${status === 'lost' ? 'btn-danger' : 'btn-outline'}" onclick="updateInquiryStatus('${inquiry.id}','${status}')">${label}</button>`).join('');
  const convertButton = ['pending', 'contacted', 'quoted', 'considering'].includes(inquiry.status)
    ? `<button class="btn btn-sm btn-success" onclick="convertInquiry('${inquiry.id}')">转为正式订单</button>` : '';
  document.getElementById('inquiryDetailContent').innerHTML = `
    <div class="order-detail-header"><div><div class="order-no">${escapeHtml(inquiry.inquiry_no)}</div><span class="badge inquiry-${inquiry.status}">${labels[inquiry.status]}</span></div><div class="text-right"><strong>${inquiry.total_quantity}件</strong><div class="muted-text">${escapeHtml(formatTime(inquiry.created_at))}</div></div></div>
    <div class="order-meta"><div class="order-meta-item"><span class="order-meta-label">客户：</span>${escapeHtml(inquiry.customer_name)}</div><div class="order-meta-item"><span class="order-meta-label">电话：</span>${escapeHtml(inquiry.customer_phone)}</div><div class="order-meta-item"><span class="order-meta-label">店铺：</span>${escapeHtml(inquiry.customer_company || '-')}</div><div class="order-meta-item full-row"><span class="order-meta-label">地址：</span>${escapeHtml(inquiry.shipping_address || '未填写')}</div>${inquiry.remark ? `<div class="order-meta-item full-row"><span class="order-meta-label">需求备注：</span>${escapeHtml(inquiry.remark)}</div>` : ''}</div>
    <h3>选款明细</h3><table class="order-items-table"><thead><tr><th>商品</th><th>款号</th><th>SKU</th><th>颜色/尺码</th><th>数量</th></tr></thead><tbody>${inquiry.items.map(item => `<tr><td>${escapeHtml(item.product_name)}</td><td>${escapeHtml(item.style_code)}</td><td>${escapeHtml(item.sku_code)}</td><td>${escapeHtml(item.color)}/${escapeHtml(item.size)}</td><td>${item.quantity}件</td></tr>`).join('')}</tbody></table>
    <div class="order-status-actions">${statusButtons}${convertButton}${!statusButtons && !convertButton ? '<span class="muted-text">该询价单已结束</span>' : ''}</div>`;
  openModal('inquiryDetailModal');
}

async function updateInquiryStatus(id, status) {
  if (!confirm(`确认更新询价状态为“${inquiryStatusLabels()[status]}”？`)) return;
  const result = await api(`/inquiries/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  if (result.code !== 0) return alert(`更新失败：${result.message}`);
  closeModal('inquiryDetailModal');
  showToast('询价状态已更新');
  await Promise.all([loadInquiries(), loadDashboard()]);
}

async function convertInquiry(id) {
  if (!confirm('确认已经与客户谈妥价格、库存和交期，并转为正式订单？转换后会扣减实际库存。')) return;
  const result = await api(`/inquiries/${id}/convert`, { method: 'POST' });
  if (result.code !== 0) return alert(`转换失败：${result.message}`);
  closeModal('inquiryDetailModal');
  alert(`转换成功，正式订单号：${result.data.order_no}`);
  await Promise.all([loadInquiries(), loadOrders(), loadDashboard(), loadProductsAdmin()]);
}

async function loadOrders() {
  const params = currentOrderFilter ? `?status=${encodeURIComponent(currentOrderFilter)}` : '';
  const result = await api(`/orders${params}`);
  const body = document.getElementById('ordersBody');
  if (result.code !== 0) return body.innerHTML = `<tr><td colspan="6" class="form-error">${escapeHtml(result.message)}</td></tr>`;
  const labels = orderStatusLabels();
  body.innerHTML = result.data.length ? result.data.map(order => `<tr>
    <td><strong>${escapeHtml(order.order_no)}</strong></td>
    <td>${escapeHtml(order.customer_name)}<br><span class="muted-text">${escapeHtml(order.customer_phone)}</span></td>
    <td>${order.total_quantity}件</td>
    <td><span class="badge badge-${order.status}">${labels[order.status]}</span></td>
    <td>${escapeHtml(formatTime(order.created_at))}</td>
    <td><button class="btn btn-sm btn-outline" onclick="showOrderDetail('${order.id}')">详情</button></td>
  </tr>`).join('') : '<tr><td colspan="6" class="empty-state">暂无正式订单</td></tr>';
}

async function showOrderDetail(id) {
  const result = await api(`/orders/${id}`);
  if (result.code !== 0) return alert(result.message || '读取失败');
  const order = result.data;
  const labels = orderStatusLabels();
  const flow = {
    pending: [['confirmed', '确认订单', 'btn-primary'], ['cancelled', '取消订单', 'btn-danger']],
    confirmed: [['production', '开始生产', 'btn-primary'], ['cancelled', '取消订单', 'btn-danger']],
    production: [['shipping', '开始发货', 'btn-primary']],
    shipping: [['delivered', '确认送达', 'btn-success']],
  };
  const actions = (flow[order.status] || []).map(([status, label, className]) => `<button class="btn btn-sm ${className}" onclick="updateOrderStatus('${order.id}','${status}')">${label}</button>`).join('');
  document.getElementById('orderDetailContent').innerHTML = `
    <div class="order-detail-header"><div><div class="order-no">${escapeHtml(order.order_no)}</div><span class="badge badge-${order.status}">${labels[order.status]}</span></div><div class="text-right"><strong>${order.total_quantity}件</strong><div class="muted-text">${escapeHtml(formatTime(order.created_at))}</div></div></div>
    <div class="order-meta"><div class="order-meta-item"><span class="order-meta-label">客户：</span>${escapeHtml(order.customer_name)}</div><div class="order-meta-item"><span class="order-meta-label">电话：</span>${escapeHtml(order.customer_phone)}</div><div class="order-meta-item full-row"><span class="order-meta-label">地址：</span>${escapeHtml(order.shipping_address || '未填写')}</div>${order.remark ? `<div class="order-meta-item full-row"><span class="order-meta-label">备注：</span>${escapeHtml(order.remark)}</div>` : ''}</div>
    <h3>订单明细</h3><table class="order-items-table"><thead><tr><th>商品</th><th>SKU</th><th>颜色/尺码</th><th>数量</th></tr></thead><tbody>${order.items.map(item => `<tr><td>${escapeHtml(item.product_name)}</td><td>${escapeHtml(item.sku_code)}</td><td>${escapeHtml(item.color)}/${escapeHtml(item.size)}</td><td>${item.quantity}件</td></tr>`).join('')}</tbody></table>
    <div class="order-status-actions"><button class="btn btn-sm btn-outline" onclick="printProduction('${order.id}')">打印生产单</button>${actions || '<span class="muted-text">订单已完成或已取消</span>'}</div>`;
  openModal('orderDetailModal');
}

async function updateOrderStatus(id, status) {
  if (!confirm(`确认更新订单状态为“${orderStatusLabels()[status]}”？`)) return;
  const result = await api(`/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  if (result.code !== 0) return alert(`更新失败：${result.message}`);
  closeModal('orderDetailModal');
  showToast('订单状态已更新');
  await Promise.all([loadOrders(), loadDashboard(), loadProductsAdmin()]);
}

async function printProduction(id) {
  const result = await api(`/orders/${id}/print-token`, { method: 'POST' });
  if (result.code !== 0) return alert(`生成生产单失败：${result.message}`);
  window.open(result.data.url, '_blank', 'noopener');
}

async function loadProductsAdmin() {
  const result = await api('/products?status=all');
  const grid = document.getElementById('productAdminGrid');
  if (result.code !== 0) return grid.innerHTML = `<p class="form-error">${escapeHtml(result.message)}</p>`;
  productsCache = result.data || [];
  renderProductsAdmin(productsCache);
}

function filterProductsAdmin() {
  const keyword = (document.getElementById('adminProductSearch')?.value || '').trim().toLowerCase();
  const filtered = !keyword ? productsCache : productsCache.filter(product => [
    product.name, product.style_code, product.material, product.badge_text, product.description,
  ].some(value => String(value || '').toLowerCase().includes(keyword)));
  renderProductsAdmin(filtered);
}

function renderProductsAdmin(productList) {
  const grid = document.getElementById('productAdminGrid');
  const count = document.getElementById('adminProductCount');
  if (count) count.textContent = `共 ${productList.length} 款`;
  grid.innerHTML = productList.length ? productList.map(product => {
    const cover = product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}">` : '<div class="admin-product-placeholder">👕</div>';
    const meta = [product.category, product.material, product.badge_text].filter(Boolean).map(escapeHtml).join(' · ');
    const skuContent = product.skus.length ? product.skus.map(sku => `<div class="sku-row"><span>${escapeHtml(sku.color)} / ${escapeHtml(sku.size)}（${escapeHtml(sku.sku_code)}）</span><span><span class="${sku.stock < 20 ? 'danger-text' : 'muted-text'} sku-stock">库存 ${sku.stock}件</span> <button class="btn btn-sm btn-outline" onclick="showEditSku('${sku.id}')">编辑规格</button></span></div>`).join('') : '<div class="empty-state">暂无 SKU</div>';
    return `<article class="product-admin-card">
      <div class="admin-product-cover">${cover}<div class="admin-cover-badges"><span class="badge ${product.status === 'on_sale' ? 'badge-delivered' : 'badge-cancelled'}">${product.status === 'on_sale' ? '在售' : '已下架'}</span>${product.badge_text ? `<span class="badge badge-new">${escapeHtml(product.badge_text)}</span>` : ''}</div></div>
      <div class="product-admin-content">
        <div class="product-admin-header"><div><div class="style-code">${escapeHtml(product.style_code)}</div><div class="product-admin-title">${escapeHtml(product.name)}</div><div class="product-admin-cat">${meta || '未填写商品资料'} · ${product.images.length}张图片</div></div></div>
        ${product.description ? `<div class="muted-text product-description">${escapeHtml(product.description)}</div>` : ''}
        ${product.customer_note ? `<div class="customer-note-admin">客户说明：${escapeHtml(product.customer_note)}</div>` : ''}
        <div class="product-admin-actions"><button class="btn btn-sm btn-outline" onclick="showEditProduct('${product.id}')">编辑商品</button><button class="btn btn-sm btn-outline" onclick="toggleProductStatus('${product.id}','${product.status}')">${product.status === 'on_sale' ? '下架' : '上架'}</button><button class="btn btn-sm btn-outline" onclick="manageProductImages('${product.id}')">图片管理</button><button class="btn btn-sm btn-outline" onclick="showShareMaterial('${product.id}')">朋友圈素材</button><button class="btn btn-sm btn-primary" onclick="showBatchSku('${product.id}')">批量规格</button><button class="btn btn-sm btn-primary" onclick="showAddSku('${product.id}')">+ 单个SKU</button></div>
        <details class="sku-details" ${product.skus.length <= 4 ? 'open' : ''}><summary>颜色/尺码规格（${product.skus.length} 个）</summary><div class="sku-list">${skuContent}</div></details>
      </div>
    </article>`;
  }).join('') : '<p class="empty-state">没有匹配的商品</p>';
}

async function toggleProductStatus(productId, currentStatus) {
  const nextStatus = currentStatus === 'on_sale' ? 'off_sale' : 'on_sale';
  if (!confirm(`确认${nextStatus === 'on_sale' ? '上架' : '下架'}该商品？`)) return;
  const result = await api(`/products/${productId}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
  if (result.code !== 0) return alert(`操作失败：${result.message}`);
  showToast('商品状态已更新');
  loadProductsAdmin();
}

function findProduct(productId) {
  return productsCache.find(product => product.id === productId) || null;
}

function findSku(skuId) {
  for (const product of productsCache) {
    const sku = product.skus.find(item => item.id === skuId);
    if (sku) return { product, sku };
  }
  return null;
}

function showEditProduct(productId) {
  const product = findProduct(productId);
  if (!product) return alert('未找到商品，请刷新页面后重试');
  document.getElementById('editProductId').value = product.id;
  document.getElementById('epName').value = product.name || '';
  document.getElementById('epStyleCode').value = product.style_code || '';
  document.getElementById('epCategory').value = product.category || '上衣';
  document.getElementById('epMaterial').value = product.material || '';
  document.getElementById('epBadgeText').value = product.badge_text || '';
  document.getElementById('epDesc').value = product.description || '';
  document.getElementById('epCustomerNote').value = product.customer_note || '';
  openModal('editProductModal');
}

async function updateProduct(event) {
  event.preventDefault();
  const productId = document.getElementById('editProductId').value;
  const button = event.submitter || event.target.querySelector('button[type="submit"]');
  if (button) { button.disabled = true; button.textContent = '保存中...'; }
  try {
    const result = await api(`/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: document.getElementById('epName').value.trim(),
        style_code: document.getElementById('epStyleCode').value.trim(),
        category: document.getElementById('epCategory').value,
        material: document.getElementById('epMaterial').value.trim(),
        badge_text: document.getElementById('epBadgeText').value.trim(),
        description: document.getElementById('epDesc').value.trim(),
        customer_note: document.getElementById('epCustomerNote').value.trim(),
      }),
    });
    if (result.code !== 0) return alert(`保存失败：${result.message}`);
    closeModal('editProductModal');
    showToast('商品资料已更新');
    await loadProductsAdmin();
  } catch (error) {
    alert(`保存失败：${error.message}`);
  } finally {
    if (button) { button.disabled = false; button.textContent = '保存修改'; }
  }
}

async function deleteCurrentProduct() {
  const productId = document.getElementById('editProductId').value;
  const product = findProduct(productId);
  if (!product) return;
  if (!confirm(`确认永久删除“${product.name}”？\n\n仅没有历史询价或订单引用的商品可以删除。`)) return;
  const result = await api(`/products/${productId}`, { method: 'DELETE' });
  if (result.code !== 0) return alert(`删除失败：${result.message}`);
  closeModal('editProductModal');
  showToast('商品已删除');
  await loadProductsAdmin();
}

function showEditSku(skuId) {
  const found = findSku(skuId);
  if (!found) return alert('未找到该规格，请刷新页面后重试');
  const { product, sku } = found;
  document.getElementById('editSkuId').value = sku.id;
  document.getElementById('editSkuProductName').textContent = `${product.name} · ${product.style_code}`;
  document.getElementById('eskuCode').value = sku.sku_code || '';
  document.getElementById('eskuColor').value = sku.color || '';
  document.getElementById('eskuSize').value = sku.size || '';
  document.getElementById('eskuStock').value = Number(sku.stock || 0);
  openModal('editSkuModal');
}

async function updateSku(event) {
  event.preventDefault();
  const skuId = document.getElementById('editSkuId').value;
  const result = await api(`/skus/${skuId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sku_code: document.getElementById('eskuCode').value.trim(),
      color: document.getElementById('eskuColor').value.trim(),
      size: document.getElementById('eskuSize').value.trim(),
      stock: Number(document.getElementById('eskuStock').value),
    }),
  });
  if (result.code !== 0) return alert(`保存失败：${result.message}`);
  closeModal('editSkuModal');
  showToast('颜色、尺码和库存已更新');
  await Promise.all([loadProductsAdmin(), loadDashboard()]);
}

async function deleteCurrentSku() {
  const skuId = document.getElementById('editSkuId').value;
  const found = findSku(skuId);
  if (!found) return;
  if (!confirm(`确认删除规格：${found.sku.color} / ${found.sku.size}？`)) return;
  const result = await api(`/skus/${skuId}`, { method: 'DELETE' });
  if (result.code !== 0) return alert(`删除失败：${result.message}`);
  closeModal('editSkuModal');
  showToast('规格已删除');
  await Promise.all([loadProductsAdmin(), loadDashboard()]);
}

function showAddProduct() {
  document.getElementById('addProductForm').reset();
  openModal('addProductModal');
}

async function createProduct(event) {
  event.preventDefault();
  const button = event.submitter || event.target.querySelector('button[type="submit"]');
  if (button) { button.disabled = true; button.textContent = '创建中...'; }
  try {
    const result = await api('/products', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('pName').value.trim(),
        style_code: document.getElementById('pStyleCode').value.trim(),
        category: document.getElementById('pCategory').value,
        material: document.getElementById('pMaterial').value.trim(),
        badge_text: document.getElementById('pBadgeText').value.trim(),
        description: document.getElementById('pDesc').value.trim(),
        customer_note: document.getElementById('pCustomerNote').value.trim(),
      }),
    });
    if (result.code !== 0) return alert(`创建失败：${result.message}`);
    const files = [...document.getElementById('pImages').files];
    if (files.length) {
      try { await uploadFiles(result.data.id, files); }
      catch (error) { alert(`商品已创建，但部分图片上传失败：${error.message}`); }
    }
    closeModal('addProductModal');
    showToast('商品创建成功');
    loadProductsAdmin();
  } catch (error) {
    alert(`创建失败：${error.message}`);
  } finally {
    if (button) { button.disabled = false; button.textContent = '创建商品'; }
  }
}

function splitList(value) {
  return [...new Set(String(value || '').split(/[，,、;；\n\r\t]+/).map(item => item.trim()).filter(Boolean))];
}

function showBatchSku(productId) {
  const product = findProduct(productId);
  if (!product) return alert('未找到商品');
  document.getElementById('batchSkuProductId').value = productId;
  document.getElementById('batchSkuProductName').textContent = `${product.name} · ${product.style_code}`;
  document.getElementById('batchSkuColors').value = [...new Set(product.skus.map(sku => sku.color))].join('、');
  document.getElementById('batchSkuSizes').value = [...new Set(product.skus.map(sku => sku.size))].join('、');
  document.getElementById('batchSkuStock').value = '100';
  document.getElementById('batchSkuUpdateExisting').checked = false;
  openModal('batchSkuModal');
}

async function batchAddSkus(event) {
  event.preventDefault();
  const productId = document.getElementById('batchSkuProductId').value;
  const colors = splitList(document.getElementById('batchSkuColors').value);
  const sizes = splitList(document.getElementById('batchSkuSizes').value);
  if (!colors.length || !sizes.length) return alert('请填写颜色和尺码');
  if (!confirm(`将处理 ${colors.length} 个颜色 × ${sizes.length} 个尺码，共 ${colors.length * sizes.length} 个组合。确认继续？`)) return;
  const result = await api(`/products/${productId}/skus/batch`, {
    method: 'POST',
    body: JSON.stringify({
      colors, sizes,
      stock: Number(document.getElementById('batchSkuStock').value),
      update_existing: document.getElementById('batchSkuUpdateExisting').checked,
    }),
  });
  if (result.code !== 0) return alert(`批量处理失败：${result.message}`);
  closeModal('batchSkuModal');
  showToast(result.message || '批量规格已处理');
  await Promise.all([loadProductsAdmin(), loadDashboard()]);
}

function showAddSku(productId) {
  document.getElementById('skuProductId').value = productId;
  document.getElementById('skuCode').value = '';
  document.getElementById('skuColor').value = '';
  document.getElementById('skuSize').value = '';
  document.getElementById('skuStock').value = '0';
  openModal('addSkuModal');
}

async function addSku(event) {
  event.preventDefault();
  const productId = document.getElementById('skuProductId').value;
  const result = await api(`/products/${productId}/skus`, {
    method: 'POST',
    body: JSON.stringify({
      sku_code: document.getElementById('skuCode').value.trim(),
      color: document.getElementById('skuColor').value.trim(),
      size: document.getElementById('skuSize').value.trim(),
      stock: Number(document.getElementById('skuStock').value),
    }),
  });
  if (result.code !== 0) return alert(`添加失败：${result.message}`);
  closeModal('addSkuModal');
  showToast('SKU 添加成功');
  loadProductsAdmin();
}

async function manageProductImages(productId) {
  const result = await api(`/products/${productId}`);
  if (result.code !== 0) return alert(result.message || '读取商品失败');
  document.getElementById('imageProductId').value = productId;
  imageManagerProduct = result.data;
  renderImageManager(result.data);
  openModal('imageManagerModal');
}

function renderImageManager(product) {
  const list = document.getElementById('imageManagerList');
  list.innerHTML = product.images.length ? product.images.map((image, index) => `<div class="image-manager-item"><img src="${escapeHtml(image.image_url)}" alt="商品图片"><div class="image-order-label">第 ${index + 1} 张</div><div class="image-manager-actions"><button class="btn btn-sm btn-outline" ${index === 0 ? 'disabled' : ''} onclick="moveProductImage('${product.id}','${image.id}',-1)">前移</button><button class="btn btn-sm btn-outline" ${index === product.images.length - 1 ? 'disabled' : ''} onclick="moveProductImage('${product.id}','${image.id}',1)">后移</button>${image.is_cover ? '<span class="badge badge-delivered">当前封面</span>' : `<button class="btn btn-sm btn-outline" onclick="setCoverImage('${product.id}','${image.id}')">设为封面</button>`}<button class="btn btn-sm btn-danger" onclick="deleteProductImage('${product.id}','${image.id}')">删除</button></div></div>`).join('') : '<div class="empty-state">暂未上传图片</div>';
}

async function moveProductImage(productId, imageId, direction) {
  if (!imageManagerProduct || imageManagerProduct.id !== productId) return;
  const images = [...imageManagerProduct.images];
  const index = images.findIndex(image => image.id === imageId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= images.length) return;
  [images[index], images[target]] = [images[target], images[index]];
  const result = await api(`/products/${productId}/images/reorder`, { method: 'PATCH', body: JSON.stringify({ image_ids: images.map(image => image.id) }) });
  if (result.code !== 0) return alert(`排序失败：${result.message}`);
  showToast('图片顺序已更新');
  await manageProductImages(productId);
  loadProductsAdmin();
}

async function uploadMoreImages(event) {
  event.preventDefault();
  const productId = document.getElementById('imageProductId').value;
  const files = [...document.getElementById('moreImages').files];
  if (!files.length) return;
  try { await uploadFiles(productId, files); }
  catch (error) { return alert(`上传失败：${error.message}`); }
  document.getElementById('moreImages').value = '';
  showToast('图片上传成功');
  await manageProductImages(productId);
  loadProductsAdmin();
}

async function setCoverImage(productId, imageId) {
  const result = await api(`/products/${productId}/images/${imageId}/cover`, { method: 'PATCH', body: JSON.stringify({}) });
  if (result.code !== 0) return alert(`设置失败：${result.message}`);
  showToast('封面已更新');
  await manageProductImages(productId);
  loadProductsAdmin();
}

async function deleteProductImage(productId, imageId) {
  if (!confirm('确认删除这张图片？')) return;
  const result = await api(`/products/${productId}/images/${imageId}`, { method: 'DELETE' });
  if (result.code !== 0) return alert(`删除失败：${result.message}`);
  showToast('图片已删除');
  await manageProductImages(productId);
  loadProductsAdmin();
}

async function showShareMaterial(productId) {
  const result = await api(`/products/${productId}/share`);
  if (result.code !== 0) return alert(`生成失败：${result.message}`);
  currentShareData = result.data;
  currentShareTemplate = 'short';
  const product = result.data.product;
  const meta = [product.material, product.badge_text].filter(Boolean).join(' · ');
  document.getElementById('shareProductSummary').innerHTML = `<div class="share-product-summary">${product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="">` : ''}<div><div class="style-code">${escapeHtml(product.style_code)}</div><strong>${escapeHtml(product.name)}</strong>${meta ? `<p>${escapeHtml(meta)}</p>` : ''}<p>${escapeHtml(product.description || '')}</p></div></div>`;
  document.getElementById('shareQr').src = result.data.qr_url;
  document.getElementById('shareUrl').value = result.data.url;
  selectShareTemplate('short');
  openModal('shareModal');
}

function selectShareTemplate(type) {
  if (!currentShareData) return;
  currentShareTemplate = type === 'detail' ? 'detail' : 'short';
  document.getElementById('shareCopy').value = currentShareTemplate === 'detail' ? currentShareData.copy_detail : currentShareData.copy_short;
  document.getElementById('shareShortBtn').className = `btn btn-sm ${currentShareTemplate === 'short' ? 'btn-primary' : 'btn-outline'}`;
  document.getElementById('shareDetailBtn').className = `btn btn-sm ${currentShareTemplate === 'detail' ? 'btn-primary' : 'btn-outline'}`;
}

async function copyShareUrl() { await copyText(document.getElementById('shareUrl').value, '链接已复制'); }
async function copyShareCopy() { await copyText(document.getElementById('shareCopy').value, '朋友圈文案已复制'); }
function downloadQr() { if (currentShareData) window.open(currentShareData.qr_url, '_blank', 'noopener'); }
async function copyText(text, successMessage) {
  try { await navigator.clipboard.writeText(text); showToast(successMessage); }
  catch (_) { prompt('复制下面的内容：', text); }
}

async function loadCustomers() {
  const result = await api('/customers');
  const body = document.getElementById('customersBody');
  if (result.code !== 0) return body.innerHTML = `<tr><td colspan="8" class="form-error">${escapeHtml(result.message)}</td></tr>`;
  body.innerHTML = result.data.length ? result.data.map(customer => `<tr><td>${escapeHtml(customer.id.slice(0, 8))}</td><td>${escapeHtml(customer.name)}</td><td>${escapeHtml(customer.phone)}</td><td>${escapeHtml(customer.company || '-')}</td><td class="address-cell">${escapeHtml(customer.address || '-')}</td><td>${customer.inquiry_count}</td><td>${customer.order_count}</td><td>${customer.last_inquiry_at ? escapeHtml(formatTime(customer.last_inquiry_at)) : '-'}</td></tr>`).join('') : '<tr><td colspan="8" class="empty-state">暂无客户</td></tr>';
}

function showAddCustomer() { openModal('addCustomerModal'); }
async function createCustomer(event) {
  event.preventDefault();
  const result = await api('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: document.getElementById('cName').value.trim(),
      phone: document.getElementById('cPhone').value.trim(),
      password: document.getElementById('cPassword').value,
      company: document.getElementById('cCompany').value.trim(),
      address: document.getElementById('cAddress').value.trim(),
    }),
  });
  if (result.code !== 0) return alert(`创建失败：${result.message}`);
  closeModal('addCustomerModal');
  event.target.reset();
  showToast('客户创建成功');
  loadCustomers();
}

function inquiryStatusLabels() { return { pending: '待联系', contacted: '已联系', quoted: '已报价', considering: '客户考虑中', converted: '已成交', lost: '未成交' }; }
function orderStatusLabels() { return { pending: '待确认', confirmed: '已确认', production: '生产中', shipping: '发货中', delivered: '已送达', cancelled: '已取消' }; }
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function formatTime(iso) { return new Date(iso).toLocaleString('zh-CN', { hour12: false }); }
function showDataError(id, message) { document.getElementById(id).innerHTML = `<p class="form-error">${escapeHtml(message || '加载失败')}</p>`; }
function showToast(message) { const toast = document.createElement('div'); toast.className = 'toast-message'; toast.textContent = message; document.body.appendChild(toast); setTimeout(() => toast.remove(), 2200); }

document.getElementById('inquiryStatusFilter').addEventListener('click', event => {
  if (!event.target.classList.contains('status-btn')) return;
  document.querySelectorAll('#inquiryStatusFilter .status-btn').forEach(button => button.classList.remove('active'));
  event.target.classList.add('active');
  currentInquiryFilter = event.target.dataset.status;
  loadInquiries();
});

document.getElementById('orderStatusFilter').addEventListener('click', event => {
  if (!event.target.classList.contains('status-btn')) return;
  document.querySelectorAll('#orderStatusFilter .status-btn').forEach(button => button.classList.remove('active'));
  event.target.classList.add('active');
  currentOrderFilter = event.target.dataset.status;
  loadOrders();
});

initializeAdmin();
