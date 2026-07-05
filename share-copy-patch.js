'use strict';

// 在不改动业务接口结构的前提下，把后台生成的朋友圈文案压缩成适合直接发布的短格式。
const express = require('express');

const originalJson = express.response.json;

function uniqueValues(items, key) {
  return [...new Set((items || []).map(item => String(item?.[key] || '').trim()).filter(Boolean))];
}

express.response.json = function patchedJson(body) {
  const requestPath = String(this.req?.originalUrl || this.req?.url || '').split('?')[0];
  const isShareResponse = this.req?.method === 'GET' && /^\/api\/products\/[^/]+\/share$/.test(requestPath);

  if (isShareResponse && body?.code === 0 && body?.data?.product) {
    const product = body.data.product;
    const colors = uniqueValues(product.skus, 'color').join('、') || '详询';
    const sizes = uniqueValues(product.skus, 'size').join('、') || '详询';
    const tag = product.badge_text ? `｜${product.badge_text}` : '';
    const shortTitle = product.material || product.name;
    const url = body.data.url;

    const copyShort = [
      `${product.style_code}# ${shortTitle}${tag}`,
      `颜色：${colors}`,
      `尺码：${sizes}`,
      `更多款式：${url}`,
    ].join('\n');

    const copyDetail = [
      `${product.style_code}# ${product.name}${tag}`,
      product.material ? `面料：${product.material}` : '',
      `颜色：${colors}`,
      `尺码：${sizes}`,
      `选款链接：${url}`,
    ].filter(Boolean).join('\n');

    body.data.copy = copyShort;
    body.data.copy_short = copyShort;
    body.data.copy_detail = copyDetail;
  }

  return originalJson.call(this, body);
};
