'use strict';

const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(__dirname, '..', relativePath), content, 'utf8');
}

function replaceRequired(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`[catalog-v3.4] 未找到待修改代码：${label}`);
  }
  return content.replace(pattern, replacement);
}

function patchServer() {
  let source = read('server.js');
  if (source.includes('const DISPLAY_ORDER_OBJECT =')) {
    console.log('[catalog-v3.4] server.js 已升级，跳过。');
    return;
  }

  source = source.replace("const APP_VERSION = '3.3.0';", "const APP_VERSION = '3.4.0';");

  source = replaceRequired(
    source,
    /const IMAGE_BUCKET = process\.env\.SUPABASE_IMAGE_BUCKET \|\| 'product-images';/,
    `const IMAGE_BUCKET = process.env.SUPABASE_IMAGE_BUCKET || 'product-images';
const DISPLAY_ORDER_OBJECT = '_system/product-display-order.webp';
const PRODUCT_CATEGORIES = Object.freeze(['短袖', '长袖', '卫衣', '背心']);
const PRODUCT_CATEGORY_RANK = new Map(PRODUCT_CATEGORIES.map((category, index) => [category, index]));`,
    '商品分类常量',
  );

  source = replaceRequired(
    source,
    /    category: product\.category,/,
    '    category: inferProductCategory(product),',
    '商品分类标准化',
  );

  const helpers = `
function inferProductCategory(product) {
  const current = cleanText(product?.category, 50);
  if (PRODUCT_CATEGORIES.includes(current)) return current;
  const text = \`${product?.name || ''} ${product?.description || ''}\`;
  if (/卫衣/.test(text)) return '卫衣';
  if (/(背心|无袖)/.test(text)) return '背心';
  if (/长袖/.test(text)) return '长袖';
  return '短袖';
}

async function readProductDisplayOrder() {
  try {
    const { data, error } = await supabase.storage.from(IMAGE_BUCKET).download(DISPLAY_ORDER_OBJECT);
    if (error || !data) return [];
    const raw = Buffer.from(await data.arrayBuffer()).toString('utf8');
    const parsed = JSON.parse(raw);
    const ids = Array.isArray(parsed) ? parsed : parsed?.product_ids;
    return Array.isArray(ids) ? ids.map(String).filter(validUuid) : [];
  } catch (_) {
    return [];
  }
}

async function writeProductDisplayOrder(productIds) {
  const payload = Buffer.from(JSON.stringify({
    product_ids: productIds,
    updated_at: new Date().toISOString(),
  }), 'utf8');
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(
    DISPLAY_ORDER_OBJECT,
    payload,
    { contentType: 'image/webp', cacheControl: '0', upsert: true },
  );
  assertDb(error, '保存商品展示顺序失败');
}

function sortProductsForDisplay(products, displayOrder) {
  const position = new Map(displayOrder.map((id, index) => [id, index]));
  return [...products].sort((a, b) => {
    const aPosition = position.has(a.id) ? position.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bPosition = position.has(b.id) ? position.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (aPosition !== bPosition) return aPosition - bPosition;
    const categoryDifference =
      (PRODUCT_CATEGORY_RANK.get(a.category) ?? 99) -
      (PRODUCT_CATEGORY_RANK.get(b.category) ?? 99);
    if (categoryDifference !== 0) return categoryDifference;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

`;

  source = replaceRequired(
    source,
    /async function fetchOrder\(orderId\) \{/,
    `${helpers}async function fetchOrder(orderId) {`,
    '展示顺序辅助函数',
  );

  const productsRoute = `app.get('/api/products', requireDatabase, optionalAuth, asyncRoute(async (req, res) => {
  const category = cleanText(req.query.category, 50);
  const keyword = cleanText(req.query.keyword, 100).replaceAll('%', '');
  const requestedStatus = cleanText(req.query.status, 20);
  const isAdmin = req.user?.role === 'admin';
  const canSeeAll = isAdmin && requestedStatus === 'all';

  if (category && !PRODUCT_CATEGORIES.includes(category)) {
    return fail(res, 400, '商品分类无效');
  }

  let query = supabase
    .from('products')
    .select('*, skus:product_skus(*), images:product_images(*)')
    .order('created_at', { ascending: false });
  if (!canSeeAll) query = query.eq('status', requestedStatus || 'on_sale');
  if (keyword) query = query.or(\`name.ilike.%${keyword}%,style_code.ilike.%${keyword}%,material.ilike.%${keyword}%,description.ilike.%${keyword}%\`);

  const { data, error } = await query;
  assertDb(error, '读取商品列表失败');

  let products = (data || []).map(product => normalizeProduct(product, isAdmin));
  if (category) products = products.filter(product => product.category === category);
  const displayOrder = await readProductDisplayOrder();
  products = sortProductsForDisplay(products, displayOrder)
    .map((product, index) => ({ ...product, display_position: index + 1 }));
  return ok(res, products);
}));

app.patch('/api/products/reorder', requireDatabase, requireJwtSecret, auth, adminOnly, asyncRoute(async (req, res) => {
  const requestedIds = Array.isArray(req.body.product_ids) ? req.body.product_ids.map(String) : [];
  if (!requestedIds.length || requestedIds.some(id => !validUuid(id)) || new Set(requestedIds).size !== requestedIds.length) {
    return fail(res, 400, '商品顺序数据无效');
  }

  const { data: rows, error } = await supabase.from('products').select('id');
  assertDb(error, '读取商品列表失败');
  const existingIds = (rows || []).map(row => row.id);
  const existingSet = new Set(existingIds);
  if (requestedIds.some(id => !existingSet.has(id))) {
    return fail(res, 400, '商品列表已变化，请刷新后台后重试');
  }

  const currentOrder = await readProductDisplayOrder();
  const requestedSet = new Set(requestedIds);
  const merged = [
    ...requestedIds,
    ...currentOrder.filter(id => existingSet.has(id) && !requestedSet.has(id)),
    ...existingIds.filter(id => !requestedSet.has(id) && !currentOrder.includes(id)),
  ];

  await writeProductDisplayOrder(merged);
  return ok(res, { product_ids: merged }, '前台展示顺序已更新');
}));

app.get('/api/products/:id/share'`;

  source = replaceRequired(
    source,
    /app\.get\('\/api\/products',[\s\S]*?app\.get\('\/api\/products\/:id\/share'/,
    productsRoute,
    '商品列表与排序接口',
  );

  source = replaceRequired(
    source,
    /  if \(!name \|\| !category\) return fail\(res, 400, '商品名称和分类不能为空'\);/,
    `  if (!name || !category) return fail(res, 400, '商品名称和分类不能为空');
  if (!PRODUCT_CATEGORIES.includes(category)) return fail(res, 400, '商品分类无效');`,
    '新增商品分类校验',
  );

  source = replaceRequired(
    source,
    /  if \(req\.body\.category !== undefined\) \{\n    const category = cleanText\(req\.body\.category, 50\);\n    if \(!category\) return fail\(res, 400, '商品分类不能为空'\);\n    updates\.category = category;\n  \}/,
    `  if (req.body.category !== undefined) {
    const category = cleanText(req.body.category, 50);
    if (!PRODUCT_CATEGORIES.includes(category)) return fail(res, 400, '商品分类无效');
    updates.category = category;
  }`,
    '编辑商品分类校验',
  );

  write('server.js', source);
  console.log('[catalog-v3.4] server.js 已加入分类与展示排序。');
}

function patchAdminHtml() {
  let source = read('public/admin.html');
  const options = '<option value="短袖">短袖</option><option value="长袖">长袖</option><option value="卫衣">卫衣</option><option value="背心">背心</option>';
  source = source
    .replace(/<option value="上衣">上衣<\/option><option value="裤子">裤子<\/option><option value="连衣裙">连衣裙<\/option><option value="外套">外套<\/option><option value="套装">套装<\/option>/g, options)
    .replace(
      '维护商品资料、图片、颜色尺码和库存，一键生成适合朋友圈的发布文案。',
      '维护商品资料、分类、前台展示位置、图片、颜色尺码和库存。',
    );
  write('public/admin.html', source);
  console.log('[catalog-v3.4] admin.html 分类选项已更新。');
}

function patchIndexHtml() {
  let source = read('public/index.html');
  source = replaceRequired(
    source,
    /<div class="category-tabs" id="categoryTabs">[\s\S]*?<\/div>\n  <\/div>/,
    `<div class="category-tabs" id="categoryTabs">
      <button class="cat-btn active" data-cat="">全部</button>
      <button class="cat-btn" data-cat="短袖">短袖</button>
      <button class="cat-btn" data-cat="长袖">长袖</button>
      <button class="cat-btn" data-cat="卫衣">卫衣</button>
      <button class="cat-btn" data-cat="背心">背心</button>
    </div>
  </div>`,
    '前台分类标签',
  );
  write('public/index.html', source);
  console.log('[catalog-v3.4] index.html 前台分类已更新。');
}

function patchAppJs() {
  let source = read('public/assets/app.js');
  source = source.replace(
    "return ({ 上衣: '👕', 裤子: '👖', 连衣裙: '👗', 外套: '🧥', 套装: '🥋' })[category] || '📦';",
    "return ({ 短袖: '👕', 长袖: '👕', 卫衣: '🧥', 背心: '🎽' })[category] || '📦';",
  );
  write('public/assets/app.js', source);
  console.log('[catalog-v3.4] app.js 分类占位图已更新。');
}

function patchAdminJs() {
  let source = read('public/assets/admin.js');
  if (source.includes('async function moveProductDisplay')) {
    console.log('[catalog-v3.4] admin.js 已升级，跳过。');
    return;
  }

  source = replaceRequired(
    source,
    /productList\.map\(product => \{/,
    'productList.map(product => {',
    '商品后台卡片循环',
  );

  source = replaceRequired(
    source,
    /    const meta = \[product\.category, product\.material, product\.badge_text\]\.filter\(Boolean\)\.map\(escapeHtml\)\.join\(' · '\);/,
    `    const meta = [product.category, product.material, product.badge_text].filter(Boolean).map(escapeHtml).join(' · ');
    const displayIndex = productsCache.findIndex(item => item.id === product.id);
    const displayPosition = displayIndex >= 0 ? displayIndex + 1 : product.display_position || '-';`,
    '商品展示位置',
  );

  source = replaceRequired(
    source,
    /<div class="product-admin-actions"><button class="btn btn-sm btn-outline" onclick="showEditProduct\('\$\{product\.id\}'\)">编辑商品<\/button>[\s\S]*?<button class="btn btn-sm btn-primary" onclick="showAddSku\('\$\{product\.id\}'\)">\+ 单个SKU<\/button><\/div>/,
    `<div class="product-admin-actions"><span class="badge badge-delivered">前台第 ${displayPosition} 位</span><button class="btn btn-sm btn-outline" onclick="moveProductDisplay('${product.id}','top')">置顶</button><button class="btn btn-sm btn-outline" ${displayIndex <= 0 ? 'disabled' : ''} onclick="moveProductDisplay('${product.id}','up')">上移</button><button class="btn btn-sm btn-outline" ${displayIndex < 0 || displayIndex >= productsCache.length - 1 ? 'disabled' : ''} onclick="moveProductDisplay('${product.id}','down')">下移</button><button class="btn btn-sm btn-outline" onclick="setProductDisplayPosition('${product.id}')">指定位置</button><button class="btn btn-sm btn-outline" onclick="showEditProduct('${product.id}')">编辑商品</button><button class="btn btn-sm btn-outline" onclick="toggleProductStatus('${product.id}','${product.status}')">${product.status === 'on_sale' ? '下架' : '上架'}</button><button class="btn btn-sm btn-outline" onclick="manageProductImages('${product.id}')">图片管理</button><button class="btn btn-sm btn-outline" onclick="showShareMaterial('${product.id}')">朋友圈素材</button><button class="btn btn-sm btn-primary" onclick="showBatchSku('${product.id}')">批量规格</button><button class="btn btn-sm btn-primary" onclick="showAddSku('${product.id}')">+ 单个SKU</button></div>`,
    '商品排序按钮',
  );

  source = source.replace(
    "document.getElementById('epCategory').value = product.category || '上衣';",
    "document.getElementById('epCategory').value = product.category || '短袖';",
  );

  const controls = `
async function saveProductDisplayOrder(productIds) {
  const result = await api('/products/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ product_ids: productIds }),
  });
  if (result.code !== 0) return alert(\`排序失败：${result.message}\`);
  showToast('前台展示顺序已更新');
  await loadProductsAdmin();
}

async function moveProductDisplay(productId, action) {
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
  await saveProductDisplayOrder(productIds);
}

async function setProductDisplayPosition(productId) {
  const productIds = productsCache.map(product => product.id);
  const currentIndex = productIds.indexOf(productId);
  if (currentIndex < 0) return;
  const input = prompt(\`请输入前台位置（1-${productIds.length}）\`, String(currentIndex + 1));
  if (input === null) return;
  const position = Number.parseInt(input, 10);
  if (!Number.isInteger(position) || position < 1 || position > productIds.length) {
    return alert(\`请输入 1 到 ${productIds.length} 之间的整数\`);
  }
  productIds.splice(currentIndex, 1);
  productIds.splice(position - 1, 0, productId);
  await saveProductDisplayOrder(productIds);
}

`;

  source = replaceRequired(
    source,
    /async function toggleProductStatus\(productId, currentStatus\) \{/,
    `${controls}async function toggleProductStatus(productId, currentStatus) {`,
    '商品排序控制函数',
  );

  write('public/assets/admin.js', source);
  console.log('[catalog-v3.4] admin.js 已加入前台排序控制。');
}

patchServer();
patchAdminHtml();
patchIndexHtml();
patchAppJs();
patchAdminJs();
