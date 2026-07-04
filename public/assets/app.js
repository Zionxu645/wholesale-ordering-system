'use strict';

const API = '/api';
const TOKEN_KEY = 'wholesale_customer_token';
const SELECTION_KEY = 'eluren_selection_v1';
let token = localStorage.getItem(TOKEN_KEY) || '';
let currentUser = null;
let products = [];
let currentCategory = '';
let currentKeyword = '';
let afterAuthAction = '';
let activeProductId = '';
let selection = readSelection();

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function readSelection() {
  try {
    const data = JSON.parse(localStorage.getItem(SELECTION_KEY) || '[]');
    return Array.isArray(data) ? data.filter(item => item?.sku_id && Number(item.quantity) > 0) : [];
  } catch (_) {
    return [];
  }
}

function saveSelection() {
  localStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
  updateSelectionBadge();
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
  if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
    clearSession();
    openAuthModal('login');
  }
  return result;
}

function clearSession() {
  token = '';
  currentUser = null;
  localStorage.removeItem(TOKEN_KEY);
  renderSession();
}

function renderSession() {
  const loggedIn = Boolean(currentUser);
  document.getElementById('userSummary').textContent = loggedIn ? `${currentUser.name}（${currentUser.phone}）` : '可直接浏览款式';
  document.getElementById('loginButton').style.display = loggedIn ? 'none' : '';
  document.getElementById('inquiriesButton').style.display = loggedIn ? '' : 'none';
  document.getElementById('ordersButton').style.display = loggedIn ? '' : 'none';
  document.getElementById('logoutButton').style.display = loggedIn ? '' : 'none';
}

async function initializeSession() {
  if (!token) {
    renderSession();
    return;
  }
  try {
    const result = await api('/auth/me');
    if (result.code !== 0 || result.data.role !== 'customer') return clearSession();
    currentUser = result.data;
    renderSession();
  } catch (_) {
    clearSession();
  }
}

function openAuthModal(mode = 'login', nextAction = '') {
  afterAuthAction = nextAction || afterAuthAction;
  switchAuthMode(mode);
  document.getElementById('authError').textContent = '';
  openModal('authModal');
}

function switchAuthMode(mode) {
  const loginMode = mode === 'login';
  document.getElementById('loginForm').style.display = loginMode ? '' : 'none';
  document.getElementById('registerForm').style.display = loginMode ? 'none' : '';
  document.getElementById('loginTab').classList.toggle('active', loginMode);
  document.getElementById('registerTab').classList.toggle('active', !loginMode);
}

async function login(event) {
  event.preventDefault();
  const error = document.getElementById('authError');
  error.textContent = '';
  const result = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      phone: document.getElementById('loginPhone').value.trim(),
      password: document.getElementById('loginPassword').value,
    }),
  });
  if (result.code !== 0) return error.textContent = result.message || '登录失败';
  if (result.data.user.role !== 'customer') return error.textContent = '管理员账号请从管理后台登录';
  token = result.data.token;
  currentUser = result.data.user;
  localStorage.setItem(TOKEN_KEY, token);
  renderSession();
  closeModal('authModal');
  showToast('登录成功');
  runAfterAuthAction();
}

async function register(event) {
  event.preventDefault();
  const error = document.getElementById('authError');
  error.textContent = '';
  const result = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: document.getElementById('registerName').value.trim(),
      phone: document.getElementById('registerPhone').value.trim(),
      password: document.getElementById('registerPassword').value,
      company: document.getElementById('registerCompany').value.trim(),
      address: document.getElementById('registerAddress').value.trim(),
    }),
  });
  if (result.code !== 0) return error.textContent = result.message || '注册失败';
  token = result.data.token;
  currentUser = result.data.user;
  localStorage.setItem(TOKEN_KEY, token);
  renderSession();
  closeModal('authModal');
  showToast('注册成功');
  runAfterAuthAction();
}

function runAfterAuthAction() {
  const action = afterAuthAction;
  afterAuthAction = '';
  if (action === 'inquiry') setTimeout(showInquiryForm, 120);
}

function logout() {
  clearSession();
  showToast('已退出登录，选款单仍保留在本机');
}

async function loadProducts() {
  const grid = document.getElementById('productGrid');
  grid.innerHTML = '<div class="loading">加载款式中...</div>';
  const params = new URLSearchParams();
  if (currentCategory) params.set('category', currentCategory);
  if (currentKeyword) params.set('keyword', currentKeyword);
  try {
    const result = await api(`/products?${params.toString()}`);
    if (result.code !== 0) throw new Error(result.message || '款式加载失败');
    products = result.data || [];
    renderProducts();
  } catch (error) {
    grid.innerHTML = `<div class="loading">${escapeHtml(error.message)}</div>`;
  }
}

