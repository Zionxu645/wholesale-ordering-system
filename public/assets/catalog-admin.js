'use strict';

(function installCatalogAdminControls() {
  const baseApi = window.api;

  function encodeCategory(category, position) {
    return `${category}|${String(position).padStart(6, '0')}`;
  }

  window.api = async function catalogAwareApi(path, options = {}) {
    const isProductEdit = options.method === 'PATCH' && /^\/products\/[0-9a-f-]+$/i.test(path);
    if (!isProductEdit || !options.body) return baseApi(path, options);

    try {
      const payload = JSON.parse(options.body);
      if (payload.category && !payload.category.includes('|')) {
        const productId = path.split('/').pop();
        const index = productsCache.findIndex(product => product.id === productId);
        const position = index >= 0 ? index + 1 : 999999;
        payload.category = encodeCategory(payload.category, position);
        return baseApi(path, { ...options, body: JSON.stringify(payload) });
      }
    } catch (_) {
      // 保持原请求，交给原有接口处理。
    }
    return baseApi(path, options);
  };

  function productIdFromCard(card) {
    const editButton = card.querySelector('button[onclick^="showEditProduct"]');
    const match = String(editButton?.getAttribute('onclick') || '').match(/showEditProduct\('([^']+)'\)/);
    return match ? match[1] : '';
  }

  function makeButton(label, onClick, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline';
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
  }

  async function saveOrder(productIds) {
    for (let index = 0; index < productIds.length; index += 1) {
      const product = productsCache.find(item => item.id === productIds[index]);
      if (!product) continue;
      const result = await baseApi(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ category: encodeCategory(product.category, index + 1) }),
      });
      if (result.code !== 0) {
        await loadProductsAdmin();
        return alert(`排序失败：${result.message}`);
      }
    }
    showToast('前台展示顺序已更新');
    await loadProductsAdmin();
  }

  async function moveProduct(productId, action) {
    const productIds = productsCache.map(product => product.id);
    const currentIndex = productIds.indexOf(productId);
    if (currentIndex < 0) return;
    let targetIndex = currentIndex;
    if (action === 'top') targetIndex = 0;
    if (action === 'up') targetIndex = Math.max(0, currentIndex - 1);
    if (action === 'down') targetIndex = Math.min(productIds.length - 1, currentIndex + 1);
    if (targetIndex === currentIndex) return;
    productIds.splice(currentIndex, 1);
    productIds.splice(targetIndex, 0, productId);
    await saveOrder(productIds);
  }

  async function setPosition(productId) {
    const productIds = productsCache.map(product => product.id);
    const currentIndex = productIds.indexOf(productId);
    if (currentIndex < 0) return;
    const input = prompt(`请输入前台位置（1-${productIds.length}）`, String(currentIndex + 1));
    if (input === null) return;
    const position = Number.parseInt(input, 10);
    if (!Number.isInteger(position) || position < 1 || position > productIds.length) {
      return alert(`请输入 1 到 ${productIds.length} 之间的整数`);
    }
    productIds.splice(currentIndex, 1);
    productIds.splice(position - 1, 0, productId);
    await saveOrder(productIds);
  }

  function enhanceCards() {
    document.querySelectorAll('.product-admin-card').forEach(card => {
      if (card.dataset.displayControls === '1') return;
      const productId = productIdFromCard(card);
      const index = productsCache.findIndex(product => product.id === productId);
      const actions = card.querySelector('.product-admin-actions');
      if (!productId || index < 0 || !actions) return;

      const controls = document.createElement('div');
      controls.className = 'product-admin-actions display-order-actions';

      const position = document.createElement('span');
      position.className = 'badge badge-delivered';
      position.textContent = `前台第 ${index + 1} 位`;
      controls.appendChild(position);
      controls.appendChild(makeButton('置顶', () => moveProduct(productId, 'top'), index === 0));
      controls.appendChild(makeButton('上移', () => moveProduct(productId, 'up'), index === 0));
      controls.appendChild(makeButton('下移', () => moveProduct(productId, 'down'), index === productsCache.length - 1));
      controls.appendChild(makeButton('指定位置', () => setPosition(productId)));

      actions.parentNode.insertBefore(controls, actions);
      card.dataset.displayControls = '1';
    });
  }

  const originalRender = window.renderProductsAdmin;
  if (typeof originalRender === 'function') {
    window.renderProductsAdmin = function wrappedRenderProductsAdmin(productList) {
      const result = originalRender(productList);
      setTimeout(enhanceCards, 0);
      return result;
    };
  }

  window.addEventListener('DOMContentLoaded', () => setTimeout(enhanceCards, 0));
})();
