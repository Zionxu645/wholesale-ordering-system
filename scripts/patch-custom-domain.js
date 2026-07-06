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
server = server.replace(
  /function requestBaseUrl\(req\) \{\s*return PUBLIC_BASE_URL \|\| `\$\{req\.protocol\}:\/\/\$\{req\.get\('host'\)\}`;\s*\}/,
  "function requestBaseUrl(_req) {\n  return 'https://eluren.cn';\n}",
);
write('server.js', server);

let index = read('public/index.html');
if (!index.includes('rel="canonical"')) {
  index = index.replace(
    '<meta name="description" content="Eluren 服装电子选款册：查看最新款式、颜色与尺码，提交选款询价。">',
    '<meta name="description" content="Eluren 服装电子选款册：查看最新款式、颜色与尺码，提交选款询价。">\n  <link rel="canonical" href="https://eluren.cn/">',
  );
}
write('public/index.html', index);

const robots = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: https://eluren.cn/\n`;
write('public/robots.txt', robots);

console.log('[custom-domain] 已将分享链接和站点主地址切换为 https://eluren.cn');
