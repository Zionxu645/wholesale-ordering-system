'use strict';

const fs = require('fs');
const path = require('path');

function file(relativePath) {
  return path.join(__dirname, '..', relativePath);
}

function read(relativePath) {
  return fs.readFileSync(file(relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(file(relativePath), content, 'utf8');
}

let server = read('server.js');
if (!server.includes("require('./catalog-runtime');")) {
  server = server.replace("'use strict';", "'use strict';\n\nrequire('./catalog-runtime');");
  write('server.js', server);
}

let admin = read('public/admin.html');
const categoryOptions = '<option value="短袖">短袖</option><option value="长袖">长袖</option><option value="卫衣">卫衣</option><option value="背心">背心</option>';
admin = admin
  .replace(/<option value="上衣">上衣<\/option><option value="裤子">裤子<\/option><option value="连衣裙">连衣裙<\/option><option value="外套">外套<\/option><option value="套装">套装<\/option>/g, categoryOptions)
  .replace(
    '维护商品资料、图片、颜色尺码和库存，一键生成适合朋友圈的发布文案。',
    '维护商品资料、分类、前台展示位置、图片、颜色尺码和库存。',
  )
  .replace(
    '<script src="/assets/admin.js"></script>',
    '<script src="/assets/admin.js"></script>\n  <script src="/assets/catalog-admin.js"></script>',
  );
write('public/admin.html', admin);

let index = read('public/index.html');
index = index.replace(
  /<div class="category-tabs" id="categoryTabs">[\s\S]*?<\/div>\n  <\/div>/,
  `<div class="category-tabs" id="categoryTabs">
      <button class="cat-btn active" data-cat="">全部</button>
      <button class="cat-btn" data-cat="短袖">短袖</button>
      <button class="cat-btn" data-cat="长袖">长袖</button>
      <button class="cat-btn" data-cat="卫衣">卫衣</button>
      <button class="cat-btn" data-cat="背心">背心</button>
    </div>
  </div>`,
);
write('public/index.html', index);

let app = read('public/assets/app.js');
app = app.replace(
  "return ({ 上衣: '👕', 裤子: '👖', 连衣裙: '👗', 外套: '🧥', 套装: '🥋' })[category] || '📦';",
  "return ({ 短袖: '👕', 长袖: '👕', 卫衣: '🧥', 背心: '🎽' })[category] || '📦';",
);
write('public/assets/app.js', app);

console.log('[catalog-v3.4] 分类与前台排序界面已安装。');
