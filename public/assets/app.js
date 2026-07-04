'use strict';

const API = '/api';
const TOKEN_KEY = 'wholesale_customer_token';
let token = localStorage.getItem(TOKEN_KEY) || '';
let currentUser = null;
let products = [];
let cart = [];
let currentCategory = '';
let currentKeyword = '';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(`${API}${path}`, { ...options, headers });
  } catch (_) {
    throw new Error('网络连接失败，请检查服务是否启动');
  }
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json')
    ? await response.json()
    : { code: 1, message: await response.text() };
  if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
    clearSession();
    openAuthModal('login');
  }
  return result;
}

function clearSession() {
  token = '';
  currentUser = null;
  cart = [];
  localStorage.removeItem(TOKEN_KEY);
  renderSession();
  updateCartBadge();
}

function renderSession() {
  const loggedIn = Boolean(currentUser);
  document.getElementById('userSummary').textContent = loggedIn ? `${currentUser.name}（${currentUser.phone}）` : '未登录';
  document.getElementById('loginButton').style.display = loggedIn ? 'none' : '';
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
    if (result.code !== 0 || result.data.role !== 'customer') {
      clearSession();
      return;
    }
    currentUser = result.data;
    renderSession();
    await loadCart();
  } catch (_) {
    clearSession();
  }
}

function openAuthModal(mode = 'login') {
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
  if (result.code !== 0) {
    error.textContent = result.message || '登录失败';
    return;
  }
  if (result.data.user.role !== 'customer') {
    error.textContent = '管理员账号请从管理后台登录';
    return;
  }
  token = result.data.token;
  currentUser = result.data.user;
  localStorage.setItem(TOKEN_KEY, token);
  renderSession();
  closeModal('authModal');
  await loadCart();
  showToast('登录成功');
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
  if (result.code !== 0) {
    error.textContent = result.message || '注册失败';
    return;
  }
  token = result.data.token;
  currentUser = result.data.user;
  localStorage.setItem(TOKEN_KEY, token);
  renderSession();
  closeModal('authModal');
  await loadCart();
  showToast('注册成功');
}

function logout() {
  clearSession();
  showToast('已退出登录');
}

function requireLogin() {
  if (currentUser && token) return true;
  openAuthModal('login');
  return false;
}

async function loadProducts() {
  const grid = document.getElementById('productGrid');
  grid.innerHTML = '<div class="loading">加载商品中...</div>';
  const params = new URLSearchParams();
  if (currentCategory) params.set('category', currentCategory);
  if (currentKeyword) params.set('keyword', currentKeyword);
  try {
    const result = await api(`/products?${params}`);
    if (result.code !== 0) throw new Error(result.message || '商品加载失败');
    products = result.data || [];
    renderProducts();
  } catch (error) {
    grid.innerHTML = `<div class="loading">${escapeHtml(error.message)}</div>`;
  }
}

function renderProducts() {
  const grid = document.getElementById('productGrid');
  if (products.length === 0) {
    grid.innerHTML = '<div class="loading">暂无在售商品，请管理员先在后台添加商品和 SKU</div>';
    return;
  }
  const icons = { 上衣: '👕', 裤子: '👖', 连衣裙: '👗', 外套: '🧥', 套装: '🥋' };
  grid.innerHTML = products.map(product => {
    const prices = product.skus.map(sku => Number(sku.wholesale_price));
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const image = product.image_url
      ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" loading="lazy">`
      : (icons[product.category] || '📦');
    return `<div class="product-card" onclick="showProductDetail('${product.id}')">
      <div class="product-card-image">${image}</div>
      <div class="product-card-info">
        <div class="product-card-name">${escapeHtml(product.name)}</div>
        <div class="product-card-desc">${escapeHtml(product.description || '')}</div>
        <div class="product-card-footer"><span class="product-card-price">¥${money(minPrice)}起</span><span class="product-card-sku-count">${product.skus.length}个规格</span></div>
      </div>
    </div>`;
  }).join('');
}

