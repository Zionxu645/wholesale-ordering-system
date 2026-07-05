'use strict';

const express = require('express');

const CATEGORIES = ['短袖', '长袖', '卫衣', '背心'];
const CATEGORY_RANK = new Map(CATEGORIES.map((category, index) => [category, index]));
const ENCODED_CATEGORY = /^(短袖|长袖|卫衣|背心)\|(\d{1,9})$/;

function productCategoryData(product) {
  const stored = String(product?.category || '').trim();
  const matched = stored.match(ENCODED_CATEGORY);
  if (matched) return { category: matched[1], order: Number(matched[2]) };

  if (CATEGORIES.includes(stored)) return { category: stored, order: null };
  const text = `${product?.name || ''} ${product?.description || ''}`;
  if (/卫衣/.test(text)) return { category: '卫衣', order: null };
  if (/(背心|无袖)/.test(text)) return { category: '背心', order: null };
  if (/长袖/.test(text)) return { category: '长袖', order: null };
  return { category: '短袖', order: null };
}

function cleanProduct(product) {
  const { category } = productCategoryData(product);
  return { ...product, category };
}

const originalGet = express.application.get;
express.application.get = function patchedGet(routePath, ...handlers) {
  if (routePath === '/api/products') {
    const captureCategory = (req, _res, next) => {
      req.catalogRequestedCategory = String(req.query?.category || '').trim();
      if (req.query) delete req.query.category;
      next();
    };
    return originalGet.call(this, routePath, captureCategory, ...handlers);
  }
  return originalGet.call(this, routePath, ...handlers);
};

const originalJson = express.response.json;
express.response.json = function patchedJson(body) {
  const req = this.req;
  const requestPath = String(req?.originalUrl || req?.url || '').split('?')[0];

  if (req?.method === 'GET' && requestPath === '/api/products' && body?.code === 0 && Array.isArray(body.data)) {
    let products = body.data.map(product => {
      const categoryData = productCategoryData(product);
      return { ...product, category: categoryData.category, __displayOrder: categoryData.order };
    });

    const requestedCategory = req.catalogRequestedCategory;
    if (requestedCategory && CATEGORIES.includes(requestedCategory)) {
      products = products.filter(product => product.category === requestedCategory);
    }

    products.sort((a, b) => {
      const aOrder = Number.isFinite(a.__displayOrder) ? a.__displayOrder : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(b.__displayOrder) ? b.__displayOrder : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const categoryDifference = (CATEGORY_RANK.get(a.category) ?? 99) - (CATEGORY_RANK.get(b.category) ?? 99);
      if (categoryDifference !== 0) return categoryDifference;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    body.data = products.map((product, index) => {
      const { __displayOrder, ...clean } = product;
      return { ...clean, display_position: index + 1 };
    });
  } else if (body?.code === 0 && body?.data?.product) {
    body.data.product = cleanProduct(body.data.product);
  } else if (body?.code === 0 && body?.data?.id && body.data?.name) {
    body.data = cleanProduct(body.data);
  }

  return originalJson.call(this, body);
};
