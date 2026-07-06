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
if (!server.includes("Permissions-Policy")) {
  server = server.replace(
    "  res.setHeader('Referrer-Policy', 'same-origin');",
    "  res.setHeader('Referrer-Policy', 'same-origin');\n  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');\n  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');\n  res.setHeader('Content-Security-Policy', \"default-src 'self'; img-src 'self' https: data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'\");",
  );
  write('server.js', server);
}

let index = read('public/index.html');
if (!index.includes('site-trust-footer')) {
  index = index.replace(
    '<script src="/assets/app.js"></script>',
    `<footer class="site-trust-footer" style="max-width:1000px;margin:24px auto 40px;padding:18px 20px;border-top:1px solid #e5e7eb;color:#64748b;font-size:13px;line-height:1.7;text-align:center">
    <div>Eluren 服装电子选款册 · 仅用于商品展示、选款询价与订单跟进，不提供在线支付或软件下载。</div>
    <div><a href="/site-info.html">站点说明</a> · <a href="/privacy.html">隐私说明</a> · <a href="/terms.html">使用条款</a></div>
  </footer>
  <script src="/assets/app.js"></script>`,
  );
  write('public/index.html', index);
}

let admin = read('public/admin.html');
if (!admin.includes('name="robots"')) {
  admin = admin.replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <meta name="robots" content="noindex,nofollow,noarchive">',
  );
  write('public/admin.html', admin);
}

console.log('[site-trust] 安全响应头、站点说明入口和后台禁止索引已安装。');
