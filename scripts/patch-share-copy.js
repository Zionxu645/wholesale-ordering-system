'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

const replacement = `  const copyShort = [
    \`\${product.style_code}# \${product.material || product.name}\${tag}\`,
    \`颜色：\${colors}\`,
    \`尺码：\${sizes}\`,
    url,
  ].join('\\n');
  const copyDetail = [
    \`\${product.style_code}# \${product.name}\${tag}\`,
    product.material ? \`面料：\${product.material}\` : '',
    \`颜色：\${colors}\`,
    \`尺码：\${sizes}\`,
    url,
  ].filter(Boolean).join('\\n');
  const qrUrl =`;

const blockPattern = /  const noteLine =[\s\S]*?  const qrUrl =/;

if (!blockPattern.test(source)) {
  console.log('[postinstall] 朋友圈文案代码已是短版或目标代码结构已变化，跳过。');
  process.exit(0);
}

source = source.replace(blockPattern, replacement);
fs.writeFileSync(serverPath, source, 'utf8');
console.log('[postinstall] 已将朋友圈素材改为短文案。');
