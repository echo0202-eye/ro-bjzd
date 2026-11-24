# 北境之地 RO · 自动鉴定 / 自动狩猎（Chrome 扩展）

当前版本 **1.8.105**。完整说明看 [交接说明.md](交接说明.md)。

## 目录

| 路径 | 用途 |
|---|---|
| `ro-extension/` | 扩展本体，`chrome://extensions` 里「加载已解压的扩展程序」选这个目录 |
| `src/` | 主源码 `ro-auto-identify.js`、油猴脚本、`build-remote.js` 构建脚本 |
| `docs/` | 远程热更新产物（GitHub Pages 用，含 `version.json`） |
| `交接说明.md` | 机制、踩坑、待办、Windows 测试脚本 |

## 安装（Windows）

1. `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `ro-extension`。
2. 进扩展「详情」，打开 **允许运行用户脚本**（不开热更新必失败）。
3. 打开游戏页 `http://103.45.135.247:3000/`，面板上 **Shift+左键「更新」** 填远程地址：
   `https://echo0202-eye.github.io/ro-bjzd`

无网络限制时的整包下载：`https://codeload.github.com/echo0202-eye/ro-bjzd/zip/refs/heads/main`

## 开发

改 `src/ro-auto-identify.js` → `node src/build-remote.js` → 同步 `ro-extension/content.js`、`docs/` → 更新 `ro-extension/manifest.json` 的 version。

## 热更新原理

`bg.js` 拉 `<远程地址>/version.json` 与本地版本比对，不同则下载脚本并用 `chrome.userScripts.register` 注册（先 `unregister` 同 id），再刷新游戏标签页。