async function showProductDetail(id) {
  const result = await api(`/products/${id}`);
  if (result.code !== 0) {
    alert(result.message || '读取商品失败');
    return;
  }
  const product = result.data;
  document.getElementById('productDetail').innerHTML = `
    <div class="product-detail-header"><div class="product-detail-name">${escapeHtml(product.name)}</div><div class="product-detail-desc">${escapeHtml(product.description || '')}</div></div>
    <h3>选择规格</h3>
    <table class="sku-table"><thead><tr><th>颜色</th><th>尺码</th><th>批发价</th><th>库存</th><th>数量</th></tr></thead>
    <tbody>${product.skus.map(sku => `<tr>
      <td>${escapeHtml(sku.color)}</td><td>${escapeHtml(sku.size)}</td><td class="price">¥${money(sku.wholesale_price)}</td>
      <td class="stock-tag">${sku.stock > 0 ? `库存${sku.stock}件` : '<span class="danger-text">缺货</span>'}</td>
      <td><input type="number" class="qty-input" id="qty-${sku.id}" min="0" max="${sku.stock}" value="0" ${sku.stock <= 0 ? 'disabled' : ''}></td>
    </tr>`).join('')}</tbody></table>
    <button class="btn btn-primary btn-block" onclick="addToCartFromDetail('${product.id}')">加入订货清单</button>`;
  openModal('productModal');
}

async function addToCartFromDetail(productId) {
  if (!requireLogin()) return;
  const product = products.find(item => item.id === productId) || (await api(`/products/${productId}`)).data;
  const selections = product.skus.map(sku => ({ sku, quantity: Number.parseInt(document.getElementById(`qty-${sku.id}`)?.value, 10) || 0 })).filter(item => item.quantity > 0);
  if (selections.length === 0) {
    alert('请至少选择一个规格并输入数量');
    return;
  }

  let added = 0;
  for (const item of selections) {
    const result = await api('/cart/add', { method: 'POST', body: JSON.stringify({ sku_id: item.sku.id, quantity: item.quantity }) });
    if (result.code !== 0) {
      await loadCart();
      alert(`${item.sku.color}/${item.sku.size} 添加失败：${result.message}`);
      return;
    }
    added += item.quantity;
  }
  await loadCart();
  closeModal('productModal');
  showToast(`已加入 ${added} 件`);
}

async function loadCart() {
  if (!token) {
    cart = [];
    updateCartBadge();
    return;
  }
  const result = await api('/cart');
  if (result.code === 0) cart = result.data || [];
  updateCartBadge();
}

function updateCartBadge() {
  document.getElementById('cartCount').textContent = cart.reduce((sum, item) => sum + Number(item.quantity), 0);
}

async function openCart() {
  if (!requireLogin()) return;
  await loadCart();
  renderCart();
  openModal('cartModal');
}

function renderCart() {
  const container = document.getElementById('cartItems');
  container.innerHTML = cart.length === 0
    ? '<p class="empty-state">订货清单为空</p>'
    : cart.map(item => `<div class="cart-item">
      <div class="cart-item-info"><div class="cart-item-name">${escapeHtml(item.product_name)}</div><div class="cart-item-sku">${escapeHtml(item.color)} / ${escapeHtml(item.size)} (${escapeHtml(item.sku_code)})</div><div class="cart-item-sku">单价：¥${money(item.unit_price)}</div></div>
      <div class="cart-item-qty"><button class="btn btn-sm btn-outline" onclick="changeQty('${item.sku_id}', ${item.quantity - 1})">-</button><span class="qty-value">${item.quantity}</span><button class="btn btn-sm btn-outline" onclick="changeQty('${item.sku_id}', ${item.quantity + 1})">+</button></div>
      <div class="cart-item-subtotal price">¥${money(item.subtotal)}</div>
      <button class="btn btn-sm btn-outline" onclick="removeFromCart('${item.sku_id}')">✕</button>
    </div>`).join('');
  const totalQty = cart.reduce((sum, item) => sum + Number(item.quantity), 0);
  const totalAmount = cart.reduce((sum, item) => sum + Number(item.subtotal), 0);
  document.getElementById('cartTotalQty').textContent = totalQty;
  document.getElementById('cartTotalAmount').textContent = `¥${money(totalAmount)}`;
}

