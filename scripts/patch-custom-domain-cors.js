'use strict';

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

if (!source.includes("const CUSTOM_DOMAIN_ORIGINS = ['https://eluren.cn', 'https://www.eluren.cn'];")) {
  source = source.replace(
    ".filter(Boolean);\n\napp.disable('x-powered-by');",
    ".filter(Boolean);\nconst CUSTOM_DOMAIN_ORIGINS = ['https://eluren.cn', 'https://www.eluren.cn'];\nfor (const origin of CUSTOM_DOMAIN_ORIGINS) {\n  if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);\n}\n\napp.disable('x-powered-by');",
  );
  fs.writeFileSync(serverPath, source, 'utf8');
  console.log('[custom-domain-cors] 已允许 eluren.cn 后台登录与接口请求。');
} else {
  console.log('[custom-domain-cors] eluren.cn 已在允许来源中，跳过。');
}
