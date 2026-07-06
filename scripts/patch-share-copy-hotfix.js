'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

const marker = '  const copyShort = [';
const declarationNeedle = '  const noteLine = product.customer_note ?';

if (source.includes(marker) && !source.includes(declarationNeedle)) {
  const placeholder = '$' + '{product.customer_note}';
  const declaration = "  const noteLine = product.customer_note ? `\\n说明：" + placeholder + "` : '';\n";
  source = source.replace(marker, declaration + marker);
  fs.writeFileSync(serverPath, source, 'utf8');
  console.log('[share-copy-hotfix] 已修复朋友圈素材生成错误。');
} else {
  console.log('[share-copy-hotfix] 无需修复，跳过。');
}
