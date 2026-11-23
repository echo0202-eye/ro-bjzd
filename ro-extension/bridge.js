// 面板 ↔ 后台 的桥：远程热更新后的脚本运行在 USER_SCRIPT 世界，拿不到 chrome.runtime，
// 所以统一用 DOM 事件转发；普通 content script 世界也可以直接调 chrome.runtime。
(function () {
  'use strict';

  window.addEventListener('ro-remote-request', function (ev) {
    var d = (ev && ev.detail) || {};
    var id = d.id;
    try {
      chrome.runtime.sendMessage(d.msg, function (resp) {
        window.dispatchEvent(new CustomEvent('ro-remote-response', { detail: { id: id, data: resp } }));
      });
    } catch (e) {
      window.dispatchEvent(new CustomEvent('ro-remote-response', { detail: { id: id, data: { ok: false, msg: String(e && e.message || e) } } }));
    }
  });
})();
