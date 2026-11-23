/* 远程热更新
 * 面板「更新」-> 拉取 <远端目录>/version.json -> 比对版本 -> 拉脚本 ->
 * chrome.userScripts 注册到游戏页（document_start）-> 刷新游戏标签页。
 * 首次需要在 chrome://extensions 打开「允许用户脚本」开关。
 */
var REMOTE_ID = 'ro-remote-script';
var GAME_MATCH = 'http://103.45.135.247:3000/*';
var CHECK_GAP = 5 * 60 * 1000;

var lastCheck = 0;
var running = null;

function getStore(keys) {
  return new Promise(function (res) {
    chrome.storage.local.get(keys, function (o) { res(o || {}); });
  });
}
function setStore(obj) {
  return new Promise(function (res) {
    chrome.storage.local.set(obj, function () { res(); });
  });
}
function saveMeta(patch) {
  return getStore(['ro-remote-meta']).then(function (st) {
    var meta = st['ro-remote-meta'] || {};
    for (var k in patch) meta[k] = patch[k];
    meta.updatedAt = Date.now();
    return setStore({ 'ro-remote-meta': meta }).then(function () { return meta; });
  });
}
function fetchText(url) {
  return fetch(url, { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return r.text();
  });
}
function joinUrl(base, file) {
  return String(base).replace(/\/+$/, '') + '/' + file;
}
function errMsg(e) {
  return String((e && e.message) || e || '未知错误');
}

async function tabsOfGame() {
  try {
    return await chrome.tabs.query({ url: GAME_MATCH });
  } catch (e) {
    return [];
  }
}
async function reloadGameTabs() {
  var tabs = await tabsOfGame();
  for (var i = 0; i < tabs.length; i++) {
    try { chrome.tabs.reload(tabs[i].id); } catch (e) {}
  }
  return tabs.length;
}

async function registerRemote(version, code) {
  if (!chrome.userScripts || !chrome.userScripts.register) {
    var e1 = new Error('未开启「允许用户脚本」（一次性开关）');
    e1.hint = '允许用户脚本';
    throw e1;
  }
  var preamble =
    '(function(){try{window.__RO_REMOTE_VER__=' + JSON.stringify(version) + ';}catch(e){}' +
    'var d=document;function m(){try{(d.documentElement||d.body).setAttribute("data-ro-remote",' + JSON.stringify(version) + ');}catch(e){}}' +
    'm();if(d.readyState==="loading")d.addEventListener("DOMContentLoaded",m,{once:true});})();\n';
  try {
    // 同 id 重复注册会报 Duplicate script ID，先注销旧的
    try { await chrome.userScripts.unregister({ ids: [REMOTE_ID] }); } catch (e) {}
    await chrome.userScripts.register([{
      id: REMOTE_ID,
      matches: [GAME_MATCH],
      allFrames: true,
      runAt: 'document_start',
      world: 'USER_SCRIPT',
      js: [{ code: preamble + code }]
    }]);
  } catch (e) {
    var msg = errMsg(e);
    if (/not available|developer mode|user scripts/i.test(msg)) {
      e.hint = '允许用户脚本';
    }
    throw e;
  }
}

async function unregisterRemote() {
  try {
    if (chrome.userScripts && chrome.userScripts.unregister) {
      await chrome.userScripts.unregister({ ids: [REMOTE_ID] });
      return true;
    }
  } catch (e) {}
  return false;
}

