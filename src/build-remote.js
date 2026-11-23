#!/usr/bin/env node
/* 生成 remote/ 目录：把 ro-auto-identify.js 和 version.json 放到一起，
 * 整个目录推到任意静态托管（GitHub Pages / raw / 自己的服务器）即可被插件热更新。
 * 用法：node build-remote.js
 */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var root = __dirname;
var manifest = JSON.parse(fs.readFileSync(path.join(root, 'ro-extension', 'manifest.json'), 'utf8'));
var code = fs.readFileSync(path.join(root, 'ro-auto-identify.js'), 'utf8');

// 远程构建不做「扩展世界让位」判断：它本身就是跑在 user script 世界里的那份
var guard = 'if (IS_EXT_WORLD) return;   // 内置 content.js 让位给远程 user script（远程构建会去掉这一行）';
if (code.indexOf(guard) < 0) {
  console.error('找不到让位判断那一行，构建中止');
  process.exit(1);
}
code = code.replace(guard, '/* 远程构建：无需让位 */');

// user script 在 document_start 跑，此时还没有 body；等 DOM 就绪再创建面板
code = '(function () {\nfunction __RO_BOOT__() {\n' + code +
  '\n}\nif (document.readyState === "loading") {\n' +
  '  document.addEventListener("DOMContentLoaded", __RO_BOOT__, { once: true });\n' +
  '} else { __RO_BOOT__(); }\n})();\n';

var out = path.join(root, 'remote');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'ro-auto-identify.js'), code);

var sha = crypto.createHash('sha256').update(code).digest('hex');
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({
  version: manifest.version,
  url: 'ro-auto-identify.js',
  sha256: sha,
  at: new Date().toISOString()
}, null, 2) + '\n');

console.log('remote/ 已生成：v' + manifest.version + ' · ' + sha.slice(0, 12));