function placeholderFor(category) {
  return ({ 上衣: '👕', 裤子: '👖', 连衣裙: '👗', 外套: '🧥', 套装: '🥋' })[category] || '📦';
}

function renderProducts() {
  const grid = document.getElementById('productGrid');
  if (!products.length) {
    grid.innerHTML = '<div class="loading">暂无在售款式</div>';
    return;
  }
  grid.innerHTML = products.map(product => {
    const colors = new Set(product.skus.map(sku => sku.color)).size;
    const sizes = new Set(product.skus.map(sku => sku.size)).size;
    const image = product.image_url
      ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" loading="lazy">`
      : `<span class="product-placeholder">${placeholderFor(product.category)}</span>`;
    const meta = [product.material, product.badge_text].filter(Boolean).join(' · ');
    return `<article class="product-card" onclick="showProductDetail('${product.id}')">
      <div class="product-card-image">${image}<span class="supply-pill supply-${product.availability.code}">${escapeHtml(product.availability.label)}</span>${product.badge_text ? `<span class="product-new-pill">${escapeHtml(product.badge_text)}</span>` : ''}</div>
      <div class="product-card-info">
        <div class="style-code">${escapeHtml(product.style_code || '')}</div>
        <div class="product-card-name">${escapeHtml(product.name)}</div>
        ${meta ? `<div class="product-card-meta">${escapeHtml(meta)}</div>` : ''}
        <div class="product-card-desc">${escapeHtml(product.description || '点击查看款式详情')}</div>
        <div class="product-card-footer"><span>${colors} 种颜色 · ${sizes} 个尺码</span><strong>查看款式 →</strong></div>
      </div>
    </article>`;
  }).join('');
}

async function showProductDetail(id, updateHistory = true) {
  const result = await api(`/products/${id}`);
  if (result.code !== 0) return alert(result.message || '读取商品失败');
  const product = result.data;
  activeProductId = product.id;
  const images = product.images?.length ? product.images : (product.image_url ? [{ image_url: product.image_url, is_cover: true }] : []);
  const mainImage = images[0]?.image_url || '';
  const gallery = images.length
    ? `<div class="product-gallery"><div class="product-main-image"><img id="productMainImage" src="${escapeHtml(mainImage)}" alt="${escapeHtml(product.name)}"></div>${images.length > 1 ? `<div class="product-thumbs">${images.map((image, index) => `<button onclick="changeMainImage('${escapeHtml(image.image_url)}',this)" class="thumb-button ${index === 0 ? 'active' : ''}"><img src="${escapeHtml(image.image_url)}" alt="商品图片 ${index + 1}"></button>`).join('')}</div>` : ''}</div>`
    : `<div class="product-main-image product-empty-image">${placeholderFor(product.category)}</div>`;
  const skuRows = product.skus.length ? product.skus.map(sku => `<tr>
    <td>${escapeHtml(sku.color)}</td><td>${escapeHtml(sku.size)}</td>
    <td><span class="supply-text supply-${sku.availability.code}">${escapeHtml(sku.availability.label)}</span></td>
    <td><input type="number" class="qty-input" id="qty-${sku.id}" min="0" max="99999" value="0" inputmode="numeric"></td>
  </tr>`).join('') : '<tr><td colspan="4" class="empty-state">该款式尚未录入颜色和尺码</td></tr>';
  document.getElementById('productDetail').innerHTML = `
    ${gallery}
    <div class="product-detail-header">
      <div class="product-detail-top"><div><div class="style-code">款号：${escapeHtml(product.style_code)}</div><div class="product-detail-name">${escapeHtml(product.name)}</div></div><button class="btn btn-sm btn-outline" onclick="copyProductLink('${product.id}')">复制分享链接</button></div>
      <div class="product-meta-chips">${product.material ? `<span>面料：${escapeHtml(product.material)}</span>` : ''}${product.badge_text ? `<span>${escapeHtml(product.badge_text)}</span>` : ''}</div>
      <div class="product-detail-desc">${escapeHtml(product.description || '')}</div>
      ${product.customer_note ? `<div class="customer-note">${escapeHtml(product.customer_note)}</div>` : ''}
      <div class="no-price-note">价格与精确库存不公开，提交选款后联系确认。</div>
    </div>
    <h3>选择颜色、尺码与数量</h3>
    <table class="sku-table"><thead><tr><th>颜色</th><th>尺码</th><th>供货状态</th><th>需求数量</th></tr></thead><tbody>${skuRows}</tbody></table>
    <button class="btn btn-primary btn-block" ${product.skus.length ? '' : 'disabled'} onclick="addToSelectionFromDetail('${product.id}')">加入选款单</button>`;
  openModal('productModal');
  if (updateHistory && location.pathname !== `/product/${id}`) history.pushState({ productId: id }, '', `/product/${id}`);
}

