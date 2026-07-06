'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

const replacement = `  const colorText = colors === '详询' ? colors : colors.replaceAll('、', ' ');
  const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
  const sizeList = [...new Set(product.skus.map(sku => String(sku.size || '').trim().toUpperCase()).filter(Boolean))]
    .sort((a, b) => {
      const aIndex = sizeOrder.indexOf(a);
      const bIndex = sizeOrder.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b, 'zh-CN');
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  const canUseRange = sizeList.length > 1 && sizeList.every(size => sizeOrder.includes(size));
  const sizeText = !sizeList.length
    ? '详询'
    : canUseRange
      ? \`\${sizeList[0]}-\${sizeList[sizeList.length - 1]}\`
      : sizeList.join(' ');
  const copyShort = [
    materialLine,
    '',
    \`\${product.style_code}# \${colorText} \${sizeText}\`,
    url,
    '欢迎选购～',
  ].join('\\n');
  const description = product.description ? \`\${product.description}\\n\` : '';
  const copyDetail = \`今日新款｜\${product.name}\${tag}\\n款号：\${product.style_code}\\n\${product.material ? \`面料：\${product.material}\\n\` : ''}\${description}颜色：\${colors}\\n尺码：\${sizes}\${noteLine}\\n\\n更多现有款式与规格请进入 Eluren 电子选款册：\\n\${url}\\n\\n需要报价或确认库存，可提交选款单或直接私聊。\`;
  const qrUrl =`;

const blockPattern = /  const noteLine =[\s\S]*?  const qrUrl =/;

if (blockPattern.test(source)) {
  source = source.replace(blockPattern, replacement);
}

const marker = '  const copyShort = [';
const declarationNeedle = '  const noteLine = product.customer_note ?';
if (source.includes(marker) && !source.includes(declarationNeedle)) {
  const placeholder = '$' + '{product.customer_note}';
  const declaration = "  const noteLine = product.customer_note ? `\\n说明：" + placeholder + "` : '';\n";
  source = source.replace(marker, declaration + marker);
}

fs.writeFileSync(serverPath, source, 'utf8');
console.log('[postinstall] 已修复并更新简洁版朋友圈素材。');