async function changeQty(skuId, quantity) {
  const result = await api(`/cart/${skuId}`, { method: 'PATCH', body: JSON.stringify({ quantity }) });
  if (result.code !== 0) {
    alert(result.message || '更新数量失败');
    return;
  }
  await loadCart();
  renderCart();
}

async function removeFromCart(skuId) {
  const result = await api(`/cart/${skuId}`, { method: 'DELETE' });
  if (result.code !== 0) return alert(result.message || '移除失败');
  await loadCart();
  renderCart();
}

async function clearCart() {
  if (!requireLogin()) return;
  if (cart.length && !confirm('确认清空订货清单？')) return;
  const result = await api('/cart', { method: 'DELETE' });
  if (result.code !== 0) return alert(result.message || '清空失败');
  cart = [];
  updateCartBadge();
  renderCart();
}

async function showCheckout() {
  if (!requireLogin()) return;
  await loadCart();
  if (cart.length === 0) return alert('订货清单为空');
  document.getElementById('customerName').value = currentUser.name || '';
  document.getElementById('customerPhone').value = currentUser.phone || '';
  document.getElementById('shippingAddress').value = currentUser.address || '';
  document.getElementById('checkoutItems').innerHTML = cart.map(item => `<div class="checkout-item"><span>${escapeHtml(item.product_name)}（${escapeHtml(item.color)}/${escapeHtml(item.size)}）</span><span>${item.quantity}件 × ¥${money(item.unit_price)} = <span class="price">¥${money(item.subtotal)}</span></span></div>`).join('');
  document.getElementById('checkoutTotal').textContent = `¥${money(cart.reduce((sum, item) => sum + Number(item.subtotal), 0))}`;
  closeModal('cartModal');
  openModal('checkoutModal');
}

async function submitOrder(event) {
  event.preventDefault();
  const submitButton = event.submitter;
  if (submitButton) submitButton.disabled = true;
  try {
    const result = await api('/orders', {
      method: 'POST',
      body: JSON.stringify({
        shipping_address: document.getElementById('shippingAddress').value.trim(),
        remark: document.getElementById('remark').value.trim(),
      }),
    });
    if (result.code !== 0) return alert(`下单失败：${result.message}`);
    closeModal('checkoutModal');
    document.getElementById('successOrderNo').textContent = `订单号：${result.data.order.order_no}`;
    document.getElementById('successAmount').textContent = `¥${money(result.data.order.total_amount)}`;
    cart = [];
    updateCartBadge();
    openModal('successModal');
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function openMyOrders() {
  if (!requireLogin()) return;
  const container = document.getElementById('myOrdersList');
  container.innerHTML = '<p class="empty-state">加载中...</p>';
  openModal('ordersModal');
  const result = await api('/orders');
  if (result.code !== 0) {
    container.innerHTML = `<p class="form-error">${escapeHtml(result.message)}</p>`;
    return;
  }
  const labels = { pending: '待确认', confirmed: '已确认', production: '生产中', shipping: '发货中', delivered: '已送达', cancelled: '已取消' };
  container.innerHTML = result.data.length === 0
    ? '<p class="empty-state">暂无订单</p>'
    : result.data.map(order => `<div class="recent-order-item"><div><strong>${escapeHtml(order.order_no)}</strong><br><span>${escapeHtml(formatTime(order.created_at))} · ${order.total_quantity}件</span></div><div class="text-right"><span class="price">¥${money(order.total_amount)}</span><br><span class="badge badge-${order.status}">${labels[order.status] || order.status}</span></div></div>`).join('');
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function formatTime(iso) { return new Date(iso).toLocaleString('zh-CN', { hour12: false }); }
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

const searchInput = document.getElementById('searchInput');
searchInput.addEventListener('input', event => {
  currentKeyword = event.target.value.trim();
  clearTimeout(window.searchTimer);
  window.searchTimer = setTimeout(loadProducts, 300);
});
document.getElementById('categoryTabs').addEventListener('click', event => {
  if (!event.target.classList.contains('cat-btn')) return;
  document.querySelectorAll('.cat-btn').forEach(button => button.classList.remove('active'));
  event.target.classList.add('active');
  currentCategory = event.target.dataset.cat;
  loadProducts();
});

initializeSession();
loadProducts();
