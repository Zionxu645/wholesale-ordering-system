'use strict';

const assert = require('node:assert/strict');
const { app } = require('../server');

async function run() {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 503);
    const healthJson = await health.json();
    assert.equal(healthJson.data.status, 'configuration_required');
    assert.equal(healthJson.data.version, '3.0.0');

    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Eluren 服装电子选款册/);

    const productPage = await fetch(`${base}/product/00000000-0000-4000-8000-000000000000`);
    assert.equal(productPage.status, 200);
    assert.match(await productPage.text(), /先选款，再询价/);

    const admin = await fetch(`${base}/admin`);
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /Eluren 选款册管理后台/);

    const products = await fetch(`${base}/api/products`);
    assert.equal(products.status, 503);
    const productsJson = await products.json();
    assert.equal(productsJson.code, 1);

    const missing = await fetch(`${base}/api/not-exist`);
    assert.equal(missing.status, 404);
    const missingJson = await missing.json();
    assert.equal(missingJson.code, 1);

    console.log('Smoke tests passed.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
