/* ============================================
   服装批发订货系统 - 前台订货逻辑
   ============================================ */

const API = '/api';
let products = [];
let cart = [];
let customers = [];
let currentCategory = '';
let currentKeyword = '';

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
// 商品列表
// ============================================
async function loadProducts() {
  const params = new URLSearchParams();
  if (currentCategory) params.set('category', currentCategory);
  if (currentKeyword) params.set('keyword', currentKeyword);
  const res = await api(`/products?${params}`);
  products = res.data || [];
  renderProducts();
}

function renderProducts() {
  const grid = document.getElementById('productGrid');
  if (products.length === 0) {
    grid.innerHTML = '<div class="loading">暂无商品</div>';
    return;
  }
  grid.innerHTML = products.map(p => {
    const minPrice = p.skus.length > 0 ? Math.min(...p.skus.map(s => s.wholesale_price)) : 0;
    const emojis = { '上衣': '👕', '裤子': '👖', '连衣裙': '👗', '外套': '🧥', '套装': '🥋' };
    return `
      <div class="product-card" onclick="showProductDetail('${p.id}')">
        <div class="product-card-image">${emojis[p.category] || '📦'}</div>
        <div class="product-card-info">
          <div class="product-card-name">${p.name}</div>
          <div class="product-card-desc">${p.description || ''}</div>
          <div class="product-card-footer">
            <span class="product-card-price">¥${minPrice.toFixed(2)}起</span>
            <span class="product-card-sku-count">${p.skus.length}个规格</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================
// 商品详情
// ============================================
async function showProductDetail(id) {
  const res = await api(`/products/${id}`);
  if (res.code !== 0) return;
  const p = res.data;
  document.getElementById('productDetail').innerHTML = `
    <div class="product-detail-header">
      <div class="product-detail-name">${p.name}</div>
      <div class="product-detail-desc">${p.description || ''}</div>
    </div>
    <h3>选择规格</h3>
    <table class="sku-table">
      <thead>
        <tr><th>颜色</th><th>尺码</th><th>批发价</th><th>库存</th><th>数量</th></tr>
      </thead>
      <tbody>
        ${p.skus.map(s => `
          <tr>
            <td>${s.color}</td>
            <td>${s.size}</td>
            <td class="price">¥${s.wholesale_price.toFixed(2)}</td>
            <td class="stock-tag">${s.stock > 0 ? `库存${s.stock}件` : '<span style="color:#ef4444">缺货</span>'}</td>
            <td>
              <input type="number" class="qty-input" id="qty-${s.id}" min="0" max="${s.stock}" value="0" ${s.stock <= 0 ? 'disabled' : ''} onchange="updateQtyPreview('${s.id}', ${s.wholesale_price})">
              <span id="preview-${s.id}" style="font-size:12px;color:#64748b"></span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="btn btn-primary btn-block" onclick="addToCartFromDetail('${id}')">加入订货清单</button>
  `;
  openModal('productModal');
}

function updateQtyPreview(skuId, price) {
  const qty = parseInt(document.getElementById(`qty-${skuId}`).value) || 0;
  const preview = document.getElementById(`preview-${skuId}`);
  preview.textContent = qty > 0 ? `= ¥${(qty * price).toFixed(2)}` : '';
}

function addToCartFromDetail(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  let added = 0;
  product.skus.forEach(sku => {
    const qtyEl = document.getElementById(`qty-${sku.id}`);
    if (!qtyEl) return;
    const qty = parseInt(qtyEl.value) || 0;
    if (qty > 0 && qty <= sku.stock) {
      const existing = cart.find(c => c.sku_id === sku.id);
      if (existing) {
        existing.quantity += qty;
      } else {
        cart.push({
          sku_id: sku.id,
          product_id: productId,
          product_name: product.name,
          sku_code: sku.sku_code,
          color: sku.color,
          size: sku.size,
          quantity: qty,
          unit_price: sku.wholesale_price,
        });
      }
      added += qty;
    }
  });
  if (added === 0) {
    alert('请至少选择一个规格并输入数量');
    return;
  }
  updateCartBadge();
  closeModal('productModal');
  showToast(`已加入 ${added} 件到订货清单`);
}

// ============================================
// 购物车
// ============================================
function updateCartBadge() {
  const total = cart.reduce((s, c) => s + c.quantity, 0);
  document.getElementById('cartCount').textContent = total;
}

function openCart() {
  renderCart();
  openModal('cartModal');
}

function renderCart() {
  const container = document.getElementById('cartItems');
  if (cart.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#94a3b8;padding:40px">订货清单为空</p>';
  } else {
    container.innerHTML = cart.map((item, idx) => `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.product_name}</div>
          <div class="cart-item-sku">${item.color} / ${item.size} (${item.sku_code})</div>
          <div class="cart-item-sku">单价: ¥${item.unit_price.toFixed(2)}</div>
        </div>
        <div class="cart-item-qty">
          <button class="btn btn-sm btn-outline" onclick="changeQty(${idx}, -1)">-</button>
          <span style="min-width:30px;text-align:center">${item.quantity}</span>
          <button class="btn btn-sm btn-outline" onclick="changeQty(${idx}, 1)">+</button>
        </div>
        <div class="cart-item-subtotal price">¥${(item.quantity * item.unit_price).toFixed(2)}</div>
        <button class="btn btn-sm btn-outline" onclick="removeFromCart(${idx})" style="margin-left:8px">✕</button>
      </div>
    `).join('');
  }
  const totalQty = cart.reduce((s, c) => s + c.quantity, 0);
  const totalAmount = cart.reduce((s, c) => s + c.quantity * c.unit_price, 0);
  document.getElementById('cartTotalQty').textContent = totalQty;
  document.getElementById('cartTotalAmount').textContent = `¥${totalAmount.toFixed(2)}`;
}

function changeQty(idx, delta) {
  cart[idx].quantity += delta;
  if (cart[idx].quantity <= 0) cart.splice(idx, 1);
  updateCartBadge();
  renderCart();
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  updateCartBadge();
  renderCart();
}

function clearCart() {
  cart = [];
  updateCartBadge();
  renderCart();
}

// ============================================
// 下单流程
// ============================================
async function showCheckout() {
  if (cart.length === 0) {
    alert('订货清单为空');
    return;
  }
  // 加载客户列表
  const res = await api('/customers');
  customers = res.data || [];
  const select = document.getElementById('customerSelect');
  select.innerHTML = '<option value="">请选择客户</option>' + customers.map(c => `<option value="${c.id}">${c.name} - ${c.phone}</option>`).join('');

  // 渲染订单明细
  document.getElementById('checkoutItems').innerHTML = cart.map(item => `
    <div class="checkout-item">
      <span>${item.product_name} (${item.color}/${item.size})</span>
      <span>${item.quantity}件 × ¥${item.unit_price.toFixed(2)} = <span class="price">¥${(item.quantity * item.unit_price).toFixed(2)}</span></span>
    </div>
  `).join('');

  const total = cart.reduce((s, c) => s + c.quantity * c.unit_price, 0);
  document.getElementById('checkoutTotal').textContent = `¥${total.toFixed(2)}`;

  closeModal('cartModal');
  openModal('checkoutModal');
}

function fillCustomerInfo() {
  const customerId = document.getElementById('customerSelect').value;
  const customer = customers.find(c => c.id === customerId);
  if (customer) {
    document.getElementById('customerName').value = customer.name;
    document.getElementById('customerPhone').value = customer.phone;
    document.getElementById('shippingAddress').value = customer.address || '';
  }
}

async function submitOrder(event) {
  event.preventDefault();
  const customerId = document.getElementById('customerSelect').value;
  const shippingAddress = document.getElementById('shippingAddress').value;
  const remark = document.getElementById('remark').value;

  const orderData = {
    customer_id: customerId,
    shipping_address: shippingAddress,
    remark: remark,
    items: cart.map(c => ({ sku_id: c.sku_id, quantity: c.quantity })),
  };

  const res = await api('/orders', {
    method: 'POST',
    body: JSON.stringify(orderData),
  });

  if (res.code === 0) {
    closeModal('checkoutModal');
    document.getElementById('successOrderNo').textContent = `订单号: ${res.data.order.order_no}`;
    document.getElementById('successAmount').textContent = `¥${res.data.order.total_amount.toFixed(2)}`;
    openModal('successModal');
  } else {
    alert('下单失败: ' + res.message);
  }
}

// ============================================
// 工具函数
// ============================================
function openModal(id) {
  document.getElementById(id).style.display = 'flex';
}
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:12px 24px;border-radius:8px;z-index:300;font-size:14px;animation:fadeIn 0.3s';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// ============================================
// 事件绑定
// ============================================
document.getElementById('searchInput').addEventListener('input', (e) => {
  currentKeyword = e.target.value;
  clearTimeout(window._searchTimer);
  window._searchTimer = setTimeout(loadProducts, 300);
});

document.getElementById('categoryTabs').addEventListener('click', (e) => {
  if (e.target.classList.contains('cat-btn')) {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    currentCategory = e.target.dataset.cat;
    loadProducts();
  }
});

// ============================================
// 初始化
// ============================================
loadProducts();
