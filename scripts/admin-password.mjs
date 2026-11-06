#!/usr/bin/env node
// scripts/admin-password.mjs — create or replace the private admin dashboard credentials
// (config/player-admin/config.json). Without this file the /admin console stays disabled; with it, admins log in
// with username + password alone — no OAuth provider involved.
//
// Usage:
//   node scripts/admin-password.mjs <password> [--username admin] [--origin http://localhost:3210]
// The password must be 12–128 bytes. `--origin` is the public base URL players use; plain HTTP is only accepted
// for loopback hosts (the login cookie is marked Secure on HTTPS origins).

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { credentials, atomicJson } from '../server/playerAdmin.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    username: { type: 'string', default: 'admin' },
    origin: { type: 'string' },
  },
});

const [password] = positionals;
if (typeof password !== 'string' || !password) {
  console.error('用法：node scripts/admin-password.mjs <密码(12–128 字节)> [--username admin] [--origin http://localhost:3210]');
  process.exit(2);
}

const origin = values.origin ?? process.env.SP_PUBLIC_ORIGIN ?? 'http://localhost:3210';
try {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(values.username)) throw new Error('用户名只能使用 1–32 个字母、数字、_ 或 -');
  const config = { version: 1, username: values.username, publicOrigin: origin.replace(/\/+$/, ''), ...(await credentials(password)) };
  const file = fileURLToPath(new URL('../config/player-admin/config.json', import.meta.url));
  await atomicJson(file, config);
  console.log(`管理凭据已写入 ${file}（用户名 ${values.username}，来源 ${origin}）。`);
  console.log('重启服务器后访问 /admin 登录。');
} catch (e) {
  console.error(`写入失败：${e.message}`);
  process.exit(1);
}