async function doEnsure(force) {
  var st = await getStore(['ro-remote-url', 'ro-remote-meta']);
  var base = String(st['ro-remote-url'] || '').trim();
  var meta = st['ro-remote-meta'] || {};

  if (!base) {
    if (meta.registered) {
      await unregisterRemote();
      await saveMeta({ registered: false, version: '', msg: '已清除远程地址', checkAt: Date.now() });
      await reloadGameTabs();
      return { ok: true, cleared: true, msg: '已清除远程地址，恢复扩展内置版本' };
    }
    return { ok: false, code: 'no-url', msg: '未配置远程更新地址（Shift+点「更新」填写）' };
  }

  if (!force && Date.now() - lastCheck < CHECK_GAP) {
    return { ok: true, cached: true, version: meta.version || '', same: true, msg: meta.msg || '' };
  }
  lastCheck = Date.now();

  var verUrl = joinUrl(base, 'version.json');
  var info;
  try {
    info = JSON.parse(await fetchText(verUrl));
  } catch (e) {
    await saveMeta({ msg: '读取 version.json 失败：' + errMsg(e), checkAt: Date.now() });
    return { ok: false, code: 'fetch-version', msg: '读取 version.json 失败：' + errMsg(e) };
  }
  var ver = String((info && info.version) || '').trim();
  if (!ver) {
    await saveMeta({ msg: 'version.json 缺少 version 字段', checkAt: Date.now() });
    return { ok: false, code: 'bad-version', msg: 'version.json 缺少 version 字段' };
  }

  if (!force && meta.registered && meta.version === ver) {
    await saveMeta({ checkAt: Date.now(), msg: '已是最新 v' + ver });
    return { ok: true, same: true, version: ver, msg: '已是最新 v' + ver };
  }

  var scriptUrl = info.url ? new URL(String(info.url), verUrl).href : joinUrl(base, 'ro-auto-identify.js');
  // 加版本参数再兜一层：即使托管/CDN 缓存了同名脚本，也不会把新版注册成旧代码
  scriptUrl += (scriptUrl.indexOf('?') < 0 ? '?' : '&') + 'v=' + encodeURIComponent(ver);
  var code;
  try {
    code = await fetchText(scriptUrl);
  } catch (e) {
    await saveMeta({ msg: '下载脚本失败：' + errMsg(e), checkAt: Date.now() });
    return { ok: false, code: 'fetch-script', msg: '下载脚本失败：' + errMsg(e) };
  }
  if (!/function\s*\(/.test(code) || code.length < 2000) {
    await saveMeta({ msg: '远端脚本内容异常（' + code.length + ' 字节）', checkAt: Date.now() });
    return { ok: false, code: 'bad-script', msg: '远端脚本内容异常（' + code.length + ' 字节）' };
  }

  try {
    await registerRemote(ver, code);
  } catch (e) {
    var m = errMsg(e);
    var hint = e && e.hint ? '（' + e.hint + '：chrome://extensions → 本扩展详情 → 打开「允许用户脚本」）' : '';
    await saveMeta({ registered: false, msg: '注册用户脚本失败：' + m + hint, checkAt: Date.now() });
    return { ok: false, code: 'register', msg: '注册用户脚本失败：' + m + hint };
  }

  await saveMeta({
    registered: true,
    version: ver,
    url: scriptUrl,
    at: Date.now(),
    checkAt: Date.now(),
    msg: '已热更新到 v' + ver
  });
  var n = await reloadGameTabs();
  return { ok: true, updated: true, version: ver, reloaded: n, msg: '已更新到 v' + ver + '，正在刷新 ' + n + ' 个页面' };
}

function ensureRemote(force) {
  if (running) return running;
  running = doEnsure(force).then(function (r) {
    running = null;
    return r;
  }, function (e) {
    running = null;
    return { ok: false, msg: errMsg(e) };
  });
  return running;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  if (msg.type === 'ro-ext-reload') {
    chrome.runtime.reload();
    return;
  }

  if (msg.type === 'ro-remote-status') {
    getStore(['ro-remote-url', 'ro-remote-meta']).then(function (st) {
      sendResponse({ ok: true, url: st['ro-remote-url'] || '', meta: st['ro-remote-meta'] || null });
    });
    return true;
  }

  if (msg.type === 'ro-remote-check') {
    ensureRemote(true).then(sendResponse);
    return true;
  }

  if (msg.type === 'ro-remote-set-url') {
    var url = String(msg.url || '').trim().replace(/\/+$/, '');
    setStore({ 'ro-remote-url': url }).then(function () {
      lastCheck = 0;
      return ensureRemote(true);
    }).then(sendResponse, function (e) {
      sendResponse({ ok: false, msg: errMsg(e) });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(function () { ensureRemote(false); });
chrome.runtime.onStartup.addListener(function () { ensureRemote(false); });

chrome.tabs.onUpdated.addListener(function (tabId, info, tab) {
  if (!info || info.status !== 'complete') return;
  if (!tab || !/^http:\/\/103\.45\.135\.247:3000\//.test(tab.url || '')) return;
  ensureRemote(false);
});