function changeMainImage(url, button) {
  document.getElementById('productMainImage').src = url;
  document.querySelectorAll('.thumb-button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
}

function closeProductModal(updateHistory = true) {
  closeModal('productModal');
  activeProductId = '';
  if (updateHistory && location.pathname.startsWith('/product/')) history.pushState({}, '', '/');
}

async function copyProductLink(id) {
  const link = `${location.origin}/product/${id}`;
  try {
    await navigator.clipboard.writeText(link);
    showToast('商品链接已复制');
  } catch (_) {
    prompt('复制下面的商品链接：', link);
  }
}

async function addToSelectionFromDetail(productId) {
  const product = products.find(item => item.id === productId) || (await api(`/products/${productId}`)).data;
  const selected = product.skus.map(sku => ({ sku, quantity: Number.parseInt(document.getElementById(`qty-${sku.id}`)?.value, 10) || 0 })).filter(item => item.quantity > 0);
  if (!selected.length) return alert('请至少选择一个规格并输入数量');
  let added = 0;
  for (const item of selected) {
    const existing = selection.find(row => row.sku_id === item.sku.id);
    if (existing) existing.quantity += item.quantity;
    else selection.push({
      sku_id: item.sku.id,
      product_id: product.id,
      product_name: product.name,
      style_code: product.style_code,
      image_url: product.image_url || '',
      sku_code: item.sku.sku_code,
      color: item.sku.color,
      size: item.sku.size,
      availability: item.sku.availability,
      quantity: item.quantity,
    });
    added += item.quantity;
  }
  saveSelection();
  closeProductModal();
  showToast(`已加入 ${added} 件到选款单`);
}

function updateSelectionBadge() {
  document.getElementById('selectionCount').textContent = selection.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function openSelection() {
  renderSelection();
  openModal('selectionModal');
}

function renderSelection() {
  const container = document.getElementById('selectionItems');
  const total = selection.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const styles = new Set(selection.map(item => item.product_id)).size;
  document.getElementById('selectionStyleCount').textContent = styles;
  document.getElementById('selectionTotalQty').textContent = total;
  if (!selection.length) {
    container.innerHTML = '<div class="empty-state">选款单还是空的，先去选择喜欢的款式。</div>';
    return;
  }
  container.innerHTML = selection.map(item => `<div class="selection-item">
    <div class="selection-thumb">${item.image_url ? `<img src="${escapeHtml(item.image_url)}" alt="">` : '👕'}</div>
    <div class="selection-info"><strong>${escapeHtml(item.product_name)}</strong><span>款号：${escapeHtml(item.style_code)}</span><span>${escapeHtml(item.color)} / ${escapeHtml(item.size)} · ${escapeHtml(item.sku_code)}</span></div>
    <div class="selection-control"><input type="number" min="1" max="99999" value="${item.quantity}" onchange="changeSelectionQty('${item.sku_id}',this.value)"><button class="btn btn-sm btn-outline" onclick="removeSelection('${item.sku_id}')">移除</button></div>
  </div>`).join('');
}

function changeSelectionQty(skuId, value) {
  const quantity = Number.parseInt(value, 10);
  const item = selection.find(row => row.sku_id === skuId);
  if (!item) return;
  if (!Number.isInteger(quantity) || quantity <= 0) return removeSelection(skuId);
  item.quantity = Math.min(quantity, 99999);
  saveSelection();
  renderSelection();
}

function removeSelection(skuId) {
  selection = selection.filter(item => item.sku_id !== skuId);
  saveSelection();
  renderSelection();
}

function clearSelection() {
  if (!selection.length || confirm('确认清空全部选款？')) {
    selection = [];
    saveSelection();
    renderSelection();
  }
}

function showInquiryForm() {
  if (!selection.length) return alert('选款单为空');
  if (!currentUser || !token) {
    closeModal('selectionModal');
    return openAuthModal('login', 'inquiry');
  }
  document.getElementById('customerName').value = currentUser.name || '';
  document.getElementById('customerPhone').value = currentUser.phone || '';
  document.getElementById('shippingAddress').value = currentUser.address || '';
  document.getElementById('inquiryRemark').value = '';
  document.getElementById('inquiryTotalQty').textContent = `${selection.reduce((sum, item) => sum + item.quantity, 0)} 件`;
  document.getElementById('inquiryItems').innerHTML = selection.map(item => `<div class="checkout-item"><span>${escapeHtml(item.product_name)} · ${escapeHtml(item.color)}/${escapeHtml(item.size)}</span><strong>${item.quantity}件</strong></div>`).join('');
  closeModal('selectionModal');
  openModal('inquiryModal');
}

async function submitInquiry(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  button.textContent = '提交中...';
  try {
    const result = await api('/inquiries', {
      method: 'POST',
      body: JSON.stringify({
        shipping_address: document.getElementById('shippingAddress').value.trim(),
        remark: document.getElementById('inquiryRemark').value.trim(),
        items: selection.map(item => ({ sku_id: item.sku_id, quantity: item.quantity })),
      }),
    });
    if (result.code !== 0) return alert(`提交失败：${result.message}`);
    selection = [];
    saveSelection();
    closeModal('inquiryModal');
    document.getElementById('successInquiryNo').textContent = `询价单号：${result.data.inquiry_no}`;
    openModal('successModal');
  } finally {
    button.disabled = false;
    button.textContent = '提交选款询价';
  }
}

async function openMyInquiries() {
  if (!currentUser) return openAuthModal('login');
  const container = document.getElementById('myInquiriesList');
  container.innerHTML = '<div class="loading">加载中...</div>';
  openModal('inquiriesModal');
  const result = await api('/inquiries');
  if (result.code !== 0) return container.innerHTML = `<div class="form-error">${escapeHtml(result.message)}</div>`;
  if (!result.data.length) return container.innerHTML = '<div class="empty-state">暂无询价记录</div>';
  const labels = inquiryStatusLabels();
  container.innerHTML = result.data.map(inquiry => `<div class="record-card">
    <div class="record-head"><div><strong>${escapeHtml(inquiry.inquiry_no)}</strong><span class="badge inquiry-${inquiry.status}">${labels[inquiry.status]}</span></div><span>${formatTime(inquiry.created_at)}</span></div>
    <div class="record-items">${inquiry.items.map(item => `<span>${escapeHtml(item.style_code)} · ${escapeHtml(item.color)}/${escapeHtml(item.size)} × ${item.quantity}</span>`).join('')}</div>
    <div class="record-foot"><span>合计 ${inquiry.total_quantity} 件</span>${inquiry.converted_order_id ? '<strong>已转正式订单</strong>' : '<span>等待联系确认</span>'}</div>
  </div>`).join('');
}

async function openMyOrders() {
  if (!currentUser) return openAuthModal('login');
  const container = document.getElementById('myOrdersList');
  container.innerHTML = '<div class="loading">加载中...</div>';
  openModal('ordersModal');
  const result = await api('/orders');
  if (result.code !== 0) return container.innerHTML = `<div class="form-error">${escapeHtml(result.message)}</div>`;
  if (!result.data.length) return container.innerHTML = '<div class="empty-state">暂无正式订单</div>';
  const labels = orderStatusLabels();
  container.innerHTML = result.data.map(order => `<div class="record-card">
    <div class="record-head"><div><strong>${escapeHtml(order.order_no)}</strong><span class="badge badge-${order.status}">${labels[order.status]}</span></div><span>${formatTime(order.created_at)}</span></div>
    <div class="record-foot"><span>共 ${order.total_quantity} 件</span><span>${escapeHtml(order.shipping_address || '地址待确认')}</span></div>
  </div>`).join('');
}

function inquiryStatusLabels() {
  return { pending: '待联系', contacted: '已联系', quoted: '已报价', considering: '客户考虑中', converted: '已成交', lost: '未成交' };
}

function orderStatusLabels() {
  return { pending: '待确认', confirmed: '已确认', production: '生产中', shipping: '发货中', delivered: '已送达', cancelled: '已取消' };
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function formatTime(iso) { return new Date(iso).toLocaleString('zh-CN', { hour12: false }); }
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

let searchTimer;
document.getElementById('searchInput').addEventListener('input', event => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentKeyword = event.target.value.trim();
    loadProducts();
  }, 250);
});

document.getElementById('categoryTabs').addEventListener('click', event => {
  if (!event.target.classList.contains('cat-btn')) return;
  document.querySelectorAll('.cat-btn').forEach(button => button.classList.remove('active'));
  event.target.classList.add('active');
  currentCategory = event.target.dataset.cat;
  loadProducts();
});

window.addEventListener('popstate', () => {
  const match = location.pathname.match(/^\/product\/([0-9a-f-]+)$/i);
  if (match) showProductDetail(match[1], false);
  else if (activeProductId) closeProductModal(false);
});

async function initialize() {
  updateSelectionBadge();
  await Promise.all([initializeSession(), loadProducts()]);
  const match = location.pathname.match(/^\/product\/([0-9a-f-]+)$/i);
  if (match) showProductDetail(match[1], false);
}

initialize();
