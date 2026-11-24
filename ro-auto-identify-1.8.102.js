(function () {
function __RO_BOOT__() {
/* ============================================================
 * RO 网页端 · 自动鉴定工具
 * 用法：进入游戏角色后，F12 打开 Console，整段粘贴回车。
 *      右上角出现「自动鉴定」面板，点「开始鉴定」。
 * 说明：只做鉴定 + 记录，不改动装备；保留/卖出由你在面板上手动标记。
 * ============================================================ */
(function () {
  'use strict';

  // 远程热更新用的 user script 会在 document_start 把版本写进 data-ro-remote；
  // 扩展内置的 content.js（有 chrome.runtime）看到标记就让位，避免出现两个面板
  var RO_REMOTE_VER = '';
  var IS_EXT_WORLD = false;
  try { RO_REMOTE_VER = (document.documentElement && document.documentElement.getAttribute('data-ro-remote')) || ''; } catch (e) {}
  try { IS_EXT_WORLD = !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id); } catch (e) {}
  if (RO_REMOTE_VER) {
    /* 远程构建：无需让位 */
    try { document.documentElement.setAttribute('data-ro-boot', RO_REMOTE_VER); } catch (e) {}
  }

  if (window.__RO_IDENTIFY_TOOL__) {
    window.__RO_IDENTIFY_TOOL__.show();
    console.log('自动鉴定面板已存在，已重新显示。');
    return;
  }

  // 多账号：游戏可能放在多个 iframe 里（扩展 all_frames 注入），每个 iframe 各建一个独立面板；
  // 顶层页面如果只是容器（账号都在 iframe 里），就不建面板，避免重复
  var IS_TOP = (function () { try { return window.top === window.self; } catch (e) { return false; } })();
  if (IS_TOP && !isGameDoc(document) && gameDocs().length) return;

  var STORE_KEY = 'ro-auto-identify-records-v1';
  var PANEL_ID = 'ro-identify-tool-host';
  var MAX_PER_RUN = 0;      // 0 = 不限件数；想先试几件可改成 1、5 等
  var STEP_GAP = 320;       // 每件之间的间隔（毫秒）
  // 面板呼出键：Mac 用 Cmd+Option+K，避开 F12 / 浏览器 / 系统默认快捷键
  var IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  var HOTKEY = IS_MAC
    ? { meta: true, alt: true, code: 'KeyK', label: 'Cmd+Option+K' }
    : { ctrl: true, shift: true, code: 'KeyX', label: 'Ctrl+Shift+X' };
  var LOUPE_PRICE_MAX = 5000;   // 寄售买放大镜的单价上限，超过就不买
  // 扩展版本（油猴脚本里没有 chrome.runtime.getManifest，会为空）
  var EXT_VERSION = (function () {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        return chrome.runtime.getManifest().version || '';
      }
    } catch (e) {}
    return '';
  })();
  // 远程热更新注入时的版本（扩展内置运行时没有）
  var REMOTE_VERSION = (RO_REMOTE_VER && RO_REMOTE_VER !== '1') ? RO_REMOTE_VER : '';
  var SHOWN_VERSION = EXT_VERSION || REMOTE_VERSION;

  var running = false;
  var autoSell = false;     // 自动卖开关：鉴定完判定「建议卖」就顺手卖掉
  var sellHinted = false;   // 自动卖时「没打开出售道具页」只提示一次
  var records = loadRecords();

  /* ---------------- 词条表（取自 8.136.111.206 词条页的 AFFIX / ADVICE） ---------------- */

  // tab=简写  num=数值范围  cat=第几条  rec=原作者推荐职业
  var AFFIX = [
    { id: 'RDMOPT_VAR_STRAMOUNT', tab: 'STR', num: '1-50', cat: '第一条', rec: '骑士 / 刺客' },
    { id: 'RDMOPT_VAR_AGIAMOUNT', tab: 'AGI', num: '1-50', cat: '第一条', rec: '' },
    { id: 'RDMOPT_VAR_VITAMOUNT', tab: 'VIT', num: '1-50', cat: '第一条', rec: '' },
    { id: 'RDMOPT_VAR_INTAMOUNT', tab: 'INT', num: '1-50', cat: '第一条', rec: '法师 / 牧师' },
    { id: 'RDMOPT_VAR_DEXAMOUNT', tab: 'DEX', num: '1-50', cat: '第一条', rec: '流氓 / 猎人 / 诗舞' },
    { id: 'RDMOPT_VAR_LUKAMOUNT', tab: 'LUK', num: '1-50', cat: '第二条', rec: '' },
    { id: 'RDMOPT_VAR_MAXHPPERCENT', tab: 'MHP', num: '1-50%', cat: '第二条', rec: '全职业' },
    { id: 'RDMOPT_VAR_MAXSPPERCENT', tab: 'MSP', num: '1-50%', cat: '第二条', rec: '' },
    { id: 'RDMOPT_VAR_HPACCELERATION', tab: 'HP恢复', num: '1-50%', cat: '第二条', rec: '' },
    { id: 'RDMOPT_VAR_SPACCELERATION', tab: 'SP恢复', num: '1-50%', cat: '第二条', rec: '' },
    { id: 'RDMOPT_VAR_PLUSAVOIDSUCCESSVALUE', tab: '完全回避', num: '1-50', cat: '第三条', rec: '' },
    { id: 'RDMOPT_VAR_CRITICALSUCCESSVALUE', tab: 'CRI', num: '1-50', cat: '第三条', rec: '' },
    { id: 'RDMOPT_CLASS_IGNORE_DEF_PERCENT_BOSS', tab: '首领物防忽视', num: '1-50%', cat: '第三条', rec: '骑士 / 流氓 / 猎人 / 诗舞 / 刺客' },
    { id: 'RDMOPT_CLASS_IGNORE_MDEF_PERCENT_BOSS', tab: '首领魔防忽视', num: '1-50%', cat: '第三条', rec: '法师 / 牧师' },
    { id: 'RDMOPT_DAMAGE_CRI_TARGET', tab: '必杀技伤害', num: '1-50%', cat: '第三条', rec: '' },
    { id: 'RDMOPT_VAR_ATKPERCENT', tab: 'ATK', num: '1-50%', cat: '第四条', rec: '骑士 / 流氓 / 猎人 / 诗舞 / 刺客' },
    { id: 'RDMOPT_VAR_MAGICATKPERCENT', tab: 'MATK', num: '1-50%', cat: '第四条', rec: '法师 / 牧师' },
    { id: 'RDMOPT_VAR_PLUSASPD', tab: 'ASPD', num: '1-50', cat: '第四条', rec: '' },
    { id: 'RDMOPT_VAR_PLUSASPDPERCENT', tab: '攻速', num: '1-50%', cat: '第四条', rec: '' },
    { id: 'RDMOPT_VAR_HITSUCCESSVALUE', tab: 'HIT', num: '1-50', cat: '第四条', rec: '' },
    { id: 'RDMOPT_RANGE_ATTACK_DAMAGE_USER', tab: '远距离攻击减少', num: '1-50%', cat: '第五条', rec: '' },
    { id: 'RDMOPT_RANGE_ATTACK_DAMAGE_TARGET', tab: '远距离攻击增加', num: '1-50%', cat: '第五条', rec: '骑士 / 流氓 / 猎人 / 诗舞' },
    { id: 'RDMOPT_CLASS_DAMAGE_BOSS_TARGET', tab: '对首领物理攻击增加', num: '1-50%', cat: '第五条', rec: '刺客' },
    { id: 'RDMOPT_CLASS_DAMAGE_BOSS_USER', tab: '对首领受到物理攻击减少', num: '1-50%', cat: '第五条', rec: '' },
    { id: 'RDMOPT_CLASS_MDAMAGE_BOSS', tab: '对首领魔法攻击增加', num: '1-50%', cat: '第五条', rec: '法师 / 牧师' }
  ];
  var AFFIX_BY_ID = {};
  AFFIX.forEach(function (a) { AFFIX_BY_ID[a.id] = a; });

  // 词条简称（表格只显示「简称 + 等级」，完整属性放 title 里）
  var AFFIX_SHORT = {
    RDMOPT_VAR_PLUSAVOIDSUCCESSVALUE: '回避',
    RDMOPT_CLASS_IGNORE_DEF_PERCENT_BOSS: '首领物防',
    RDMOPT_CLASS_IGNORE_MDEF_PERCENT_BOSS: '首领魔防',
    RDMOPT_DAMAGE_CRI_TARGET: '必杀',
    RDMOPT_VAR_HPACCELERATION: 'HP恢',
    RDMOPT_VAR_SPACCELERATION: 'SP恢',
    RDMOPT_RANGE_ATTACK_DAMAGE_USER: '远减',
    RDMOPT_RANGE_ATTACK_DAMAGE_TARGET: '远增',
    RDMOPT_CLASS_DAMAGE_BOSS_TARGET: '首领物攻',
    RDMOPT_CLASS_DAMAGE_BOSS_USER: '首领物抗',
    RDMOPT_CLASS_MDAMAGE_BOSS: '首领魔攻'
  };
  function affixShort(a) {
    if (!a) return '?';
    return AFFIX_SHORT[a.id] || a.tab;
  }
  // 单条词条等级：按数值完成度给 S/A/B/C/D
  function affixGrade(pct) {
    if (pct >= 0.9) return 'S';
    if (pct >= 0.75) return 'A';
    if (pct >= 0.6) return 'B';
    if (pct >= 0.4) return 'C';
    return 'D';
  }

  var PROFS = ['骑士', '猎人', '法师', '刺客'];            // 资料库里出现的职业方向
  // 职业归并：把资料库写的细分职业并到四个大方向，用于和装备的可装备职业取交集
  var JOB_BUCKET = [
    { p: '骑士', re: /骑士|十字军|领主|皇家/ },
    { p: '猎人', re: /猎人|流氓|诗舞|吟游|游侠|舞娘|神射/ },
    { p: '法师', re: /法师|牧师|贤者|巫师|服事|祭司/ },
    { p: '刺客', re: /刺客|盗贼|忍者|拳圣/ }
  ];

  // 解析「装备: xxx」能装备的职业；返回 null 表示所有职业 / 无法判断
  function allowedJobs(text) {
    var t = String(text || '').trim();
    if (!t) return null;
    if (/所有职业|全职业/.test(t)) return null;
    var out = [];
    JOB_BUCKET.forEach(function (b) { if (b.re.test(t)) out.push(b.p); });
    return out.length ? out : null;
  }

  var MAX_ROLL = 50;                                      // 词条数值上限（条目表统一 1-50）

  // 游戏里显示的简写 → 词条 id，顺序很重要（先匹配更具体的）
  var RULES = [
    { id: 'RDMOPT_CLASS_IGNORE_MDEF_PERCENT_BOSS', re: /首领.*(魔防|魔法防御)|(魔防|魔法防御).*首领/ },
    { id: 'RDMOPT_CLASS_IGNORE_DEF_PERCENT_BOSS', re: /首领.*(物防|物理防御)|(物防|物理防御).*首领/ },
    { id: 'RDMOPT_CLASS_DAMAGE_BOSS_USER', re: /(受到|被).*首领.*物理|首领.*物理.*(减少|抵抗)/ },
    { id: 'RDMOPT_CLASS_MDAMAGE_BOSS', re: /首领.*魔法|魔法.*首领/ },
    { id: 'RDMOPT_CLASS_DAMAGE_BOSS_TARGET', re: /首领.*物理|物理.*首领/ },
    { id: 'RDMOPT_RANGE_ATTACK_DAMAGE_USER', re: /远距离.*(减少|抵抗|-)|\-\s*远距离/ },
    { id: 'RDMOPT_RANGE_ATTACK_DAMAGE_TARGET', re: /远距离/ },
    { id: 'RDMOPT_DAMAGE_CRI_TARGET', re: /必杀/ },
    { id: 'RDMOPT_VAR_PLUSAVOIDSUCCESSVALUE', re: /完全回避/ },
    { id: 'RDMOPT_VAR_CRITICALSUCCESSVALUE', re: /CRI/i },
    { id: 'RDMOPT_VAR_HITSUCCESSVALUE', re: /HIT/i },
    { id: 'RDMOPT_VAR_PLUSASPDPERCENT', re: /(攻击速度|攻速|攻击后延迟)/ },
    { id: 'RDMOPT_VAR_PLUSASPD', re: /ASPD/i },
    { id: 'RDMOPT_VAR_MAGICATKPERCENT', re: /MATK/i },
    { id: 'RDMOPT_VAR_ATKPERCENT', re: /ATK/i },
    { id: 'RDMOPT_VAR_MAXHPPERCENT', re: /MHP|最大\s*HP|HP\s*上限/i },
    { id: 'RDMOPT_VAR_MAXSPPERCENT', re: /MSP|最大\s*SP|SP\s*上限/i },
    { id: 'RDMOPT_VAR_HPACCELERATION', re: /HP.*恢复/i },
    { id: 'RDMOPT_VAR_SPACCELERATION', re: /SP.*恢复/i },
    { id: 'RDMOPT_VAR_STRAMOUNT', re: /STR/i },
    { id: 'RDMOPT_VAR_AGIAMOUNT', re: /AGI/i },
    { id: 'RDMOPT_VAR_VITAMOUNT', re: /VIT/i },
    { id: 'RDMOPT_VAR_INTAMOUNT', re: /INT/i },
    { id: 'RDMOPT_VAR_DEXAMOUNT', re: /DEX/i },
    { id: 'RDMOPT_VAR_LUKAMOUNT', re: /LUK/i }
  ];

  var TAG_COLOR = {
    '本命': ['#4f7a45', '#b6c9a8', '#eef4e8'],
    '对口': ['#6b7f4f', '#c3cfb2', '#f2f6ec'],
    '通用': ['#8a7f63', '#d4cbb4', '#f5f2e9'],
    '中性': ['#6b7c8a', '#c6d2db', '#eef3f6'],
    '偏门': ['#a3524a', '#e0bcb8', '#fbeeed'],
    '未收录': ['#958c78', '#ded7c8', '#f4f1ea']
  };

  function extractNum(t) {
    var m = String(t).match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  function matchAffix(text) {
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i].re.test(text)) return AFFIX_BY_ID[RULES[i].id];
    }
    return null;
  }

  // 不区分职业：单条只按「数值完成度」给分，满分 10
  // 词条表里的推荐职业只用来标「推荐谁用」和算「适合职业」，不参与打分
  function optionsWithScore(list) {
    return (list || []).map(function (text) {
      var a = matchAffix(text);
      var val = extractNum(text);
      var pct = (a && val != null) ? Math.min(val / MAX_ROLL, 1) : 0;
      return {
        text: text,
        pct: pct,
        score: pct * 10,
        affix: a,
        rec: a ? (a.rec || '') : ''
      };
    });
  }

  function scoreRecord(r) {
    var items = optionsWithScore(r.options);

    // 适合职业：在「装备本身能穿的职业」里，找资料库推荐该职业的词条最多的那个
    // 避免出现「属性像法师装，但其实是骑士专属武器」的误判
    var allow = allowedJobs(r.equipFor);
    var bestAll = '', nAll = 0, bestOk = '', nOk = 0;
    PROFS.forEach(function (p) {
      var n = 0;
      items.forEach(function (x) {
        if (x.rec && x.rec !== '全职业' && x.rec.indexOf(p) >= 0) n++;
      });
      if (n > nAll) { nAll = n; bestAll = p; }
      if (allow && allow.indexOf(p) < 0) return;
      if (n > nOk) { nOk = n; bestOk = p; }
    });
    if (!allow) { bestOk = bestAll; nOk = nAll; }

    // 总分只算有用的词条：第 1 条（STR/DEX/INT 等主属性）1 份；第 2 条只有 MHP 算 0.5 份；
    // 第 4 条只有 ATK / MATK 算 1 份；第 3、5 条及其他词条不计分
    var total = 0, max = 0;
    items.forEach(function (x, i) {
      var id = x.affix ? x.affix.id : '';
      var w = 0;
      if (i === 0) w = 1;
      else if (i === 1) w = (id === 'RDMOPT_VAR_MAXHPPERCENT') ? 0.5 : 0;
      else if (i === 3) w = (id === 'RDMOPT_VAR_ATKPERCENT' || id === 'RDMOPT_VAR_MAGICATKPERCENT') ? 1 : 0;
      total += x.score * w;
      max += 10 * w;
    });
    var ratio = max ? total / max : 0;

    // 评级：第 1 条是 STR/DEX/INT、第 4 条是 ATK/MATK，两条都在满值 90%(≥45) 以上 → S；
    // 都在 80%(≥40) 以上 → S-；其他情况按加权总分比例给 A/B/C/D
    var tier = '';
    if (items.length >= 4) {
      var id1 = items[0].affix ? items[0].affix.id : '';
      var id4 = items[3].affix ? items[3].affix.id : '';
      var main1 = id1 === 'RDMOPT_VAR_STRAMOUNT' || id1 === 'RDMOPT_VAR_DEXAMOUNT' || id1 === 'RDMOPT_VAR_INTAMOUNT';
      var main4 = id4 === 'RDMOPT_VAR_ATKPERCENT' || id4 === 'RDMOPT_VAR_MAGICATKPERCENT';
      if (main1 && main4) {
        var a1 = items[0].pct, a4 = items[3].pct;
        if (a1 >= 0.9 && a4 >= 0.9) tier = 'S';
        else if (a1 >= 0.8 && a4 >= 0.8) tier = 'S-';
      }
    }
    var grade = tier || (ratio >= 0.6 ? 'A' : ratio >= 0.45 ? 'B' : ratio >= 0.3 ? 'C' : 'D');

    return {
      items: items, total: total, max: max, grade: grade, ratio: ratio,
      smax: tier === 'S' ? 1 : 0,   // 整件 S
      s90: tier === 'S-' ? 1 : 0,   // 整件 S-
      suit: nOk ? bestOk : '', suitN: nOk,
      allow: allow,
      offSuit: (allow && nAll > 0 && nAll > nOk) ? bestAll : ''
    };
  }

  // 留/卖判定：只看加权总分占满分的比例，达到阈值就留，否则卖。
  // 阈值可在面板「留≥__%」里调，默认 60%，存 localStorage（同一域名下所有账号共用）。
  var GRADE_RANK = { 'S': 6, 'S-': 5, 'A': 4, 'B': 3, 'C': 2, 'D': 1 };
  var KEEP_RATIO_KEY = 'ro-auto-identify-keep-ratio';
  var KEEP_RATIO = 0.6;
  (function loadKeepRatio() {
    try {
      var v = parseFloat(localStorage.getItem(KEEP_RATIO_KEY));
      if (isFinite(v) && v >= 0.1 && v <= 1) KEEP_RATIO = v;
    } catch (e) {}
  })();
  function setKeepRatio(pct) {
    var v = Math.max(10, Math.min(100, Number(pct) || 60)) / 100;
    KEEP_RATIO = v;
    try { localStorage.setItem(KEEP_RATIO_KEY, String(v)); } catch (e) {}
    return v;
  }
  function keepByScore(sc) { return !!sc && sc.max > 0 && sc.ratio >= KEEP_RATIO; }

  function advise(sc) {
    var pct = Math.round((sc.ratio || 0) * 100);
    var need = Math.round(KEEP_RATIO * 100);
    var why = '总分 ' + sc.total.toFixed(1) + '/' + sc.max + '（' + pct + '%）';
    if (sc.allow) why += ' · 限定 ' + sc.allow.join('/') + ' 可用';
    if (sc.offSuit) why += '（属性偏 ' + sc.offSuit + '，但穿不了）';
    else if (sc.suit) why += ' · 适合 ' + sc.suit;

    if (keepByScore(sc)) {
      return { t: '建议留', cls: 'keep', why: '评级 ' + sc.grade + ' · ' + why + ' ≥ ' + need + '%' };
    }
    return { t: '建议卖', cls: 'sell', why: '评级 ' + sc.grade + ' · ' + why + ' < ' + need + '%' };
  }

  function recLabel(rec) {
    if (!rec) return '—';
    if (rec === '全职业') return '通用';
    return rec.replace(/\s+/g, '');
  }

  /* ---------------- 基础工具 ---------------- */

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  async function waitFor(fn, timeout, interval) {
    timeout = timeout || 2000;
    interval = interval || 60;
    var end = Date.now() + timeout;
    while (Date.now() < end) {
      var v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  function isGameDoc(d) {
    return !!d && !!(d.querySelector('.window-inventory') || d.querySelector('.inventory-cell'));
  }

  // 有些按钮只认完整指针事件序列，光 el.click() 不触发（实测「开始挂机」就是这样）
  function tapEl(el) {
    if (!el) return false;
    var w = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    var r = el.getBoundingClientRect();
    var base = {
      bubbles: true, cancelable: true, composed: true, view: w,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0
    };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) {
      try {
        var C = t.indexOf('pointer') === 0 && w.PointerEvent ? w.PointerEvent : w.MouseEvent;
        el.dispatchEvent(new C(t, base));
      } catch (e) {}
    });
    return true;
  }

  // 一个页面可能同时开多个账号（每个账号一个 iframe），需要指定控制哪一个
  var TARGET_KEY = 'ro-auto-identify-target-v1';
  var TARGET = { title: '' };

  function gameDocs() {
    var out = [];
    if (isGameDoc(document)) {
      out.push({ doc: document, title: document.title || '当前页' });
    }
    Array.prototype.slice.call(document.querySelectorAll('iframe')).forEach(function (f, i) {
      var d = null;
      try { d = f.contentDocument; } catch (e) { return; }
      if (d && isGameDoc(d)) out.push({ doc: d, title: f.title || d.title || ('账号 ' + (i + 1)) });
    });
    return out;
  }

  function charNameOf(doc) {
    var el = doc && (doc.querySelector('.rail-player-title b') || doc.querySelector('.rail-player-title'));
    if (!el) return '';
    return el.textContent.trim().split(/\s+/)[0] || '';
  }

  function currentTarget() {
    var list = gameDocs();
    if (!list.length) return null;
    var want = TARGET.title || '';
    if (!want) { try { want = localStorage.getItem(TARGET_KEY) || ''; } catch (e) {} }
    var pick = null;
    if (want) {
      pick = list.filter(function (x) { return x.title === want; })[0] || null;
    }
    if (!pick) pick = list[0];
    TARGET.title = pick.title;
    return pick;
  }

  function getGameDoc() {
    var t = currentTarget();
    return t ? t.doc : null;
  }

  // 游戏界面可能一部分在 iframe 内、一部分在外层（顶栏/角色栏），统一跨文档查找
  function docList() {
    var out = [];
    var g = getGameDoc();
    if (g) out.push(g);
    if (out.indexOf(document) < 0) out.push(document);
    return out;
  }

  function qSel(sel) {
    var list = docList();
    for (var i = 0; i < list.length; i++) {
      try {
        var el = list[i].querySelector(sel);
        if (el) return el;
      } catch (e) {}
    }
    return null;
  }

  function qAll(sel) {
    var out = [];
    docList().forEach(function (d) {
      try { out = out.concat(Array.prototype.slice.call(d.querySelectorAll(sel))); } catch (e) {}
    });
    return out;
  }

  // 注意：放大镜弹层是 position:fixed，offsetParent 恒为 null，不能用 offsetParent 判断
  function visible(el) {
    if (!el || el.getClientRects().length === 0) return false;
    var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    var cs = view.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  // 记录跟账号走：按「账号|角色名」分开存，切号后重新读该角色的记录，不会把上一个号的带过去
  var REC_ACCT = '';
  function acctRecKey() {
    try {
      var info = readAccountInfo();
      return info && info.name ? (info.account || '?') + '|' + info.name : '';
    } catch (e) { return ''; }
  }
  function recordKey() { return STORE_KEY + '@' + (REC_ACCT || '未登录'); }

  function loadRecords() {
    try {
      var raw = localStorage.getItem(recordKey());
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveRecords() {
    var k = acctRecKey();
    // 账号已经切了但还没轮询到：先换成新账号的记录，避免把旧号的数据写进新号
    if (k && k !== REC_ACCT) { REC_ACCT = k; records = loadRecords(); }
    try { localStorage.setItem(recordKey(), JSON.stringify(records)); } catch (e) {}
  }

  // 轮询检测切号；旧版混存数据不迁移，避免把别的角色的装备算到当前角色头上
  function syncRecordsAcct(quiet) {
    var k = acctRecKey();
    if (!k || k === REC_ACCT) return false;
    REC_ACCT = k;
    records = loadRecords();
    selected = {};
    if (!quiet) { render(); renderTasks(); }
    return true;
  }

  // 启动时先按当前角色加载自己的记录（还没进角色就空着，等轮询补上）
  REC_ACCT = acctRecKey();
  if (REC_ACCT) records = loadRecords();

  /* ---------------- 游戏界面操作 ---------------- */

  // 确保背包窗口打开、并切到「装备」页签
  async function ensureInventoryEquipTab(doc) {
    var win = doc.querySelector('.window-inventory');
    if (!win || win.classList.contains('closed')) {
      var menuBtn = Array.prototype.slice
        .call(doc.querySelectorAll('.game-menu-button'))
        .filter(function (b) { return b.textContent.trim() === '背包'; })[0];
      if (menuBtn) menuBtn.click();
      win = await waitFor(function () {
        var w = doc.querySelector('.window-inventory');
        return w && !w.classList.contains('closed') ? w : null;
      }, 1500);
    }
    if (!win) return;
    var tab = Array.prototype.slice
      .call(win.querySelectorAll('button'))
      .filter(function (b) { return b.textContent.trim() === '装备'; })[0];
    if (tab && !tab.classList.contains('active')) {
      tab.click();
      await sleep(250);
    }
  }

  function findAction(det, label) {
    return Array.prototype.slice
      .call(det.querySelectorAll('.item-detail-actions .item-action'))
      .filter(function (b) { return b.textContent.trim() === label; })[0] || null;
  }

  function closeDetail(det) {
    if (!det) return;
    // 关闭按钮在详情外层浮窗的标题栏里，不在 .persistent-item-detail 内部
    var win = (det.closest && (det.closest('.window-itemdetail') || det.closest('.game-floating-window'))) || det;
    var btn = win.querySelector('.game-window-controls button[aria-label^="关闭"]');
    if (btn) btn.click();
  }

  // 等详情浮窗出现，且确实是对应装备（避免读到上一件残留的内容）
  function detailName(det) {
    var icon = det.querySelector('.item-icon');
    return icon ? (icon.getAttribute('title') || '').split('\n')[0].trim() : '';
  }

  async function waitDetail(doc, name) {
    return await waitFor(function () {
      var d = doc.querySelector('.persistent-item-detail');
      if (!d || !visible(d)) return null;
      return name && detailName(d) !== name ? null : d;
    }, 2500);
  }

  function parseDetail(det) {
    var name = (det.querySelector('h2') || {}).textContent || '';
    var eyebrow = (det.querySelector('.eyebrow') || {}).textContent || '';
    var idMatch = eyebrow.match(/#(\d+)/);
    var lines = Array.prototype.slice
      .call(det.querySelectorAll('.item-description p'))
      .map(function (p) { return p.textContent.trim(); });
    var find = function (prefix) {
      var line = lines.filter(function (l) { return l.indexOf(prefix) === 0; })[0];
      if (!line) return '';
      var idx = line.indexOf(':');
      return idx >= 0 ? line.slice(idx + 1).trim() : '';
    };
    return {
      name: name.trim(),
      itemId: idMatch ? idMatch[1] : '',
      state: ((det.querySelector('.identify-state') || {}).textContent || '').trim(),
      series: find('系列'),
      reqLv: find('要求等级'),
      equipFor: find('装备'),
      options: Array.prototype.slice
        .call(det.querySelectorAll('.item-random-options b'))
        .map(function (b) { return b.textContent.trim(); })
        .filter(Boolean),
      lines: lines
    };
  }

  // 鉴定后按名称找回那一格（排除仍未鉴定的同名格子）
  function findIdentifiedCell(doc, name) {
    var cells = Array.prototype.slice.call(doc.querySelectorAll('.inventory-cell:not(.unidentified)'));
    for (var i = 0; i < cells.length; i++) {
      var icon = cells[i].querySelector('.item-icon');
      if (!icon) continue;
      var t = (icon.getAttribute('title') || '').split('\n')[0].trim();
      if (t === name) return cells[i];
    }
    return null;
  }

  function parseRemain(picker) {
    var small = picker.querySelector('.identify-actions small');
    if (!small) return null;
    var m = (small.textContent || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function stopError(msg, code) {
    var e = new Error(msg);
    e.code = code || '';
    return e;
  }

  // 鉴定一件，成功返回装备数据；没有未鉴定装备返回 null
  async function identifyOne() {
    var doc = getGameDoc();
    if (!doc) throw stopError('找不到游戏页面，请确认已进入角色', 'NO_GAME');

    await ensureInventoryEquipTab(doc);

    var cell = doc.querySelector('.inventory-cell.unidentified');
    if (!cell) return null;

    var icon = cell.querySelector('.item-icon');
    if (!icon) throw stopError('格子结构异常');
    var cellName = (icon.getAttribute('title') || '').split('\n')[0].trim();

    // 1. 打开详情
    icon.click();
    var det = await waitDetail(doc, cellName);
    if (!det) throw stopError('打开装备详情失败');

    // 2. 二次确认确实是未鉴定装备，避免误点其它按钮
    if (!det.querySelector('.identify-state.unknown')) {
      closeDetail(det);
      throw stopError('状态不是未鉴定，跳过');
    }
    var identifyBtn = findAction(det, '鉴定');
    if (!identifyBtn) {
      closeDetail(det);
      throw stopError('未找到鉴定按钮');
    }
    if (identifyBtn.disabled) {
      closeDetail(det);
      throw stopError('没有放大镜，需要购买', 'NO_LOUPE');
    }

    // 3. 点鉴定 → 等放大镜选择框
    identifyBtn.click();
    var picker = await waitFor(function () {
      var p = doc.querySelector('.identify-picker-layer');
      return p && visible(p) ? p : null;
    }, 2500);
    if (!picker) {
      closeDetail(det);
      throw stopError('放大镜选择框未出现');
    }
    var remain = parseRemain(picker);
    // 没有放大镜时弹层不渲染按钮，只显示「背包中没有放大镜（#611 / #12325）」
    if (picker.querySelector('.identify-actions .empty') || /没有放大镜/.test(picker.textContent || '')) {
      var closeX = picker.querySelector('.modal-close');
      if (closeX) closeX.click();
      closeDetail(det);
      throw stopError('背包没有放大镜，需要购买', 'NO_LOUPE');
    }
    if (remain === 0) {
      var closeBtn = picker.querySelector('.modal-close');
      if (closeBtn) closeBtn.click();
      throw stopError('放大镜用完了，请补充后再鉴定', 'NO_LOUPE');
    }

    // 4. 选放大镜（弹层内容可能比外层晚一帧出现）
    var useBtn = await waitFor(function () {
      return picker.querySelector('.identify-actions button');
    }, 1500);
    if (!useBtn) throw stopError('未找到放大镜按钮');
    useBtn.click();

    var closed = await waitFor(function () {
      return !doc.querySelector('.identify-picker-layer') && !doc.querySelector('.persistent-item-detail');
    }, 3500);
    if (!closed) {
      var left = doc.querySelector('.persistent-item-detail');
      closeDetail(left);
      throw stopError('鉴定后界面未关闭');
    }
    await sleep(280);

    // 5. 重新打开读属性
    var cell2 = findIdentifiedCell(doc, cellName);
    if (!cell2) throw stopError('鉴定后找不到该装备');
    cell2.querySelector('.item-icon').click();

    var det2 = await waitDetail(doc, cellName);
    if (!det2) throw stopError('鉴定后读取属性失败');

    await sleep(120);
    var result = parseDetail(det2);
    closeDetail(det2);
    await sleep(150);
    return result;
  }

  // 同一件装备的指纹：名称 + 词条组合（物品ID 是模板ID，不能用来去重）
  function recordSig(name, options) {
    return name + '|' + (options || []).join('+');
  }

  // 扫描背包里已鉴定的装备：打开详情读词条，补进评分列表（按指纹去重）
  async function collectIdentified() {
    var doc = getGameDoc();
    if (!doc) return 0;
    await ensureInventoryEquipTab(doc);
    var cells = Array.prototype.slice
      .call(doc.querySelectorAll('.inventory-cell:not(.unidentified)'))
      .filter(function (c) { return !!c.querySelector('.item-icon'); })
      .slice(0, 80);
    var added = 0;
    for (var i = 0; i < cells.length && running; i++) {
      var icon = cells[i].querySelector('.item-icon');
      var nm = (icon.getAttribute('title') || '').split('\n')[0].trim();
      if (!nm) continue;
      setStatus('补录已鉴定装备… ' + (i + 1) + '/' + cells.length + '（新增 ' + added + '）');
      try {
        icon.click();
        var det = await waitDetail(doc, nm);
        if (!det) continue;
        var res = parseDetail(det);
        closeDetail(det);
        await sleep(160);
        // 没有词条说明是普通物品/还没鉴定，跳过
        if (!res.options || !res.options.length) continue;
        var sig = recordSig(res.name, res.options);
        var dup = records.some(function (r) { return r.sig === sig; });
        if (dup) continue;
        records.unshift({
          name: res.name, itemId: res.itemId, series: res.series, reqLv: res.reqLv,
          equipFor: res.equipFor, options: res.options, sig: sig,
          ts: Date.now(), decision: '待定'
        });
        added++;
        render();
      } catch (e) {}
    }
    if (added) { sortRecords(); saveRecords(); render(); }
    return added;
  }

  /* ---------------- 起号 ---------------- */
  // 流程：转职 NPC（自由转职 → 下一步 → 选职业）→ 传送南门 → 开始挂机 → 满级 →
  //      转职 NPC（我要转生）×5 → 满级 → @allskill
  var CAS_STORE = 'ro-auto-identify-cas-v2';
  var CAS_ALL = loadCasAll();
  var CAS = { on: false, key: '', reborns: 0, stage: '', lastBase: 0, moveTries: 0, needSync: true, blockUntil: 0, expDone: false };
  var CAS_TARGET_REBORN = 5;
  var CAS_TICK = 1200;
  var CAS_NPC = { x: 171, y: 151 };     // rag_fes 转职服务 NPC
  var CAS_WARP = { x: 164, y: 82 };     // rag_fes 南门传送点
  var CAS_FARM = 'prt_fild08';          // 练级地图
  var CAS_MOVE_WAIT = 12000;            // 发一次移动指令后等待的时间

  function loadCasAll() {
    try {
      var o = JSON.parse(localStorage.getItem(CAS_STORE) || '{}');
      if (o && typeof o.reborns === 'number') {          // 旧版单角色格式
        return { _legacy: { reborns: o.reborns, stage: o.stage || '', lastBase: 0 } };
      }
      return o && typeof o === 'object' ? o : {};
    } catch (e) { return {}; }
  }

  // 每个角色单独存进度，避免多开时互相覆盖
  function casKey(doc) {
    var el = qSel('.rail-player-title b') || qSel('.rail-player-title');
    var n = el ? el.textContent.trim().split(/\s+/)[0] : '';
    return n || '_default';
  }

  function casBind(doc) {
    var k = casKey(doc);
    if (CAS.key === k) return CAS;
    if (!CAS_ALL[k]) {
      CAS_ALL[k] = CAS_ALL._legacy || { reborns: 0, stage: '', lastBase: 0 };
      delete CAS_ALL._legacy;
    }
    var s = CAS_ALL[k];
    CAS.key = k;
    CAS.reborns = s.reborns || 0;
    CAS.stage = s.stage || '';
    CAS.lastBase = s.lastBase || 0;
    CAS.moveTries = 0;
    CAS.blockUntil = 0;
    return CAS;
  }

  function saveCas() {
    try {
      if (CAS.key) {
        CAS_ALL[CAS.key] = { reborns: CAS.reborns, stage: CAS.stage, lastBase: CAS.lastBase };
      }
      localStorage.setItem(CAS_STORE, JSON.stringify(CAS_ALL));
    } catch (e) {}
  }

  // 从 NPC 对话文本里读「已转生 N 次」
  // 只认明确表达进度的说法，避免把「还需转生 5 次」「第 5 次转生」当成当前进度（曾误判成 5 转）
  function readRebornsFromText(txt) {
    var t = String(txt || '').replace(/\s+/g, ' ');
    var pats = [
      /(?:已经|已|当前|目前|累计|总共|完成)\s*转生\s*(?:了)?\s*(\d+)\s*次/,
      /转生\s*(?:次数|层数)\s*[:：]?\s*(\d+)/,
      /(?:已经|已|累计)\s*(\d+)\s*次\s*转生/
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = t.match(pats[i]);
      if (!m) continue;
      var n = parseInt(m[1], 10);
      if (isNaN(n) || n < 0 || n > 20) continue;
      return Math.min(n, CAS_TARGET_REBORN);
    }
    return null;
  }

  // 主动找转职 NPC 确认已转生次数（掉线重开脚本时用）
  async function casSyncReborns() {
    var doc = getGameDoc() || document;
    if (!(await casOpenNpc(doc, '转职', CAS_NPC))) return false;
    await sleep(900);
    var card = qSel('.npc-dialog-card');
    var txt = card ? card.textContent : '';
    var n = readRebornsFromText(txt);
    // 菜单里可能有「查询转生次数」之类的选项，点一次再读
    if (n == null) {
      var opts = qSel('.npc-choice-card');
      var q = opts && Array.prototype.slice.call(opts.querySelectorAll('button')).filter(function (b) {
        return /查询|几次|几转|转生次数/.test(b.textContent);
      })[0];
      if (q) {
        await fireChoice(q);
        await sleep(1200);
        var card2 = qSel('.npc-dialog-card');
        n = readRebornsFromText(card2 ? card2.textContent : '');
      }
    }
    if (n != null) {
      CAS.reborns = n;
      CAS.stage = '';
      CAS.needSync = false;
      saveCas();
      setStatus('起号：NPC 确认已转生 ' + n + ' 次（' + CAS.key + '）');
    } else {
      CAS.needSync = false;
      saveCas();
      setStatus('起号：NPC 没读到转生次数，暂按本地 ' + CAS.reborns + ' 次；对话原文：' +
        String(txt).replace(/\s+/g, ' ').slice(0, 40));
    }
    return true;
  }

  // 面板「查转数」：主动去 NPC 核对一次（不在运行时也可用）
  async function casCheckReborns() {
    var doc = getGameDoc() || document;
    casBind(doc);
    if (CAS.on) { setStatus('起号运行中，会自动核对转生次数'); return; }
    if (await casSyncReborns()) return;
    setStatus('查转数：右侧 NPC 列表里没有转职服务（需在 rag_fes 且 NPC 在视野内）');
  }

  // 角色栏结构：.rail-player-facts > div（dt=Base Lv.x / dd=百分比 或 MAX）
  function railInfo(doc) {
    var s = qSel('.rail-player-summary') || doc;
    var facts = Array.prototype.slice.call(s.querySelectorAll('.rail-player-facts > div'));
    var lvOf = function (key) {
      var d = facts.filter(function (x) {
        var dt = x.querySelector('dt');
        return dt && dt.textContent.replace(/\s+/g, '').indexOf(key) >= 0;
      })[0];
      if (!d) return null;
      var dt = d.querySelector('dt');
      var dd = d.querySelector('dd');
      var lvM = (dt ? dt.textContent : '').match(/Lv\.\s*(\d+)/);
      var ddTxt = dd ? dd.textContent.replace(/\s+/g, '') : '';
      var pcM = ddTxt.match(/([\d.]+)%/);
      return {
        max: /MAX/i.test(ddTxt),
        lv: lvM ? parseInt(lvM[1], 10) : 0,
        pct: pcM ? parseFloat(pcM[1]) : 0
      };
    };
    var base = lvOf('Base');
    var job = lvOf('Job');
    var title = s.querySelector('.rail-player-title small');
    var zEl = s.querySelector('[data-currency="ZENY"] dd') || doc.querySelector('[data-currency="ZENY"] dd');
    var zm = (zEl ? zEl.textContent : '').match(/([\d,]+)/);
    // 挂机额度：rail 底部 / 挂机窗口头部都有「免费挂机剩余：H:MM:SS」
    var qEl = s.querySelector('.aa-quota-status strong') || doc.querySelector('.aa-quota-status strong');
    var qTxt = qEl ? qEl.textContent.replace(/\s+/g, '') : '';
    var qm = qTxt.match(/(\d+):(\d+):(\d+)/);

    // 结构异常时兜底：整段文本解析（Lv.1 与 0.0% 会连成 Lv.10.0%）
    if (!base) {
      var t = s.textContent.replace(/\s+/g, ' ');
      var segs = t.split(/(?=Lv\.)/).filter(function (x) { return /^Lv\./.test(x); });
      var parseSeg = function (seg) {
        var mx = seg.match(/^Lv\.\s*(\d+)\s*MAX/i);
        if (mx) return { max: true, lv: parseInt(mx[1], 10), pct: 0 };
        var pc = seg.match(/^Lv\.\s*(\d+?)\.\d+%/);
        var any = seg.match(/^Lv\.\s*(\d+)/);
        return { max: false, lv: pc ? parseInt(pc[1], 10) : (any ? parseInt(any[1], 10) : 0), pct: 0 };
      };
      base = parseSeg(segs[0] || '');
      job = parseSeg(segs[1] || '');
      if (!zm) zm = (t.match(/ZENY\s*[\d,]+/) || [''])[0].match(/([\d,]+)/);
    }
    var idleSec = qm ? parseInt(qm[1], 10) * 3600 + parseInt(qm[2], 10) * 60 + parseInt(qm[3], 10) : null;
    if (idleSec == null) {
      var qm2 = s.textContent.replace(/\s+/g, '').match(/免费挂机剩余[：:]*(\d+):(\d+):(\d+)/);
      if (qm2) idleSec = parseInt(qm2[1], 10) * 3600 + parseInt(qm2[2], 10) * 60 + parseInt(qm2[3], 10);
    }
    // 血量：rail 里是「HP9657/10321SP741/1557」
    var vTxt = (s.querySelector('.rail-vitals') || {}).textContent || '';
    var vhp = vTxt.replace(/\s+/g, '').match(/HP([\d,]+)\/([\d,]+)/i);
    // 负重：rail 里是「负重2760.9 / 4830.0 (57%)」
    var wEl = facts.filter(function (x) {
      var dt = x.querySelector('dt');
      return dt && dt.textContent.indexOf('负重') >= 0;
    })[0];
    var wTxt = (wEl && wEl.querySelector('dd')) ? wEl.querySelector('dd').textContent.replace(/,/g, '') : '';
    var wm = wTxt.match(/([\d.]+)\s*\/\s*([\d.]+)/);
    return {
      baseMax: !!base.max,
      jobMax: !!job.max,
      // 转生条件：Base 99 + Job 50；有些界面只显示数字不显示 MAX，用等级兜底
      baseFull: !!base.max || base.lv >= 99,
      jobFull: !!job.max || job.lv >= 50,
      baseLv: base.lv,
      jobLv: job.lv,
      basePct: base.pct,
      jobPct: job.pct,
      novice: /初学者/.test(title ? title.textContent : ''),
      jobName: title ? title.textContent.replace(/\s+/g, '') : '',
      zeny: zm ? parseInt(zm[1].replace(/,/g, ''), 10) : 0,
      hp: vhp ? parseInt(vhp[1].replace(/,/g, ''), 10) : 0,
      hpMax: vhp ? parseInt(vhp[2].replace(/,/g, ''), 10) : 0,
      weight: wm ? parseFloat(wm[1]) : null,
      weightMax: wm ? parseFloat(wm[2]) : null,
      weightPct: wm ? Math.round(parseFloat(wm[1]) / parseFloat(wm[2]) * 100) : null,
      idleSec: idleSec
    };
  }

  // 顶栏位置：.location-chip 文本「rag_fes · 165, 120」，title「rag_fes (165, 120)」
  function mapInfo(doc) {
    var el = qSel('.location-chip');
    if (!el) return { map: '', x: null, y: null };
    var title = el.getAttribute('title') || '';
    var all = (title + ' ' + el.textContent).replace(/\s+/g, ' ');
    var m = all.match(/(-?\d+)\s*,\s*(-?\d+)/);
    var nm = (title.match(/^([a-z0-9_@.-]+)\s*\(/i) || [])[1] || el.textContent.split('·')[0].trim();
    return {
      map: String(nm || '').slice(0, 24),
      x: m ? parseInt(m[1], 10) : null,
      y: m ? parseInt(m[2], 10) : null
    };
  }

  // 「开始挂机 / 停止挂机」在顶栏，不在左侧 game-menu-button 里
  function farmButton(doc) {
    var pick = function (list) {
      return list.filter(function (b) {
        return /^(开始|停止)挂机$/.test(b.textContent.trim());
      })[0] || null;
    };
    return pick(qAll('.game-topbar button, .topbar-actions button, .mobile-quick-actions button'))
      || pick(qAll('button'));
  }

  // 顶栏快捷按钮（苍蝇翅膀 / 蝴蝶翅膀）
  function wingButton(doc, label) {
    var pick = function (list) {
      return list.filter(function (b) { return b.textContent.trim() === label; })[0] || null;
    };
    return pick(qAll('.game-topbar button, .topbar-actions button, .mobile-quick-actions button'))
      || pick(qAll('button'));
  }

  function entityTab(doc, name) {
    var sb = qSel('.map-entity-sidebar');
    if (!sb) return null;
    return Array.prototype.slice.call(sb.querySelectorAll('.entity-group-tab'))
      .filter(function (b) { return b.textContent.trim() === name; })[0] || null;
  }

  function entityButtons(doc) {
    var sb = qSel('.map-entity-sidebar');
    var list = sb && sb.querySelector('.entity-list');
    return list ? Array.prototype.slice.call(list.querySelectorAll('button')) : [];
  }

  function npcButton(doc, keyword, coord) {
    var list = entityButtons(doc);
    // 先按名字匹配
    var byName = list.filter(function (b) {
      var n = b.querySelector('b');
      return (n ? n.textContent : b.textContent).indexOf(keyword) >= 0;
    })[0];
    if (byName) return byName;
    if (!coord) return null;
    // 名字对不上时按坐标兜底：列表项里自带「171, 151 · 点击远程对话」
    return list.filter(function (b) {
      var m = b.textContent.match(/(\d+)\s*,\s*(\d+)/);
      if (!m) return false;
      return Math.abs(+m[1] - coord.x) <= 3 && Math.abs(+m[2] - coord.y) <= 3;
    })[0] || null;
  }

  async function casOpenNpc(doc, keyword, coord, opts) {
    var tgt = coord === undefined ? CAS_NPC : coord;
    // nameOnly：名字对不上就放弃，不要按坐标兜底（否则会点到旁边不相干的 NPC）
    if (opts && opts.nameOnly) tgt = null;
    var tab = entityTab(doc, 'NPC');
    if (tab && !tab.classList.contains('active')) { tab.click(); await sleep(400); }
    // 实体列表是异步拉的：最多等 3 秒，别读一次空列表就放弃
    var b = null;
    for (var i = 0; i < 10 && !b; i++) {
      b = npcButton(doc, keyword, tgt);
      if (!b) await sleep(300);
    }
    if (!b && tab) {
      // 再点一次页签，强制刷新列表（偶尔第一次点没拉到数据）
      tab.click();
      await sleep(600);
      b = npcButton(doc, keyword, tgt);
    }
    if (!b) return false;
    // 列表项本身就是「点击远程对话」，不会让角色走过去
    b.click();
    await sleep(900);
    if (qSel('.npc-dialog-card')) { CAS.moveTries = 0; HUNT.npcFail = 0; return true; }
    // 偶发丢包：同一条再点一次
    b.click();
    await sleep(900);
    if (qSel('.npc-dialog-card')) { CAS.moveTries = 0; HUNT.npcFail = 0; return true; }
    // 列表里有这个 NPC，点两次都打不开对话：客户端可能卡死，累计到 4 次就刷新本页恢复
    HUNT.npcFail = (HUNT.npcFail || 0) + 1;
    if (HUNT.npcFail >= 4) {
      HUNT.npcFail = 0;
      try { localStorage.setItem('ro-hunt-autoresume', '1'); } catch (e) {}
      setStatus('游戏客户端点了 NPC 没反应，刷新页面恢复（狩猎会自动重启）…');
      setTimeout(function () { try { window.location.reload(); } catch (e) {} }, 800);
    }
    return false;
  }

  // 传送页签的列表项形如「南门 164,82 → prt_fild08 170,375」，按目标地图精确挑
  // 传送有延迟（1.8 秒内经常还没切图），所以点完要轮询地图，最多等 12 秒
  async function casWarpTo(doc, targetMap) {
    var before = mapInfo(doc).map;
    var tab = entityTab(doc, '传送');
    if (tab && !tab.classList.contains('active')) { tab.click(); await sleep(600); }
    var re = new RegExp('→\\s*' + targetMap, 'i');
    var b = entityButtons(doc).filter(function (x) {
      return re.test(x.textContent.replace(/\s+/g, ' '));
    })[0] || null;
    if (!b) return false;
    b.click();
    var want = new RegExp('^' + targetMap + '$', 'i');
    for (var i = 0; i < 12; i++) {
      await sleep(1000);
      var now = mapInfo(doc).map;
      if (now && now !== before && want.test(now)) return true;
    }
    return false;
  }

  // 回主城：优先传送列表里目标为 rag_fes 的传送点，其次顶栏蝴蝶翅膀
  // 两种方式都要复核地图是否真的变了，避免「点了但没生效」被当成回城成功，反复空点
  // MVP 图（如 boss1）的传送页签是空列表，这时只能靠翅膀，所以翅膀必须作为兜底
  async function casGoHome(doc) {
    var before = mapInfo(doc).map;
    if (await casWarpTo(doc, 'rag_fes')) {
      await sleep(900);
      if (mapInfo(doc).map !== before) { HUNT.homeFail = 0; return 'warp'; }
    }
    var w = wingButton(doc, '蝴蝶翅膀');
    if (!w || w.disabled) return '';
    w.click();
    await sleep(2600);
    var moved = mapInfo(doc).map !== before;
    if (moved) HUNT.homeFail = 0;
    return moved ? 'wing' : '';
  }

  // 背包格子的道具名（优先 item-icon 的 title 第一行，兜底 aria-label）
  function invItemName(c) {
    var ic = c.querySelector('.item-icon');
    var t = ic ? (ic.getAttribute('title') || '').split('\n')[0].trim() : '';
    if (t) return t;
    return (c.getAttribute('aria-label') || '').split('×')[0].trim();
  }

  // 穿时装：名称带「时装」的装备双击穿上（系列为 时装-头上/头中/披风/头下）
  // 只在「装备」页签和带「时装」字样的页签里找，避免误用消耗品里的时装礼盒 / 兑换券
  async function casWearCostumes(doc) {
    try {
      var win = qSel('.window-inventory');
      if (!win || win.classList.contains('closed')) {
        var mb = qAll('.game-menu-button').filter(function (b) { return b.textContent.trim() === '背包'; })[0];
        if (mb) { mb.click(); await sleep(800); }
        win = qSel('.window-inventory');
      }
      if (!win) return '没打开背包，跳过穿时装';

      var labels = qAll('.inventory-tabs button')
        .map(function (b) { return b.textContent.trim(); })
        .filter(function (l) { return l === '装备' || l.indexOf('时装') >= 0; });
      if (!labels.length) labels = ['装备'];

      var worn = 0, tried = 0, fail = '';
      for (var t = 0; t < labels.length; t++) {
        await invTab(doc, labels[t]);
        var guard = 0;
        while (guard++ < 15) {
          var cell = qAll('.inventory-cell').filter(function (c) {
            return invItemName(c).indexOf('时装') >= 0;
          })[0];
          if (!cell) break;
          var nm = invItemName(cell);
          var cnt = function () {
            return qAll('.inventory-cell').filter(function (c) { return invItemName(c) === nm; }).length;
          };
          var before = cnt();
          tried++;
          cell.dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true, cancelable: true, detail: 2, view: doc.defaultView || window
          }));
          await sleep(700);
          if (cnt() < before) worn++;
          else { fail = nm; break; }   // 穿不上就别死循环
        }
      }
      await invTab(doc, '装备');
      if (!tried) return '背包里没有时装，跳过';
      if (fail) return '已穿 ' + worn + '/' + tried + ' 件时装（' + fail + ' 穿不上，可能槽位或等级限制）';
      return '已穿上 ' + worn + ' 件时装';
    } catch (e) {
      return '穿时装有异常（' + ((e && e.message) || e) + '），继续后续流程';
    }
  }

  // 起号第一步：把背包里的经验书吃掉（名称含「经验书」，如「巅峰经验书+1000」）
  // 优先用详情里的「批量使用」，不可用再点「使用」；两处都被禁用就记录原因并跳过
  async function casEatExpBooks(doc) {
    try {
      var win = qSel('.window-inventory');
      if (!win || win.classList.contains('closed')) {
        var mb = qAll('.game-menu-button').filter(function (b) { return b.textContent.trim() === '背包'; })[0];
        if (mb) { mb.click(); await sleep(800); }
        win = qSel('.window-inventory');
      }
      if (!win) return '没打开背包，跳过经验书';
      await invTab(doc, '消耗品');

      var used = 0, blocked = '';
      var guard = 0;
      while (guard++ < 40) {
        var cell = qAll('.inventory-cell').filter(function (c) {
          return invItemName(c).indexOf('经验书') >= 0;
        })[0];
        if (!cell) break;
        var nm = invItemName(cell);
        var qty = function () {
          var n = 0;
          qAll('.inventory-cell').forEach(function (c) {
            if (invItemName(c) !== nm) return;
            var em = c.querySelector('em');
            n += em ? (parseInt(em.textContent, 10) || 1) : 1;
          });
          return n;
        };
        var before = qty();

        (cell.querySelector('.item-icon') || cell).click();
        await sleep(500);
        var det = qSel('.persistent-item-detail');
        if (!det) { blocked = nm + '（打不开详情）'; break; }

        var btns = Array.prototype.slice.call(det.querySelectorAll('button'));
        var batch = btns.filter(function (b) { return b.textContent.trim() === '批量使用' && !b.disabled; })[0];
        var one = btns.filter(function (b) { return b.textContent.trim() === '使用' && !b.disabled; })[0];
        if (!batch && !one) { blocked = nm + '（现在用不了，可能等级 / 转生条件未满足）'; break; }

        (batch || one).click();
        await sleep(800);
        // 若弹出确认框，点一次「确认 / 确定」
        var ok = qAll('button').filter(function (b) {
          return visible(b) && /^(确认|确定)$/.test(b.textContent.trim()) && !b.closest('.persistent-item-detail');
        })[0];
        if (ok) { ok.click(); await sleep(600); }

        var after = qty();
        if (after >= before) { blocked = nm + '（点了没反应）'; break; }
        used += before - after;
        closeDetail(qSel('.persistent-item-detail'));
        await sleep(250);
      }

      closeDetail(qSel('.persistent-item-detail'));
      await invTab(doc, '装备');
      if (used) return '已吃 ' + used + ' 个经验书' + (blocked ? '（' + blocked + '）' : '');
      if (blocked) return '经验书没吃成：' + blocked;
      return '背包里没有经验书，跳过';
    } catch (e) {
      return '吃经验书异常（' + ((e && e.message) || e) + '），继续后续流程';
    }
  }

  var CAS_TALK_BASE = ['下一步', '确定', '确认', '是', '关闭', '结束交易'];
  var CAS_TALK_NOVICE = ['自由转职', '转职', '下一步', '确定', '确认', '是', '关闭'];
  var CAS_TALK_REBORN = ['我要转生', '转生', '下一步', '确定', '确认', '是', '关闭'];
  var CAS_TALK_HUNT_ACCEPT = ['T1', '简单', '接取', '接受', '领取', '下一步', '确定', '确认', '继续', '关闭'];
  var CAS_TALK_HUNT_DONE = ['完成任务', '完成', '交付', '领取奖励', '领取', '下一步', '确定', '确认', '是', '继续', '关闭'];
  var CAS_TALK_HUNT_ENTER = ['进入', '前往', '传送', '开始', 'T1', '确定', '确认', '继续', '关闭'];
  var CAS_TALK_HUNT_KEEP = ['否', '不要', '取消', '不', '继续', '保留', '拒绝', '关闭'];
  var CAS_TALK_HUNT_SAFE = ['下一步', '确定', '确认', '继续', '关闭'];
  var CAS_TALK_REPAIR = ['装备修理', '修理装备', '修装备', '维修装备', '维修', '修理', '修复'];
  var CAS_TALK_SKIP = /取消|离开|返回|放弃/;

  // 对话选项卡：单击只改高亮，执行靠 listbox 的 activedescendant + Enter（实测唯一可靠的方式）
  async function fireChoice(el) {
    var doc = el.ownerDocument;
    var card0 = doc.querySelector('.npc-dialog-card');
    var before = card0 ? card0.textContent : '';
    el.click();
    await sleep(320);
    var card = doc.querySelector('.npc-dialog-card');
    if (!card || card.textContent !== before) return;   // 单击就执行了，别再补刀
    var L = doc.querySelector('.npc-choice-list');
    if (!L) {
      // 没有 listbox 的旧式选项卡：兜底双击
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2, view: el.ownerDocument.defaultView }));
      await sleep(600);
      return;
    }
    if (el.id) L.setAttribute('aria-activedescendant', el.id);
    try {
      L.focus();
      ['keydown', 'keypress', 'keyup'].forEach(function (t) {
        L.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      });
    } catch (e) {}
    await sleep(700);
  }

  function pickByPriority(btns, mode) {
    var list = mode === 'novice' ? CAS_TALK_NOVICE
      : mode === 'reborn' ? CAS_TALK_REBORN
      : mode === 'hunt-accept' ? CAS_TALK_HUNT_ACCEPT
      : mode === 'hunt-done' ? CAS_TALK_HUNT_DONE
      : mode === 'hunt-enter' ? CAS_TALK_HUNT_ENTER
      : mode === 'hunt-keep' ? CAS_TALK_HUNT_KEEP
      : mode === 'hunt-safe' ? ['下一步', '确定', '确认', '继续', '关闭']
      : mode === 'repair' ? CAS_TALK_REPAIR
      : CAS_TALK_BASE;
    var pick = null;
    list.forEach(function (t) {
      if (pick) return;
      pick = btns.filter(function (b) { return b.textContent.trim().indexOf(t) >= 0; })[0] || null;
    });
    return pick;
  }

  async function casTalkOnce(doc, mode) {
    // ① 菜单选项卡 .npc-choice-card（与消息卡片并列，选项需双击）
    var choice = qSel('.npc-choice-card');
    if (choice && visible(choice)) {
      var opts = Array.prototype.slice.call(choice.querySelectorAll('button'))
        .filter(function (b) { return visible(b) && !b.disabled; });
      if (!opts.length) return '';
      var p1 = pickByPriority(opts, mode);
      // 转生 / 修理 / 保留任务：没匹配到就不乱点
      if (!p1 && (mode === 'reborn' || mode === 'repair' || mode === 'hunt-keep')) return '';
      if (!p1) p1 = opts.filter(function (b) { return !CAS_TALK_SKIP.test(b.textContent); })[0] || opts[0];
      var l1 = p1.textContent.trim().slice(0, 12);
      await fireChoice(p1);
      await sleep(CAS_TICK);
      // 狩猎「选择操作」这类页面：选完还要点「确认」才生效（chooseConfirm 会先对齐高亮项）
      if (mode === 'hunt-done' && qSel('.npc-choice-card')) await chooseConfirm();
      return '选项「' + l1 + '」';
    }

    var card = qSel('.npc-dialog-card');
    if (!card || !visible(card)) return '';

    // ② 数字 / 文本输入框
    var inp = card.querySelector('.npc-input input');
    if (inp) {
      setVal(inp, '1');
      await sleep(120);
      var okBtn = card.querySelector('.npc-input button');
      if (okBtn && !okBtn.disabled) {
        okBtn.click();
        await sleep(CAS_TICK);
        return '输入确定';
      }
    }

    // ③ 选道具 / 选技能列表（单击即可）
    var sel = card.querySelector('.npc-native-selection button');
    if (sel && visible(sel) && !sel.disabled) {
      var l3 = sel.textContent.trim().slice(0, 12);
      sel.click();
      await sleep(CAS_TICK);
      return '选择「' + l3 + '」';
    }

    // ④ 普通按钮：下一步 / 确定 / 关闭
    var btns = Array.prototype.slice.call(card.querySelectorAll('button'))
      .filter(function (b) { return visible(b) && !b.disabled; });
    var p4 = pickByPriority(btns, mode);
    // 修理要精确匹配，找不到宁可不动，避免点到仓库/精炼
    if (!p4 && mode !== 'repair' && mode !== 'hunt-keep') p4 = btns.filter(function (b) { return !CAS_TALK_SKIP.test(b.textContent); })[0] || null;
    if (!p4) return '';
    var l4 = p4.textContent.trim().slice(0, 12);
    p4.click();
    await sleep(CAS_TICK);
    return l4;
  }

  async function casWarpOut(doc) {
    var tab = entityTab(doc, '传送');
    if (tab && !tab.classList.contains('active')) { tab.click(); await sleep(500); }
    var b = npcButton(doc, '南门');
    if (!b) return false;
    b.click();
    await sleep(1800);
    return true;
  }

  // 聊天框：form.command.social-command + input[placeholder="输入交流内容"]
  // 内容以 @ 或 # 开头时游戏会原样发给服务端，所以 @allskill / #web:move:x:y 都能直接发
  async function casChat(doc, text) {
    var form = qSel('form.social-command') || qSel('form.command');
    if (!form) return false;
    var box = form.querySelector('input[placeholder="输入交流内容"]') ||
      Array.prototype.slice.call(form.querySelectorAll('input')).filter(function (i) {
        return (i.getAttribute('placeholder') || '').indexOf('交流') >= 0;
      })[0];
    if (!box) return false;
    setVal(box, text);
    await sleep(120);
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await sleep(600);
    return true;
  }

  // 客户端所有 /remote 请求都要 Bearer token；token 只存在 React 状态里，从根 fiber 扫出来
  // 扫到后按 doc 缓存，刷新页面（doc 变了）会自动重扫
  function gameSession(doc) {
    if (CAS.sess && CAS.sess.doc === doc) return CAS.sess;
    try {
      var root = doc.getElementById('root') || (doc.body && doc.body.firstElementChild);
      if (!root) return null;
      var rk = Object.keys(root).filter(function (k) { return k.indexOf('__reactContainer') === 0; })[0];
      var fiber = rk ? root[rk] : null;
      if (!fiber) return null;
      var token = '', charId = 0, seen = new Set(), cnt = 0, steps = 0;
      function scan(v, depth) {
        if (!v || depth > 3 || cnt > 20000) return;
        if (typeof v === 'string') {
          if (!token && v.length === 64 && /^[a-f0-9]+$/i.test(v)) token = v;
          return;
        }
        if (typeof v !== 'object' || seen.has(v)) return;
        seen.add(v); cnt++;
        if (Array.isArray(v)) {
          for (var i = 0; i < v.length && i < 6; i++) scan(v[i], depth + 1);
          return;
        }
        if (!charId && typeof v.char_id === 'number' && v.char_id > 1000) charId = v.char_id;
        var ks = Object.keys(v);
        for (var j = 0; j < ks.length; j++) {
          var k = ks[j];
          if (k === 'children' || k === 'return' || k === 'child' || k === 'sibling' || k === '_owner') continue;
          var x; try { x = v[k]; } catch (e) { continue; }
          scan(x, depth + 1);
        }
      }
      while (fiber && steps < 4000 && !(token && charId)) {
        steps++;
        scan(fiber.memoizedState, 0);
        scan(fiber.memoizedProps, 0);
        if (fiber.child) { fiber = fiber.child; continue; }
        while (fiber && !fiber.sibling) fiber = fiber.return;
        fiber = fiber ? fiber.sibling : null;
      }
      if (!token || !charId) return null;
      CAS.sess = { doc: doc, token: token, charId: charId };
      return CAS.sess;
    } catch (e) { return null; }
  }

  // 通过客户端同款接口发指令：服务端只认带 trace_action 的 #web:move，
  // 走聊天输入框（不带 trace_action）会被静默忽略，这就是以前「角色走不动」的原因
  async function casApiChat(doc, message, opt) {
    for (var attempt = 0; attempt < 2; attempt++) {
      var s = gameSession(doc);
      if (!s) return { ok: false, err: 'no-session' };
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var tm = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : 0;
      try {
        var res = await fetch(location.origin + '/remote/chat', {
          method: 'POST',
          cache: 'no-store',
          signal: ctl ? ctl.signal : undefined,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.token },
          body: JSON.stringify({ char_id: s.charId, message: message, trace_action: !!(opt && opt.trace) })
        });
        var txt = '';
        try { txt = await res.text(); } catch (e) {}
        if (res.status === 401 && attempt === 0) { CAS.sess = null; continue; }
        return { ok: res.ok, status: res.status, body: txt };
      } catch (e) {
        return { ok: false, err: String(e) };
      } finally {
        if (tm) clearTimeout(tm);
      }
    }
    return { ok: false, err: 'unauthorized' };
  }

  // 发移动指令：优先走接口（带 trace_action），接口不可用时回退聊天框
  async function casMoveCmd(doc, x, y) {
    var r = await casApiChat(doc, '#web:move:' + x + ':' + y, { trace: true });
    if (r && r.ok) return true;
    return await casChat(doc, '#web:move:' + x + ':' + y);
  }

  // 传送到指定坐标：发 #web:move，连续 3 次位置没变就认为走不过去
  async function casMove(doc, x, y) {
    var p = mapInfo(doc);
    if (p.x == null) return false;
    if (Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1) { CAS.moveTries = 0; return true; }
    if (CAS.moveTries >= 3) return false;
    if (!await casMoveCmd(doc, x, y)) return false;
    var before = p.x + ',' + p.y;
    await sleep(CAS_MOVE_WAIT);
    var q = mapInfo(doc);
    if (q.x != null && (q.x + ',' + q.y) !== before) CAS.moveTries = 0;
    else CAS.moveTries = (CAS.moveTries || 0) + 1;
    return CAS.moveTries < 3;
  }

  // 小步走向目标（只发一次 #web:move，短等待），用于回城后 NPC 还没进视野时靠近
  async function casStepTo(doc, x, y) {
    // 目标正好是 NPC 站的那一格：改走旁边一格。服务端会围着被占的格子反复绕，
    // 表现就是「在 NPC 左右晃」；远程对话本来也不需要贴身。
    var npcs = [SHOP_NPC, HUNT_WARP, CAS_NPC, WILD_NPC, CRAFT_NPC];
    for (var ni = 0; ni < npcs.length; ni++) {
      var n0 = npcs[ni];
      if (n0 && n0.x === x && n0.y === y) { x = x - 1; break; }
    }
    var p = mapInfo(doc);
    if (p.x == null) return '';
    var dNow = Math.abs(p.x - x) + Math.abs(p.y - y);
    if (dNow <= 2) {
      CAS.lastMoveTo = ''; CAS.lastDist = null; CAS.noProg = 0;
      CAS.posTgt = ''; CAS.posHist = [];
      return 'near';
    }
    // 刚走开散场（NPC 对话关不掉时）：短时间内别走回原地，否则会在 NPC 旁左右来回
    if (CAS.awayUntil && Date.now() < CAS.awayUntil && CAS.awayPt
      && Math.abs(p.x - CAS.awayPt.x) + Math.abs(p.y - CAS.awayPt.y) <= 5) return 'near';
    var tgt = x + ',' + y;
    // 同一目标下反复回到同一格：被 NPC/障碍挡住左右蹭，不再发移动，交给远程对话
    var pk = p.x + ',' + p.y;
    if (CAS.posTgt !== tgt) { CAS.posTgt = tgt; CAS.posHist = []; }
    CAS.posHist = CAS.posHist || [];
    CAS.posHist.push(pk);
    if (CAS.posHist.length > 10) CAS.posHist.shift();
    var same = CAS.posHist.filter(function (k) { return k === pk; }).length;
    if (same >= 3 && dNow <= 8) return 'near';
    // 在相邻两格之间来回蹭（寻路绕 NPC）：也当作已到位
    if (CAS.posHist.length >= 6 && dNow <= 8) {
      var uniq = {};
      CAS.posHist.slice(-6).forEach(function (k) { uniq[k] = 1; });
      if (Object.keys(uniq).length <= 2) return 'near';
    }
    // 同一条移动指令还在生效时不要重发：每 1.7 秒发一次会不断打断寻路，角色反而原地不动
    if (CAS.lastMoveTo === tgt) {
      if (dNow < (CAS.lastDist == null ? Infinity : CAS.lastDist)) {
        CAS.lastDist = dNow; CAS.noProg = 0; CAS.moveTries = 0;
        return 'move';
      }
      CAS.noProg = (CAS.noProg || 0) + 1;
      if (CAS.noProg < 5) return 'move';          // 约 8 秒没有靠近才重发
      CAS.noProg = 0;
      CAS.moveTries = (CAS.moveTries || 0) + 1;
      if (CAS.moveTries >= 8) return '';
    }
    if (!await casMoveCmd(doc, x, y)) return '';
    CAS.lastMoveTo = tgt;
    CAS.lastDist = dNow;
    CAS.lastMoveAt = Date.now();
    return 'move';
  }

  function isFarm(pos) {
    return /prt_fild08/i.test(pos.map || '');
  }

  async function casTick() {
    var doc = getGameDoc() || document;
    var info = railInfo(doc);
    var pos = mapInfo(doc);

    // 任何对话打开时都顺带同步转生次数（转职、转生时 NPC 会报数）
    var openCard = qSel('.npc-dialog-card');
    if (openCard) {
      var nCard = readRebornsFromText(openCard.textContent);
      if (nCard != null && nCard !== CAS.reborns) {
        CAS.reborns = nCard;
        saveCas();
      }
    }

    var tag = ' · ' + (pos.map || '?') +
      (pos.x != null ? ' (' + pos.x + ',' + pos.y + ')' : '') +
      ' · Lv.' + info.baseLv + '/' + info.jobLv +
      ' · 转生 ' + CAS.reborns + '/' + CAS_TARGET_REBORN;

    // 转生计数：等级从 ≥90 掉回 1 级且变回初学者，比数点击按钮可靠
    if (CAS.lastBase >= 90 && info.baseLv > 0 && info.baseLv <= 5 && info.novice &&
      CAS.reborns < CAS_TARGET_REBORN) {
      CAS.reborns = Math.min(CAS.reborns + 1, CAS_TARGET_REBORN);
      CAS.stage = '';
    }
    if (info.baseLv > 0 && CAS.lastBase !== info.baseLv) {
      CAS.lastBase = info.baseLv;
    }
    saveCas();

    // 起号第一步：先把背包里的经验书吃掉（每次启动只做一次）
    if (!CAS.expDone) {
      CAS.expDone = true;
      var ebMsg = await casEatExpBooks(doc);
      setStatus('起号：' + ebMsg + tag);
      return;
    }

    // 重试退避：条件暂时不满足时不要每轮都重复点击
    if (CAS.blockUntil && Date.now() < CAS.blockUntil) return;

    var maxed = info.baseFull && info.jobFull;
    var said = await casTalkOnce(doc, info.novice ? 'novice' : (maxed ? 'reborn' : ''));
    if (said) { setStatus('起号：' + said + tag); return; }

    // 初学者先转职：跳过「job 10 级还要再转一次」的坑
    if (info.novice) {
      if (pos.map !== 'rag_fes') {
        var how0 = await casGoHome(doc);
        if (how0) { setStatus('起号：回主城转职（' + (how0 === 'warp' ? '传送列表' : '蝴蝶翅膀') + '）' + tag); return; }
        setStatus('起号：回不了主城（传送列表没有 rag_fes，蝴蝶翅膀也没生效），8 秒后重试' + tag);
        CAS.blockUntil = Date.now() + 8000;
        return;
      }
      // 只在右侧 NPC 页签里点「转职服务」，不走路（走动太显眼）
      if (await casOpenNpc(doc, '转职', CAS_NPC)) {
        setStatus('起号：已打开转职 NPC，选「自由转职」→ 下一步…' + tag);
        return;
      }
      // NPC 不在视野里：朝 NPC 坐标走一小段（回城后一般往上走一点就能看到）
      var st0 = await casStepTo(doc, CAS_NPC.x, CAS_NPC.y);
      if (st0 === 'move') setStatus('起号：走向转职 NPC（' + CAS_NPC.x + ',' + CAS_NPC.y + '）…' + tag);
      else if (st0 === 'near') { setStatus('起号：已到转职 NPC 位置，等它出现在 NPC 列表…' + tag); CAS.blockUntil = Date.now() + 2000; }
      else { setStatus('起号：走不到转职 NPC，请手动走到 ' + CAS_NPC.x + ',' + CAS_NPC.y + ' 附近，5 秒后重试' + tag); CAS.blockUntil = Date.now() + 5000; CAS.moveTries = 0; }
      return;
    }
    // 满级
    if (maxed) {
      if (CAS.reborns >= CAS_TARGET_REBORN) {
        if (CAS.stage === 'skill') {
          setStatus('起号完成（已回城穿时装并发送 @allskill）' + tag);
          CAS.on = false;
          showCasbar(false);
          return;
        }
        // ① 5 转且满级：先回主城
        if (pos.map !== 'rag_fes') {
          var howEnd = await casGoHome(doc);
          if (howEnd) {
            setStatus('起号完成前：满级了，回主城穿时装（' + (howEnd === 'warp' ? '传送列表' : '蝴蝶翅膀') + '）' + tag);
            return;
          }
          setStatus('起号：满级了，但回不了主城（传送列表没有 rag_fes，蝴蝶翅膀也没生效），8 秒后重试' + tag);
          CAS.blockUntil = Date.now() + 8000;
          return;
        }
        // ② 在主城把背包里的时装穿上（只做一次，结果会记在 stage 里）
        if (CAS.stage !== 'dress') {
          var wr = await casWearCostumes(doc);
          CAS.stage = 'dress';
          saveCas();
          setStatus('起号：已回主城，' + wr + '，下一步发 @allskill' + tag);
          return;
        }
        // ③ 发 @allskill
        if (await casChat(doc, '@allskill')) {
          CAS.stage = 'skill';
          saveCas();
          setStatus('起号完成：已回城穿时装 + 发 @allskill，满级 · 转生 ' + CAS.reborns + ' 次' + tag);
        } else {
          setStatus('起号：满级了，但没找到聊天输入框，请手动输入 @allskill' + tag);
        }
        CAS.on = false;
        showCasbar(false);
        return;
      }
      if (pos.map !== 'rag_fes') {
        var how1 = await casGoHome(doc);
        if (how1) {
          setStatus('起号：满级，回主城转生（' + (how1 === 'warp' ? '传送列表' : '蝴蝶翅膀') + '）' + tag);
          return;
        }
        setStatus('起号：满级，但回不了主城（传送列表没有 rag_fes，蝴蝶翅膀也没生效），8 秒后重试' + tag);
        CAS.blockUntil = Date.now() + 8000;
        return;
      }
      if (await casOpenNpc(doc, '转职', CAS_NPC)) {
        setStatus('起号：满级，点「我要转生」（' + CAS.reborns + '/' + CAS_TARGET_REBORN + '）' + tag);
        return;
      }
      // 满级时同样：NPC 不在视野就朝坐标靠近
      var st1 = await casStepTo(doc, CAS_NPC.x, CAS_NPC.y);
      if (st1 === 'move') setStatus('起号：满级，走向转职 NPC（' + CAS_NPC.x + ',' + CAS_NPC.y + '）…' + tag);
      else if (st1 === 'near') { setStatus('起号：满级，已到转职 NPC 位置，等它出现在 NPC 列表…' + tag); CAS.blockUntil = Date.now() + 2000; }
      else { setStatus('起号：满级，走不到转职 NPC，请手动走到 ' + CAS_NPC.x + ',' + CAS_NPC.y + ' 附近，5 秒后重试' + tag); CAS.blockUntil = Date.now() + 5000; CAS.moveTries = 0; }
      return;
    }

    // 未满级：去 prt_fild08 挂机。传送页签里的「南门」可直接点，不用先走过去
    if (!isFarm(pos)) {
      if (await casWarpOut(doc)) {
        setStatus('起号：已点「南门」传送，等待切图…' + tag);
        return;
      }
      var mv3 = await casMove(doc, CAS_WARP.x, CAS_WARP.y);
      if (mv3) setStatus('起号：传送列表里没有「南门」，正在走向传送点（' + CAS_WARP.x + ',' + CAS_WARP.y + '）' + tag);
      else {
        setStatus('起号：找不到「南门」也走不过去，8 秒后重试（可手动传到 ' + CAS_FARM + '）' + tag);
        CAS.blockUntil = Date.now() + 8000;
      }
      return;
    }

    // 只要人在主城，药不足 100 就补齐（不再为了买药特意回城）
    if (/rag_fes/i.test(pos.map || '') && Date.now() - (CAS.buyAt || 0) > 20000) {
      await invTab(doc, '消耗品');
      if (potionCount() < POTION_TARGET) {
        CAS.buyAt = Date.now();
        var pb = await buyPotions(doc);
        setStatus('起号：' + POTION_KEY + '不足，' + pb);
        return;
      }
    }

    // 练级地图：装备坏了先停下来修
    if (brokenNames().length && Date.now() - (CAS.repairAt || 0) > 20000) {
      CAS.repairAt = Date.now();
      setStatus('起号：发现损坏装备，暂停挂机修理…' + tag);
      var rp = await tryRepair(doc);
      setStatus('起号：' + rp + tag);
      return;
    }

    // 被怪物技能卸下的装备：及时穿回
    if (Date.now() - (CAS.wornAt || 0) > 12000) {
      CAS.wornAt = Date.now();
      var wo = await checkStripped();
      if (wo) { setStatus('起号：' + wo + tag); return; }
    }

    // 练级地图：开挂机
    var fb = farmButton(doc);
    if (!fb) { setStatus('起号：没找到「开始挂机」按钮（顶栏）' + tag); return; }
    if (fb.textContent.trim() === '停止挂机') {
      setStatus('起号：挂机中，等满级' + tag);
      return;
    }
    tapEl(fb);
    await sleep(1400);
    var fb2 = farmButton(doc);
    if (!fb2 || fb2.textContent.trim() !== '停止挂机') {
      tapEl(fb2 || fb);
      await sleep(1500);
      fb2 = farmButton(doc);
    }
    if (fb2 && fb2.textContent.trim() === '停止挂机') {
      setStatus('起号：挂机已开始，练级中（Base/Job 未满）' + tag);
    } else {
      setStatus('起号：点了「开始挂机」但没生效（可能被禁用或挂机额度用完）' + tag);
    }
  }

  // 起号进度条只在运行时显示，不占平时的高度
  function showCasbar(on) {
    var bar = $('casbar');
    if (bar) bar.style.display = on ? 'flex' : 'none';
  }

  async function casRun() {
    if (CAS.on) return;
    var doc0 = getGameDoc() || document;
    casBind(doc0);
    CAS.on = true;
    CAS.expDone = false;          // 每次启动起号，先吃一遍背包里的经验书
    CAS.blockUntil = 0;
    CAS.needSync = true;          // 每次启动都向 NPC 核对一次已转生次数
    showCasbar(true);
    setStatus('起号：检查角色状态…');
    while (CAS.on) {
      try {
        var doc = getGameDoc() || document;
        casBind(doc);
        // 掉线重开后进度可能丢：在主城就先去 NPC 确认几转；不在主城等满级时顺带读
        if (CAS.needSync) {
          if (/rag_fes/i.test(mapInfo(doc).map)) {
            if (!await casSyncReborns()) CAS.needSync = false;   // 视野里没 NPC，交给正常流程走过去
          } else {
            CAS.needSync = false;
          }
        }
        await casTick();
      } catch (e) { setStatus('起号出错：' + (e && e.message ? e.message : e)); }
      await sleep(CAS_TICK);
    }
    setStatus('起号已停止（转生 ' + CAS.reborns + '/' + CAS_TARGET_REBORN + '）');
  }

  /* ---------------- 狩猎任务（T1） ---------------- */

  var HUNT_NPC = { x: 174, y: 165 };   // rag_fes 狩猎任务 NPC
  var HUNT = { on: false, mobs: [], accepted: false, entering: false, info: null, infoAt: 0, noticeAt: 0, sellAt: 0, bagAt: 0, noviceBad: false, enteredFree: false, progBase: null };

  // 完成检测：全服公告「【狩猎公告】玩家[角色名]完成T1狩猎」
  function huntDoneByChat() {
    var w = qSel('.window-logs');
    if (!w) return false;
    var nm = (railInfo(getGameDoc() || document).name || '').trim();
    if (!nm) return false;                 // 读不到角色名就不猜，避免被别人的公告骗回城
    // 全服广播里也有别人完成狩猎，只认「玩家[自己的角色名]」
    var hit = (w.innerText || '').split('\n').filter(function (l) {
      return l.indexOf('狩猎公告') >= 0 && l.indexOf('玩家[' + nm + ']') >= 0;
    });
    return hit.length > 0;
  }
  var HUNT_REFRESH = 20000;   // 任务状态每 20 秒向 NPC 刷新一次

  // 狩猎任务的状态只存在于 NPC 对话里（任务窗口不会显示），按真实文案解析
  function parseHuntDialog() {
    var dlg = qSel('.npc-dialog-card');
    if (!dlg) return null;
    var t = (dlg.textContent || '').replace(/\s+/g, ' ');
    var pm = t.match(/击杀进度[:：]?\s*(\d+)\s*\/\s*(\d+)/);
    if (!pm) return null;
    var tm = t.match(/当前难度[:：]?\s*(T\d)/);
    var bm = t.match(/目标BOSS[:：]?\s*([^\s\[]+)\s*\[ID[:：]?\s*(\d+)\]/) || t.match(/目标\s*BOSS[:：]?\s*([^\s\[]+)/);
    return {
      tier: tm ? tm[1] : '',
      boss: bm ? bm[1] : '',
      bossId: bm && bm[2] ? +bm[2] : 0,
      cur: +pm[1], need: +pm[2], text: t
    };
  }
  var HUNT_STAND = { x: 166, y: 165 };   // 站这里点「狩猎任务」
  var HUNT_WARP = { x: 153, y: 165 };    // rag_fes「挂机区」传送 NPC

  // 任务窗口默认是关的，需要主动打开：点「手册」按钮，或用 Alt+U 热键
  async function openQuestWindow(doc) {
    if (qSel('.quest-window-list')) return true;
    var cands = qAll('button').filter(function (b) {
      var t = b.textContent.trim();
      return (t === '手册' || t === '任务') && !b.disabled;
    });
    var b = cands.filter(function (x) { return x.textContent.trim() === '手册'; })[0] || cands[0];
    if (b) { b.click(); await sleep(700); }
    if (qSel('.quest-window-list')) return true;
    var win = doc.defaultView || window;
    win.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', code: 'KeyU', altKey: true, bubbles: true }));
    await sleep(700);
    return !!qSel('.quest-window-list');
  }

  // 任务面板：article > b(任务名) / small(#id) / span(目标怪 + em 当前/需求)
  function questList() {
    var out = [];
    qAll('.quest-window-list article').forEach(function (a) {
      var b = a.querySelector('b');
      var sm = a.querySelector('small');
      var idm = sm && sm.textContent.match(/#(\d+)/);
      var objs = [];
      Array.prototype.slice.call(a.children).forEach(function (el) {
        if (el.tagName !== 'SPAN') return;
        var em = el.querySelector('em');
        if (!em) return;
        var m = em.textContent.match(/(\d+)\s*\/\s*(\d+)/);
        if (!m) return;
        objs.push({
          name: String(el.textContent).replace(em.textContent, '').trim(),
          cur: +m[1], need: +m[2]
        });
      });
      out.push({ id: idm ? +idm[1] : 0, title: b ? b.textContent.trim() : '', objs: objs });
    });
    return out;
  }

  /* ---------------- 任务进度：面板里常显，不用翻 NPC 对话 ---------------- */

  var TASK_KEY = 'ro-auto-identify-tasks-v1';
  var TASK_ALL = (function () {
    try { return JSON.parse(localStorage.getItem(TASK_KEY) || '{}') || {}; } catch (e) { return {}; }
  })();

  function taskCharKey() {
    var el = qSel('.rail-player-title b') || qSel('.rail-player-title');
    var n = el ? el.textContent.trim().split(/\s+/)[0] : '';
    return n || '';
  }

  function tasksOfChar() {
    var k = taskCharKey();
    if (!k) return null;                 // 角色还没加载出来，先不记，免得串到别的号
    if (!TASK_ALL[k] || typeof TASK_ALL[k] !== 'object') TASK_ALL[k] = {};
    return TASK_ALL[k];
  }

  function saveTasks() {
    try {
      // 多开时各 iframe 共用同一份 localStorage：只回写自己角色的进度，
      // 否则某个号每 4 秒整表覆盖，会把别的号刚记下的击杀数/监控基线抹掉
      var k = taskCharKey();
      if (!k) { localStorage.setItem(TASK_KEY, JSON.stringify(TASK_ALL)); return; }
      var all = {};
      try { all = JSON.parse(localStorage.getItem(TASK_KEY) || '{}') || {}; } catch (e) { all = {}; }
      if (TASK_ALL[k]) all[k] = TASK_ALL[k];
      TASK_ALL = all;
      localStorage.setItem(TASK_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  // 狩猎进度只在 NPC 对话里，读到就按角色存下来；任务窗口关着也在 DOM 里，可直接读
  function gatherTasks() {
    var rows = [];
    var st = tasksOfChar();
    if (!st) return rows;
    var live = parseHuntDialog() || HUNT.info;
    if (live && live.boss && live.need > 0) {
      var prev = st.hunt;
      if (!prev || prev.boss !== live.boss || prev.cur !== (live.cur || 0)
        || prev.need !== live.need || (prev.tier || '') !== (live.tier || '')) {
        st.hunt = { tier: live.tier || '', boss: live.boss, cur: live.cur || 0, need: live.need, ts: Date.now(), watch: null };
        saveTasks();
      }
    }
    if (st.hunt && st.hunt.need > 0) {
      var hcur = st.hunt.cur || 0, hest = false;
      // 挂机中按「任务怪击杀数」估算实时进度，面板不会一直停在旧数字上
      if (HUNT.on) {
        var liveCur = huntLiveCur();
        if (liveCur != null && liveCur > hcur) { hcur = liveCur; hest = true; }
        if (liveCur != null) { st.hunt.cur = Math.min(liveCur, st.hunt.need); st.hunt.ts = Date.now(); st.hunt.watch = null; saveTasks(); }
      } else if (!WILD.on) {
        // 静默监控：没点「狩猎任务」也按统计窗口里的击杀增量往下记
        var wcur = watchLiveCur(st);
        if (wcur != null && wcur > hcur) hcur = wcur;
      }
      rows.push({
        name: (st.hunt.tier ? st.hunt.tier + '狩猎 · ' : '狩猎 · ') + st.hunt.boss,
        cur: Math.min(hcur, st.hunt.need), need: st.hunt.need, ts: st.hunt.ts || 0, est: hest
      });
    }
    var qw = qSel('.quest-window-list');
    if (qw && !qw.querySelector('p.empty')) {
      var qs = questList();
      if (qs.length) { st.quests = qs; saveTasks(); }
      var list = qs.length ? qs : (st.quests || []);
      list.forEach(function (q) {
        (q.objs || []).forEach(function (o) {
          if (!o.need) return;
          rows.push({ name: q.title + (o.name ? ' · ' + o.name : ''), cur: o.cur, need: o.need, ts: 0 });
        });
      });
    }
    return rows;
  }

  function renderTasks() {
    var box = $('taskbar');
    var list = $('task-list');
    if (!box || !list) return;
    var rows = gatherTasks();
    if (!rows.length) {
      box.style.display = 'none';
      list.textContent = '';
      return;
    }
    box.style.display = 'block';
    list.textContent = '';
    rows.forEach(function (r) {
      var pct = r.need > 0 ? Math.max(0, Math.min(1, r.cur / r.need)) : 0;
      var done = r.need > 0 && r.cur >= r.need && !r.est;
      var row = document.createElement('div');
      row.className = 'tb-row' + (done ? ' done' : '');
      var nm = document.createElement('span');
      nm.className = 'tb-name';
      nm.textContent = r.name;
      nm.title = r.name;
      var num = document.createElement('span');
      num.className = 'tb-num';
      num.textContent = (r.est ? '≈' : '') + r.cur + '/' + r.need + (done ? ' 完成' : '');
      num.title = r.est ? '按本次任务怪击杀数估算，回城与狩猎 NPC 对话后会校准' : '';
      var bar = document.createElement('div');
      bar.className = 'tb-bar';
      var fill = document.createElement('i');
      fill.style.width = Math.round(pct * 100) + '%';
      bar.appendChild(fill);
      var pc = document.createElement('span');
      pc.className = 'tb-pct';
      pc.textContent = Math.round(pct * 100) + '%';
      row.appendChild(nm);
      row.appendChild(num);
      row.appendChild(bar);
      row.appendChild(pc);
      list.appendChild(row);
    });
    var ago = $('task-ago');
    var withTs = rows.filter(function (r) { return r.ts; })[0];
    if (ago) {
      ago.textContent = withTs
        ? '更新 ' + new Date(withTs.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
          + (rows.some(function (r) { return r.est; }) ? ' · 含估算' : '')
        : '';
    }
  }

  // 刷新点页签：每一行带怪物名、#mob_id、排除/躲避两个勾选
  async function openSpawnTab(doc) {
    var tab = entityTab(doc, '刷新点');
    if (!tab) return false;
    if (!tab.classList.contains('active')) { tab.click(); await sleep(700); }
    return true;
  }

  function spawnRows() {
    return qAll('.spawn-row').map(function (row) {
      var b = row.querySelector('b');
      var idm = row.textContent.match(/#(\d+)/);
      var boxes = Array.prototype.slice.call(row.querySelectorAll('input[type=checkbox]'));
      return {
        name: b ? b.textContent.replace(/^★\s*/, '').trim() : '',
        mobId: idm ? +idm[1] : 0,
        exclude: boxes[0] || null
      };
    }).filter(function (r) { return r.mobId > 0 && r.exclude; });
  }

  // 只保留任务怪：其余刷点的「排除」都勾上，任务怪取消勾选
  async function huntSyncExclude(targets) {
    var rows = spawnRows();
    if (!rows.length) return -1;
    var tset = {};
    targets.forEach(function (t) { tset[normName(t)] = 1; });
    var changed = 0;
    for (var i = 0; i < rows.length && changed < 12; i++) {
      var r = rows[i];
      var want = !tset[normName(r.name)];
      if (!!r.exclude.checked === want) continue;
      r.exclude.click();
      changed++;
      await sleep(260);
    }
    return changed;
  }

  async function huntStartFarm(doc) {
    var fb = farmButton(doc);
    if (!fb || fb.disabled) return 'nofarm';
    if (fb.textContent.trim() === '停止挂机') return 'running';
    tapEl(fb);
    await sleep(1500);
    var fb2 = farmButton(doc);
    if (fb2 && fb2.textContent.trim() === '停止挂机') return 'started';
    tapEl(fb2 || fb);          // 第一次没生效再补一次（服务端偶发拒绝）
    await sleep(1600);
    fb2 = farmButton(doc);
    return fb2 && fb2.textContent.trim() === '停止挂机' ? 'started' : 'failed';
  }

  async function huntTick() {
    var doc = getGameDoc() || document;
    var pos = mapInfo(doc);
    var tag = ' · ' + (pos.map || '?');

    // 购买失败/提示类弹窗会拦住移动和换装：点掉再继续
    if (clearNotice(doc)) {
      await sleep(500);
      return '已关闭游戏提示框' + tag;
    }

    // 角色倒下：先点「返回城镇」复活，否则后面所有交互都会被拦
    var dead = Array.prototype.slice.call(doc.querySelectorAll('button')).filter(function (b) {
      return visible(b) && !b.disabled && /返回城镇/.test(b.textContent);
    })[0];
    if (dead) {
      tapEl(dead);
      await sleep(1800);
      return '角色倒下，已点「返回城镇」复活' + tag;
    }

    // 回城就补药：不足 100 补到 100
    if (/rag_fes/i.test(pos.map || '') && Date.now() - (HUNT.buyAt || 0) > 20000) {
      await invTab(doc, '消耗品');
      if (potionCount() < POTION_TARGET) {
        HUNT.buyAt = Date.now();
        return '回城补给：' + (await buyPotions(doc)) + tag;
      }
      // 药够用：顺手把鉴定判定「建议卖」的没用装备卖到商店（最多 60 秒一次）
      if (Date.now() - (HUNT.sellAt || 0) > 60000) {
        HUNT.sellAt = Date.now();
        var sj = await huntSellJunk(doc);
        if (sj) return '回城卖装备：' + sj + tag;
      }
      // 负重过半就先把铝这类材料/战利品存仓库，否则买东西时一直提示「负重不足」
      var wi = railInfo(doc);
      if (wi && wi.weightPct != null && wi.weightPct >= 70 && Date.now() - (HUNT.stashWAt || 0) > 60000) {
        HUNT.stashWAt = Date.now();
        var sw = await huntStashLoot(doc);
        if (sw > 0) return '负重 ' + wi.weightPct + '%：存仓 ' + sw + ' 种' + tag;
      }
      // 公会仓库：把鉴定出的 S 装存进去，并取出本职业对口的 S 装穿上（最多 2 分钟一次）
      if (Date.now() - (HUNT.stashAt || 0) > 120000) {
        HUNT.stashAt = Date.now();
        var sq = await huntStashAndEquip(doc);
        if (sq) return '公会仓库：' + sq + tag;
      }
    }
    // 背包快满：回主城把未鉴定装备鉴定掉、判要卖的卖掉，腾出空间再继续任务（最多 20 秒一次）
    if (Date.now() - (HUNT.bagAt || 0) > 20000) {
      var bu0 = bagUsage(doc);
      if (bu0 && bu0.used >= bu0.cap) {
        HUNT.bagAt = Date.now();
        if (!/rag_fes/i.test(pos.map || '')) {
          var bh = await casGoHome(doc);
          if (bh) {
            HUNT.homeFail = 0;
            return '背包已满 ' + bu0.used + '/' + bu0.cap + '，回主城鉴定/出售（' + (bh === 'warp' ? '传送列表' : '蝴蝶翅膀') + '）' + tag;
          }
          HUNT.homeFail = (HUNT.homeFail || 0) + 1;
          if (HUNT.homeFail >= 3) {
            HUNT.on = false;
            setHuntBtn(false);
            HUNT.stopMsg = '背包已满 ' + bu0.used + '/' + bu0.cap + '，连续 3 次回不了主城 · ' + (pos.map || '');
            try { localStorage.removeItem('ro-hunt-autoresume'); } catch (e) {}
            return '狩猎已停止：背包满且回不了主城，请手动回城后重新点「狩猎任务」' + tag;
          }
          return '背包已满 ' + bu0.used + '/' + bu0.cap + '，但回不了主城（' + HUNT.homeFail + '/3）' + tag;
        }
        return '背包 ' + bu0.used + '/' + bu0.cap + ' 已满：' + (await huntBagRoutine(doc)) + tag;
      }
    }
    // 小号交完狩猎任务：每天一次把材料 + 评级 S 装备全存公会仓库
    if (HUNT.stashAfter) {
      HUNT.stashAfter = false;
      var sds = await subDailyStash(doc);
      if (sds) return '小号日常存仓：' + sds + tag;
    }
    // 商店弹窗残留：直接「结束交易」关掉（走开不会关；继续往下会误点「购买」）
    if (qSel('.npc-shop-list')) {
      await closeShop(doc);
      return (qSel('.npc-dialog-card') ? '商店窗口没关掉' : '已关闭商店窗口') + tag;
    }
    // 狩猎任务状态只存在于 NPC 对话：有对话时先解析
    if (qSel('.npc-dialog-card')) {
      var st = parseHuntDialog();
      var ccard = qSel('.npc-choice-card');
      var ct = ccard ? Array.prototype.slice.call(ccard.querySelectorAll('button')).map(function (b) { return b.textContent.trim(); }) : [];

      // 与狩猎/挂机无关的对话（商店、仓库、传送、队伍等）直接关掉，避免下面误点其它按钮
      var dlgText = (qSel('.npc-dialog-card').textContent || '');
      if (!/狩猎|挂机|击杀|难度|新手区/.test(dlgText)) {
        await closeDialog();
        if (!qSel('.npc-dialog-card')) { HUNT.dlgFail = 0; return '已关闭无关对话窗口' + tag; }
        // 没有关闭键的窗口：走开一步让它散场
        if (await dismissNpcDialog(doc)) { HUNT.dlgFail = 0; return '走开后已关闭无关对话窗口' + tag; }
        HUNT.dlgFail = (HUNT.dlgFail || 0) + 1;
        if (HUNT.dlgFail >= 4) {
          HUNT.on = false;
          setHuntBtn(false);
          HUNT.stopMsg = '有打不开也关不掉的对话窗口（' + (qSel('.npc-dialog-card').textContent || '').replace(/\s+/g, ' ').slice(0, 40)
            + '…），已停止狩猎：请手动关闭后再点「狩猎任务」';
          try { localStorage.removeItem('ro-hunt-autoresume'); } catch (e) {}
          return HUNT.stopMsg + tag;
        }
        return '有无关对话窗口（关不掉 ' + HUNT.dlgFail + '/4）' + tag;
      }

      // 挂机区传送页：优先「新手区（免费）」，没有再兜底付费 T1
      if (!HUNT.noviceBad && ct.some(function (x) { return /新手区|免费/.test(x); })) {
        var wpf = await chooseCard(/新手区/) || await chooseCard(/免费/);
        if (wpf) {
          await chooseConfirm();
          await sleep(2200);
          HUNT.enteredFree = true;
          return '传送到新手区挂机（免费）' + tag;
        }
      }
      if (ct.some(function (x) { return /T1/.test(x) && /传送|入场费/.test(x); })) {
        var wp = await chooseCard(/T1[^]*入场费/) || await chooseCard(/「T1」/);
        if (wp) {
          await chooseConfirm();
          await sleep(2200);
          HUNT.enteredFree = false;
          return '传送到 T1 挂机区（5w）' + tag;
        }
      }

      // 难度选择页 = 当前没有任务，选 T1
      if (!st && ct.some(function (x) { return /^T1/.test(x); })) {
        var picked = await chooseCard(/^T1/);
        await sleep(600);
        var st2 = parseHuntDialog();
        if (st2) { HUNT.info = st2; HUNT.infoAt = Date.now(); HUNT.progCur = -1; HUNT.progAt = 0; HUNT.mobs = st2.boss ? [st2.boss] : []; huntProgBind(st2); }
        await closeDialog();
        return '接取狩猎任务：' + (picked || 'T1') + tag;
      }

      // 任务状态页：记进度；已完成就交任务，否则关闭（绝不点「放弃任务」）
      if (st) {
        HUNT.info = st;
        HUNT.infoAt = Date.now();
        HUNT.progCur = -1;
        HUNT.progAt = 0;
        huntProgBind(st);
        HUNT.mobs = st.boss ? [st.boss] : HUNT.mobs;
        if (st.cur >= st.need) {
          var cl = await casTalkOnce(doc, 'hunt-done');
          if (cl) {
            HUNT.info = null;
            HUNT.progCur = -1;
            HUNT.progAt = 0;
            if (isSubAccount) HUNT.stashAfter = true;
            return '交任务「' + cl.replace(/^选项/, '') + '」 · ' + st.boss + ' ' + st.cur + '/' + st.need + tag;
          }
          await closeDialog();
          return '任务已完成，但对话里没有交任务按钮' + tag;
        }
        await closeDialog();
        return '任务 ' + st.tier + ' · ' + st.boss + ' ' + st.cur + '/' + st.need + tag;
      }

      // 其它提示页：只点安全按钮
      var said = await casTalkOnce(doc, 'hunt-safe');
      return said ? '对话「' + said.replace(/^选项/, '') + '」' + tag : '';
    }

    var info = HUNT.info;

    // 挂机中估算：任务怪击杀数已到需求，就回城找 NPC 核对并交任务
    if (info && info.cur < info.need) {
      var lv = huntLiveCur();
      if (lv != null && lv >= info.need) info.cur = info.need;
    }
    // 状态行和面板用同一个实时数字，避免一处不动一处动
    var showCur = info ? info.cur : 0;
    if (info && info.cur < info.need) {
      var lvShow = huntLiveCur();
      if (lvShow != null && lvShow > showCur) showCur = lvShow;
    }

    // 全服公告出现（比反复回城查进度省事）
    if (info && info.cur < info.need && huntDoneByChat()) {
      info.cur = info.need;
      HUNT.info = info;
    }

    // 打完了：回主城找 NPC 交任务
    if (info && info.cur >= info.need) {
      if (!/rag_fes/i.test(pos.map || '')) {
        var hd = await casGoHome(doc);
        return hd ? '任务已完成，回主城交任务（' + (hd === 'warp' ? '传送列表' : '蝴蝶翅膀') + '）' + tag
          : '任务已完成，但回不了主城' + tag;
      }
      if (await casOpenNpc(doc, '狩猎', HUNT_NPC)) {
        HUNT.info = null;
        HUNT.progCur = -1;
        HUNT.progAt = 0;
        return '任务已完成（' + info.boss + ' ' + info.cur + '/' + info.need + '），打开 NPC 交任务' + tag;
      }
      var stc = await casStepTo(doc, HUNT_STAND.x, HUNT_STAND.y);
      return (stc === 'move' ? '走向 (166,165) 交任务…' : '请站在 (166,165) 附近交任务') + tag;
    }

    // 有任务没打完：去挂机区只打任务怪
    if (info && info.boss) {
      // 看门狗：在挂机区连续 5 分钟没有击杀进展，说明任务怪打不动（常见于全程 MISS），停下来提示
      if (/rag_fes/i.test(pos.map || '')) {
        HUNT.progAt = 0;
      } else if (HUNT.progCur !== showCur) {
        HUNT.progCur = showCur;
        HUNT.progAt = Date.now();
      } else if (!HUNT.progAt) {
        HUNT.progAt = Date.now();
      }
      if (HUNT.progAt && Date.now() - HUNT.progAt > 300000) {
        HUNT.on = false;
        setHuntBtn(false);
        HUNT.stopMsg = '狩猎任务「' + info.boss + '」5 分钟没有击杀进展（战斗记录可能全程 MISS），已停止：请换任务或提升命中后再试';
        return HUNT.stopMsg + tag;
      }
      var approx = info && showCur > info.cur ? '≈' : '';
      return await huntFarm(doc, pos, [info.boss], info.boss + ' ' + approx + showCur + '/' + info.need, tag);
    }

    // 状态未知（掉线重开等）：先用右侧 NPC 列表远程对话读进度，走不过去也能开
    if (!/rag_fes/i.test(pos.map || '')) {
      var h = await casGoHome(doc);
      return h ? '回主城读任务状态（' + (h === 'warp' ? '传送列表' : '蝴蝶翅膀') + '）' + tag
        : '回不了主城（传送列表没有 rag_fes，蝴蝶翅膀也没生效）' + tag;
    }
    if (Date.now() - (HUNT.infoAt || 0) >= 2500 && await casOpenNpc(doc, '狩猎', HUNT_NPC)) {
      HUNT.infoAt = Date.now();
      return '打开「狩猎任务」读取进度' + tag;
    }
    var stm = await casStepTo(doc, HUNT_STAND.x, HUNT_STAND.y);
    if (stm === 'move') {
      // 城内移动若被服务端拒绝，会一直原地「假装移动」：连续 8 轮坐标不变就停，别无限空转
      var pn = mapInfo(doc);
      var pk = pn.x + ',' + pn.y;
      if (HUNT.stuckKey === pk) HUNT.stuckN = (HUNT.stuckN || 0) + 1;
      else { HUNT.stuckKey = pk; HUNT.stuckN = 1; }
      if (HUNT.stuckN >= 8) {
        HUNT.on = false;
        setHuntBtn(false);
        HUNT.stopMsg = '角色卡在 ' + pk + ' 走不动（服务端没接受自动移动），已停止狩猎：'
          + '请手动把角色走到 (166,165) 附近，再点「狩猎任务」';
        return HUNT.stopMsg + tag;
      }
      return '走向 (166,165) 好点「狩猎任务」NPC…' + tag;
    }
    HUNT.stuckN = 0;
    HUNT.stuckKey = '';
    if (stm !== 'near') return '走不到「狩猎任务」NPC，请手动走到 (166,165) 附近' + tag;
    if (Date.now() - (HUNT.infoAt || 0) < 2500) return '等待任务状态刷新…' + tag;
    HUNT.infoAt = Date.now();
    if (await casOpenNpc(doc, '狩猎', HUNT_NPC)) return '打开「狩猎任务」读取进度' + tag;
    return '已到 (166,165)，但 NPC 列表里没有「狩猎任务」' + tag;
  }

  // 任务区 → 只留目标怪的排除列表 → 开始挂机
  async function huntFarm(doc, pos, targets, prog, tag) {
    // 购买失败之类的游戏提示框会挡住移动/换装：先点掉，本 tick 直接返回，下一轮再走
    if (clearNotice(doc)) return '已关闭游戏提示框' + tag;
    // 血量低且背包没药：先回城补给；在城里还补不上就别再出去送死
    // （有药时交给游戏挂机的自动喝药，不在这里反复回城）
    var ri = railInfo(doc);
    if (ri && ri.hpMax && ri.hp / ri.hpMax < 0.35 && potionCount() < 5) {
      if (!/rag_fes/i.test(pos.map || '')) {
        var back = await casGoHome(doc);
        return back
          ? '血量过低 ' + ri.hp + '/' + ri.hpMax + '，先回城补药' + tag
          : '血量过低（' + ri.hp + '/' + ri.hpMax + '），但回不了主城' + tag;
      }
      // 已经在主城还是残血：说明药没买到（没钱/卖不动），再出去就是送死，直接停
      HUNT.on = false;
      setHuntBtn(false);
      HUNT.stopMsg = '血量过低 ' + ri.hp + '/' + ri.hpMax + '，背包药 ' + potionCount()
        + ' 个、ZENY ' + ri.zeny + '，补不上药，已停止狩猎（先卖装备/上架换钱，或手动买药）';
      return HUNT.stopMsg + tag;
    }
    if (brokenNames().length && Date.now() - (HUNT.repairAt || 0) > 20000) {
      HUNT.repairAt = Date.now();
      return await tryRepair(doc);
    }
    // 被怪物技能卸下的装备：及时穿回
    if (Date.now() - (HUNT.wornAt || 0) > 12000) {
      HUNT.wornAt = Date.now();
      var wr = await checkStripped();
      if (wr) return wr + tag;
    }
    if (!await openSpawnTab(doc)) return '找不到右侧「刷新点」页签' + tag;

    var want = targets.map(normName);
    var rows = spawnRows();
    var hit = rows.filter(function (r) { return want.indexOf(normName(r.name)) >= 0; });

    // 不在任务图 / 这张图没有任务怪：回主城 (153,165) 找「挂机区」NPC 传送
    // 地图前缀不再作为硬条件：新手区不在 spl_ 前缀里，只看刷点列表有没有任务怪
    if (!hit.length) {
      if (!/rag_fes/i.test(pos.map || '')) {
        // 新手区里没有任务怪：记下来，下次传送改回 T1，避免免费区 ↔ 主城来回空跑
        if (HUNT.enteredFree) { HUNT.noviceBad = true; HUNT.enteredFree = false; }
        var h = await casGoHome(doc);
        return h ? '回主城准备进挂机区（' + (h === 'warp' ? '传送列表' : '蝴蝶翅膀') + '）' + tag
          : '回不了主城，请手动回 rag_fes' + tag;
      }
      var wk = await ensureWeapon(doc);
      if (wk) return wk + tag;                           // 没武器：先补/停，绝不空手出门
      if (await casOpenNpc(doc, '挂机', HUNT_WARP)) { HUNT.entering = true; return '已打开「挂机区」NPC，选新手区传送' + tag; }
      var st = await casStepTo(doc, HUNT_WARP.x, HUNT_WARP.y);
      if (st === 'move') return '走向 (153,165) 点「挂机区」NPC…' + tag;
      return '右侧 NPC 列表里没有「挂机区」，请站在 (153,165) 附近后重试' + tag;
    }

    var changed = await huntSyncExclude(targets);
    if (changed < 0) return '刷新点列表还没加载出来，稍等' + tag;
    if (changed > 0) return '设置排除列表：只打 ' + targets.join('/') + '（本批改 ' + changed + ' 个）' + tag;

    var f = await huntStartFarm(doc);
    if (f === 'running' || f === 'started') return '挂机中，只打任务怪 · ' + prog + tag;
    if (f === 'nofarm') return '没找到顶栏「开始挂机」按钮' + tag;
    return '点了「开始挂机」但没生效（挂机额度可能用完）' + tag;
  }

  /* ---------------- 野外 BOSS 循环 ---------------- */

  var WILD_NPC = { x: 145, y: 165 };    // rag_fes「野外boss传送」
  var WILD_STAND = { x: 148, y: 166 };  // 站这里能点到「野外boss传送」
  var WILD_COST = 200000;               // 每次传送费用
  var WILD_STEP = 5;                    // 每杀一只按 -5% 活力
  var WILD_STOP = 35;                   // 低于 30% 有重罚，到 35% 就停手回城
  var WILD_RESUME = 95;                 // 城内坐下恢复到 95% 再进下一轮
  var WILD_RECOVER = 7;                 // 城内坐下每分钟恢复 7%
  var WILD_KEY = 'ro-auto-identify-wild-v1';
  var WILD = {
    on: false, map: '', key: '', done: false, doneReason: '',
    round: 0, total: 0, roundKills: 0,
    vigor: 100, vigorAt: 0, resting: false,
    killsSeen: null, roundAt: 0,
    mobAt: 0, targetKey: '',
    startedAt: 0, statAt: 0, repairAt: 0, wornAt: 0, stoppedMsg: ''
  };

  try { WILD.key = localStorage.getItem(WILD_KEY) || ''; } catch (e) {}

  // 统计窗口里的「怪物击杀」总数（找不到窗口 / 没渲染时返回 null）
  function statKills() {
    var sec = qSel('.window-statistics .autoattack-statistics');
    if (!sec) return null;
    var secs = Array.prototype.slice.call(sec.querySelectorAll('section'));
    for (var i = 0; i < secs.length; i++) {
      var h = secs[i].querySelector('h4');
      if (!h || h.textContent.indexOf('怪物击杀') < 0) continue;
      var st = secs[i].querySelector('header strong');
      if (!st) return null;
      var m = st.textContent.replace(/,/g, '').match(/\d+/);
      return m ? +m[0] : null;
    }
    return null;
  }

  // 统计窗口里某个怪物的击杀数（列表行文案「蜂后#1059×3」）；窗口没开/没数据返回 null
  function statKillsOf(name) {
    var sec = qSel('.window-statistics .autoattack-statistics');
    if (!sec) return null;
    var secs = Array.prototype.slice.call(sec.querySelectorAll('section'));
    for (var i = 0; i < secs.length; i++) {
      var h = secs[i].querySelector('h4');
      if (!h || h.textContent.indexOf('怪物击杀') < 0) continue;
      var list = secs[i].querySelector('.autoattack-stat-list');
      if (!list) return null;
      var rows = Array.prototype.slice.call(list.children);
      for (var j = 0; j < rows.length; j++) {
        var t = (rows[j].textContent || '').replace(/\s+/g, '');
        var m = t.match(/^(.+?)#\d+[×x](\d+)$/);
        if (!m) continue;
        if (normName(m[1]) === normName(name)) return +m[2];
      }
      return 0;   // 列表里没有这只怪 = 本次还没杀过
    }
    return null;
  }

  // 读到 NPC 真实进度时记下「任务怪当前击杀数」，之后用它算实时增量
  function huntProgBind(info) {
    var kc = (info && info.boss) ? statKillsOf(info.boss) : null;
    HUNT.progBase = (kc == null) ? null : { boss: info.boss, cnt: kc, extra: 0 };
  }

  // 挂机中的实时进度估算：NPC 记录的 cur + 之后新杀的任务怪数量
  function huntLiveCur() {
    var info = HUNT.info;
    if (!HUNT.on || !info || !info.boss) return null;
    var kc = statKillsOf(info.boss);
    if (kc == null) return null;
    var pb = HUNT.progBase;
    if (!pb || pb.boss !== info.boss) {
      HUNT.progBase = pb = { boss: info.boss, cnt: kc, extra: 0 };
      return info.cur;
    }
    if (kc < pb.cnt) { pb.extra += pb.cnt; pb.cnt = 0; }   // 统计被重置过，把差值累积起来
    var d = pb.extra + (kc - pb.cnt);
    return d > 0 ? info.cur + d : info.cur;
  }

  // 静默监控：狩猎没开时，用统计窗口里「任务怪击杀数」的增量推进已记录的进度。
  // 统计窗口没开、或刚重置过，只重新绑定基线，不追溯计数，避免把历史击杀算进来。
  function watchLiveCur(st) {
    var h = st && st.hunt;
    if (!h || !h.need || !h.boss) return null;
    var kc = statKillsOf(h.boss);
    if (kc == null) return null;
    var w = h.watch;
    if (!w || w.boss !== h.boss) {
      h.watch = { boss: h.boss, cnt: kc };
      saveTasks();
      return h.cur || 0;
    }
    if (kc < w.cnt) {                       // 统计被「重置」过，基线跟着归零
      w.cnt = kc;
      saveTasks();
      return h.cur || 0;
    }
    var d = kc - w.cnt;
    if (d > 0) {
      h.cur = Math.min(h.need, (h.cur || 0) + d);
      h.ts = Date.now();
      w.cnt = kc;
      saveTasks();
    }
    return h.cur || 0;
  }

  // 统计窗口不在就静默打开它（每分钟最多试一次，不弹提示、不打断操作）
  var SILENT_OPEN_GAP = 60000;
  var silentOpenAt = 0;
  function silentWatchTasks() {
    var st = tasksOfChar();
    var h = st && st.hunt;
    if (!h || !h.need || !h.boss) return;
    if (HUNT.on || WILD.on) return;         // 自动流程自己会记，别重复
    var w = qSel('.window-statistics');
    if (w && !w.classList.contains('closed')) return;
    if (Date.now() - silentOpenAt < SILENT_OPEN_GAP) return;
    silentOpenAt = Date.now();
    var doc = getGameDoc();
    if (doc) ensureStatWindow(doc);
  }

  async function ensureStatWindow(doc) {
    var w = qSel('.window-statistics');
    if (w && !w.classList.contains('closed')) return true;
    var win = doc.defaultView || window;
    win.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', altKey: true, bubbles: true }));
    await sleep(600);
    w = qSel('.window-statistics');
    if (w && !w.classList.contains('closed')) return true;
    var b = qAll('.game-menu-button').filter(function (x) {
      return /统计/.test((x.getAttribute('title') || '') + (x.getAttribute('aria-label') || '') + x.textContent);
    })[0];
    if (b && !b.disabled) { tapEl(b); await sleep(700); }
    w = qSel('.window-statistics');
    return !!(w && !w.classList.contains('closed'));
  }

  async function resetStats() {
    var sec = qSel('.window-statistics .autoattack-statistics');
    if (!sec) return false;
    var b = Array.prototype.slice.call(sec.querySelectorAll('button')).filter(function (x) {
      return x.textContent.trim() === '重置统计' && !x.disabled;
    })[0];
    if (!b) return false;
    tapEl(b);
    await sleep(500);
    return true;
  }

  function setWildBtn(on) {
    var b = $('wildbtn');
    if (b) b.textContent = on ? '停野外' : '野外BOSS';
  }

  // 活力估算：野图里站着不恢复，只是每杀一只 -5%；回城坐下每分钟 +7%（封顶 100）
  function wildVigorNow() {
    var v = (WILD.vigor == null) ? 100 : WILD.vigor;
    if (WILD.resting && WILD.vigorAt) v += WILD_RECOVER * (Date.now() - WILD.vigorAt) / 60000;
    return Math.max(0, Math.min(100, v));
  }

  // 城里的「坐下 / 站起」按钮（比模拟 Insert 键可靠）
  function wildPostureBtn() {
    var b = qAll('button.map-posture-toggle').filter(visible)[0];
    if (b) return b;
    return qAll('.minimap-wrap button, .map-zoom-controls button').filter(function (x) {
      return /^(坐下|站起)$/.test((x.textContent || '').trim());
    })[0] || null;
  }

  function updateWildBar() {
    var bar = $('wildbar');
    if (!bar) return;
    bar.style.display = 'flex';
    var b = $('wild-info');
    if (!b) return;
    var v = Math.round(wildVigorNow());
    var txt = '第 ' + Math.max(1, (WILD.round || 0) + 1) + ' 轮 · 活力约 ' + v + '%';
    if (WILD.resting) {
      var mins = Math.max(0, Math.ceil((WILD_RESUME - v) / WILD_RECOVER));
      txt += '（坐下恢复' + (mins > 0 ? '，约 ' + mins + ' 分钟后到 ' + WILD_RESUME + '%' : '') + '）';
    }
    b.textContent = txt + ' · 本轮 ' + (WILD.roundKills || 0) + ' 只 · 累计 ' + (WILD.total || 0);
  }

  // 右侧「魔物」页签：列出视野内的活怪，点一下行就是主动攻击
  async function openMobTab(doc) {
    var tab = entityTab(doc, '魔物');
    if (!tab) return false;
    if (!tab.classList.contains('active')) { tab.click(); await sleep(500); }
    return true;
  }

  function mobRows() {
    var sb = qSel('.map-entity-sidebar');
    if (!sb) return [];
    var list = sb.querySelector('.entity-list.entity-group-content') || sb.querySelector('.entity-list');
    if (!list) return [];
    return Array.prototype.slice.call(list.querySelectorAll('button')).map(function (b) {
      var nm = b.querySelector('b');
      var raw = b.textContent.replace(/\s+/g, ' ');
      var idm = raw.match(/#(\d+)/);
      var hpm = raw.match(/HP\s*(\d+(?:\.\d+)?)\s*%/i);
      var xy = raw.match(/(-?\d+)\s*,\s*(-?\d+)\s*$/);
      return {
        el: b,
        name: (nm ? nm.textContent : b.textContent).replace(/^★\s*/, '').trim(),
        mobId: idm ? +idm[1] : 0,
        hp: hpm ? parseFloat(hpm[1]) : null,
        star: /★/.test(raw),
        attacking: b.classList.contains('manual-target') || !!(b.querySelector('em') && /攻击中/.test(b.textContent)),
        disabled: !!b.disabled,
        x: xy ? +xy[1] : null,
        y: xy ? +xy[2] : null
      };
    }).filter(function (r) { return !!r.name; });
  }

  function mobKey(r) { return r.name + '#' + r.mobId; }

  var MOB_IDLE_MS = 5000;   // 点了怪 5 秒还没进入「攻击中」，重新点一次

  // 主动攻击：优先 ★(MVP)，其次血最少、离得最近；已经在打就不重复点
  async function wildAttackOnce(doc, pos) {
    if (!await openMobTab(doc)) return '找不到右侧「魔物」页签';
    var rows = mobRows();
    if (!rows.length) { WILD.targetKey = ''; return '视野里没有魔物，等刷新…'; }

    var cur = rows.filter(function (r) { return r.attacking; })[0];
    if (cur) {
      WILD.targetKey = mobKey(cur);
      WILD.mobAt = Date.now();
      return '攻击中 · ' + (cur.star ? '★ ' : '') + cur.name + (cur.hp == null ? '' : '（HP ' + Math.round(cur.hp) + '%）');
    }
    if (WILD.targetKey && Date.now() - (WILD.mobAt || 0) < MOB_IDLE_MS) {
      var pending = rows.filter(function (r) { return mobKey(r) === WILD.targetKey; })[0];
      return '已点怪' + (pending ? ' ' + pending.name : '') + '，等开始攻击…';
    }

    var usable = rows.filter(function (r) { return !r.disabled; });
    if (!usable.length) { WILD.targetKey = ''; return '魔物暂时都不可攻击（等刷新）…'; }

    function hpOf(r) { return r.hp == null ? 999 : r.hp; }
    function distOf(r) {
      if (r.x == null || pos.x == null) return 9999;
      return Math.abs(r.x - pos.x) + Math.abs(r.y - pos.y);
    }
    var pick = usable.slice().sort(function (a, b) {
      if (a.star !== b.star) return a.star ? -1 : 1;
      if (hpOf(a) !== hpOf(b)) return hpOf(a) - hpOf(b);
      return distOf(a) - distOf(b);
    })[0];

    WILD.targetKey = mobKey(pick);
    WILD.mobAt = Date.now();
    tapEl(pick.el);
    return '攻击 ' + (pick.star ? '★ ' : '') + pick.name + (pick.hp == null ? '' : '（HP ' + Math.round(pick.hp) + '%）');
  }

  function stopWild(msg) {
    WILD.on = false;
    WILD.map = '';
    if (WILD.resting) {
      WILD.resting = false;
      var sb = wildPostureBtn();
      if (sb && /站起/.test(sb.textContent)) tapEl(sb);
    }
    WILD.stoppedMsg = msg || '';
    setWildBtn(false);
    if (msg) setStatus('野外BOSS：' + msg);
  }

  // 处理「野外boss传送」对话：选图 → 确认 → 复核地图
  async function wildDialog(doc, pos, tag) {
    var card = qSel('.npc-choice-card');
    if (card) {
      var opts = Array.prototype.slice.call(card.querySelectorAll('button')).filter(function (b) {
        var t = b.textContent.trim();
        return t && visible(b) && !b.disabled &&
          !/^(关闭|取消|返回|离开|上一页|下一页|确认|确定)$/.test(t) &&
          !/放弃|出售|分解|丢弃/.test(t);
      });
      if (!opts.length) {
        await closeDialog();
        stopWild('传送对话没有可选地图，已停止');
        return '';
      }
      var pick = null;
      if (WILD.key) {
        pick = opts.filter(function (b) { return b.textContent.indexOf(WILD.key) >= 0; })[0] || null;
      }
      if (!pick) pick = opts.filter(function (b) { return /BOSS|boss/.test(b.textContent); })[0] || null;
      if (!pick) pick = opts.filter(function (b) { return /[a-z]+_[a-z0-9_]+/i.test(b.textContent); })[0] || null;
      if (!pick) pick = opts[0] || null;
      if (!pick) {
        await closeDialog();
        stopWild('没认出传送选项，已停止');
        return '';
      }
      var label = pick.textContent.trim().slice(0, 16);
      await fireChoice(pick);
      await sleep(700);
      if (qSel('.npc-choice-card')) await chooseConfirm();
      await sleep(1800);

      var np = mapInfo(doc);
      if (np.map && np.map !== pos.map) {
        WILD.map = np.map;
        WILD.done = false;
        WILD.doneReason = '';
        WILD.resting = false;
        WILD.roundAt = Date.now();
        WILD.roundKills = 0;
        WILD.killsSeen = null;          // 进图后按统计窗口重新绑基线
        WILD.mobAt = 0;
        WILD.targetKey = '';
        updateWildBar();
        return '已到 ' + np.map + '（' + label + '），开始主动攻击' + tag;
      }
      var dlg = qSel('.npc-dialog-card');
      var txt = dlg ? dlg.textContent.replace(/\s+/g, ' ').slice(0, 120) : '';
      await closeDialog();
      if (/不足|无法|不够|欠费/.test(txt)) { stopWild('传送失败：' + txt); return ''; }
      return '选了「' + label + '」但地图没变' + (txt ? '（' + txt + '）' : '') + tag;
    }
    var said = await casTalkOnce(doc, 'hunt-safe');
    return said ? '对话「' + said.replace(/^选项/, '') + '」' + tag : '';
  }

  async function wildTick() {
    var doc = getGameDoc() || document;
    var pos = mapInfo(doc);
    var info = railInfo(doc);
    var tag = ' · ' + (pos.map || '?');

    // 角色倒下：先点「返回城镇」复活
    var dead = Array.prototype.slice.call(doc.querySelectorAll('button')).filter(function (b) {
      return visible(b) && !b.disabled && /返回城镇/.test(b.textContent);
    })[0];
    if (dead) {
      tapEl(dead);
      await sleep(1800);
      return '角色倒下，已点「返回城镇」复活' + tag;
    }

    // 本轮打完已回城：先坐下恢复活力，回到 95% 再修装备、重置统计并续下一轮
    if (WILD.done && /rag_fes/i.test(pos.map || '')) {
      if (WILD.doneReason === 'timeout') {
        stopWild('统计窗口不可用，本轮挂了 40 分钟，累计击杀 ' + (WILD.total || 0) + '，收工' + tag);
        return '';
      }
      if (!WILD.resting) {
        WILD.vigor = wildVigorNow();
        WILD.vigorAt = Date.now();
        WILD.resting = true;
        var pb = wildPostureBtn();
        if (pb && /坐下/.test(pb.textContent)) { tapEl(pb); await sleep(500); }
        updateWildBar();
        return '回城坐下恢复活力（' + Math.round(WILD.vigor) + '% → ' + WILD_RESUME + '%）' + tag;
      }
      var vg = wildVigorNow();
      updateWildBar();
      if (vg < WILD_RESUME) {
        var mins = Math.max(1, Math.ceil((WILD_RESUME - vg) / WILD_RECOVER));
        return '城内坐下恢复中 · 活力约 ' + Math.floor(vg) + '%（还需约 ' + mins + ' 分钟）' + tag;
      }
      WILD.vigor = Math.max(vg, WILD_RESUME);
      WILD.resting = false;
      var sb = wildPostureBtn();
      if (sb && /站起/.test(sb.textContent)) { tapEl(sb); await sleep(400); }
      WILD.round = (WILD.round || 0) + 1;
      WILD.done = false;
      WILD.doneReason = '';
      WILD.map = '';
      WILD.roundKills = 0;
      WILD.killsSeen = null;
      WILD.mobAt = 0;
      WILD.targetKey = '';
      var rp = '';
      if (brokenNames().length) rp = await tryRepair(doc);
      if (await ensureStatWindow(doc)) await resetStats();     // 新一轮从 0 开始计
      WILD.statAt = 0;
      updateWildBar();
      return '活力回到 ' + Math.round(WILD.vigor) + '%，第 ' + WILD.round + ' 轮完成（累计击杀 ' + (WILD.total || 0) + '），继续下一轮' +
        (rp ? '（' + rp + '）' : '') + tag;
    }

    var onWild = WILD.map && pos.map === WILD.map;

    if (onWild) {
      if (brokenNames().length && Date.now() - (WILD.repairAt || 0) > 20000) {
        WILD.repairAt = Date.now();
        return await tryRepair(doc);
      }
      // 被怪物技能卸下的装备：及时穿回
      if (Date.now() - (WILD.wornAt || 0) > 12000) {
        WILD.wornAt = Date.now();
        var wr = await checkStripped();
        if (wr) return wr + tag;
      }
      if (Date.now() - (WILD.statAt || 0) > 10000) {
        WILD.statAt = Date.now();
        if (statKills() == null) await ensureStatWindow(doc);
      }

      // 按统计窗口的击杀增量扣活力（每只 -5%）
      var kn = statKills();
      if (kn != null) {
        if (WILD.killsSeen == null || kn < WILD.killsSeen) WILD.killsSeen = kn;
        var dk = kn - WILD.killsSeen;
        if (dk > 0) {
          WILD.killsSeen = kn;
          WILD.vigor = Math.max(0, wildVigorNow() - WILD_STEP * dk);
          WILD.vigorAt = Date.now();
          WILD.roundKills = (WILD.roundKills || 0) + dk;
          WILD.total = (WILD.total || 0) + dk;
        }
      }
      updateWildBar();

      // 到 35%：停手回城（只停点怪，不碰挂机开关）
      var vig = wildVigorNow();
      if (vig <= WILD_STOP) {
        WILD.map = '';
        WILD.done = true;
        WILD.doneReason = 'vigor';
        WILD.targetKey = '';
        return '活力降到 ' + Math.round(vig) + '%（本轮 ' + WILD.roundKills + ' 只，累计 ' + WILD.total + '），停手回城' + tag;
      }
      // 兜底：统计窗口一直不可用时，本轮最多打 40 分钟
      if (kn == null && Date.now() - (WILD.roundAt || WILD.startedAt || 0) > 40 * 60 * 1000) {
        WILD.map = '';
        WILD.done = true;
        WILD.doneReason = 'timeout';
        WILD.targetKey = '';
        return '统计窗口不可用，本轮已打 40 分钟，停手回城' + tag;
      }

      return await wildAttackOnce(doc, pos) + tag;
    }

    // 已离开野图（被打回城 / 掉线）：清掉目标图，重新准备
    if (WILD.map && pos.map !== WILD.map) {
      WILD.map = '';
      return '已离开野外BOSS图（' + (pos.map || '?') + '），重新准备传送' + tag;
    }

    if (!/rag_fes/i.test(pos.map || '')) {
      var h = await casGoHome(doc);
      return h ? '回主城准备传送（' + (h === 'warp' ? '传送列表' : '蝴蝶翅膀') + '）' + tag
        : '回不了主城（传送列表没有 rag_fes，蝴蝶翅膀也没生效）' + tag;
    }

    // 传送前检查金币（不足就不点，避免白跑）
    if (!(info.zeny >= WILD_COST)) {
      stopWild('金币不足 20 万（当前 ' + (info.zeny || 0) + '），已刷 ' + (WILD.round || 0) + ' 轮、累计击杀 ' + (WILD.total || 0) + '，先攒钱' + tag);
      return '';
    }

    // 对话已打开：选图 → 确认
    if (qSel('.npc-dialog-card')) return await wildDialog(doc, pos, tag);

    if (await casOpenNpc(doc, '野外', WILD_NPC)) {
      return '打开「野外boss传送」，读地图列表…' + tag;
    }
    var st = await casStepTo(doc, WILD_STAND.x, WILD_STAND.y);
    if (st === 'move') return '走向 (' + WILD_STAND.x + ',' + WILD_STAND.y + ') 点「野外boss传送」…' + tag;
    if (st === 'near') return '已到 (' + WILD_STAND.x + ',' + WILD_STAND.y + ')，等 NPC 出现在列表…' + tag;
    stopWild('右侧 NPC 列表里没有「野外boss传送」，请手动站到 (' + WILD_STAND.x + ',' + WILD_STAND.y + ') 附近');
    return '';
  }

  async function wildRun() {
    if (WILD.on) return;
    if (HUNT.on || CRAFT.on || CAS.on) {
      setStatus('野外BOSS：先停止狩猎 / 影装 / 起号任务再启动');
      return;
    }
    WILD.on = true;
    WILD.done = false;
    WILD.doneReason = '';
    WILD.map = '';
    WILD.round = 0;
    WILD.total = 0;
    WILD.roundKills = 0;
    WILD.vigor = 100;
    WILD.vigorAt = 0;
    WILD.resting = false;
    WILD.killsSeen = null;
    WILD.roundAt = Date.now();
    WILD.mobAt = 0;
    WILD.targetKey = '';
    WILD.stoppedMsg = '';
    WILD.startedAt = Date.now();
    WILD.statAt = 0;
    WILD.repairAt = 0;
    WILD.wornAt = 0;
    setWildBtn(true);
    updateWildBar();
    setStatus('野外BOSS：检查金币与统计窗口…');
    var doc = getGameDoc() || document;
    if (await ensureStatWindow(doc)) await resetStats();   // 从 0 开始计击杀
    while (WILD.on) {
      try {
        var s = await wildTick();
        if (s) setStatus('野外 ' + s);
      } catch (e) { setStatus('野外BOSS出错：' + (e && e.message ? e.message : e)); }
      await sleep(1800);
    }
    setStatus(WILD.stoppedMsg ? '野外BOSS：' + WILD.stoppedMsg : '野外BOSS 已停止');
  }

  /* ---------------- 影装合成（rag_fes 便捷合成机 104,142） ---------------- */

  var CRAFT_NPC = { x: 104, y: 142 };
  var CRAFT = { on: false, frags: 0, names: [], msg: '', steps: 0, stoppedMsg: '' };

  function setCraftBtn(on) {
    var b = $('craftbtn');
    if (b) b.textContent = on ? '停影装' : '影装';
  }

  function updateCraftBar() {
    var bar = $('craftbar');
    if (!bar) return;
    bar.style.display = 'flex';
    var b = $('craft-info');
    if (!b) return;
    b.textContent = '影碎片 x' + CRAFT.frags +
      (CRAFT.names.length ? '（' + CRAFT.names.join('、') + '）' : '') +
      (CRAFT.msg ? ' · ' + CRAFT.msg : '');
  }

  function stopCraft(msg) {
    CRAFT.on = false;
    CRAFT.stoppedMsg = msg || '';
    setCraftBtn(false);
    if (msg) { CRAFT.msg = msg; setStatus('影装：' + msg); }
    updateCraftBar();
  }

  async function ensureInvWindow(doc) {
    var win = qSel('.window-inventory');
    if (win && !win.classList.contains('closed')) return true;
    var mb = qAll('.game-menu-button').filter(function (b) { return b.textContent.trim() === '背包'; })[0];
    if (mb) { tapEl(mb); await sleep(800); }
    win = qSel('.window-inventory');
    return !!(win && !win.classList.contains('closed'));
  }

  // 扫背包里名称同时含「影」和「碎片」的道具，数量取格子上的 em
  async function scanFragments(doc) {
    if (!await ensureInvWindow(doc)) return { n: 0, names: [] };
    var tabs = qAll('.inventory-tabs button').map(function (b) { return b.textContent.trim(); });
    var names = tabs.filter(function (t) { return /消耗|材料|其它|其他|道具|装备/.test(t); });
    if (!names.length) names = ['消耗品', '装备'];
    var total = 0, found = [];
    for (var i = 0; i < names.length; i++) {
      await invTab(doc, names[i]);
      qAll('.inventory-cell').forEach(function (c) {
        var nm = invItemName(c);
        if (nm.indexOf('影') < 0 || nm.indexOf('碎片') < 0) return;
        var em = c.querySelector('em');
        total += em ? (parseInt(em.textContent, 10) || 1) : 1;
        if (found.indexOf(nm) < 0) found.push(nm);
      });
    }
    await invTab(doc, '装备');
    return { n: total, names: found };
  }

  async function craftDialog(doc, tag) {
    var card = qSel('.npc-choice-card');
    if (card) {
      var opts = Array.prototype.slice.call(card.querySelectorAll('button')).filter(function (b) {
        var t = b.textContent.trim();
        return t && visible(b) && !b.disabled &&
          !/^(关闭|取消|返回|离开)$/.test(t) && !/出售|分解|丢弃/.test(t);
      });
      var pick = opts.filter(function (b) { return /影装/.test(b.textContent); })[0] ||
        opts.filter(function (b) { return /合成|升级/.test(b.textContent); })[0] || null;
      if (!pick) {
        var texts = opts.map(function (b) { return b.textContent.trim().slice(0, 8); }).slice(0, 4).join(' / ');
        await closeDialog();
        stopCraft('便捷合成机里没看到影装选项' + (texts ? '（现有：' + texts + '）' : '') +
          '，可到 lhz_in02「影装服务」(273,17) 手动合成');
        return '';
      }
      var label = pick.textContent.trim().slice(0, 14);
      await fireChoice(pick);
      await sleep(700);
      if (qSel('.npc-choice-card')) await chooseConfirm();
      await sleep(1200);
      CRAFT.steps++;
      if (CRAFT.steps > 20) {
        await closeDialog();
        stopCraft('合成步骤超过 20 步，先停下（可能缺材料或金币）');
        return '';
      }
      var sc = await scanFragments(doc);
      CRAFT.frags = sc.n;
      CRAFT.names = sc.names;
      CRAFT.msg = '点了「' + label + '」';
      updateCraftBar();
      return '点了「' + label + '」，剩余影碎片 ' + sc.n + tag;
    }

    var dlg = qSel('.npc-dialog-card');
    if (!dlg) return '';

    // 普通对话：只点安全的推进按钮
    var safe = Array.prototype.slice.call(dlg.querySelectorAll('button')).filter(function (b) {
      return visible(b) && !b.disabled && /^(确定|确认|下一步|继续|合成|升级)$/.test(b.textContent.trim());
    })[0];
    if (safe) {
      var t = safe.textContent.trim();
      safe.click();
      await sleep(800);
      return '对话「' + t + '」' + tag;
    }

    var brief = dlg.textContent.replace(/\s+/g, ' ').slice(0, 100);
    await closeDialog();
    stopCraft('合成对话没有可用按钮（' + brief + '）');
    return '';
  }

  async function craftTick() {
    var doc = getGameDoc() || document;
    var pos = mapInfo(doc);
    var tag = ' · ' + (pos.map || '?');

    if (qSel('.npc-dialog-card')) return await craftDialog(doc, tag);

    if (!/rag_fes/i.test(pos.map || '')) {
      var h = await casGoHome(doc);
      return h ? '回主城准备合成（' + (h === 'warp' ? '传送列表' : '蝴蝶翅膀') + '）' + tag
        : '回不了主城，请手动回 rag_fes' + tag;
    }

    var sc = await scanFragments(doc);
    CRAFT.frags = sc.n;
    CRAFT.names = sc.names;
    updateCraftBar();
    if (!sc.n) { stopCraft('背包里没有影碎片，先去野外BOSS刷'); return ''; }

    if (await casOpenNpc(doc, '便捷合成', CRAFT_NPC)) {
      return '打开「便捷合成机」，查看影装选项…' + tag;
    }
    var st = await casStepTo(doc, CRAFT_NPC.x, CRAFT_NPC.y);
    if (st === 'move') return '走向 (104,142) 便捷合成机…' + tag;
    if (st === 'near') return '已到 (104,142)，等「便捷合成机」出现在 NPC 列表…' + tag;
    stopCraft('右侧 NPC 列表里没有「便捷合成机」，请手动站到 (104,142) 附近');
    return '';
  }

  async function craftRun() {
    if (CRAFT.on) return;
    if (HUNT.on || WILD.on || CAS.on) {
      setStatus('影装：先停止狩猎 / 野外BOSS / 起号任务再启动');
      return;
    }
    CRAFT.on = true;
    CRAFT.steps = 0;
    CRAFT.msg = '';
    CRAFT.stoppedMsg = '';
    setCraftBtn(true);
    updateCraftBar();
    setStatus('影装：扫描背包影碎片…');
    while (CRAFT.on) {
      try {
        var s = await craftTick();
        if (s) setStatus('影装 ' + s);
      } catch (e) { setStatus('影装出错：' + (e && e.message ? e.message : e)); }
      await sleep(1800);
    }
    setStatus(CRAFT.stoppedMsg ? '影装：' + CRAFT.stoppedMsg : '影装合成 已停止');
  }

  /* ---------------- 自动买药（消耗品售卖机 156,145） ---------------- */

  var POTION_KEY = '双补药';
  var POTION_TARGET = 100;   // 补到 100 个
  var POTION_LOW = 20;       // 低于 20 个就回城补货
  var SHOP_NPC = { x: 156, y: 145 };

  async function invTab(doc, label) {
    await ensureInvWindow(doc);
    var b = qAll('.inventory-tabs button').filter(function (x) { return x.textContent.trim() === label; })[0];
    if (b && !/active/.test(b.className)) { b.click(); await sleep(420); }
    return !!b;
  }

  function potionCount() {
    var n = 0;
    qAll('.inventory-cell').forEach(function (c) {
      var al = c.getAttribute('aria-label') || '';
      if (al.indexOf(POTION_KEY) < 0) return;
      var em = c.querySelector('em');
      n += em ? (parseInt(em.textContent, 10) || 1) : 1;
    });
    return n;
  }

  async function buyPotions(doc) {
    await invTab(doc, '消耗品');
    var have = potionCount();
    if (have >= POTION_TARGET) return '背包已有 ' + have + ' 个' + POTION_KEY + '，不用买';

    if (!(await openShopPage(doc, '购买道具'))) {
      return '没打开「消耗品售卖机」（请确认在 rag_fes 且 NPC 出现在右侧列表）';
    }
    await waitFor(function () { return qSel('.shop-buy-row'); }, 3000);

    var findRow = function () {
      return qAll('.shop-buy-row').filter(function (r) {
        var b = r.querySelector('.npc-shop-item-detail b');
        return b && b.textContent.indexOf(POTION_KEY) >= 0;
      })[0];
    };
    var row = findRow();
    if (!row) return '商店里没找到「' + POTION_KEY + '」';

    // 没钱先卖装备：身上钱不够补满，就结束交易重开商店、进「出售道具」把判定建议卖的装备卖掉再回来买
    var unit = 225;
    var priceEl = row.querySelector('.npc-shop-item-detail');
    var pm = priceEl ? (priceEl.textContent || '').match(/·\s*([\d,]+)\s*z/) : null;
    if (pm) unit = parseInt(pm[1].replace(/,/g, ''), 10) || unit;
    var needZ = unit * Math.max(0, POTION_TARGET - have);
    var z = (railInfo(doc) || {}).zeny || 0;
    if (z > 0 && z < needZ) {
      if (!qSel('.npc-shop-list .shop-sell-row')) {
        await closeShop(doc);
        await sleep(400);
        await openShopPage(doc, '出售道具');
      }
      if (qSel('.npc-shop-list .shop-sell-row')) await sellRecommended(true);
      z = (railInfo(doc) || {}).zeny || 0;
      if (z < needZ) {
        await closeShop(doc);
        return '没钱：' + z.toLocaleString('zh-CN') + ' Z，补满' + POTION_KEY + '需 '
          + needZ.toLocaleString('zh-CN') + ' Z，先卖装备 / 上架换钱';
      }
      // 卖到钱了，回到购买页继续买（row 会随窗口重渲染失效，必须重新查）
      await closeShop(doc);
      await sleep(400);
      if (!(await openShopPage(doc, '购买道具'))) return '卖完装备但没重新打开购买页';
      await waitFor(function () { return qSel('.shop-buy-row'); }, 3000);
      row = findRow();
      if (!row) return '回到购买页后没找到「' + POTION_KEY + '」';
    }

    for (var round = 0; round < 6; round++) {
      var need = POTION_TARGET - potionCount();
      if (need <= 0) break;
      var inp = row.querySelector('input[type="number"]');
      if (inp) setVal(inp, String(need));
      var buy = Array.prototype.slice.call(row.querySelectorAll('button')).filter(function (b) {
        return b.textContent.trim() === '购买' && !b.disabled;
      })[0];
      if (!buy) return '「购买」按钮不可点（可能 ZENY 不足）';
      buy.click();
      await sleep(1200);
    }

    var after = potionCount();
    await closeShop(doc);
    return after > have ? '已补' + POTION_KEY + '到 ' + after + ' 个' : '购买没有生效（当前 ' + after + ' 个）';
  }

  /* ---------------- 装备修理 ---------------- */

  // 装备窗口默认可能是关的，先点「装备」页签 / 按 Alt+Q 打开，否则读不到损坏标记
  async function openEquipWindow(doc) {
    if (qSel('.equipment-window-body') || qSel('.equipment-broken-label')) return true;
    var b = qAll('button').filter(function (x) {
      return x.textContent.trim() === '装备' && !x.disabled;
    })[0];
    if (b) { b.click(); await sleep(700); }
    if (qSel('.equipment-window-body') || qSel('.equipment-broken-label')) return true;
    var win = doc.defaultView || window;
    win.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', altKey: true, bubbles: true }));
    await sleep(700);
    return !!(qSel('.equipment-window-body') || qSel('.equipment-broken-label'));
  }

  // 装备窗口里损坏的装备名（em.equipment-broken-label）
  function brokenNames() {
    var out = [];
    qAll('.equipment-broken-label').forEach(function (em) {
      var b = em.closest('b');
      var slot = em.closest('[title]');
      var nm = (b && b.getAttribute('title')) || (b && b.textContent.replace('损坏', '').trim()) ||
        (slot && slot.getAttribute('title')) || '';
      if (nm) out.push(nm);
    });
    // 背包里损坏的道具（未装备）也一起修
    qAll('.inventory-cell.broken').forEach(function (c) {
      var al = (c.getAttribute('aria-label') || '').replace(/（已损坏）/, '').replace(/^未鉴定装备/, '').trim();
      var ic = c.querySelector('.item-icon');
      var nm = (ic && (ic.getAttribute('title') || '').split('\n')[0]) || al.split('×')[0].trim();
      if (nm && out.indexOf(nm) < 0) out.push(nm);
    });
    return out;
  }

  // 装备窗口里的各部位：返回 [{lab:'头上', name:'[T1]小狼王'}]，空部位 name 为空
  function wornSlots() {
    var out = [];
    qAll('.equipment-slot').forEach(function (el) {
      if (el.classList.contains('equipment-unload-toggle')) return;
      var isEmpty = el.classList.contains('empty');
      var nm = isEmpty ? '' : (el.getAttribute('title') || '').replace(/^(双击)?卸下[:：]?\s*/, '').trim();
      // 部位名必须读 .equipment-slot-label：用 textContent 切 '[' 时，
      // 没有 [T1] 前缀的装备会把名字并进部位名（「右手短剑」），空槽时就对不上号、穿不回去
      var labEl = el.querySelector('.equipment-slot-label');
      var lab = (labEl && labEl.textContent || '').trim();
      if (!lab) {
        lab = isEmpty
          ? (el.getAttribute('title') || '').trim()
          : ((el.textContent || '').trim().split('[')[0] || '').trim();
      }
      if (lab) out.push({ lab: lab, name: nm });
    });
    return out;
  }

  // 某个部位当前穿的装备名；null = 读不到这个部位
  function wornSlotName(lab) {
    var hit = null;
    wornSlots().forEach(function (s) { if (s.lab === lab) hit = s.name || ''; });
    return hit;
  }

  // 这件装备是不是「正在穿 / 上次穿在手上」的武器或盾：存仓时必须跳过
  function isWornWeapon(name) {
    var n = normName(name);
    if (!n) return false;
    var on = wornSlots().some(function (s) { return s.name && normName(s.name) === n; });
    if (on) return true;
    return ['右手', '左手'].some(function (k) {
      return wornSnap[k] && normName(wornSnap[k]) === n;
    });
  }

  function wornByName(name) {
    var n = normName(name);
    return wornSlots().filter(function (s) {
      return s.name && normName(s.name).indexOf(n) >= 0;
    })[0] || null;
  }

  // 在背包当前页签里双击穿上同名装备
  async function wearFromBag(name) {
    var n = normName(name);
    var cell = qAll('.inventory-cell').filter(function (c) {
      var ic = c.querySelector('.item-icon');
      var t = ic ? (ic.getAttribute('title') || '').split('\n')[0] : '';
      return t && normName(t).indexOf(n) >= 0;
    })[0];
    if (!cell) return false;
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await sleep(520);
    return true;
  }

  // 修完把装备穿回去：还在身上的跳过，真在包里的双击穿上，穿不上才回报
  async function reEquip(doc, names) {
    await invTab(doc, '装备');
    var left = [];
    for (var i = 0; i < names.length; i++) {
      if (wornByName(names[i])) continue;
      if (!await wearFromBag(names[i])) { left.push(names[i]); continue; }
      if (!wornByName(names[i])) left.push(names[i]);
    }
    return left;
  }

  /* ---------------- 被怪物技能卸下的装备：定期穿回 ---------------- */

  var wornSnap = {};        // 部位 → 上次看到的装备名（只在内存里，多账号互不影响）
  var wornMiss = {};        // 部位 → 连续在背包里找不到的次数
  var wornTryAt = {};       // 部位 → 上次尝试穿回的时间
  var wearing = false;

  // 挂机中每个部位都应该有装备；空了且背包里有同名装备，就说明被技能卸下来了
  async function checkStripped() {
    if (wearing) return '';
    var doc = getGameDoc();
    if (!doc) return '';
    if (!qSel('.equipment-slot')) return '';                 // 装备窗口没开，读不到部位
    if (qSel('.npc-dialog-card')) return '';                 // 正在跟 NPC 对话，别抢操作
    if (running || mailing || claimingMail || scanning) return '';

    var fb = farmButton(doc);
    var farming = (!!fb && fb.textContent.trim() === '停止挂机') || HUNT.on || CAS.on;
    var slots = wornSlots();

    // 没在挂机：只记录当前穿着，不自动穿（免得跟手动换装打架）
    if (!farming) {
      slots.forEach(function (s) {
        if (s.name) wornSnap[s.lab] = s.name;
        else delete wornSnap[s.lab];
      });
      return '';
    }

    var fix = [];
    slots.forEach(function (s) {
      if (s.name) { wornSnap[s.lab] = s.name; return; }
      if (wornSnap[s.lab]) fix.push({ lab: s.lab, name: wornSnap[s.lab] });
    });
    if (!fix.length) return '';

    wearing = true;
    var done = [];
    try {
      await invTab(doc, '装备');
      for (var i = 0; i < fix.length; i++) {
        var it = fix[i];
        if (Date.now() - (wornTryAt[it.lab] || 0) < 15000) continue;
        wornTryAt[it.lab] = Date.now();
        if (!await wearFromBag(it.name)) {
          wornMiss[it.lab] = (wornMiss[it.lab] || 0) + 1;
          if (wornMiss[it.lab] >= 3) delete wornSnap[it.lab];   // 连试三次都没有，可能已经卖掉/存仓
          continue;
        }
        wornMiss[it.lab] = 0;
        var back = wornByName(it.name);
        if (back) { wornSnap[back.lab] = it.name; done.push(it.name); }
      }
    } finally {
      wearing = false;
    }
    return done.length ? '装备被卸下，已重新穿上：' + done.join('、') : '';
  }

  // 手册按钮：图标按钮没有文字，靠 title / aria-label 认
  function handbookBtn() {
    return qAll('.game-menu-button').filter(function (b) {
      var t = (b.getAttribute('title') || '') + '|' + (b.getAttribute('aria-label') || '') + '|' + b.textContent;
      return t.indexOf('手册') >= 0 && !b.disabled;
    })[0] || null;
  }

  async function dlgNext(doc) {
    var dlg = qSel('.npc-dialog-card');
    if (!dlg) return false;
    var b = Array.prototype.slice.call(dlg.querySelectorAll('button')).filter(function (x) {
      return /^(下一步|继续)$/.test(x.textContent.trim()) && !x.disabled;
    })[0];
    if (!b) return false;
    b.click(); await sleep(750); return true;
  }

  // 选项卡片：单击只高亮，要让服务端执行得按 Enter（部分页面双击也行，兜底都发一遍）
  async function chooseCard(re) {
    var c = qSel('.npc-choice-card');
    if (!c) return '';
    var b = Array.prototype.slice.call(c.querySelectorAll('button')).filter(function (x) {
      var t = x.textContent.trim();
      if (!t || /^(确认|取消|关闭|继续)$/.test(t) || x.classList.contains('dialog-cancel')) return false;
      return re.test(t);
    })[0];
    if (!b) return '';
    var sig = function () { var d = qSel('.npc-dialog-card'); return d ? d.textContent.length + '|' + d.textContent.slice(0, 60) : ''; };
    var before = sig();
    b.click();
    await sleep(450);
    if (sig() !== before) return b.textContent.trim();   // 单击就执行了，别再补刀
    var L = qSel('.npc-choice-list');
    if (L) {
      try {
        // Enter 执行的是 listbox 的 activedescendant，不是 aria-selected；
        // 单击只改高亮，必须把 activedescendant 也指到目标项，否则会执行第 0 项（实测传送会跑错图）
        var oid = b.id;
        if (!oid) {
          var all = Array.prototype.slice.call(L.querySelectorAll('[role=option]'));
          var ix = all.indexOf(b);
          if (ix >= 0) oid = 'npc-choice-' + ix;
        }
        if (oid) L.setAttribute('aria-activedescendant', oid);
        L.focus();
        ['keydown', 'keypress', 'keyup'].forEach(function (t) {
          L.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        });
      } catch (e) {}
      await sleep(800);
    }
    if (qSel('.npc-choice-card')) {
      b.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await sleep(900);
    }
    return b.textContent.trim();
  }

  async function chooseConfirm() {
    var c = qSel('.npc-choice-card');
    if (!c) return false;
    // 「确认」执行的是 listbox 的 activedescendant：先同步成当前高亮项，
    // 否则默认落到第 0 项（狩猎「选择操作」里第 0 项就是「放弃任务」）
    var L = qSel('.npc-choice-list');
    if (L) {
      var opts = Array.prototype.slice.call(L.querySelectorAll('[role=option]'));
      if (!opts.length) opts = Array.prototype.slice.call(L.querySelectorAll('button'));
      var cur = opts.filter(function (x) { return x.getAttribute('aria-selected') === 'true'; })[0] || opts[0];
      if (cur) {
        if (/放弃/.test(cur.textContent)) return false;   // 保险：绝不确认放弃任务
        if (cur.id) L.setAttribute('aria-activedescendant', cur.id);
      }
    }
    var b = Array.prototype.slice.call(c.querySelectorAll('button')).filter(function (x) {
      return x.textContent.trim() === '确认' && !x.disabled;
    })[0];
    if (!b) return false;
    b.click(); await sleep(800); return true;
  }

  async function closeDialog() {
    var dlg = qSel('.npc-dialog-card');
    if (!dlg) return;
    var b = Array.prototype.slice.call(dlg.querySelectorAll('button')).filter(function (x) {
      return /^(关闭|取消|结束交易|结束异常对话)$/.test(x.textContent.trim()) && !x.disabled;
    })[0];
    // 队伍/社交等卡片只有一个「×」关闭键（class=modal-close），没有文字，必须单独认
    if (!b) b = dlg.querySelector('button.modal-close:not([disabled])');
    if (b) {
      // 有些「对话等待时间已结束」的窗口只认指针事件，.click() 点了没反应，用完整事件序列补一遍
      tapEl(b);
      await sleep(500);
      if (qSel('.npc-dialog-card')) {   // 还开着：再补一个 Esc
        try {
          var esc = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true });
          qSel('.npc-dialog-card').dispatchEvent(esc);
          document.dispatchEvent(esc);
        } catch (e) {}
        await sleep(300);
      }
      return;
    }
    // 狩猎任务进度页只有「下一步」：进操作页选「关闭」→ 确认 → 关闭（绝不碰「放弃任务」）
    if (!/狩猎/.test(dlg.textContent)) return;
    var next = Array.prototype.slice.call(dlg.querySelectorAll('button')).filter(function (x) {
      return x.textContent.trim() === '下一步' && !x.disabled;
    })[0];
    if (!next) return;
    next.click();
    await sleep(900);
    var closeOpt = qAll('.npc-choice-list button').filter(function (o) {
      return /关闭/.test(o.textContent) && !/放弃/.test(o.textContent);
    })[0];
    if (closeOpt) {
      await fireChoice(closeOpt);
      var ok = Array.prototype.slice.call(qAll('.npc-dialog-card footer button')).filter(function (x) {
        return x.textContent.trim() === '确认' && !x.disabled;
      })[0];
      if (ok) { ok.click(); await sleep(900); }
    }
    var fin = qSel('.npc-dialog-card');
    var cb = fin && Array.prototype.slice.call(fin.querySelectorAll('button')).filter(function (x) {
      return x.textContent.trim() === '关闭' && !x.disabled;
    })[0];
    if (cb) { tapEl(cb); await sleep(400); }
  }

  // 游戏的「购买失败 / 余额不足」等提示框（.service-notice-layer）会挡住移动和换装，
  // 必须先点「确定」关掉，否则角色会一直原地打转
  function clearNotice(doc) {
    var n = doc.querySelector('.service-notice-layer');
    if (!n) return false;
    var b = Array.prototype.slice.call(n.querySelectorAll('button')).filter(function (x) {
      return /确定|知道了|关闭|确认/.test(x.textContent);
    })[0] || n.querySelector('button');
    if (b && !b.disabled) b.click();
    return true;
  }

  // 商店类对话没有关闭按钮，点空白也不会关；走开一步才会散场
  async function dismissNpcDialog(doc) {
    if (!qSel('.npc-dialog-card')) return true;
    var p = mapInfo(doc);
    var x = p.x == null ? SHOP_NPC.x : p.x + 2;
    var y = p.y == null ? SHOP_NPC.y : p.y;
    if (!await casMoveCmd(doc, x, y)) return false;
    await sleep(1600);
    if (!qSel('.npc-dialog-card')) {
      // 记下走开的位置：15 秒内别走回这一带，避免「走开→走回→再走开」的左右晃动
      CAS.awayUntil = Date.now() + 15000;
      CAS.awayPt = { x: p.x == null ? x : p.x, y: p.y == null ? y : p.y };
    }
    return !qSel('.npc-dialog-card');
  }

  // 修一件：手册 → 下一步 → 装备修理 → 下一步 → 我有物品要修理 → 确认 → 下一步 → 继续 → 关闭
  async function repairOnce(doc) {
    var hb = handbookBtn();
    if (!hb) return 'no-handbook';
    hb.click(); await sleep(1200);

    var picked = '';
    for (var i = 0; i < 5 && !picked; i++) {
      picked = await chooseCard(/装备修理/);
      if (!picked && !await dlgNext(doc)) break;
    }
    if (!picked) { await closeDialog(); return 'no-option'; }

    var got = '';
    for (var j = 0; j < 5 && !got; j++) {
      got = await chooseCard(/我有物品要修理/);
      if (!got && !await dlgNext(doc)) break;
    }
    if (!got) { await closeDialog(); return 'nothing'; }

    await chooseConfirm();      // 物品列表默认选中第一件
    await dlgNext(doc);         // 费用提示
    if (!await chooseCard(/^继续$/)) await dlgNext(doc);
    await closeDialog();
    return 'ok';
  }

  // 有损坏装备就暂停挂机 → 手册 → 修装备 → 穿上 → 继续挂机
  async function tryRepair(doc) {
    await openEquipWindow(doc);
    var names = brokenNames();
    if (!names.length) return '';
    var fb = farmButton(doc);
    var wasFarming = !!fb && fb.textContent.trim() === '停止挂机';
    if (wasFarming) { tapEl(fb); await sleep(900); }

    var fixed = 0, last = '';
    for (var r = 0; r < 10; r++) {
      if (!brokenNames().length) break;
      var res = await repairOnce(doc);
      if (res === 'ok') { fixed++; await sleep(900); continue; }
      last = res === 'no-handbook' ? '没找到左侧「手册」按钮'
        : res === 'no-option' ? '手册里没找到「装备修理」'
        : res === 'nothing' ? '修理工说没有要修的物品（损坏标记可能过期）'
        : '修理中断';
      break;
    }

    // 修完把装备穿回去（装备窗口若被手册关掉，再打开一次才读得到部位）
    await openEquipWindow(doc);
    var left = await reEquip(doc, names);

    var fb2 = farmButton(doc);
    if (fb2 && fb2.textContent.trim() === '开始挂机') { tapEl(fb2); await sleep(1200); }

    if (!fixed) return last || '没有修成';
    return '修理 ' + fixed + ' 件' + (left.length ? '，这些没穿上：' + left.join('、') : '，已重新穿上') +
      ' · ' + names.join('、');
  }

  function setHuntBtn(on) {
    var b = $('huntbtn');
    if (!b) return;
    b.textContent = on ? '停狩猎' : '狩猎任务';
  }

  async function huntRun() {
    if (HUNT.on) return;
    if (WILD.on || CRAFT.on) {
      setStatus('狩猎任务：先停止野外BOSS / 影装任务再启动');
      return;
    }
    var qd = getGameDoc() || document;
    var qi = railInfo(qd);
    if (qi && qi.idleSec === 0) {
      setStatus('狩猎任务：免费挂机额度已用完（0:00:00），挂机不会产出，0 点重置后再开');
      return;
    }
    HUNT.on = true;
    HUNT.noviceBad = false;
    HUNT.enteredFree = false;
    HUNT.stopMsg = '';
    HUNT.progBase = null;
    HUNT.progCur = -1;
    HUNT.progAt = 0;
    HUNT.stuckN = 0;
    HUNT.stuckKey = '';
    setHuntBtn(true);
    // 自动刷新页面后要能接着跑（正常停止时会清掉）
    try { localStorage.setItem('ro-hunt-autoresume', '1'); } catch (e) {}
    setStatus('狩猎任务：检查任务状态…');
    // 打开统计窗口：挂机中用「任务怪击杀数」估算面板进度
    try { await ensureStatWindow(qd); } catch (e) {}
    // 打开背包窗口：读取「背包 n / 100 种」判断包满
    try { await ensureInvWindow(qd); } catch (e) {}
    HUNT.bagAt = 0;
    while (HUNT.on) {
      try {
        var s = await huntTick();
        if (s) setStatus('狩猎 ' + s);
      } catch (e) { setStatus('狩猎出错：' + (e && e.message ? e.message : e)); }
      await sleep(1700);
    }
    setStatus(HUNT.stopMsg || '狩猎任务已停止');
    HUNT.stopMsg = '';
    try { localStorage.removeItem('ro-hunt-autoresume'); } catch (e) {}
  }

  /* ---------------- 主循环 ---------------- */

  function unidCount() {
    var doc = getGameDoc();
    return doc ? doc.querySelectorAll('.inventory-cell.unidentified').length : 0;
  }

  async function run(limit) {
    if (running) return;
    running = true;
    updateButtons();
    var done = 0;
    var fails = 0;
    var buyTries = 0;

    // 开跑前先把背包里已鉴定的装备扫一遍，补进评分列表
    var imported = await collectIdentified();
    if (imported) setStatus('已补录 ' + imported + ' 件已鉴定装备，开始鉴定…');

    while (running) {
      var left = unidCount();
      setStatus('鉴定中… 已完成 ' + done + ' 件，剩余 ' + left + ' 件');
      try {
        var res = await identifyOne();
        if (!res) {
          setStatus('没有未鉴定装备了，本次共鉴定 ' + done + ' 件');
          break;
        }
        done++;
        fails = 0;
        buyTries = 0;      // 补货成功过就清零，否则长跑时第 3 次补货会被误判成连续失败
        upsertRecord(res);
        saveRecords();
        render();
        if (autoSell) {
          var soldN = await sellRecommended(true);
          if (!soldN && sellCandidates().length) {
            setStatus('自动卖：判定要卖的装备没卖出去，请在店里切到「出售道具」页');
          }
        }
        if (limit && done >= limit) {
          setStatus('已鉴定 ' + done + ' 件（本次上限 ' + limit + ' 件）');
          break;
        }
        await sleep(STEP_GAP);
      } catch (err) {
        if (err && err.code === 'NO_LOUPE') {
          if (buyTries >= 3) { setStatus('连续补货失败 3 次，已停止（寄售和消耗品售卖机都没有放大镜）'); break; }
          buyTries++;
          setStatus('放大镜用完了，自动购买（寄售 → 消耗品售卖机）…');
          var nb = await buyLoupes(Math.min(Math.max(1, unidCount()), 99));
          if (nb > 0) {
            setStatus('已自动补 ' + nb + ' 个放大镜，继续鉴定');
            await sleep(400);
            continue;
          }
          setStatus('放大镜用完了，本次已鉴定 ' + done + ' 件');
          break;
        }
        fails++;
        setStatus('跳过一件：' + (err && err.message ? err.message : err));
        await sleep(500);
        if (fails >= 5) {
          setStatus('连续失败 5 次，已停止。最后一个错误：' + (err && err.message ? err.message : err));
          break;
        }
      }
    }

    running = false;
    sortRecords();
    saveRecords();
    updateButtons();
    render();
  }

  // 把记录按评级排序后落盘，面板和 CSV 顺序一致
  function sortRecords() {
    records.sort(function (a, b) {
      var sa = scoreRecord(a), sb = scoreRecord(b);
      if (sb.smax !== sa.smax) return sb.smax - sa.smax;
      if (sb.s90 !== sa.s90) return sb.s90 - sa.s90;
      if (sb.total !== sa.total) return sb.total - sa.total;
      return (b.ts || 0) - (a.ts || 0);
    });
  }

  function upsertRecord(res) {
    // 物品ID 是模板ID，多件同名装备会重复，不能拿它去重，每件独立记一条
    records.unshift({
      name: res.name,
      itemId: res.itemId,
      series: res.series,
      reqLv: res.reqLv,
      equipFor: res.equipFor,
      options: res.options,
      sig: recordSig(res.name, res.options),
      ts: Date.now(),
      decision: '待定'
    });
  }

  /* ---------------- 自动卖 ---------------- */

  // 待卖清单：判定「建议卖」或你在面板点了「卖出」的装备名
  function sellCandidates() {
    var names = [];
    records.forEach(function (r) {
      if (!r.options || !r.options.length) return;
      if (r.decision === '保留' || r.decision === '已卖' || r.decision === '存仓') return;
      if (r.decision === '卖出' || !keepByScore(scoreRecord(r))) pushName(names, r.name);
    });
    return names;
  }

  function stripPrefix(n) {
    return String(n || '').replace(/^\[[^\]]*\]\s*/, '');
  }

  // 名字归一化：去掉「[收藏]」「[S]」这类前缀和所有空白，用于精确比对
  // 不能直接做子串匹配：卖「短剑」时会把「精炼短剑」一起卖掉
  function nameKey(n) {
    var s = String(n || '');
    for (var i = 0; i < 4; i++) {
      var t = s.replace(/^\s*\[[^\]]*\]\s*/, '');
      if (t === s) break;
      s = t;
    }
    return s.replace(/\s+/g, '').trim();
  }
  function pushName(list, n) {
    var k = nameKey(n);
    if (!k) return;
    for (var i = 0; i < list.length; i++) {
      if (nameKey(list[i]) === k) return;
    }
    list.push(n);
  }

  function rowName(row) {
    var b = row.querySelector('.npc-shop-item-detail b');
    return (b && (b.getAttribute('title') || b.textContent) || '').trim();
  }
  // 商店行与目标名是否同一件：归一化后相等，或只差一个短 ASCII 前缀（等级标记 S/A、T1 之类）
  // 「精炼短剑」不会被当成「短剑」：中文前缀不放行
  function sameItem(rowN, target) {
    var a = nameKey(rowN), b = nameKey(target);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.indexOf(b) === 0) return true;
    var i = a.indexOf(b);
    return i > 0 && i <= 3 && /^[A-Za-z0-9+\-]+$/.test(a.slice(0, i));
  }

  // 商店对话当前停在哪一页：shop=购买/出售菜单，shop_buy=购买道具，shop_sell=出售道具
  function shopAction(doc) {
    var c = doc.querySelector('.npc-dialog-card[data-action]');
    return c ? (c.getAttribute('data-action') || '') : '';
  }
  function shopBtnByText(doc, text) {
    return Array.prototype.slice.call(doc.querySelectorAll('.npc-dialog-card button'))
      .filter(function (b) { return b.textContent.trim() === text && !b.disabled; })[0] || null;
  }
  // 从「商店」菜单自动点进「出售道具」页
  async function ensureSellPage(doc) {
    if (shopAction(doc) === 'shop_sell') return true;
    if (shopAction(doc) === 'shop') {
      var b = shopBtnByText(doc, '出售道具');
      if (!b) return false;
      b.click();
      return !!(await waitFor(function () { return shopAction(doc) === 'shop_sell'; }, 2500, 100));
    }
    return false;
  }
  // 打开商店的某一页（购买道具 / 出售道具）：没对话就先找 NPC，停在菜单就点对应按钮
  async function openShopPage(doc, page) {
    var want = page === '出售道具' ? 'shop_sell' : 'shop_buy';
    if (shopAction(doc) === want) return true;
    if (!qSel('.npc-dialog-card')) {
      // NPC 列表里点一下就是远程对话，不用走到旁边；走不到才小步靠近。
      // （以前无条件先走过去，散场再走回来，看起来就是在 NPC 旁边左右晃）
      if (!(await casOpenNpc(doc, '消耗品售卖机', SHOP_NPC))) {
        await casStepTo(doc, SHOP_NPC.x, SHOP_NPC.y);
        if (!(await casOpenNpc(doc, '消耗品售卖机', SHOP_NPC))) return false;
      }
      await sleep(600);
    }
    if (shopAction(doc) === 'shop') {
      var b = shopBtnByText(doc, page);
      if (!b) return false;
      b.click();
      return !!(await waitFor(function () { return shopAction(doc) === want; }, 2500, 100));
    }
    return shopAction(doc) === want;
  }
  // 优先点「结束交易」，实在没有就回到走开散场
  async function closeShop(doc) {
    if (!qSel('.npc-dialog-card')) return true;
    if (await closeDialog()) return true;
    await dismissNpcDialog(doc);
    return !qSel('.npc-dialog-card');
  }

  // 出售页里还有库存的同名行（同一件：归一化后相等，或行名以目标名开头，如「短剑[4]」）
  function rowsWithStock(doc, name) {
    return Array.prototype.slice.call(doc.querySelectorAll('.npc-shop-list .shop-sell-row'))
      .filter(function (row) {
        if (!sameItem(rowName(row), name)) return false;
        var b = row.querySelector('.shop-sell-all');
        return !!(b && !b.disabled);
      });
  }

  // 在 NPC 商店的「出售道具」列表里按名称匹配，先批量勾选一次卖掉，剩下的再逐行补卖
  async function sellRecommended(quiet, onlyNames) {
    var doc = getGameDoc();
    if (!doc) { setStatus('找不到游戏页面'); return 0; }
    var act = shopAction(doc);
    if (!(await ensureSellPage(doc))) {
      if (!quiet) setStatus(act === 'shop_buy'
        ? '现在停在「购买道具」页，没有出售入口：请点「结束交易」后重新和 NPC 说话，选「出售道具」'
        : '请先找 NPC 打开「商店 → 出售道具」，再点这里');
      else if (!sellHinted) { sellHinted = true; setStatus('自动卖：需要先打开商店的「出售道具」页'); }
      return 0;
    }
    sellHinted = false;
    var names = (onlyNames && onlyNames.length) ? onlyNames : sellCandidates();
    var uniq = [];
    names.forEach(function (n) { pushName(uniq, n); });
    names = uniq;
    if (!names.length) {
      if (!quiet) setStatus('没有需要卖的装备');
      return 0;
    }

    // 同名装备里只要有一件要留，就整名跳过：出售页是按名字整叠卖，卖了就找不回来
    var prot = {};
    if (!onlyNames) {
      records.forEach(function (r) {
        if (!r.name) return;
        var k = nameKey(r.name);
        if (r.decision === '保留') prot[k] = '已标记保留';
        else if ((!r.decision || r.decision === '待定') && r.options && r.options.length
          && keepByScore(scoreRecord(r))) prot[k] = '同名里有建议留的词条';
      });
    }

    // 搜索框可能有残留关键字、页签可能停在其他分类，先把它们复位，否则列表里看不到全部道具
    var listEl = doc.querySelector('.npc-shop-list');
    var shopWin = (listEl && listEl.closest('.game-floating-window')) || doc;
    var search = shopWin.querySelector('input.storage-search');
    if (search && (search.value || '').trim()) {
      setVal(search, '');
      await sleep(350);
    }
    var tabAll = Array.prototype.slice.call(shopWin.querySelectorAll('.storage-tabs button'))
      .filter(function (b) { return b.textContent.trim() === '全部'; })[0];
    if (tabAll && !tabAll.classList.contains('active')) {
      tabAll.click();
      await sleep(450);
    }

    var soldNames = {};
    var skipped = [];

    // 第一步：把要卖的行全部勾上，用底部「出售所选」一次性卖（一次服务端请求，比逐行点快也更稳）
    var wanted = names.filter(function (n) { return !prot[nameKey(n)]; });
    var picked = [];
    wanted.forEach(function (n) {
      rowsWithStock(doc, n).forEach(function (row) {
        var cb = row.querySelector('input.shop-select');
        if (!cb || cb.disabled) return;
        if (!cb.checked) cb.click();
        if (picked.indexOf(n) < 0) picked.push(n);
      });
    });
    if (picked.length) {
      setStatus('批量出售 ' + picked.length + ' 种…');
      // 勾选后 React 状态更新有一帧延迟，等「出售所选」真正可用再点
      var payBtn = await waitFor(function () { return shopBtnByText(doc, '出售所选'); }, 1500, 100);
      if (payBtn) {
        payBtn.click();
        var okBtn = await waitFor(function () {
          return doc.querySelector('.app-dialog .app-dialog-confirm')
            || doc.querySelector('.app-dialog-confirm');
        }, 2500, 120);
        if (okBtn) okBtn.click();
        // 等这批行卖空（数量归零/行消失）
        await waitFor(function () {
          return picked.every(function (n) { return rowsWithStock(doc, n).length === 0; });
        }, 4500, 200);
      }
      picked.forEach(function (n) {
        if (!rowsWithStock(doc, n).length) soldNames[n] = 1;
      });
    }

    // 第二步：批量没卖掉的再逐行点「全部」补卖
    var guard = 0;
    for (var ni = 0; ni < wanted.length; ni++) {
      var name = wanted[ni];
      if (soldNames[name]) continue;
      if (!rowsWithStock(doc, name).length) { skipped.push(name + '（出售页里没有，可能在身上）'); continue; }
      var fails = 0;
      while (guard++ < 200) {
        var tgt = rowsWithStock(doc, name)[0];
        if (!tgt) break;                        // 这个名字已经卖完
        var before = tgt.textContent;
        tgt.querySelector('.shop-sell-all').click();
        var cur = tgt;
        // 出售要走一次服务端往返，慢的时候 520ms 不够，等到这一行数量变化/消失为止
        var okSale = await waitFor(function () {
          return !cur.isConnected || cur.textContent !== before;
        }, 2500, 120);
        if (!okSale) {
          fails++;
          if (fails >= 3) { skipped.push(name + '（点了没反应）'); break; }
          await sleep(400);
          continue;
        }
        soldNames[name] = 1;
        setStatus('卖出中… 已卖 ' + Object.keys(soldNames).length + ' 种');
        await sleep(250);
      }
    }
    names.forEach(function (n) {
      var k = nameKey(n);
      if (prot[k]) skipped.push(n + '（' + prot[k] + '）');
    });

    var sold = Object.keys(soldNames).length;
    if (sold) {
      records = records.filter(function (r) { return !soldNames[r.name]; });
      saveRecords();
      render();
      updateSelUi();
      setStatus('已卖出 ' + sold + ' 种装备，记录已移除'
        + (skipped.length ? '；跳过 ' + skipped.length + ' 个：' + skipped.join('、') : ''));
    } else if (!quiet) {
      setStatus(skipped.length
        ? '没有卖出：' + skipped.join('、')
        : '出售面板里没找到待卖的装备（可能已卖过，或名称对不上）');
    } else if (skipped.length) {
      setStatus('自动卖跳过：' + skipped.join('、'));
    }
    return sold;
  }

  // 回城顺手卖「没用装备」：只卖鉴定后判定为「建议卖」的装备。
  // 需要商店已经进到「出售道具」页（菜单页会自动点进去）。
  async function huntSellJunk(doc) {
    if (!sellCandidates().length) return '';
    if (!qSel('.npc-shop-list .shop-sell-row') && shopAction(doc) !== 'shop') return '';
    var sold = await sellRecommended(true);
    if (qSel('.npc-dialog-card')) await closeDialog();
    return sold ? '已卖 ' + sold + ' 种' : '';
  }

  // 背包占用（种 / 上限）：读背包窗口里的「背包 13 / 100 种」
  function bagUsage(doc) {
    var win = (doc || document).querySelector('.window-inventory');
    if (!win) return null;
    var m = (win.textContent || '').match(/背包\s*(\d+)\s*\/\s*(\d+)\s*种/);
    return m ? { used: parseInt(m[1], 10), cap: parseInt(m[2], 10) } : null;
  }

  // 在主城开商店「出售道具」页，把判定要卖的装备卖掉并关窗
  async function huntSellGear(doc) {
    if (!sellCandidates().length) return 0;
    if (qSel('.npc-dialog-card') && !/^shop/.test(shopAction(doc))) {
      await closeDialog();
      await sleep(300);
    }
    if (!(await openShopPage(doc, '出售道具'))) {
      await closeShop(doc);
      await sleep(400);
      if (!(await openShopPage(doc, '出售道具'))) return 0;
    }
    var n = await sellRecommended(true);
    await closeShop(doc);
    return n;
  }

  // 背包满：鉴定未鉴定装备、卖掉要卖的；没放大镜又没钱时先卖装备换钱，再继续鉴定
  async function huntBagRoutine(doc) {
    var done = 0, sold = 0, noMoney = false, loupeFail = false, fails = 0;
    // 先清掉残留的商店/NPC 窗口，避免挡住鉴定界面
    if (qSel('.npc-shop-list')) { await closeShop(doc); await sleep(300); }
    else if (qSel('.npc-dialog-card')) { await closeDialog(); await sleep(300); }
    // 未鉴定格子只存在于「装备」页签：背包停在消耗品/其他页时 unidCount() 恒为 0，
    // 会误判成「没有未鉴定装备」而一件都不鉴定，所以先切到装备页签
    await ensureInventoryEquipTab(doc);
    await sleep(250);
    for (var guard = 0; guard < 200; guard++) {
      if (unidCount() <= 0) break;
      try {
        var res = await identifyOne();
        if (!res) break;
        done++;
        fails = 0;
        upsertRecord(res);
        saveRecords();
        render();
      } catch (e) {
        if (e && e.code === 'NO_LOUPE') {
          var z = (railInfo(doc) || {}).zeny || 0;
          // 没钱买放大镜：先卖一批装备换钱，再回来继续鉴定
          if (z < LOUPE_PRICE_MAX) {
            sold += await huntSellGear(doc);
            z = (railInfo(doc) || {}).zeny || 0;
          }
          if (z < LOUPE_PRICE_MAX) { noMoney = true; break; }
          var nb = await buyLoupes(Math.min(Math.max(1, unidCount()), 30));
          if (nb <= 0) { loupeFail = true; break; }
          continue;
        }
        fails++;
        if (fails >= 5) break;
        await sleep(400);
      }
    }
    // 鉴定完再卖一轮，尽量把背包腾出来
    sold += await huntSellGear(doc);
    // 卖完剩下的、判定保留但没穿的装备存公会仓库，避免背包长期卡满
    var stash = await huntStashLoot(doc);
    if (stash < 0) stash = 0;
    var bu = bagUsage(doc);
    // 腾不出空间就别每 20 秒重来一次（等 5 分钟再试）
    if (bu && bu.used >= bu.cap) {
      HUNT.bagAt = Date.now() + 300000;
      // 连续 3 轮一件都没鉴定、一件都没卖、一件都没存：说明附近没有商店/仓库/放大镜，停掉避免无限刷状态
      if (done === 0 && sold === 0 && stash === 0) {
        HUNT.bagNoop = (HUNT.bagNoop || 0) + 1;
        if (HUNT.bagNoop >= 3) {
          HUNT.on = false;
          setHuntBtn(false);
          HUNT.stopMsg = '背包 ' + bu.used + '/' + bu.cap + ' 已满，鉴定 0 件、卖 0 种、存 0 种：附近没有商店/仓库/放大镜，已停止狩猎';
          try { localStorage.removeItem('ro-hunt-autoresume'); } catch (e) {}
        }
      } else {
        HUNT.bagNoop = 0;
      }
    } else {
      HUNT.bagNoop = 0;
    }
    return '鉴定 ' + done + ' 件、卖 ' + sold + ' 种'
      + (stash ? '、存仓 ' + stash + ' 种' : '')
      + (noMoney ? '；没钱买放大镜（ZENY ' + ((railInfo(doc) || {}).zeny || 0) + '）' : '')
      + (loupeFail ? '；补不到放大镜（寄售没挂单，消耗品售卖机也没买到）' : '')
      + (bu ? '；背包 ' + bu.used + '/' + bu.cap : '');
  }

  /* ---------------- 公会仓库：批量存 S 装 / 取本职业 S 装 ---------------- */

  // 当前角色属于哪个职业方向（骑士/猎人/法师/刺客），读左栏「名字+职业」
  function myJobBucket(doc) {
    var s = railSnapshot(doc || document);
    var t = s ? String(s.name || '') : '';
    var b = JOB_BUCKET.filter(function (x) { return x.re.test(t); })[0];
    return b ? b.p : '';
  }

  // 打开仓库：优先「公会仓库」；公会仓库没开通/没权限时退回「个人仓库」（一样能清负重）
  function dialogButtons(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll('.npc-dialog-card button, .npc-choice-card button'));
  }

  async function openStorageWindow(doc) {
    if (qSel('.storage-card')) return true;
    if (qSel('.npc-dialog-card')) {
      var hasRepo = dialogButtons(doc).some(function (x) {
        return /仓库/.test(x.textContent) && !x.disabled;
      });
      if (!hasRepo) { await closeDialog(); await sleep(400); }
    }
    var wants = [/公会仓库/, /个人仓库/];
    for (var w = 0; w < wants.length; w++) {
      // 上一次尝试失败后服务端会把对话关掉，这里重新点仓库 NPC
      for (var reopen = 0; reopen < 3 && !qSel('.npc-dialog-card'); reopen++) {
        var kws = ['仓库服务', '公会仓库', '仓库'];
        for (var k = 0; k < kws.length && !qSel('.npc-dialog-card'); k++) {
          await casOpenNpc(doc, kws[k], null, { nameOnly: true });
          await sleep(500);
        }
      }
      if (!qSel('.npc-dialog-card')) continue;
      // 选项列表比对话晚到，先等一会儿
      for (var wait = 0; wait < 8 && !dialogButtons(doc).length; wait++) await sleep(250);
      var b = dialogButtons(doc).filter(function (x) { return wants[w].test(x.textContent) && !x.disabled; })[0];
      if (!b) {
        if (qSel('.npc-dialog-card')) { await closeDialog(); await sleep(300); }
        continue;
      }
      b.click();
      await sleep(600);
      // 选完选项后按钮会重渲染，必须重新查「确认」，不能复用旧节点
      var okb = dialogButtons(doc).filter(function (x) {
        return /^(确认|确定)$/.test(x.textContent.trim()) && !x.disabled;
      })[0];
      if (okb) okb.click();
      // 公会仓库失败时服务端静默关对话、不返回仓库；个人仓库同理，都要轮询着看
      if (await waitFor(function () { return qSel('.storage-card'); }, 6000, 200)) return true;
      if (qSel('.npc-dialog-card')) { await closeDialog(); await sleep(300); }
    }
    return false;
  }

  async function closeStorageWindow(doc) {
    var b = Array.prototype.slice.call(doc.querySelectorAll('.storage-card button')).filter(function (x) {
      return x.textContent.trim() === '关闭' && !x.disabled;
    })[0];
    if (b) b.click();
    else doc.querySelectorAll('.storage-card') && doc.querySelector('.storage-card').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(400);
    return !qSel('.storage-card');
  }

  // 仓库窗口两列：左=背包，右=仓库
  function storageCols(doc) {
    var secs = Array.prototype.slice.call(doc.querySelectorAll('.storage-card .storage-columns section'));
    return { bag: secs[0] || null, box: secs[1] || null };
  }
  // 最近一次存/取时的诊断信息，失败时用来告诉用户到底卡在哪
  var storageDiag = { rows: 0, tabs: 0 };

  // 行名：真实结构是 <span><b>[收藏] [T1]名字[4][5词条]</b><small>持有 12</small></span>
  // 直接读 b 的文本，未鉴定图标等兜底才用 .item-icon
  function storageRowName(row) {
    var b = row.querySelector('span b') || row.querySelector('b');
    var t = b ? (b.getAttribute('title') || b.textContent || '') : '';
    if (!t.trim()) {
      var ic = row.querySelector('.item-icon');
      t = ic ? (ic.getAttribute('title') || '') : '';
    }
    t = String(t).split('\n')[0].replace(/\s+/g, ' ').trim();
    return t.replace(/\[收藏\]\s*/g, '').trim();
  }

  // 名字比对：优先归一化后完全相等，退化成 sameItem（允许短 ASCII 前缀）
  function storageMatch(names, nm) {
    var k = nameKey(nm);
    if (!k) return '';
    var i;
    for (i = 0; i < names.length; i++) {
      if (nameKey(names[i]) === k) return names[i];
    }
    for (i = 0; i < names.length; i++) {
      if (sameItem(nm, names[i])) return names[i];
    }
    return '';
  }

  async function storagePickTab(sec, label) {
    var b = Array.prototype.slice.call(sec.querySelectorAll('.storage-tabs button')).filter(function (x) {
      return x.textContent.trim() === label && !x.disabled;
    })[0];
    if (!b) return false;
    if (!b.classList.contains('active')) { b.click(); await sleep(500); }
    return true;
  }

  // 仓库左右两栏都要先切页签（装备/消耗品/其他/卡片），否则只能看到当前分类
  // side: bag=背包（存） box=仓库（取）；优先点「全部」，没有就点单个「存入/取出」
  async function storageTransfer(doc, side, names, btnRe) {
    var done = [];
    storageDiag = { rows: 0, tabs: 0 };
    var tabs = ['装备', '消耗品', '其他', '卡片'];
    for (var t = 0; t < tabs.length; t++) {
      var sec = storageCols(doc)[side];
      if (!sec) break;
      if (!(await storagePickTab(sec, tabs[t]))) continue;
      storageDiag.tabs++;
      for (var guard = 0; guard < 60; guard++) {
        var cur = storageCols(doc)[side];
        if (!cur) break;
        var rows = Array.prototype.slice.call(cur.querySelectorAll('.storage-transfer-list > div'));
        if (rows.length > storageDiag.rows) storageDiag.rows = rows.length;
        var hit = null, hitName = '';
        for (var i = 0; i < rows.length; i++) {
          var nm = storageRowName(rows[i]);
          if (!nm) continue;
          var k = storageMatch(names, nm);
          if (!k) continue;
          // 「全部」按钮点下去就是一次存档请求（数量=该行全部），不需要再点「存入」
          var btn = rows[i].querySelector('button.storage-all')
            || Array.prototype.slice.call(rows[i].querySelectorAll('button')).filter(function (b) {
              return btnRe.test(b.textContent.trim());
            })[0];
          if (!btn || btn.disabled) continue;
          hit = btn; hitName = k;
          break;
        }
        if (!hit) break;
        hit.click();
        await sleep(700);
        if (done.indexOf(hitName) < 0) done.push(hitName);
      }
    }
    return done;
  }

  // 把背包里匹配名字的行「全部」存入仓库，返回实际存入的名字
  async function depositNames(doc, names) {
    return storageTransfer(doc, 'bag', names, /^存入$/);
  }

  // 从仓库把匹配名字的行「全部」取出到背包，返回实际取出的名字
  async function withdrawNames(doc, names) {
    return storageTransfer(doc, 'box', names, /^取出$/);
  }

  // 背包里按名字双击穿上（装备页签）
  async function equipNames(doc, names) {
    var worn = 0;
    await ensureInvWindow(doc);
    await invTab(doc, '装备');
    for (var i = 0; i < names.length; i++) {
      var nm = names[i];
      var cell = qAll('.inventory-cell').filter(function (c) { return invItemName(c).indexOf(nm) >= 0; })[0];
      if (!cell) continue;
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2, view: doc.defaultView || window }));
      await sleep(800);
      worn++;
    }
    return worn;
  }

  // 评级 S 的鉴定记录（只算确实在记录里的，避免误伤）
  function sRecords() {
    return records.filter(function (r) {
      try { return r && r.name && scoreRecord(r).grade === 'S'; } catch (e) { return false; }
    });
  }

  // 背包「其他」页签里的材料（未鉴定装备除外）
  async function bagMaterialNames(doc) {
    await ensureInvWindow(doc);
    await invTab(doc, '其他');
    var names = [];
    qAll('.inventory-cell').forEach(function (c) {
      var t = invItemName(c);
      if (!t || /未鉴定/.test(t)) return;
      if (names.indexOf(t) < 0) names.push(t);
    });
    await invTab(doc, '消耗品');   // 切回来，避免影响补药的药水计数
    return names;
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  // 存仓保留名单：留在背包里（翅膀跑图、双补药练级、放大镜鉴定）
  var STASH_KEEP = ['双补药', '蝴蝶翅膀', '苍蝇翅膀', '放大镜'];
  function stashKeepName(nm) {
    for (var i = 0; i < STASH_KEEP.length; i++) {
      if (nm.indexOf(STASH_KEEP[i]) >= 0) return true;
    }
    return false;
  }

  // 鉴定过、判定「建议留」且还没存仓的装备名
  function keepGearNames() {
    var names = [];
    records.forEach(function (r) {
      if (!r || !r.name || r.stored) return;
      if (/^(已卖|卖出|保留|已上架|存仓)$/.test(r.decision || '')) return;
      if (!r.options || !r.options.length) return;
      var t = '';
      try { t = advise(scoreRecord(r)).t; } catch (e) { return; }
      if (t !== '建议留') return;                        // 建议卖的已在 huntSellGear 处理
      if (isWornWeapon(r.name)) return;                  // 正在穿/上次穿在手上的武器、盾不能存
      if (names.indexOf(r.name) < 0) names.push(r.name);
    });
    return names;
  }

  // 背包里的战利品：除「装备 / 收藏」外的所有分类（消耗品、其他、卡片、材料…）全部收集，
  // 只跳过保留名单（翅膀、双补药、放大镜）和未鉴定装备。铝这类重材料就在「其他」里
  async function bagLootNames(doc) {
    var out = [];
    await ensureInvWindow(doc);
    var labels = qAll('.inventory-tabs button').map(function (b) { return b.textContent.trim(); })
      .filter(function (l) { return l && l !== '装备' && l !== '收藏' && l !== '全部'; });
    if (!labels.length) labels = ['消耗品', '其他', '卡片'];
    for (var i = 0; i < labels.length; i++) {
      await ensureInvWindow(doc);
      if (!(await invTab(doc, labels[i]))) continue;
      qAll('.inventory-cell').forEach(function (c) {
        var nm = invItemName(c);
        if (!nm || /未鉴定/.test(nm) || stashKeepName(nm)) return;
        if (out.indexOf(nm) < 0) out.push(nm);
      });
    }
    await invTab(doc, '装备');
    return out;
  }

  // 狩猎回城卖完装备后：装备先筛选（建议留的），连同其余战利品一起存进公会仓库
  async function huntStashLoot(doc) {
    var names = keepGearNames();
    var loot = await bagLootNames(doc);
    loot.forEach(function (nm) { if (names.indexOf(nm) < 0) names.push(nm); });
    if (!names.length) return 0;
    if (!(await openStorageWindow(doc))) return -1;      // 找不到（公会）仓库 NPC
    var put = await depositNames(doc, names);
    if (put.length) {
      records.forEach(function (r) {
        if (!r.stored && put.indexOf(r.name) >= 0) { r.stored = 1; r.decision = '存仓'; }
      });
      saveRecords(); render();
    }
    await closeStorageWindow(doc);
    if (qSel('.npc-dialog-card')) await closeDialog();
    return put.length;
  }

  // 背包（装备页）里按道具详情的「系列」找一把武器（只在完全没有武器记录时用，逐件点开详情）
  async function findWeaponInBag(doc) {
    await ensureInvWindow(doc);
    await invTab(doc, '装备');
    var weapons = /武器|短剑|长剑|双手剑|剑|匕首|拳刃|斧|钝器|锤|矛|枪|弓|拳套|乐器|琴|鞭|书|杖|镰|风魔|手里剑|榴弹|刀/;
    var cells = qAll('.inventory-cell').filter(function (c) {
      return !c.classList.contains('unidentified') && invItemName(c);
    });
    for (var i = 0; i < cells.length && i < 15; i++) {
      var nm = invItemName(cells[i]);
      var ic = cells[i].querySelector('.item-icon');
      if (!ic || !nm) continue;
      ic.click();
      var det = await waitDetail(doc, nm);
      if (!det) continue;
      var ser = '';
      try { ser = parseDetail(det).series || ''; } catch (e) {}
      closeDetail(det);
      await sleep(120);
      if (ser && weapons.test(ser)) return nm;
    }
    return '';
  }

  // 出门前确认右手有武器：被卸下还没穿回时，从背包/公会仓库找回来；实在没有就停狩猎，别空手出门
  async function ensureWeapon(doc) {
    if (!qSel('.equipment-slot')) return '';
    var cur = wornSlotName('右手');
    if (cur === null || cur) return '';
    if (Date.now() - (HUNT.weaponAt || 0) < 12000) return '正在补武器…';
    HUNT.weaponAt = Date.now();

    var want = wornSnap['右手'] || '';
    await ensureInvWindow(doc);
    await invTab(doc, '装备');
    if (want && await wearFromBag(want) && wornSlotName('右手')) {
      return '右手空着，已把「' + want + '」穿回';
    }
    // 连上次穿的名字都没有（刷新过页面）：按「系列」在背包里找一把武器
    var found = want ? '' : await findWeaponInBag(doc);
    if (found) {
      await invTab(doc, '装备');
      await wearFromBag(found);
      if (wornSlotName('右手')) {
        wornSnap['右手'] = found;
        return '右手空着，已从背包穿上武器「' + found + '」';
      }
    }
    // 背包里没有：试着从公会仓库取回上次那把
    if (want && await openStorageWindow(doc)) {
      var got = await withdrawNames(doc, [want]);
      await closeStorageWindow(doc);
      if (qSel('.npc-dialog-card')) await closeDialog();
      if (got.length) {
        await invTab(doc, '装备');
        if (await wearFromBag(want) && wornSlotName('右手')) {
          return '右手空着，已从仓库取回「' + want + '」穿上';
        }
      }
    }
    HUNT.on = false;
    setHuntBtn(false);
    HUNT.stopMsg = '右手没有武器（背包/公会仓库也找不到' + (want ? '「' + want + '」' : '上次的武器')
      + '），已停止狩猎：请先手动装备武器再点「狩猎任务」';
    try { localStorage.removeItem('ro-hunt-autoresume'); } catch (e) {}
    return HUNT.stopMsg;
  }

  // 小号交完狩猎任务后：每天一次，把材料 + 评级 S 装备全存公会仓库
  async function subDailyStash(doc) {
    var s = railSnapshot(doc);
    var who = (s && s.name) ? s.name : 'me';
    var KEY = 'ro-auto-identify-sub-stash-v1';
    var map = {};
    try { map = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { map = {}; }
    if (map[who] === todayStr()) return '';

    var names = [];
    sRecords().forEach(function (r) { if (names.indexOf(r.name) < 0) names.push(r.name); });
    var mats = await bagMaterialNames(doc);
    mats.forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });

    if (!names.length) {
      map[who] = todayStr();
      try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (e) {}
      return '背包没有材料 / S 装备可存';
    }
    if (!(await openStorageWindow(doc))) return '找不到公会仓库 NPC';

    var put = await depositNames(doc, names);
    if (put.length) {
      records.forEach(function (r) { if (put.indexOf(r.name) >= 0) r.stored = 1; });
      saveRecords(); render();
    }
    await closeStorageWindow(doc);
    if (qSel('.npc-dialog-card')) await closeDialog();

    map[who] = todayStr();
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (e) {}
    return '存了 ' + put.length + ' 种（材料 + S 装备）';
  }

  // 面板「存仓库」：把所有评级 S 的记录存进公会仓库
  async function stashBatch() {
    var doc = getGameDoc() || document;
    var names = [];
    sRecords().forEach(function (r) { if (names.indexOf(r.name) < 0) names.push(r.name); });
    // 小号：材料也一起存
    if (isSubAccount) {
      var mats = await bagMaterialNames(doc);
      mats.forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    }
    if (!names.length) { setStatus('没有评级 S 的装备 / 材料可存'); return 0; }
    if (!(await openStorageWindow(doc))) {
      setStatus('没找到公会仓库：请先在主城和「公会仓库」NPC 对话，或手动打开仓库再点这里');
      return 0;
    }
    var put = await depositNames(doc, names);
    if (put.length) {
      records.forEach(function (r) { if (put.indexOf(r.name) >= 0) r.stored = 1; });
      saveRecords(); render();
    }
    await closeStorageWindow(doc);
    setStatus(put.length
      ? '已存入 ' + put.length + ' 种（S 装备' + (isSubAccount ? ' + 材料' : '') + '）到公会仓库'
      : '背包里没有可存的东西（可能已经存过）');
    return put.length;
  }

  // 面板「存仓勾选」：把表格里勾选的装备存进公会仓库
  async function stashSelected() {
    var doc = getGameDoc() || document;
    var names = [];
    records.forEach(function (r) {
      if (!selected[recKey(r)] || !r.name) return;
      if (names.indexOf(r.name) < 0) names.push(r.name);
    });
    if (!names.length) { setStatus('先在表格里勾选要存仓的装备'); return 0; }
    if (!(await openStorageWindow(doc))) {
      setStatus('没找到公会仓库：请先和「仓库服务 / 公会仓库」NPC 对话，或手动打开仓库再点这里');
      return 0;
    }
    var put = await depositNames(doc, names);
    if (put.length) {
      records.forEach(function (r) {
        if (put.indexOf(r.name) >= 0) { r.stored = 1; selected[recKey(r)] = 0; }
      });
      saveRecords(); render();
    }
    await closeStorageWindow(doc);
    setStatus(put.length
      ? '已存入 ' + put.length + ' 种到公会仓库'
      : '没存进去：勾选 ' + names.length + ' 种，仓库里看到 ' + storageDiag.rows + ' 行 / ' + storageDiag.tabs + ' 个分类页签'
        + (storageDiag.rows ? '（名称对不上，可能背包里已没有）' : '（背包栏是空的或页签没切过去）'));
    return put.length;
  }

  // 狩猎回城时：存装备（S + 建议留）和全部战利品 → 取仓库里本职业对口的 S 装 → 双击穿上（每件只穿一次）
  async function huntStashAndEquip(doc) {
    var job = myJobBucket(doc);
    var sRecs = sRecords();
    var pending = [];
    sRecs.forEach(function (r) {
      if (r.stored || isWornWeapon(r.name)) return;      // 手上/备用的武器、盾不存
      if (pending.indexOf(r.name) < 0) pending.push(r.name);
    });
    // 非 S 但判定「建议留」的装备也要存；消耗品/其他/卡片除保留名单外全存
    keepGearNames().forEach(function (n) { if (pending.indexOf(n) < 0) pending.push(n); });
    var loot = await bagLootNames(doc);
    var all = pending.slice();
    loot.forEach(function (n) { if (all.indexOf(n) < 0) all.push(n); });
    if (!all.length) return '';

    if (!(await openStorageWindow(doc))) return '找不到公会仓库 NPC（跳过存装）';
    var out = [];
    var put = await depositNames(doc, all);
    if (put.length) {
      records.forEach(function (r) { if (!r.stored && put.indexOf(r.name) >= 0) r.stored = 1; });
      saveRecords(); render();
      var gearN = put.filter(function (n) { return pending.indexOf(n) >= 0; }).length;
      if (gearN) out.push('存入 ' + gearN + ' 种装备');
      if (put.length > gearN) out.push('存入 ' + (put.length - gearN) + ' 种战利品');
    }

    var EQ_KEY = 'ro-auto-identify-s-equipped-v1';
    var eqMap = {};
    try { eqMap = JSON.parse(localStorage.getItem(EQ_KEY) || '{}') || {}; } catch (e) { eqMap = {}; }
    var take = [];
    if (job) {
      sRecs.forEach(function (r) {
        if (!r.stored || eqMap[r.name] || !r.name || take.indexOf(r.name) >= 0) return;
        var sc = scoreRecord(r);
        if (sc.suit === job) take.push(r.name);
      });
    }
    if (take.length) {
      var got = await withdrawNames(doc, take);
      if (qSel('.storage-card')) await closeStorageWindow(doc);
      if (got.length) {
        var worn = await equipNames(doc, got);
        got.forEach(function (n) { eqMap[n] = 1; });
        try { localStorage.setItem(EQ_KEY, JSON.stringify(eqMap)); } catch (e) {}
        out.push('取出并穿上 ' + worn + '/' + got.length + ' 件' + job + ' S 装备');
      }
    } else if (qSel('.storage-card')) {
      await closeStorageWindow(doc);
    }
    if (qSel('.storage-card')) await closeStorageWindow(doc);
    if (qSel('.npc-dialog-card')) await closeDialog();
    return out.join('，');
  }

  // 只卖表格里被勾选的装备
  async function sellSelected() {
    var names = [];
    records.forEach(function (r) {
      if (!selected[recKey(r)]) return;
      if (r.name && names.indexOf(r.name) < 0) names.push(r.name);
    });
    if (!names.length) { setStatus('先在表格里勾选要卖的装备'); return 0; }
    // 商店按名称整名出售，同名的高评级件也会一起卖掉，卖前确认一次
    var ok = true;
    try {
      ok = window.confirm('将按名称卖出 ' + names.length + ' 种装备：' + names.join('、')
        + '\n\n注意：同名装备会整名出售，同名的达标件也会一起卖掉。确定继续？');
    } catch (e) {}
    if (!ok) { setStatus('已取消卖出'); return 0; }
    setStatus('批量卖出选中：' + names.length + ' 种装备');
    return await sellRecommended(false, names);
  }

  // 自动勾选总分低于阈值的装备，只勾选不直接卖；之后用「批量卖出选中」或「存仓勾选」
  function selectBelowA() {
    // 商店按「装备名」整名出售，同名里只要有一件达到阈值，整名都不能勾
    var byName = {}, unid = 0;
    records.forEach(function (r) {
      if (!r.name) return;
      if (!r.options || !r.options.length) { unid++; return; }
      var k = nameKey(r.name);
      var e = byName[k] || (byName[k] = { keep: false });
      if (keepByScore(scoreRecord(r))) e.keep = true;
    });

    selected = {};
    var n = 0, keepN = 0;
    records.forEach(function (r) {
      if (!r.name || r.decision === '已卖') return;
      if (!r.options || !r.options.length) return;
      var e = byName[nameKey(r.name)];
      if (e && e.keep) { keepN++; return; }
      selected[recKey(r)] = 1;
      n++;
    });
    render();
    var need = Math.round(KEEP_RATIO * 100);
    setStatus(n
      ? '已勾选总分 < ' + need + '% 的 ' + n + ' 件，可用「批量卖出选中」卖出，或「存仓勾选」存起来'
        + (keepN ? '；同名里有达标的 ' + keepN + ' 件已整名保留' : '')
        + (unid ? '；跳过未鉴定 ' + unid + ' 件' : '')
      : '没有可勾选的装备（都达到 ' + need + '% 或未鉴定）'
        + (keepN ? '（' + keepN + ' 件因同名有达标件而保留）' : ''));
  }

  // 按总分批量卖：kind='s' 保留 ≥90%，kind='sminus' 保留 ≥80%
  // 同名装备按整名出售，所以只要同名里有一件达标就整名留下；「已标记保留」的也不卖
  async function sellBelow(kind) {
    var need = kind === 's' ? 0.9 : 0.8;
    var byKey = {};
    var unid = 0;
    records.forEach(function (r) {
      if (!r.name || r.decision === '已卖') return;
      if (!r.options || !r.options.length) { unid++; return; }
      var sc = scoreRecord(r);
      var k = nameKey(r.name);
      var e = byKey[k] || (byKey[k] = { name: r.name, keep: false, mark: false });
      if (sc.max > 0 && sc.ratio >= need) e.keep = true;
      if (r.decision === '保留') e.mark = true;
    });
    var names = Object.keys(byKey).filter(function (k) {
      return !byKey[k].keep && !byKey[k].mark;
    }).map(function (k) { return byKey[k].name; });
    var label = Math.round(need * 100) + '%';
    if (!names.length) {
      setStatus('没有需要卖的装备：没有低于总分 ' + label + ' 的记录'
        + (unid ? '（另有 ' + unid + ' 件未鉴定，未处理）' : ''));
      return 0;
    }
    setStatus('批量卖出总分 < ' + label + '：' + names.length + ' 种装备'
      + (unid ? '（跳过未鉴定 ' + unid + ' 件）' : ''));
    return await sellRecommended(false, names);
  }

  /* ---------------- 补放大镜（寄售购买） ---------------- */

  // 点开左侧「寄售」
  async function ensureAuctionOpen(doc) {
    var win = auctionWindow(doc);
    if (win) return win;
    var cands = Array.prototype.slice.call(doc.querySelectorAll('.game-menu-button, button, [role=button]'))
      .filter(function (b) { return (b.textContent || '').trim() === '寄售'; });
    if (!cands.length) return null;
    cands[0].click();
    return await waitFor(function () { return auctionWindow(doc); }, 2000);
  }

  // 买完东西会进「待领取箱」，要逐条点领取才进背包
  async function claimLoupes() {
    var doc = getGameDoc();
    if (!doc) return 0;
    var win = auctionWindow(doc);
    if (!win) { setStatus('寄售窗口不见了，无法领取'); return 0; }

    var tab = Array.prototype.slice.call(win.querySelectorAll('button'))
      .filter(function (b) { return b.textContent.trim() === '待领取'; })[0];
    if (!tab) { setStatus('寄售里找不到「待领取」页签'); return 0; }

    // 切页签，最多试 3 次并确认真的切过去了
    for (var k = 0; k < 3 && !tab.classList.contains('active'); k++) {
      tab.click();
      await sleep(600);
    }
    if (!tab.classList.contains('active')) { setStatus('「待领取」页签没切换成功'); return 0; }

    // 列表是异步拉的：刚切过去会先渲染「待领取箱为空」，必须等真正的可领行出现
    await sleep(700);
    var ready = await waitFor(function () {
      return win.querySelector('.auction-row.claim');
    }, 6000);
    if (!ready) {
      var emptyTxt = ((win.querySelector('.auction-empty') || {}).textContent || '').trim();
      setStatus(emptyTxt.indexOf('待领取') >= 0
        ? '待领取箱里没有可领的东西（购买可能没成功）'
        : '「待领取」列表没加载出来');
      return 0;
    }

    var claimed = 0, idle = 0;
    while (claimed < 20) {
      var rows = Array.prototype.slice.call(win.querySelectorAll('.auction-row.claim'));
      if (!rows.length) {
        // 领完一条后列表会刷新，短暂为空是正常的，连续空 3 秒才算领干净
        if (idle++ >= 6) break;
        await sleep(500);
        continue;
      }
      var btn = null, holder = null;
      for (var j = 0; j < rows.length; j++) {
        var b = Array.prototype.slice.call(rows[j].querySelectorAll('button')).filter(function (x) {
          return x.textContent.trim() === '领取' && !x.disabled;
        })[0];
        if (b) { btn = b; holder = rows[j]; break; }
      }
      if (!btn) {
        if (idle++ >= 3) break;
        await sleep(500);
        continue;
      }
      idle = 0;
      btn.click();
      claimed++;
      setStatus('领取中… 已领 ' + claimed + ' 批');
      // 等这一行消失再点下一条（领取是服务端动作，列表有延迟）
      var gone = await waitFor(function () {
        return !doc.contains(holder) || !holder.querySelector('button');
      }, 3500);
      await sleep(gone ? 300 : 1200);
    }
    return claimed;
  }

  function auctionWindow(doc) {
    var w = doc.querySelector('.window-auction');
    if (w && !w.classList.contains('closed')) return w;
    var wins = Array.prototype.slice.call(doc.querySelectorAll('.game-floating-window'));
    for (var i = 0; i < wins.length; i++) {
      if (wins[i].classList.contains('closed')) continue;
      if (/寄售|拍卖/.test(wins[i].textContent || '')) return wins[i];
    }
    return null;
  }

  // 关掉寄售窗口（浮动窗口右上角的「关闭」按钮；找不到就再点一次左侧「寄售」收起）
  async function closeAuctionWindow(doc) {
    var win = auctionWindow(doc);
    if (!win) return true;
    var b = win.querySelector('button[title="关闭"]')
      || win.querySelector('button[aria-label^="关闭"]')
      || win.querySelector('.modal-close');
    if (b && !b.disabled) b.click();
    else {
      var m = Array.prototype.slice.call(doc.querySelectorAll('.game-menu-button, button'))
        .filter(function (x) { return (x.textContent || '').trim() === '寄售'; })[0];
      if (m) m.click();
    }
    return !!(await waitFor(function () { return !auctionWindow(doc); }, 3000, 100));
  }

  // React 受控输入：必须走原生 setter + input 事件，直接改 value 不生效
  function setInputValue(el, val) {
    var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    var desc = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(el, String(val));
    else el.value = String(val);
    el.dispatchEvent(new view.Event('input', { bubbles: true }));
  }

  // 只买名字含「放大镜」且单价不高于 5000 的挂单，买不到就放弃
  async function buyLoupesAuction(want) {
    var doc = getGameDoc();
    if (!doc) return 0;
    var win = auctionWindow(doc) || await ensureAuctionOpen(doc);
    if (!win) { setStatus('打不开寄售窗口，请手动点开左侧「寄售」'); return 0; }

    // 必须切到「一口价」页签，拍卖（BID）行没有购买按钮
    var fixedTab = Array.prototype.slice.call(win.querySelectorAll('.auction-modes button'))
      .filter(function (b) { return b.textContent.trim() === '一口价'; })[0];
    if (fixedTab && !fixedTab.classList.contains('active')) {
      fixedTab.click();
      await sleep(900);
    }
    // 用市场搜索框直接筛「放大镜」，比翻页找更可靠
    var searchBox = win.querySelector('input.auction-search');
    var filterForm = win.querySelector('form.auction-filter');
    if (searchBox && filterForm) {
      setInputValue(searchBox, '放大镜');
      await sleep(200);
      if (filterForm.requestSubmit) filterForm.requestSubmit();
      else filterForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await sleep(700);
    }
    // 列表是异步拉取的，等挂单出来
    var loaded = await waitFor(function () {
      return win.querySelectorAll('.auction-row:not(.bid):not(.mine):not(.claim)').length > 0;
    }, 4000);
    if (!loaded) { setStatus('寄售「一口价」列表是空的，没东西可买'); return 0; }

    var bought = 0, guard = 0, pageTries = 0;
    while (bought < want && guard++ < 30) {
      var need = want - bought;
      var rows = Array.prototype.slice.call(win.querySelectorAll('.auction-row:not(.bid):not(.mine):not(.claim)'))
        .filter(function (r) { return /放大镜|#611[^0-9]|#12325/.test((r.textContent || '') + ' '); });
      if (!rows.length) {
        // 首页没有就往后翻几页
        var next = Array.prototype.slice.call(win.querySelectorAll('.auction-pagination button'))
          .filter(function (b) { return b.textContent.trim() === '下一页' && !b.disabled; })[0];
        if (next && pageTries < 3) { pageTries++; next.click(); await sleep(1000); continue; }
        var all = win.querySelectorAll('.auction-row');
        var first = win.querySelector('.auction-row:not(.bid):not(.claim)');
        setStatus('寄售里没找到放大镜挂单（共 ' + all.length + ' 行，首行：'
          + (first ? (first.textContent || '').trim().slice(0, 16) : '空') + '）');
        break;
      }

      // 一次买够：优先挑库存能覆盖剩余需求、且单价最低的那一条
      var best = null;
      rows.forEach(function (r) {
        var pEl = r.querySelector('strong[data-currency]');
        var price = pEl ? (parseInt((pEl.textContent || '').replace(/[^\d]/g, ''), 10) || 0) : 0;
        if (!price || price > LOUPE_PRICE_MAX) return;
        var sEl = r.querySelector('.auction-stock');
        var stock = sEl ? (parseInt((sEl.textContent || '').replace(/[^\d]/g, ''), 10) || 1) : 1;
        var cover = stock >= need;
        if (!best || (cover && !best.cover) || (cover === best.cover && price < best.price)) {
          best = { r: r, price: price, stock: stock, cover: cover };
        }
      });
      if (!best) {
        setStatus('放大镜挂单单价都超过上限 ' + LOUPE_PRICE_MAX + '，已停止购买');
        break;
      }

      var row = best.r;
      var buyQty = Math.max(1, Math.min(need, best.stock));
      var qtyInput = row.querySelector('input[type=number]');
      if (qtyInput && buyQty > 1) setInputValue(qtyInput, buyQty);
      await sleep(150);

      var buyBtn = Array.prototype.slice.call(row.querySelectorAll('button')).filter(function (b) {
        return b.textContent.trim() === '购买';
      })[0];
      if (!buyBtn || buyBtn.disabled) { setStatus('「购买」按钮不可用'); break; }
      buyBtn.click();

      // 会弹「请确认」对话框：.app-dialog 是整框，.app-dialog-confirm 是「确定」按钮本身
      var dlg = await waitFor(function () {
        var d = doc.querySelector('.app-dialog');
        return d && visible(d) ? d : null;
      }, 2500);
      if (!dlg) { setStatus('没等到购买确认框'); break; }
      // 确认文案里写着实际数量「购买 放大镜 ×26？」，以它为准
      var qm = (dlg.textContent || '').match(/×\s*(\d+)/);
      var realQty = qm ? parseInt(qm[1], 10) : buyQty;
      var okBtn = dlg.querySelector('button.app-dialog-confirm')
        || Array.prototype.slice.call(dlg.querySelectorAll('button')).filter(function (b) {
          return /^(确定|确认)$/.test(b.textContent.trim());
        })[0];
      if (!okBtn) { setStatus('确认框里没找到确定按钮'); break; }
      okBtn.click();

      bought += realQty;
      setStatus('补放大镜… 已买 ' + bought + '/' + want + ' 个');
      await waitFor(function () { return !doc.querySelector('.app-dialog'); }, 2000);
      await sleep(600);
    }
    if (bought) {
      setStatus('已买入 ' + bought + ' 个放大镜，正在领取…');
      await sleep(700);
      var got = await claimLoupes();
      if (got) {
        // 领取成功就把寄售页关掉，别挡着背包/鉴定
        var closed = await closeAuctionWindow(doc);
        setStatus('已买入 ' + bought + ' 个放大镜，已领取进背包' + (closed ? '，寄售已关闭' : '（寄售窗口没关掉，请手动点右上角 ×）'));
      } else {
        setStatus('已买入 ' + bought + ' 个放大镜，请在待领取箱手动领一下');
      }
    }
    return bought;
  }

  // 背包里的放大镜数量（调用前先切到「消耗品」页签）
  function loupeCount() {
    var n = 0;
    qAll('.inventory-cell').forEach(function (c) {
      if (invItemName(c).indexOf('放大镜') < 0) return;
      var em = c.querySelector('em');
      n += em ? (parseInt(em.textContent, 10) || 1) : 1;
    });
    return n;
  }

  // 寄售没货时的兜底：去 NPC「消耗品售卖机」买放大镜
  async function buyLoupesNpc(doc, want) {
    await invTab(doc, '消耗品');
    var before = loupeCount();
    if (!(await openShopPage(doc, '购买道具'))) return 0;
    await waitFor(function () { return qSel('.shop-buy-row'); }, 3000);

    var findRow = function () {
      return qAll('.shop-buy-row').filter(function (r) {
        var b = r.querySelector('.npc-shop-item-detail b');
        return b && /放大镜/.test(b.textContent || '');
      })[0];
    };
    var row = findRow();
    if (!row) { await closeShop(doc); return 0; }

    for (var round = 0; round < 4; round++) {
      var need = want - (loupeCount() - before);
      if (need <= 0) break;
      var inp = row.querySelector('input[type="number"]');
      if (inp) setVal(inp, String(need));
      var buy = Array.prototype.slice.call(row.querySelectorAll('button')).filter(function (b) {
        return b.textContent.trim() === '购买' && !b.disabled;
      })[0];
      if (!buy) break;
      buy.click();
      await sleep(1400);
      row = findRow();       // 购买后列表会重渲染，必须重新查行
      if (!row) break;
    }
    await closeShop(doc);
    var got = loupeCount() - before;
    return got > 0 ? got : 0;
  }

  // 先寄售买；寄售没有挂单或买不到，再去消耗品售卖机
  async function buyLoupes(want) {
    var got = await buyLoupesAuction(want);
    if (got > 0) return got;
    var doc = getGameDoc();
    if (!doc) return 0;
    // 寄售窗口还开着会挡住商店对话，先关掉
    await closeAuctionWindow(doc);
    await sleep(400);
    // 消耗品售卖机只在主城；不在主城就别乱跑地图
    var pos = mapInfo(doc) || {};
    if (!/rag_fes/i.test(pos.map || '')) {
      setStatus('寄售没货，且当前不在主城，无法去消耗品售卖机补放大镜');
      return 0;
    }
    var n = await buyLoupesNpc(doc, want);
    if (n > 0) setStatus('寄售没货，已从消耗品售卖机买 ' + n + ' 个放大镜');
    else setStatus('寄售和消耗品售卖机都没买到放大镜');
    return n;
  }

  /* ---------------- 面板 ---------------- */

  var host = document.getElementById(PANEL_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = PANEL_ID;
    host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483000;';
    document.body.appendChild(host);
  }

  var root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  root.innerHTML = [
    '<style>',
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.dragbar{display:flex;align-items:center;justify-content:center;height:19px;background:linear-gradient(180deg,#efe9da,#e5ddca);border-bottom:1px solid #ded7c7;color:#9c9380;font-size:10px;letter-spacing:2px;cursor:grab;user-select:none;touch-action:none}',
    '.dragbar:active{cursor:grabbing}',
    '.wrap{width:min(900px,calc(100vw - 20px));font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#2b2b2b;background:#fcfbf8;border:1px solid #ddd6c6;border-radius:10px;box-shadow:0 12px 34px rgba(40,36,26,.22);overflow:hidden}',
    '.hd{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:7px 9px;background:linear-gradient(180deg,#f7f2e7,#ece5d5);border-bottom:1px solid #ded7c7;cursor:move;user-select:none;touch-action:none}',
    '.hd b{font-size:13px;letter-spacing:.5px}',
    '.dot{width:7px;height:7px;border-radius:50%;background:#6b7f4f;box-shadow:0 0 0 3px rgba(107,127,79,.16);flex:none}',
    '.badge{background:#8a7f63;color:#fff;border-radius:9px;padding:0 6px;font-size:11px}',
    '.spacer{flex:1}',
    '.grip{color:#b3a992;font-size:10px;letter-spacing:.5px;margin-left:2px}',
    '.ver{color:#a89e89;font-size:10px;flex:none}',
    '.quota{flex:none;font-size:10.5px;line-height:15px;padding:0 6px;border-radius:8px;border:1px solid #cfdcc4;background:#eef4e8;color:#4f7a45;white-space:nowrap}',
    '.quota.low{border-color:#e0bcb8;background:#fbeeed;color:#a3524a}',
    '.quota.na{border-color:#ded7c8;background:#f4f1ea;color:#958c78}',
    'button{font:inherit;padding:3px 8px;border:1px solid #cfc7b4;background:#fff;border-radius:5px;cursor:pointer;color:#3a3a3a;transition:background .12s,border-color .12s,transform .06s}',
    'button:active:not(:disabled){transform:translateY(1px)}',
    '.list::-webkit-scrollbar,.acct::-webkit-scrollbar{width:8px;height:8px}',
    '.list::-webkit-scrollbar-thumb,.acct::-webkit-scrollbar-thumb{background:#d8cfbb;border-radius:4px}',
    '.list::-webkit-scrollbar-track,.acct::-webkit-scrollbar-track{background:transparent}',
    'button:hover:not(:disabled){background:#f6f2e8;border-color:#b5a98d}',
    'button:disabled{opacity:.45;cursor:not-allowed}',
    'button.primary{background:#6b7f4f;border-color:#5b6e42;color:#fff}',
    'button.primary:hover:not(:disabled){background:#5b6e42}',
    'button.ghost{border-color:transparent;background:transparent;padding:3px 5px}',
    '.status{padding:6px 10px;color:#6d6455;background:#fffdf7;border-bottom:1px solid #ece6d8;min-height:26px}',
    '.tools{display:flex;gap:6px;padding:6px 10px;border-bottom:1px solid #ece6d8}',
    '.tools input{flex:1;min-width:0;padding:3px 6px;border:1px solid #d5cfc0;border-radius:5px;font:inherit;color:#333;background:#fff}',
    '.rk{color:#a8a091;font-size:11px;min-width:26px}',
    '.acts{display:flex;flex-wrap:wrap;align-items:center;gap:5px;row-gap:4px;padding:6px 10px;border-bottom:1px solid #ece6d8}',
    '.acts button{padding:2px 8px;font-size:11px}',
    '.acts button.on{background:#a3524a;border-color:#8e453e;color:#fff}',
    '.acts .hint{margin-left:auto;color:#a79e8b;font-size:10.5px}',
    '.score{margin-left:auto;font-weight:600;color:#5b6e42;font-size:11.5px;white-space:nowrap}',
    '.score.g-S{color:#b07a12}',
    '.score.g-S-{color:#b07a12;opacity:.82}',
    '.score.g-A{color:#4f7a45}',
    '.score.g-C{color:#a3524a}',
    '.score.g-D{color:#8d8474}',
    '.sb{font-weight:800;font-size:11.5px;letter-spacing:1px;white-space:nowrap;background:linear-gradient(90deg,#e0533d,#e8a33d,#57a35a,#3d7de0,#9c5fd6,#e0533d);-webkit-background-clip:text;background-clip:text;color:transparent}',

    '.list{max-height:62vh;overflow:auto}',
    /* Excel 式横向表格 */
    '.tbl{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}',
    '.tbl th{position:sticky;top:0;z-index:1;background:#f3ede0;color:#7c735f;font-weight:600;text-align:left;padding:3px 3px;line-height:16px;border-bottom:1px solid #ded7c7;white-space:nowrap}',
    '.tbl td{padding:2px 3px;line-height:16px;border-bottom:1px solid #efe9db;vertical-align:middle;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.tbl tr:hover td{background:#faf7ef}',
    '.tbl tr.sel td{background:#f1f6ea}',
    '.tbl .ck{width:20px;text-align:center;padding-left:4px;padding-right:0}',
    '.tbl input.ck{width:13px;padding:0;margin:0;vertical-align:middle}',
    '.tbl .rk{color:#a8a091;white-space:nowrap}',
    '.tbl th:nth-child(1),.tbl td:nth-child(1){width:20px}',
    '.tbl th:nth-child(2),.tbl td:nth-child(2){width:20px}',
    '.tbl th:nth-child(3),.tbl td:nth-child(3){width:104px}',
    '.tbl th:nth-child(4),.tbl td:nth-child(4){width:30px}',
    '.tbl th:nth-child(5),.tbl td:nth-child(5){width:46px}',
    '.tbl th:nth-child(6),.tbl td:nth-child(6){width:28px}',
    '.tbl th:nth-child(7),.tbl td:nth-child(7){width:30px}',
    '.tbl th:nth-child(8),.tbl td:nth-child(8){width:46px}',
    '.tbl th:nth-child(9),.tbl td:nth-child(9){width:62px;font-size:10px}',
    '.tbl th:nth-child(10),.tbl td:nth-child(10){width:32px}',
    '.tbl th:nth-child(12),.tbl td:nth-child(12){width:86px}',
    '.tbl th:nth-child(13),.tbl td:nth-child(13){width:58px}',
    '.tbl .nm{font-weight:600;color:#3b3b3b;white-space:nowrap;text-overflow:ellipsis}',
    '.tbl .opts2{min-width:0}',
    '.ops-row{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0 2px}',
    '.ops-row .op1{display:flex;gap:1px;align-items:baseline;justify-content:center;min-width:0;white-space:nowrap;overflow:hidden;line-height:15px;font-size:10px;background:#f4f1e8;border-radius:3px;padding:0 1px}',
    '.ops-row .op1 .tx{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:#4a5d3a}',
    '.ops-row .op1 .g{flex:none;font-weight:700;font-size:10px}',
    '.ops-row .op1 .gS{color:#b8860b}',
    '.ops-row .op1 .gA{color:#4f7a45}',
    '.ops-row .op1 .gB{color:#4a6b8a}',
    '.ops-row .op1 .gC{color:#8a7f63}',
    '.ops-row .op1 .gD{color:#a3524a}',
    '.tag{display:inline-block;vertical-align:middle;padding:0 3px;border-radius:3px;border:1px solid;font-size:10px;line-height:15px;white-space:nowrap}',
    '.tag.keep{color:#fff;background:#4f7a45;border-color:#446b3b}',
    '.tag.sell{color:#fff;background:#a3524a;border-color:#8e453e}',
    '.dec2{white-space:nowrap}',
    '.dec2 button{padding:0 3px;font-size:10px;line-height:15px;margin-right:1px;vertical-align:middle}',
    '.dec2 button.on.keep{background:#4f7a45;border-color:#446b3b;color:#fff}',
    '.dec2 button.on.sell{background:#a3524a;border-color:#8e453e;color:#fff}',
    '.dec2 button.on.pending{background:#8a8272;border-color:#7a7364;color:#fff}',
    '.selcount{color:#8d8471;font-size:10.5px}',
    '.acct{border-bottom:1px solid #eee8db;padding:6px 10px;max-height:26vh;overflow:auto;background:#fbf8f0}',
    '.acct .ah{display:flex;align-items:center;gap:6px;margin-bottom:4px;color:#7c735f;font-size:11px}',
    '.acct .ar{display:flex;gap:8px;align-items:baseline;font-size:11.5px;padding:2px 0;border-bottom:1px dotted #eee6d6}',
    '.acct .ar:last-child{border-bottom:0}',
    '.acct .an{font-weight:600;color:#3b3b3b;flex:none}',
    '.acct .ai{color:#958c78;flex:1;min-width:0}',
    '.acct .mb{flex:none;margin-left:auto;font-size:10.5px;padding:1px 8px;border-radius:10px;border:1px solid #d8c2a8;background:#f7efe6;color:#8a6a45;cursor:pointer}',
    '.acct .mb.main{background:#eaf2e2;border-color:#a9bf98;color:#3f5a32}',
    '.acct .mb.sub{background:#f7efe6;border-color:#d8c2a8;color:#8a6a45}',
    '.row{padding:7px 10px;border-bottom:1px solid #eee8db}',
    '.row:last-child{border-bottom:0}',
    '.top{display:flex;align-items:baseline;gap:6px}',
    '.nm{font-weight:600;color:#3b3b3b}',
    '.meta{color:#958c78;font-size:11px}',
    '.opts{margin:3px 0 0;padding:0;list-style:none}',
    '.opts li{display:flex;align-items:baseline;gap:5px;color:#4a5d3a;font-size:11.5px;padding:1px 0}',
    '.opts .tx{flex:1;min-width:0}',
    '.opts .sc{flex:none;color:#958c78;font-size:10.5px}',
    '.tg{flex:none;font-size:10.5px;line-height:14px;padding:0 4px;border-radius:3px;border:1px solid}',
    '.dec{display:flex;gap:4px;margin-top:5px}',
    '.adv{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11.5px}',
    '.adv .t{flex:none;padding:1px 8px;border-radius:3px;border:1px solid;font-weight:600}',
    '.adv.keep .t{color:#fff;background:#4f7a45;border-color:#446b3b}',
    '.adv.lean .t{color:#fff;background:#7b8f56;border-color:#6d804a}',
    '.adv.maybe .t{color:#8a6a1f;background:#f7efdb;border-color:#e2d3ac}',
    '.adv.sell .t{color:#fff;background:#a3524a;border-color:#8e453e}',
    '.adv .w{color:#958c78}',
    '.adv .pr{flex:none;color:#8a6a1f;font-weight:600}',
    'button.mini{padding:1px 7px;font-size:11px}',
    '.dec button{padding:2px 8px;font-size:11px}',
    '.dec button.on{color:#fff}',
    '.dec button.on.keep{background:#4f7a45;border-color:#446b3b}',
    '.dec button.on.sell{background:#a3524a;border-color:#8e453e}',
    '.dec button.on.pending{background:#8a8272;border-color:#7a7364}',
    '.empty{padding:18px;text-align:center;color:#a79e8b}',
    '.wrap.min .dragbar,.wrap.min .targetbar,.wrap.min .casbar,.wrap.min .status,.wrap.min .taskbar,.wrap.min .acts,.wrap.min .tools,.wrap.min .acct,.wrap.min .list{display:none!important}',
    '.wrap.min .hd{height:22px;padding:1px 6px;gap:5px}',
    '.wrap.min .hd .grip,.wrap.min .hd .badge,.wrap.min .hd button{display:none!important}',
    '.wrap.min .hd #min{display:inline-block!important}',
    '.acts #keepratio{width:44px;font:inherit;padding:1px 3px;border:1px solid #d4ccb8;border-radius:4px;background:#fff;color:#3a3a3a}',
    '#mailgo-mini{display:none;background:#4f7a45;border-color:#446b3b;color:#fff}',
    '.targetbar,.casbar{display:flex;align-items:center;gap:6px;padding:5px 9px;background:#fffdf8;border-bottom:1px solid #efe9db;font-size:11px;color:#6f6656}',
    '.casbar input{flex:0 1 108px;min-width:0;font:inherit;padding:2px 5px;border:1px solid #d4ccb8;border-radius:4px;background:#fff;color:#3a3a3a}',
    '.targetbar .tlabel,.casbar .tlabel{flex:none;color:#8d8471}',
    '.casbar b{flex:1;min-width:0;font-weight:600;color:#3d5a3d}',
    '.casbar button{padding:2px 7px}',
    '.targetbar select{flex:1;min-width:0;max-width:250px;font:inherit;padding:2px 4px;border:1px solid #d4ccb8;border-radius:4px;background:#fff;color:#3a3a3a}',
    /* 任务进度 */
    '.taskbar{padding:5px 10px;background:#fffdf7;border-bottom:1px solid #ece6d8}',
    '.tb-hd{display:flex;align-items:center;margin-bottom:2px}',
    '.tb-hd .tlabel{color:#8d8471;font-size:10.5px}',
    '.tb-ago{margin-left:auto;color:#a79e8b;font-size:10px}',
    '.tb-row{display:flex;align-items:center;gap:6px;font-size:11px;color:#4a4a4a;margin:3px 0}',
    '.tb-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.tb-num{color:#5b6e42;font-weight:600;white-space:nowrap}',
    '.tb-bar{width:88px;height:6px;border-radius:3px;background:#e9e3d4;overflow:hidden;flex:none}',
    '.tb-bar i{display:block;height:100%;background:#6b7f4f;border-radius:3px}',
    '.tb-pct{width:34px;text-align:right;color:#958c78;font-size:10.5px;flex:none}',
    '.tb-row.done .tb-num{color:#4f7a45}',
    '.tb-row.done .tb-bar i{background:#4f7a45}',
    '</style>',
    '<div class="wrap min" id="wrap">',
    '  <div class="dragbar" id="dragbar">拖 动 面 板</div>',
    '  <div class="hd" id="hd">',
    '    <span class="dot"></span><b>自动鉴定</b><span class="badge" id="count">0</span><span class="grip">可拖动</span>',
    '    <span class="spacer"></span>',
    '    <button class="primary" id="run">开始鉴定</button>',
    '    <button id="stop" disabled>停止</button>',
    '    <button id="acctbtn">账号</button>',
    '    <button id="casbtn">起号</button>',
    '    <button id="huntbtn">狩猎任务</button>',
    '    <button id="wildbtn">野外BOSS</button>',
    '    <button id="craftbtn">影装</button>',
    '    <button id="layoutbtn" title="把指定账号的窗口位置/大小/吸附关系复制到其他账号（会刷新页面）">套用布局</button>',
    '    <button id="upd" title="重载扩展并刷新页面，加载最新代码">更新</button>',
    '    <span class="ver" id="ver"></span>',
    '    <span class="quota na" id="quota">挂机 —</span>',
    '    <button class="ghost" id="min">+</button>',
    '  </div>',
    '  <div class="targetbar"><span class="tlabel">控制账号</span><select id="acct-sel"></select><button class="ghost" id="acct-refresh">刷新</button></div>',
    '  <div class="casbar" id="casbar" style="display:none"><span class="tlabel">起号进度</span><b id="cas-progress">转生 0/5</b><button class="ghost" id="cas-check">查转数</button><button class="ghost" id="cas-reset">重置</button></div>',
    '  <div class="casbar" id="wildbar" style="display:none"><span class="tlabel">野外BOSS</span><b id="wild-info">第 1 轮 · 活力约 100% · 本轮 0 只 · 累计 0</b><input id="wild-key" placeholder="地图关键词（可选）" /></div>',
    '  <div class="casbar" id="craftbar" style="display:none"><span class="tlabel">影装</span><b id="craft-info">影碎片 —（点「影装」扫描）</b></div>',
    '  <div class="casbar" id="layoutbar" style="display:none"><span class="tlabel">布局来源</span><input id="layout-src" value="明知山" placeholder="账号名或角色名" /><button class="ghost" id="layout-go">套用到其他账号</button></div>',
    '  <div class="status" id="status">就绪，点「开始鉴定」</div>',
    '  <div class="taskbar" id="taskbar" style="display:none">',
    '    <div class="tb-hd"><span class="tlabel">任务进度</span><span class="tb-ago" id="task-ago"></span></div>',
    '    <div class="tb-list" id="task-list"></div>',
    '  </div>',
    '  <div class="acts">',
    '    <button id="autosell">自动卖：关</button>',
    '    <button id="sellnow">批量卖出选中</button>',
    '    <button id="sells" title="保留总分 ≥ 满分的 90%，其余全部卖掉">卖掉<90%</button>',
    '    <button id="sellsmin" title="保留总分 ≥ 满分的 80%，其余全部卖掉">卖掉<80%</button>',
    '    <button id="sellsa" title="把总分低于阈值的装备全部勾选，再用「批量卖出选中」卖出或「存仓勾选」存起来">勾选低分</button>',
    '    <button id="stash-sel" title="把勾选的装备存进公会仓库（需先和「仓库服务 / 公会仓库」NPC 对话或手动打开仓库）">存仓勾选</button>',
    '    <span class="selcount">留≥<input id="keepratio" type="number" min="10" max="100" step="5" title="总分达到满分的百分之多少就判定为「建议留」" />%</span>',
    '    <span class="selcount" id="selcount">未勾选</span>',
    '    <span class="hint">' + HOTKEY.label + '</span>',
    '  </div>',
    '  <div class="tools">',
    '    <input id="filter" placeholder="按名称 / 词条 / 部位过滤" />',
    '    <button id="selinv" title="把当前筛选结果的勾选状态反过来">反选</button>',
    '    <button id="clear">清空</button>',
    '  </div>',
    '  <div class="acct" id="acct" style="display:none"></div>',
    '  <div class="list" id="list"></div>',
    '</div>'
  ].join('');

  var $ = function (id) { return root.getElementById ? root.getElementById(id) : root.querySelector('#' + id); };
  var wrap = $('wrap');

  /* ---------------- 面板拖动 + 位置记忆 ---------------- */
  var POS_KEY = 'ro-auto-identify-panel-pos-v1';
  (function initDrag() {
    var hd = $('hd');
    if (!hd) return;
    // 恢复上次位置（并限制在可视区内）
    try {
      var p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (p && typeof p.left === 'number') {
        host.style.left = Math.max(0, p.left) + 'px';
        host.style.top = Math.max(0, p.top) + 'px';
        host.style.right = 'auto';
      }
    } catch (e) {}

    var dragging = false, sx = 0, sy = 0, ol = 0, ot = 0;

    function onMove(e) {
      if (!dragging) return;
      var w = wrap.getBoundingClientRect().width || 420;
      var left = Math.max(0, Math.min(ol + e.clientX - sx, window.innerWidth - w));
      var top = Math.max(0, Math.min(ot + e.clientY - sy, window.innerHeight - 32));
      host.style.left = left + 'px';
      host.style.top = top + 'px';
      if (e.cancelable) e.preventDefault();
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      var r = host.getBoundingClientRect();
      try { localStorage.setItem(POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })); } catch (e) {}
    }

    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      var el = e.target;
      while (el && el !== hd) {
        var tag = (el.tagName || '').toUpperCase();
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA') return;
        el = el.parentNode;
      }
      var r = host.getBoundingClientRect();
      host.style.right = 'auto';
      host.style.left = r.left + 'px';
      host.style.top = r.top + 'px';
      dragging = true; sx = e.clientX; sy = e.clientY; ol = r.left; ot = r.top;
      try { hd.setPointerCapture(e.pointerId); } catch (err) {}
      // 双重监听：指针捕获 + window 监听，指针划到游戏 iframe 上也继续跟手
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
      if (e.cancelable) e.preventDefault();
    }

    hd.addEventListener('pointerdown', onDown, true);
    hd.addEventListener('mousedown', function (e) { if (!dragging) onDown(e); }, true);
    hd.addEventListener('pointermove', onMove, true);
    var bar = $('dragbar');
    if (bar) {
      bar.addEventListener('pointerdown', onDown, true);
      bar.addEventListener('mousedown', function (e) { if (!dragging) onDown(e); }, true);
      bar.addEventListener('pointermove', onMove, true);
    }
    window.addEventListener('resize', function () {
      var r = host.getBoundingClientRect();
      if (r.right > window.innerWidth) host.style.left = Math.max(0, window.innerWidth - r.width) + 'px';
      if (r.bottom > window.innerHeight) host.style.top = Math.max(0, window.innerHeight - 32) + 'px';
    });
  })();

  /* ---------------- 多账号：选择当前控制哪个角色 ---------------- */
  (function initTarget() {
    var sel = $('acct-sel');
    var btn = $('acct-refresh');
    if (!sel) return;
    // 账号 iframe 内的面板只服务自己，不需要"控制账号"下拉
    if (!IS_TOP) {
      var bar = sel.parentNode;
      if (bar) bar.style.display = 'none';
      return;
    }

    function label(x) {
      var n = charNameOf(x.doc);
      return x.title + (n ? ' · ' + n : '');
    }

    function refresh() {
      var list = gameDocs();
      var cur = currentTarget();
      var sig = list.map(label).join('|');
      if (sel.dataset.sig !== sig) {
        sel.dataset.sig = sig;
        sel.innerHTML = '';
        if (!list.length) {
          var none = document.createElement('option');
          none.textContent = '未找到游戏页面';
          sel.appendChild(none);
          return;
        }
        list.forEach(function (x) {
          var o = document.createElement('option');
          o.value = x.title;
          o.textContent = label(x);
          sel.appendChild(o);
        });
      }
      if (cur) sel.value = cur.title;
    }

    sel.addEventListener('change', function () {
      TARGET.title = sel.value;
      try { localStorage.setItem(TARGET_KEY, sel.value); } catch (e) {}
      CAS.key = '';                       // 换号后重新绑定该角色的进度
      var t = currentTarget();
      if (t) casBind(t.doc);
      setStatus('控制账号：' + sel.value + '（' + (charNameOf(t && t.doc) || '未进角色') + '）');
      refresh();
      renderTasks();
    });
    if (btn) btn.addEventListener('click', refresh);
    refresh();
    setInterval(refresh, 2500);
  })();

  /* ---------------- 任务进度：定时读 DOM 刷新 ---------------- */
  (function initTaskBar() {
    if (!$('taskbar')) return;
    renderTasks();
    setInterval(function () {
      try { silentWatchTasks(); } catch (e) {}
      renderTasks();
    }, 4000);
  })();

  /* ---------------- 起号进度：查转数 / 重置 ---------------- */
  (function initCasBar() {
    var prog = $('cas-progress');
    var chk = $('cas-check');
    var rst = $('cas-reset');
    if (!prog) return;

    function upd() {
      var t = getGameDoc();
      if (t) casBind(t);
      prog.textContent = '转生 ' + CAS.reborns + '/' + CAS_TARGET_REBORN + (CAS.key ? ' · ' + CAS.key : '');
    }

    if (chk) chk.addEventListener('click', function () { casCheckReborns().then(upd); });
    if (rst) rst.addEventListener('click', function () {
      var t = getGameDoc();
      if (t) casBind(t);
      if (!window.confirm('把「' + (CAS.key || '当前角色') + '」的转生进度归零？')) return;
      CAS.reborns = 0;
      CAS.stage = '';
      CAS.lastBase = 0;
      CAS.needSync = false;
      saveCas();
      upd();
      setStatus('起号进度已重置：转生 0/' + CAS_TARGET_REBORN);
    });

    upd();
    setInterval(upd, 3000);
  })();

  /* ---------------- 挂机额度监控（rail「免费挂机剩余 H:MM:SS」） ---------------- */
  (function initQuota() {
    var el = $('quota');
    if (!el) return;
    var LOW_SEC = 600;        // 低于 10 分钟提示
    var warned = false;
    function fmt(sec) {
      var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      return h + ':' + pad(m) + ':' + pad(s);
    }
    function upd() {
      var doc = getGameDoc();
      var info = doc ? railInfo(doc) : null;
      if (!info || info.idleSec == null) {
        el.className = 'quota na';
        el.textContent = '挂机 —';
        return;
      }
      var low = info.idleSec <= LOW_SEC;
      el.className = 'quota' + (low ? ' low' : '');
      el.textContent = '挂机 ' + fmt(info.idleSec);
      el.title = '免费挂机剩余 ' + fmt(info.idleSec) + (low ? '（不足 10 分钟）' : '');
      if (low && !warned) {
        warned = true;
        setStatus('挂机额度只剩 ' + fmt(info.idleSec) + '，快用完了（每日免费 3 小时，0 点重置）');
      } else if (!low) {
        warned = false;
      }
    }
    upd();
    setInterval(upd, 5000);
  })();

  var countEl = $('count');
  var statusEl = $('status');
  var listEl = $('list');
  var filterEl = $('filter');
  var runBtn = $('run');
  var stopBtn = $('stop');

  /* ---------------- 账号清单 ---------------- */

  var ACCT_KEY = 'ro-auto-identify-accounts-v1';
  var accounts = loadAccounts();

  function loadAccounts() {
    try {
      var a = JSON.parse(localStorage.getItem(ACCT_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function saveAccounts() {
    try { localStorage.setItem(ACCT_KEY, JSON.stringify(accounts)); } catch (e) {}
  }

  // 读某个游戏文档里的角色栏（不依赖当前选中的账号）
  function railSnapshot(doc) {
    var sum = doc.querySelector('.rail-player-summary');
    if (!sum) return null;
    var title = sum.querySelector('.rail-player-title');
    var nameEl = title && title.querySelector('b');
    var name = nameEl ? nameEl.textContent.trim() : '';
    if (!name) return null;

    var jobEl = title.querySelector('small');
    var txt = (sum.textContent || '').replace(/\s+/g, ' ');
    var bl = txt.match(/Base\s*Lv\.?\s*(\d+)/i);
    var jl = txt.match(/Job\s*Lv\.?\s*(\d+)/i);
    var zy = txt.match(/ZENY\s*([\d,]+)/i);

    return {
      name: name,
      job: jobEl ? jobEl.textContent.trim() : '',
      baseLv: bl ? parseInt(bl[1], 10) : 0,
      jobLv: jl ? parseInt(jl[1], 10) : 0,
      zeny: zy ? parseInt(zy[1].replace(/,/g, ''), 10) : 0
    };
  }

  // 页面里所有游戏 iframe 的文档（顶层页面可一次看到全部账号）
  function gameDocList() {
    var out = [];
    function push(d) { if (d && isGameDoc(d) && out.indexOf(d) < 0) out.push(d); }
    push(getGameDoc());
    var topDoc = null;
    try { topDoc = window.top.document; } catch (e) { topDoc = null; }
    if (topDoc && topDoc !== document) {
      Array.prototype.slice.call(topDoc.querySelectorAll('iframe')).forEach(function (f) {
        var d = null;
        try { d = f.contentDocument; } catch (e) { return; }
        push(d);
      });
    }
    return out;
  }

  // 从承载这个文档的 iframe 标题里取账号名（形如「游戏账号 echo3」）
  function docAccount(d) {
    var topDoc = null;
    try { topDoc = window.top.document; } catch (e) { topDoc = null; }
    if (!topDoc) return '';
    var f = Array.prototype.slice.call(topDoc.querySelectorAll('iframe')).filter(function (x) {
      try { return x.contentDocument === d; } catch (e) { return false; }
    })[0];
    if (!f) return '';
    var m = (f.getAttribute('title') || '').match(/游戏账号\s*[·:：]?\s*(\S+)/);
    return m ? m[1] : '';
  }

  function docMapName(d) {
    var el = d.querySelector('.location-chip') || d.querySelector('.map-inline-title');
    return el ? (el.textContent || '').split('地图')[0].trim().slice(0, 28) : '';
  }

  // 扫描当前页面里所有在线角色
  function scanOnline() {
    var list = [];
    gameDocList().forEach(function (d) {
      var s = railSnapshot(d);
      if (!s) return;
      list.push({
        account: docAccount(d), name: s.name, job: s.job,
        baseLv: s.baseLv, jobLv: s.jobLv, zeny: s.zeny, map: docMapName(d)
      });
    });
    return list;
  }

  // 从游戏界面读当前账号/角色
  function readAccountInfo() {
    var doc = getGameDoc();
    if (!doc) return null;
    var s = railSnapshot(doc);
    if (!s) return null;
    s.account = docAccount(doc);
    return s;
  }

  // 抓一次当前角色信息，更新清单（同一账号+角色只保留一条）
  function captureAccount() {
    var info = readAccountInfo();
    if (!info) return false;
    var key = (info.account || '?') + '|' + info.name;
    var now = Date.now();
    var cur = accounts.filter(function (a) { return a.key === key; })[0];
    if (!cur) {
      accounts.unshift({
        key: key, account: info.account, name: info.name, job: info.job,
        baseLv: info.baseLv, jobLv: info.jobLv, zeny: info.zeny, last: now
      });
      if (accounts.length > 100) accounts.length = 100;
    } else {
      cur.job = info.job || cur.job;
      cur.baseLv = info.baseLv || cur.baseLv;
      cur.jobLv = info.jobLv || cur.jobLv;
      cur.zeny = info.zeny;
      cur.last = now;
    }
    saveAccounts();
    renderAccounts(scanOnline());
    return true;
  }

  // 把在线账号信息合并进历史清单：缺失的账号名/角色信息补上
  function mergeOnline(list) {
    var added = 0, filled = 0;
    list.forEach(function (o) {
      if (!o.name) return;
      var cur = accounts.filter(function (a) {
        return a.name === o.name && (!a.account || !o.account || a.account === o.account);
      })[0];
      if (!cur) {
        accounts.unshift({
          key: (o.account || '?') + '|' + o.name, account: o.account, name: o.name, job: o.job,
          baseLv: o.baseLv, jobLv: o.jobLv, zeny: o.zeny, last: Date.now()
        });
        added++;
        return;
      }
      if (!cur.account && o.account) { cur.account = o.account; filled++; }
      cur.key = (cur.account || '?') + '|' + cur.name;
      cur.job = o.job || cur.job;
      cur.baseLv = o.baseLv || cur.baseLv;
      cur.jobLv = o.jobLv || cur.jobLv;
      cur.zeny = o.zeny;
      cur.last = Date.now();
    });
    if (accounts.length > 100) accounts.length = 100;
    saveAccounts();
    return { added: added, filled: filled };
  }

  var onlineCache = [];

  /* ---------------- 主号 / 小号 ---------------- */
  // 按角色名记模式：小号不显示「扫行情」「批量上架」。同源多 iframe 共用 localStorage。
  var MODE_KEY = 'ro-auto-identify-acct-mode-v1';
  var acctModes = (function () {
    try { return JSON.parse(localStorage.getItem(MODE_KEY) || '{}') || {}; } catch (e) { return {}; }
  })();
  var isSubAccount = false;

  function acctMode(name) {
    return acctModes[name] === 'sub' ? 'sub' : 'main';
  }

  function setAcctMode(name, mode) {
    if (!name) return;
    if (mode === 'sub') acctModes[name] = 'sub';
    else delete acctModes[name];
    try { localStorage.setItem(MODE_KEY, JSON.stringify(acctModes)); } catch (e) {}
    applyAcctMode();
    renderAccounts(scanOnline());
  }

  // 本面板所在 iframe 的角色是哪种号，决定按钮去留
  function applyAcctMode() {
    var s = railSnapshot(document);
    isSubAccount = !!(s && s.name && acctMode(s.name) === 'sub');
    ['scan', 'listall'].forEach(function (id) {
      var b = $(id);
      if (b) b.style.display = isSubAccount ? 'none' : '';
    });
  }

  window.addEventListener('storage', function (e) {
    if (e.key !== MODE_KEY) return;
    try { acctModes = JSON.parse(e.newValue || '{}') || {}; } catch (err) { acctModes = {}; }
    applyAcctMode();
    renderAccounts(scanOnline());
  });

  function acctRow(a, live) {
    var row = document.createElement('div');
    row.className = 'ar';
    var n = document.createElement('span');
    n.className = 'an';
    n.textContent = a.name || '—';
    var i = document.createElement('span');
    i.className = 'ai';
    i.textContent = (a.account ? a.account + ' · ' : '') + (a.job || '?')
      + ' · Base ' + (a.baseLv || '-') + ' / Job ' + (a.jobLv || '-')
      + ' · ' + (a.zeny || 0).toLocaleString('zh-CN') + ' Z'
      + (a.map ? ' · ' + a.map : '')
      + (live ? ' · 在线' : '');
    row.appendChild(n);
    row.appendChild(i);
    if (a.name) {
      var mb = document.createElement('button');
      mb.className = 'mb ' + acctMode(a.name);
      mb.textContent = acctMode(a.name) === 'sub' ? '小号' : '主号';
      mb.title = '点击切换主号 / 小号；小号不显示「扫行情」「批量上架」';
      mb.addEventListener('click', function () {
        var next = acctMode(a.name) === 'sub' ? 'main' : 'sub';
        setAcctMode(a.name, next);
        setStatus(a.name + ' 已设为' + (next === 'sub' ? '小号（隐藏扫行情/批量上架）' : '主号'));
      });
      row.appendChild(mb);
    }
    return row;
  }

  function renderAccounts(online) {
    if (online) onlineCache = online;
    var box = $('acct');
    if (!box || box.style.display === 'none') return;
    box.textContent = '';
    var on = onlineCache || [];

    var head = document.createElement('div');
    head.className = 'ah';
    head.textContent = '当前在线 ' + on.length + ' 个 · 清单 ' + accounts.length + ' 个角色';
    if (accounts.length) {
      var clr = document.createElement('button');
      clr.className = 'ghost';
      clr.textContent = '清空历史';
      clr.style.marginLeft = 'auto';
      clr.addEventListener('click', function () {
        if (!confirm('确定清空账号历史清单（' + accounts.length + ' 条）？不影响游戏里的账号配置。')) return;
        accounts = [];
        saveAccounts();
        renderAccounts();
        setStatus('账号历史清单已清空');
      });
      head.appendChild(clr);
    }
    box.appendChild(head);

    if (!on.length) {
      var e = document.createElement('div');
      e.className = 'ai';
      e.textContent = '没扫到在线角色（角色还没进游戏，或账号在别的浏览器标签里）';
      box.appendChild(e);
    }
    on.forEach(function (o) { box.appendChild(acctRow(o, true)); });

    if (accounts.length) {
      var h2 = document.createElement('div');
      h2.className = 'ah';
      h2.textContent = '历史清单 · 按最近记录排序';
      box.appendChild(h2);
      accounts.forEach(function (a) { box.appendChild(acctRow(a, false)); });
    }
  }

  /* ---------------- 邮寄 ---------------- */

  var MAIL_TO = '皮城辅警';                         // 默认收件人
  var MAIL_KEEP = ['苍蝇翅膀', '蝴蝶翅膀', '双补药', '万能手册'];  // 消耗品里留着不寄的
  var MAIL_BLOCK = ['巅峰经验书'];                   // 服务端不让寄的道具（按名字包含匹配）
  var MAIL_BATCH = 5;                               // 每封最多 5 个附件
  var MAIL_MAX = 40;                                // 一次最多寄几封（寄到背包没有可寄为止）
  var mailing = false;

  function btnByText(root, txt) {
    return Array.prototype.slice.call(root.querySelectorAll('button'))
      .filter(function (b) { return b.textContent.trim() === txt; })[0] || null;
  }

  // 背包/记录里的名字带了 [1]、[5词条] 之类后缀，统一去掉再比对
  function normName(s) {
    return (s || '').replace(/\[\d+词条\]/g, '').replace(/\[\d+\]/g, '').trim();
  }

  function mailFlagged(name) {
    var n = normName(name);
    return records.some(function (r) { return r.mail && normName(r.name) === n; });
  }

  function mailBlocked(name) {
    return MAIL_BLOCK.some(function (b) { return (name || '').indexOf(b) >= 0; });
  }

  function setVal(el, v) {
    var setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function ensureMailOpen(doc) {
    var win = doc.querySelector('.window-mail');
    if (!win || win.classList.contains('closed')) {
      var mb = Array.prototype.slice.call(doc.querySelectorAll('.game-menu-button'))
        .filter(function (b) { return b.textContent.trim() === '邮件'; })[0];
      if (mb) mb.click();
      win = await waitFor(function () {
        var w = doc.querySelector('.window-mail');
        return w && !w.classList.contains('closed') ? w : null;
      }, 2000);
    }
    return win || null;
  }

  // 打开一封新邮件，填收件人并确认
  async function composeMail(doc, win, receiver) {
    var to = receiver || MAIL_TO;
    var open = btnByText(win, '写邮件');
    if (open) open.click();
    var form = await waitFor(function () {
      return doc.querySelector('.mail-compose.open');
    }, 2500);
    if (!form) throw stopError('邮件编辑框没打开');

    // 上一封草稿可能留着附件，先清掉，避免把不该寄的一起寄出去
    for (var g = 0; g < 10; g++) {
      var leftover = form.querySelector('button[aria-label^="移除附件"]');
      if (!leftover) break;
      leftover.click();
      await sleep(200);
    }

    var rec = form.querySelector('.mail-receiver-field input');
    if (!rec) throw stopError('找不到收件人输入框');
    setVal(rec, to);
    await sleep(200);

    var cb = btnByText(form, '确认角色') || btnByText(form, '重新确认');
    if (!cb) throw stopError('找不到「确认角色」按钮');
    cb.click();
    var card = await waitFor(function () { return form.querySelector('.receiver-card'); }, 6000);
    if (!card) throw stopError('收件人「' + to + '」确认失败（角色名不对或不在线）');

    var t = form.querySelector('.mail-message-fields input');
    var b = form.querySelector('.mail-message-fields textarea');
    if (t) setVal(t, '装备邮寄');
    if (b) setVal(b, '自动邮寄');
    await sleep(150);
    return form;
  }

  function choiceName(ch) {
    var b = ch.querySelector('b');
    if (!b) return '';
    return normName((b.getAttribute('title') || b.textContent || '').split('#')[0]);
  }

  // 按规则在附件选择器里挑最多 5 件：其他全寄 / 消耗品排除保留项 / 装备仅标记过的
  async function pickAttachments(doc, form) {
    var add = btnByText(form, '选择背包道具');
    if (!add || add.disabled) throw stopError('「选择背包道具」不可用');
    add.click();
    var pk = await waitFor(function () {
      var p = doc.querySelector('.inventory-picker-backdrop');
      return p && visible(p) ? p : null;
    }, 2500);
    if (!pk) throw stopError('附件选择框没打开');

    var rules = [
      { tab: '其他', ok: function (n) { return !mailBlocked(n); } },
      { tab: '消耗品', ok: function (n) { return MAIL_KEEP.indexOf(n) < 0 && !mailBlocked(n); } },
      { tab: '装备', ok: function (n) { return mailFlagged(n); } }
    ];
    var picked = [];
    for (var i = 0; i < rules.length && picked.length < MAIL_BATCH; i++) {
      var tab = btnByText(pk, rules[i].tab);
      if (!tab) continue;
      if (!tab.classList.contains('active')) {
        tab.click();
        await sleep(500);
      }
      // 每点一次列表会重渲染，所以每次重新查一遍，不能缓存节点
      var guard = 0;
      while (picked.length < MAIL_BATCH && guard++ < 30) {
        var fresh = doc.querySelector('.inventory-picker-backdrop');
        if (!fresh) break;
        var list = Array.prototype.slice.call(fresh.querySelectorAll('.inventory-picker-choice'));
        var target = null;
        for (var j = 0; j < list.length; j++) {
          var n = choiceName(list[j]);
          if (!n || !rules[i].ok(n)) continue;
          if (list[j].getAttribute('aria-pressed') === 'true') continue;
          target = list[j];
          break;
        }
        if (!target) break;
        var pickedName = choiceName(target);
        target.click();
        // 点道具会先弹出数量编辑，默认 1；改成整叠数量（叠加物品一次寄完）
        var qBox = await waitFor(function () {
          var p = doc.querySelector('.inventory-picker-backdrop');
          return p && p.querySelector('.inventory-picker-quantity');
        }, 1500);
        if (qBox) {
          var qInput = qBox.querySelector('input');
          var qMax = qInput ? parseInt(qInput.getAttribute('max'), 10) : 0;
          if (qInput && qMax > 1) {
            setVal(qInput, String(qMax));
            await sleep(250);
          }
          var qok = btnByText(qBox, '确定');
          if (qok) qok.click();
          await sleep(250);
        }
        picked.push(pickedName);
        await sleep(180);
      }
    }

    var freshPk = doc.querySelector('.inventory-picker-backdrop');
    if (!picked.length) {
      var cancel = freshPk && btnByText(freshPk, '取消');
      if (cancel) cancel.click();
      await sleep(300);
      return [];
    }

    var okBtn = freshPk && btnByText(freshPk, '确认选择');
    if (!okBtn) throw stopError('找不到「确认选择」');
    okBtn.click();
    await waitFor(function () { return !doc.querySelector('.inventory-picker-backdrop'); }, 3000);
    await sleep(300);
    return picked;
  }

  function mailTargetName() {
    var sel = $('mail-target');
    return sel && sel.value ? sel.value : MAIL_TO;
  }

  function fillMailTargets() {
    var sel = $('mail-target');
    if (!sel) return;
    var cur = sel.value;
    sel.textContent = '';
    var d = document.createElement('option');
    d.value = MAIL_TO;
    d.textContent = MAIL_TO + '（默认）';
    sel.appendChild(d);

    // 只列当前在线的角色：没登录的号寄不过去，也会把下拉搞乱
    var on = scanOnline();
    var onNames = on.map(function (o) { return o.name; });
    var me = '';
    try { var mi = readAccountInfo(); me = mi && mi.name ? mi.name : ''; } catch (e) {}
    var pool = [];
    accounts.forEach(function (a) {
      if (!a.name || a.name === MAIL_TO || a.name === me || onNames.indexOf(a.name) < 0) return;
      if (pool.some(function (x) { return x.name === a.name && (x.account || '') === (a.account || ''); })) return;
      pool.push(a);
    });
    on.forEach(function (o) {
      if (!o.name || o.name === MAIL_TO || o.name === me) return;
      if (pool.some(function (a) { return a.name === o.name; })) return;
      pool.push(o);
    });

    pool.forEach(function (a) {
      var o = document.createElement('option');
      o.value = a.name;
      o.textContent = a.name + (a.account ? '（' + a.account + '）' : '') + (a.job ? ' · ' + a.job : '');
      sel.appendChild(o);
    });
    if (cur && (cur === MAIL_TO || onNames.indexOf(cur) >= 0)) sel.value = cur;
    if (!sel.value) sel.value = MAIL_TO;
  }

  async function sendMail(doc, form) {
    var send = form.querySelector('.mail-send-button');
    if (!send || send.disabled) throw stopError('「发送邮件」不可点（检查标题/附件/负重）');
    for (var attempt = 0; attempt < 3; attempt++) {
      send.click();
      var done = await waitFor(function () {
        if (!doc.querySelector('.mail-compose.open')) return 'closed';
        return form.querySelectorAll('.mail-attachment-compact').length === 0 ? 'cleared' : null;
      }, 5000);
      if (done) {
        await sleep(500);
        return;
      }
      // 失败时服务端会写一条日志，捞出原因
      var logs = Array.prototype.slice.call(doc.querySelectorAll('.window-logs p, .social-log p'))
        .slice(-3).map(function (p) { return p.textContent.trim(); });
      var last = logs.filter(function (t) { return t.indexOf('邮件发送') >= 0; }).pop() || '';
      if (last.indexOf('频率') >= 0) {
        throw stopError('服务器限频：' + last.replace(/^\d+:\d+/, '') + '（等冷却结束再点「邮寄」继续）');
      }
      if (attempt < 2) await sleep(2000);
      else throw stopError('发送失败：' + (last.replace(/^\d+:\d+/, '') || '附件没清空，可能费用或负重伤限'));
    }
  }

  // 一键收取邮件附件：把所有邮件卡片上的「收取附件」点一遍，直到领不下来为止
  var claimingMail = false;
  async function claimMailAll() {
    if (claimingMail) return;
    var doc = getGameDoc();
    if (!doc) { setStatus('找不到游戏页面'); return; }
    claimingMail = true;
    var cb = $('claimmail');
    if (cb) cb.disabled = true;
    try {
      var win = await ensureMailOpen(doc);
      if (!win) throw stopError('打不开邮件窗口');

      // 先刷新，拿到最新邮件列表
      var rf = btnByText(win, '刷新');
      if (rf && !rf.disabled) { rf.click(); await sleep(1000); }

      var total = 0, stale = 0, fails = 0;
      for (var round = 0; round < 60; round++) {
        var btns = mailClaimButtons(win);
        var ready = btns.filter(function (b) { return !b.disabled; });
        if (!ready.length) {
          if (stale >= 3) break;
          stale++;
          await sleep(1000);
          continue;
        }
        stale = 0;
        var before = ready.length;
        ready.forEach(function (b) { if (b.isConnected) b.click(); });
        total += before;
        setStatus('取邮件：提交 ' + before + ' 封，累计 ' + total + ' 封…');
        await sleep(1600);

        // 领成功后按钮会消失；数量没减少说明被拒（负重满 / 背包满 / 邮件异常）
        var left = mailClaimButtons(win).length;
        if (left >= before) {
          fails++;
          if (fails >= 3) {
            setStatus('取邮件：还有 ' + left + ' 封领不下来（可能负重满 / 背包满 / 邮件异常），已提交 ' + total + ' 封');
            return;
          }
        } else fails = 0;
      }
      setStatus(total ? '取邮件：完成，共提交 ' + total + ' 封的附件' : '取邮件：收件箱里没有可领的附件');
    } catch (e) {
      setStatus('取邮件失败：' + ((e && e.message) || e));
    } finally {
      claimingMail = false;
      if (cb) cb.disabled = false;
    }
  }

  // 邮件卡片里所有「收取附件」按钮（有 Zeny 或道具附件的邮件才有这个按钮）
  function mailClaimButtons(win) {
    return Array.prototype.slice.call(win.querySelectorAll('.mail-card-actions button'))
      .filter(function (b) { return b.textContent.trim() === '收取附件'; });
  }

  async function mailAll() {
    if (mailing) return;
    var doc = getGameDoc();
    if (!doc) { setStatus('找不到游戏页面'); return; }
    var target = mailTargetName();
    mailing = true;
    updateButtons();
    try {
      var win = await ensureMailOpen(doc);
      if (!win) throw stopError('打不开邮件窗口');

      // 发给其他账号：只把收件人 / 标题 / 内容填好，道具和钱自己手动放
      if (target !== MAIL_TO) {
        await composeMail(doc, win, target);
        setStatus('已给 ' + target + ' 写好邮件（收件人/标题/内容已填），请手动放道具和钱后点发送');
        return;
      }

      // 发给皮城辅警：老方法，一封封寄，直到背包里没有可寄的东西
      var sent = 0;
      for (var n = 0; n < MAIL_MAX; n++) {
        setStatus('发邮件中… 第 ' + (n + 1) + ' 封，已寄 ' + sent + ' 件');
        var form = await composeMail(doc, win, target);
        var names = await pickAttachments(doc, form);
        var cnt = names.length;
        if (!cnt) {
          var close = form.querySelector('button[aria-label="关闭写邮件"]');
          if (close) close.click();
          break;
        }
        await sendMail(doc, form);
        // 寄走的装备取消「邮」标记，避免同款再次被误寄
        var changed = false;
        records.forEach(function (r) {
          if (r.mail && names.indexOf(normName(r.name)) >= 0) { r.mail = false; changed = true; }
        });
        if (changed) { saveRecords(); render(); }
        sent += cnt;
        await sleep(3000);   // 留出间隔，避免触发服务器发信频率限制
      }
      setStatus(sent
        ? '发邮件完成：共寄出 ' + sent + ' 件给 ' + target + '（包里已没有可寄的东西）'
        : '没有符合条件的物品可寄（消耗品只寄非保留项，装备需先点「邮」标记）');
    } catch (err) {
      setStatus('发邮件中断：' + (err && err.message ? err.message : err));
    } finally {
      mailing = false;
      updateButtons();
      // 寄完就把收件人面板收起来，别一直占着位置
      var box = $('mailbox');
      if (box) box.style.display = 'none';
    }
  }

  // 按指定名字挑附件（勾选邮寄用）：最多 5 件，逐个搜索并选中
  async function pickByName(doc, form, names) {
    var list = [];
    (names || []).forEach(function (n) {
      var v = normName(n);
      if (v && list.indexOf(v) < 0) list.push(v);
    });
    list = list.slice(0, MAIL_BATCH);
    if (!list.length) throw stopError('没有勾选可邮寄的装备');

    var add = btnByText(form, '选择背包道具');
    if (!add || add.disabled) throw stopError('「选择背包道具」不可用');
    add.click();
    var pk = await waitFor(function () {
      var p = doc.querySelector('.inventory-picker-backdrop');
      return p && visible(p) ? p : null;
    }, 2500);
    if (!pk) throw stopError('附件选择框没打开');

    var tab = btnByText(pk, '装备');
    if (tab && !tab.classList.contains('active')) {
      tab.click();
      await sleep(500);
    }

    var picked = [];
    for (var i = 0; i < list.length; i++) {
      var cur = doc.querySelector('.inventory-picker-backdrop');
      if (!cur) break;
      var search = cur.querySelector('.inventory-picker-tools input');
      if (!search) throw stopError('找不到附件搜索框');
      setVal(search, list[i]);
      await sleep(500);

      // 列表每次都会重渲染，逐次重新查；同名只选一件（背包里同名多件无法区分）
      var guard = 0, target = null;
      while (guard++ < 12 && !target) {
        var fresh = doc.querySelector('.inventory-picker-backdrop');
        if (!fresh) break;
        var choices = Array.prototype.slice.call(fresh.querySelectorAll('.inventory-picker-choice'));
        for (var j = 0; j < choices.length; j++) {
          if (choices[j].getAttribute('aria-pressed') === 'true') continue;
          if (choiceName(choices[j]) === list[i]) { target = choices[j]; break; }
        }
        if (!target) await sleep(250);
      }
      if (!target) continue;
      target.click();
      var qBox = await waitFor(function () {
        var p = doc.querySelector('.inventory-picker-backdrop');
        return p && p.querySelector('.inventory-picker-quantity');
      }, 1200);
      if (qBox) {
        var qInput = qBox.querySelector('input');
        var qMax = qInput ? parseInt(qInput.getAttribute('max'), 10) : 0;
        if (qInput && qMax > 1) {
          setVal(qInput, String(qMax));
          await sleep(200);
        }
        var qok = btnByText(qBox, '确定');
        if (qok) qok.click();
        await sleep(200);
      }
      picked.push(list[i]);
      await sleep(150);
    }

    var freshPk = doc.querySelector('.inventory-picker-backdrop');
    if (!picked.length) {
      var cancel = freshPk && btnByText(freshPk, '取消');
      if (cancel) cancel.click();
      await sleep(300);
      return { picked: [], missing: list };
    }

    var okBtn = freshPk && btnByText(freshPk, '确认选择');
    if (!okBtn) throw stopError('找不到「确认选择」');
    okBtn.click();
    await waitFor(function () { return !doc.querySelector('.inventory-picker-backdrop'); }, 3000);
    await sleep(300);
    return {
      picked: picked,
      missing: list.filter(function (n) { return picked.indexOf(n) < 0; })
    };
  }

  // 邮寄勾选：把表格里勾选的装备（最多 5 件）寄给上面选的角色
  async function mailSelected() {
    if (mailing) return;
    var doc = getGameDoc();
    if (!doc) { setStatus('找不到游戏页面'); return; }

    var names = [];
    records.forEach(function (r) {
      if (!selected[recKey(r)] || !r.name) return;
      var n = normName(r.name);
      if (names.indexOf(n) < 0) names.push(n);
    });
    if (!names.length) { setStatus('先在表格里勾选要邮寄的装备'); return; }
    if (names.length > MAIL_BATCH) {
      setStatus('勾选了 ' + names.length + ' 种装备，一次最多寄 ' + MAIL_BATCH + ' 件，请减少勾选');
      return;
    }

    var target = mailTargetName();
    mailing = true;
    updateButtons();
    try {
      var win = await ensureMailOpen(doc);
      if (!win) throw stopError('打不开邮件窗口');
      var form = await composeMail(doc, win, target);
      var res = await pickByName(doc, form, names);
      if (!res.picked.length) {
        var close = form.querySelector('button[aria-label="关闭写邮件"]');
        if (close) close.click();
        throw stopError('背包里没找到勾选的装备：' + names.join('、'));
      }
      await sendMail(doc, form);
      setStatus('已寄出 ' + res.picked.length + ' 件给 ' + target + '：' + res.picked.join('、')
        + (res.missing.length ? '（没找到：' + res.missing.join('、') + '）' : ''));
      // 寄走的取消勾选，避免同款重复邮寄
      records.forEach(function (r) {
        if (!selected[recKey(r)]) return;
        if (res.picked.indexOf(normName(r.name)) >= 0) selected[recKey(r)] = 0;
      });
      render();
    } catch (err) {
      setStatus('邮寄勾选失败：' + (err && err.message ? err.message : err));
    } finally {
      mailing = false;
      updateButtons();
    }
  }

  /* ---------------- 市场行情 · 建议价 · 自动上架 ---------------- */

  var MARKET_KEY = 'ro-auto-identify-market-v1';
  var SCAN_MAX_PAGES = 6;      // 扫行情最多翻几页
  var market = loadMarket();
  var scanning = false;

  function loadMarket() {
    try {
      var o = JSON.parse(localStorage.getItem(MARKET_KEY) || 'null');
      return o && Array.isArray(o.items) ? o : { ts: 0, items: [], perPoint: 0 };
    } catch (e) { return { ts: 0, items: [], perPoint: 0 }; }
  }

  function saveMarket() {
    try { localStorage.setItem(MARKET_KEY, JSON.stringify(market)); } catch (e) {}
  }

  function clickByText(node, text) {
    return Array.prototype.slice.call(node.querySelectorAll('button'))
      .filter(function (b) { return b.textContent.trim() === text && !b.disabled; })[0] || null;
  }

  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // 扫「市场」当前页挂单：逐件打开详情读词条，算总分和价格
  async function scanMarket() {
    var doc = getGameDoc();
    if (!doc) { setStatus('找不到游戏页面'); return; }
    var win = await ensureAuctionOpen(doc);
    if (!win) { setStatus('打不开寄售窗口'); return; }
    var fx = clickByText(win, '一口价');
    if (fx && !fx.classList.contains('active')) { fx.click(); await sleep(500); }
    var mk = clickByText(win, '市场');
    if (mk && !mk.classList.contains('active')) { mk.click(); await sleep(1000); }

    scanning = true;
    var out = [];
    for (var page = 0; page < SCAN_MAX_PAGES && scanning; page++) {
      var rows = await waitFor(function () {
        var r = Array.prototype.slice.call(win.querySelectorAll('.auction-row:not(.bid):not(.mine):not(.claim)'));
        return r.length ? r : null;
      }, 5000) || [];
      if (!rows.length) break;
      var sig = (rows[0].textContent || '').trim().slice(0, 30);

      for (var i = 0; i < rows.length && scanning; i++) {
        setStatus('扫行情… 第 ' + (page + 1) + ' 页 ' + (i + 1) + '/' + rows.length + '（已收 ' + out.length + ' 条）');
        var row = rows[i];
        try {
          var pEl = row.querySelector('strong[data-currency]');
          var price = pEl ? (parseInt((pEl.textContent || '').replace(/[^\d]/g, ''), 10) || 0) : 0;
          var main = row.querySelector('button.auction-item-main');
          if (!main || !price) continue;
          main.click();
          var det = await waitDetail(doc, null);
          if (!det) continue;
          var res = parseDetail(det);
          closeDetail(det);
          await sleep(240);
          var sc = scoreRecord(res);
          out.push({
            name: res.name, price: price, total: sc.total, smax: sc.smax, s90: sc.s90
          });
        } catch (e) {}
      }

      // 翻下一页，直到按钮禁用/不存在
      var next = clickByText(win, '下一页');
      if (!next) break;
      next.click();
      var changed = await waitFor(function () {
        var r = win.querySelector('.auction-row:not(.bid):not(.mine):not(.claim)');
        return r && (r.textContent || '').trim().slice(0, 30) !== sig;
      }, 5000);
      if (!changed) break;
      await sleep(400);
    }
    scanning = false;

    var pts = out.filter(function (x) { return x.total > 0 && x.price > 0; })
      .map(function (x) { return x.price / x.total; });

    // 按总分分 5 档做基准，避免低价杂货把高价装备的价拉低
    var buckets = [];
    for (var b = 0; b < 5; b++) {
      var lo = b * 10, hi = lo + 10;
      var seg = out.filter(function (x) { return x.total > lo && x.total <= hi && x.price > 0; });
      if (seg.length < 2) continue;
      buckets.push({
        lo: lo, hi: hi, n: seg.length,
        perPoint: median(seg.map(function (x) { return x.price / x.total; }))
      });
    }

    market = { ts: Date.now(), items: out, perPoint: median(pts), buckets: buckets };
    saveMarket();
    render();
    if (!out.length) setStatus('没扫到有效挂单（可能都没词条）');
    else setStatus('行情已更新：' + out.length + ' 条挂单 · 基准 ' + Math.round(market.perPoint) + ' Z/分');
  }

  // 建议价：同款挂单优先，其次同分数档，最后全局基准
  function suggestPrice(rec, sc) {
    if (!market.items.length || !market.perPoint) return 0;
    if (!(sc.total > 0)) return 0;
    var same = market.items.filter(function (m) {
      return m.total > 0 && m.price > 0 && m.name === rec.name;
    });
    var p;
    if (same.length) {
      p = median(same.map(function (m) { return m.price / m.total; }));
    } else {
      var bk = (market.buckets || []).filter(function (x) {
        return sc.total > x.lo && sc.total <= x.hi;
      })[0];
      p = bk ? bk.perPoint : market.perPoint;
    }
    return Math.max(1000, Math.round(sc.total * p / 1000) * 1000);
  }

  // 在上架表单的选物弹层里按名字挑一件
  async function pickInventoryItem(doc, name) {
    var bd = await waitFor(function () { return doc.querySelector('.inventory-picker-backdrop'); }, 2500);
    if (!bd) return false;
    var tb = clickByText(bd, '装备');
    if (tb && !tb.classList.contains('active')) { tb.click(); await sleep(300); }
    var cells = Array.prototype.slice.call(bd.querySelectorAll('.inventory-picker-choice'));
    var hit = cells.filter(function (c) {
      return ((c.textContent || '').split('#')[0]).trim() === name;
    })[0] || cells.filter(function (c) {
      return (c.textContent || '').indexOf(name) >= 0;
    })[0];
    if (!hit) return false;
    hit.click();
    await sleep(180);
    var ok = clickByText(bd, '确认选择');
    if (ok) ok.click();
    await waitFor(function () { return !doc.querySelector('.inventory-picker-backdrop'); }, 2000);
    return true;
  }

  // 一口价上架一件（30 天），成功返回 true
  async function listEquipment(rec, price) {
    var doc = getGameDoc();
    if (!doc) throw stopError('找不到游戏页面');
    var win = await ensureAuctionOpen(doc);
    if (!win) throw stopError('打不开寄售窗口');

    var mine = clickByText(win, '我的上架');
    if (mine && !mine.classList.contains('active')) { mine.click(); await sleep(900); }
    var form = await waitFor(function () { return doc.querySelector('.auction-list-form'); }, 3000);
    if (!form) throw stopError('没找到上架表单');

    var pickBtn = Array.prototype.slice.call(form.querySelectorAll('button'))
      .filter(function (b) { return b.textContent.indexOf('选择背包道具') >= 0; })[0];
    if (!pickBtn) throw stopError('没找到「选择背包道具」按钮');
    pickBtn.click();
    if (!(await pickInventoryItem(doc, rec.name))) {
      var cancel = doc.querySelector('.inventory-picker-actions button');
      if (cancel) cancel.click();
      throw stopError('背包里没找到「' + rec.name + '」');
    }
    await sleep(250);

    var inputs = form.querySelectorAll('input[type=number]');
    if (inputs.length < 2) throw stopError('上架表单结构异常');
    setInputValue(inputs[0], 1);
    setInputValue(inputs[1], price);
    await sleep(200);

    var submit = form.querySelector('button.primary');
    if (!submit || submit.disabled) throw stopError('「上架」按钮不可用');
    submit.click();

    var dlg = await waitFor(function () {
      var d = doc.querySelector('.app-dialog');
      return d && visible(d) ? d : null;
    }, 3000);
    if (!dlg) throw stopError('没等到上架确认框');
    var ok = dlg.querySelector('button.app-dialog-confirm')
      || Array.prototype.slice.call(dlg.querySelectorAll('button')).filter(function (b) {
        return /^(确定|确认)$/.test(b.textContent.trim());
      })[0];
    if (!ok) throw stopError('确认框里没找到确定按钮');
    ok.click();
    await waitFor(function () { return !doc.querySelector('.app-dialog'); }, 2500);
    return true;
  }

  // 批量上架所有「建议卖」且还没处理的
  async function listRecommended() {
    if (!market.items.length) { setStatus('先点「扫行情」拿到市场价'); return; }
    var todo = records.filter(function (r) {
      return r.options && r.options.length
        && advise(scoreRecord(r)).t === '建议卖'
        && r.decision !== '保留' && r.decision !== '已卖' && r.decision !== '已上架';
    });
    if (!todo.length) { setStatus('没有需要上架的装备'); return; }
    var okN = 0;
    for (var i = 0; i < todo.length; i++) {
      var r = todo[i];
      var sc = scoreRecord(r);
      var price = suggestPrice(r, sc);
      setStatus('上架中… ' + (i + 1) + '/' + todo.length + ' ' + r.name);
      try {
        await listEquipment(r, price);
        r.decision = '已上架';
        saveRecords();
        render();
        okN++;
      } catch (e) {
        setStatus('上架失败：' + (e.message || e));
        await sleep(600);
        break;
      }
      await sleep(300);
    }
    setStatus('已上架 ' + okN + ' 件');
  }

  // 批量上架勾选的装备（按建议价），需先「扫行情」拿到市场价
  async function listSelected() {
    if (!market.items.length) { setStatus('先点「扫行情」拿到市场价'); return; }
    var todo = records.filter(function (r) {
      if (!selected[recKey(r)]) return false;
      if (!r.options || !r.options.length) return false;
      return r.decision !== '保留' && r.decision !== '已卖' && r.decision !== '已上架';
    });
    if (!todo.length) { setStatus('先勾选要上架的装备'); return; }
    var okN = 0, skipN = 0;
    for (var i = 0; i < todo.length; i++) {
      var r = todo[i];
      var price = suggestPrice(r, scoreRecord(r));
      if (!(price > 0)) { skipN++; continue; }
      setStatus('上架中… ' + (i + 1) + '/' + todo.length + ' ' + r.name);
      try {
        await listEquipment(r, price);
        r.decision = '已上架';
        selected[recKey(r)] = 0;
        saveRecords();
        render();
        okN++;
      } catch (e) {
        setStatus('上架失败：' + (e.message || e));
        await sleep(600);
        break;
      }
      await sleep(300);
    }
    setStatus('已上架 ' + okN + ' 件' + (skipN ? '（' + skipN + ' 件没有建议价，跳过）' : ''));
  }

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function updateButtons() {
    runBtn.disabled = running;
    stopBtn.disabled = !running;
    countEl.textContent = records.length;
  }

  // ---- 勾选（批量卖出用） ----
  var selected = {};
  var lastShown = [];
  function recKey(r) { return (r.sig || '') + '@' + (r.ts || 0); }
  function pruneSelected() {
    var keep = {};
    records.forEach(function (r) { if (selected[recKey(r)]) keep[recKey(r)] = 1; });
    selected = keep;
  }
  function selCount() {
    var n = 0;
    Object.keys(selected).forEach(function (k) { if (selected[k]) n++; });
    return n;
  }
  function updateSelUi() {
    var n = selCount();
    var b = $('sellnow');
    if (b) b.textContent = n ? ('批量卖出选中 (' + n + ')') : '批量卖出选中';
    var c = $('selcount');
    if (c) c.textContent = n ? ('已勾选 ' + n + ' 件') : '未勾选';
    var all = $('ck-all');
    if (all) {
      var keys = lastShown.map(function (e) { return recKey(e.r); });
      var on = keys.length > 0 && keys.every(function (k) { return selected[k]; });
      all.checked = on;
      all.indeterminate = !on && keys.some(function (k) { return selected[k]; });
    }
  }

  function render() {
    countEl.textContent = records.length;
    var kw = filterEl.value.trim();
    // 不区分职业：默认按评级从高到低排名
    var shown = records.filter(function (r) {
      if (!kw) return true;
      return (r.name || '').indexOf(kw) >= 0
        || (r.series || '').indexOf(kw) >= 0
        || (r.equipFor || '').indexOf(kw) >= 0
        || (r.options || []).some(function (o) { return o.indexOf(kw) >= 0; });
    }).map(function (r) {
      return { r: r, sc: scoreRecord(r) };
    }).sort(function (a, b) {
      // 默认按评级从高到低：S > S- > A > B > C > D；同评级按总分、再按新鉴定优先
      var ga = GRADE_RANK[a.sc.grade] || 0;
      var gb = GRADE_RANK[b.sc.grade] || 0;
      if (gb !== ga) return gb - ga;
      if (b.sc.total !== a.sc.total) return b.sc.total - a.sc.total;
      return (b.r.ts || 0) - (a.r.ts || 0);
    });

    pruneSelected();
    lastShown = shown;
    listEl.textContent = '';
    if (!shown.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = records.length ? '没有匹配的记录' : '还没有记录';
      listEl.appendChild(empty);
      updateSelUi();
      return;
    }

    var tbl = document.createElement('table');
    tbl.className = 'tbl';
    var thead = document.createElement('thead');
    var htr = document.createElement('tr');

    var hck = document.createElement('th');
    hck.className = 'ck';
    var ckAll = document.createElement('input');
    ckAll.type = 'checkbox';
    ckAll.id = 'ck-all';
    ckAll.title = '全选 / 取消全选（当前筛选结果）';
    ckAll.addEventListener('change', function () {
      shown.forEach(function (e) { selected[recKey(e.r)] = ckAll.checked ? 1 : 0; });
      listEl.querySelectorAll('tbody tr').forEach(function (tr) {
        var k = tr.getAttribute('data-k');
        var on = !!selected[k];
        tr.classList.toggle('sel', on);
        var cb = tr.querySelector('input.ck');
        if (cb) cb.checked = on;
      });
      updateSelUi();
    });
    hck.appendChild(ckAll);
    htr.appendChild(hck);
    ['#', '名称', '评级', '分数', 'S', '建议', '部位', '可装备', 'Lv', '词条', '决定'].forEach(function (t) {
      var th = document.createElement('th');
      th.textContent = t;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    tbl.appendChild(thead);

    var tbody = document.createElement('tbody');
    shown.forEach(function (entry, idx) {
      var r = entry.r, sc = entry.sc;
      var k = recKey(r);
      var tr = document.createElement('tr');
      tr.setAttribute('data-k', k);
      if (selected[k]) tr.classList.add('sel');

      // 勾选
      var ck = document.createElement('td');
      ck.className = 'ck';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'ck';
      cb.checked = !!selected[k];
      cb.addEventListener('change', function () {
        selected[k] = cb.checked ? 1 : 0;
        tr.classList.toggle('sel', cb.checked);
        updateSelUi();
      });
      ck.appendChild(cb);

      // 名称
      var nm = document.createElement('td');
      nm.className = 'nm';
      nm.textContent = r.name || ('#' + r.itemId);
      nm.title = r.name || '';

      // 评级 / 分数
      var gd = document.createElement('td');
      var gs = document.createElement('span');
      gs.className = 'score g-' + sc.grade;
      gs.textContent = sc.grade;
      gd.appendChild(gs);

      var sy = document.createElement('td');
      sy.textContent = sc.max ? (sc.total.toFixed(1) + '/' + sc.max) : '—';

      // S 标记
      var ss = document.createElement('td');
      if (sc.smax > 0 || sc.s90 > 0) {
        var sb = document.createElement('span');
        sb.className = 'sb';
        sb.textContent = new Array(sc.smax + 1).join('S') + new Array(sc.s90 + 1).join('S-');
        sb.title = sc.smax
          ? 'S：第 1 条 STR/DEX/INT 与第 4 条 ATK/MATK 都 ≥45（满值 90%）'
          : 'S-：第 1 条 STR/DEX/INT 与第 4 条 ATK/MATK 都 ≥40（满值 80%）';
        ss.appendChild(sb);
      }

      // 建议
      var ad = document.createElement('td');
      var adv = (r.options && r.options.length) ? advise(sc) : null;
      if (adv) {
        var at = document.createElement('span');
        at.className = 'tag ' + adv.cls;
        at.textContent = adv.cls === 'keep' ? '留' : '卖';
        at.title = adv.why;
        ad.appendChild(at);
      }

      // 部位 / 可装备 / 等级
      var ser = document.createElement('td');
      ser.textContent = r.series || '';
      ser.title = r.series || '';
      var eq = document.createElement('td');
      eq.textContent = r.equipFor || '';
      eq.title = r.equipFor || '';
      var lv = document.createElement('td');
      lv.textContent = r.reqLv ? ('Lv.' + r.reqLv) : '';

      // 词条（一行 5 列：简称 + 等级，悬停看完整属性）
      var op = document.createElement('td');
      op.className = 'opts2';
      if (r.options && r.options.length) {
        var opsRow = document.createElement('div');
        opsRow.className = 'ops-row';
        sc.items.forEach(function (item) {
          var g = affixGrade(item.pct);
          var cell = document.createElement('div');
          cell.className = 'op1';
          var tx = document.createElement('span');
          tx.className = 'tx';
          tx.textContent = affixShort(item.affix);
          var gd = document.createElement('span');
          gd.className = 'g g' + g;
          gd.textContent = g;
          cell.appendChild(tx);
          cell.appendChild(gd);
          cell.title = item.text + ' · ' + Math.round(item.pct * 100) + '%'
            + (item.affix
              ? ('\n第' + item.affix.cat.replace('第', '') + '条 · ' + item.affix.tab + ' ' + item.affix.num
                + (item.affix.rec ? ' · 推荐：' + recLabel(item.affix.rec) : ''))
              : '\n词条表里没有匹配到');
          opsRow.appendChild(cell);
        });
        op.appendChild(opsRow);
      } else {
        op.textContent = '—';
      }

      // 决定
      var dec = document.createElement('td');
      dec.className = 'dec2';
      [['keep', '留'], ['sell', '卖'], ['pending', '待']].forEach(function (pair) {
        var b = document.createElement('button');
        b.textContent = pair[1];
        var cur = r.decision || '待定';
        var on = (pair[0] === 'keep' && cur === '保留')
          || (pair[0] === 'sell' && cur === '卖出')
          || (pair[0] === 'pending' && cur === '待定');
        if (on) b.className = 'on ' + pair[0];
        b.addEventListener('click', function () {
          r.decision = pair[1];
          saveRecords();
          render();
        });
        dec.appendChild(b);
      });

      tr.appendChild(ck);
      tr.appendChild(document.createElement('td')).className = 'rk';
      tr.lastChild.textContent = '#' + (idx + 1);
      tr.appendChild(nm);
      tr.appendChild(gd);
      tr.appendChild(sy);
      tr.appendChild(ss);
      tr.appendChild(ad);
      tr.appendChild(ser);
      tr.appendChild(eq);
      tr.appendChild(lv);
      tr.appendChild(op);
      tr.appendChild(dec);
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    listEl.appendChild(tbl);
    updateSelUi();
  }

  $('autosell').addEventListener('click', function () {
    autoSell = !autoSell;
    this.textContent = '自动卖：' + (autoSell ? '开' : '关');
    this.classList.toggle('on', autoSell);
    setStatus(autoSell ? '自动卖已开：鉴定时请在店里打开「出售道具」，判定建议卖会直接卖掉' : '自动卖已关');
  });
  $('sellnow').addEventListener('click', function () { sellSelected(); });
  $('sells').addEventListener('click', function () { sellBelow('s'); });
  $('sellsmin').addEventListener('click', function () { sellBelow('sminus'); });
  $('sellsa').addEventListener('click', function () { selectBelowA(); });
  $('stash-sel').addEventListener('click', function () { stashSelected(); });
  (function initKeepRatio() {
    var inp = $('keepratio');
    if (!inp) return;
    inp.value = String(Math.round(KEEP_RATIO * 100));
    inp.addEventListener('change', function () {
      var v = setKeepRatio(inp.value);
      inp.value = String(Math.round(v * 100));
      render();
      setStatus('留/卖判定已改为：总分 ≥ ' + Math.round(v * 100) + '% 建议留，其余建议卖');
    });
  })();
  $('selinv').addEventListener('click', function () {
    if (!lastShown.length) { setStatus('表格里没有可反选的记录'); return; }
    lastShown.forEach(function (e) {
      var k = recKey(e.r);
      selected[k] = selected[k] ? 0 : 1;
    });
    render();
  });

  runBtn.addEventListener('click', function () { run(MAX_PER_RUN); });
  stopBtn.addEventListener('click', function () {
    running = false;
    scanning = false;
    setStatus('正在停止…当前这件处理完就停');
  });
  $('casbtn').addEventListener('click', function () {
    if (CAS.on) { CAS.on = false; showCasbar(false); setStatus('起号已停止（转生 ' + CAS.reborns + '/' + CAS_TARGET_REBORN + '）'); return; }
    var doc = getGameDoc() || document;
    var info = railInfo(doc);
    casBind(doc);
    // ZENY 只影响转生，不再作为启动硬门槛；不够就先练级/攒钱
    if (info.zeny > 0 && info.zeny < 5000000) {
      setStatus('起号：ZENY 只有 ' + info.zeny + ' Z（转生建议 500 万+），仍先按流程升级');
    }
    casRun();
  });

  // 买药 / 修装备不再单独给按钮：狩猎循环和野外 BOSS 里已经按需自动调用 buyPotions / tryRepair

  // 挂机途中被怪物技能卸下的装备：每 10 秒查一次，及时穿回
  var wornTimerBusy = false;
  setInterval(function () {
    if (wornTimerBusy) return;
    wornTimerBusy = true;
    checkStripped().then(function (msg) {
      if (msg) setStatus(msg);
      wornTimerBusy = false;
    }, function () { wornTimerBusy = false; });
  }, 10000);
  $('huntbtn').addEventListener('click', function () {
    if (HUNT.on) { HUNT.on = false; setHuntBtn(false); setStatus('狩猎任务已停止'); return; }
    huntRun();
  });
  // 页面被自动刷新后接着狩猎（casOpenNpc 判定客户端卡死时会写这个标记）
  (function initHuntResume() {
    var want = '';
    try { want = localStorage.getItem('ro-hunt-autoresume') || ''; } catch (e) {}
    if (want !== '1') return;
    var n = 0;
    var t = setInterval(function () {
      n++;
      var d = getGameDoc() || document;
      var ri = railInfo(d);
      if (ri && ri.baseLv > 0) {
        clearInterval(t);
        if (!HUNT.on) {
          setStatus('页面刷新完成，自动重启狩猎…');
          huntRun();
        } else {
          try { localStorage.removeItem('ro-hunt-autoresume'); } catch (e) {}
        }
        return;
      }
      if (n >= 60) {
        clearInterval(t);
        try { localStorage.removeItem('ro-hunt-autoresume'); } catch (e) {}
      }
    }, 500);
  })();
  $('wildbtn').addEventListener('click', function () {
    if (WILD.on) { stopWild(''); setStatus('野外BOSS 已停止'); return; }
    wildRun();
  });
  $('craftbtn').addEventListener('click', function () {
    if (CRAFT.on) { CRAFT.on = false; setCraftBtn(false); setStatus('影装合成 已停止'); return; }
    craftRun();
  });
  // 套用布局：把源账号的浮动窗口布局（位置/大小/吸附关系）复制到其他账号
  // 游戏按「登录账号名」分别存 localStorage：rathena-game-window-layout-v17:<账号名>
  $('layoutbtn').addEventListener('click', function () {
    var bar = $('layoutbar');
    var show = bar.style.display === 'none';
    bar.style.display = show ? 'flex' : 'none';
    if (show) {
      var el = $('layout-src');
      if (el) { try { el.focus(); el.select(); } catch (e) {} }
    }
  });
  $('layout-go').addEventListener('click', function () {
    var el = $('layout-src');
    var src = ((el && el.value) || '').trim();
    if (!src) { setStatus('套用布局：先填源账号名'); return; }
    var r = copyWindowLayout(src);
    if (!r.ok) { setStatus('套用布局：' + r.msg); return; }
    if (!r.done.length) { setStatus('套用布局：没有可套用的其他账号（' + r.msg + '）'); return; }
    setStatus('布局已套用到 ' + r.done.join('、') + '（' + r.keys + ' 类窗口），正在刷新页面…');
    setTimeout(function () {
      try { window.top.location.reload(); } catch (e) { location.reload(); }
    }, 1200);
  });
  function normAccountName(s) {
    return String(s || '').trim().replace(/_[mMfF]$/, '').toLowerCase();
  }
  function readAccounts() {
    try {
      var cfg = JSON.parse(localStorage.getItem('rathena-multi-accounts:v1') || '{}');
      return Array.isArray(cfg.accounts) ? cfg.accounts : [];
    } catch (e) { return []; }
  }
  // 顶层页面里各账号 iframe：按角色名找 account-frame id
  function accountIdByCharName(name) {
    var n = normAccountName(name);
    if (!n) return '';
    try {
      var frames = Array.prototype.slice.call(window.top.document.querySelectorAll('iframe'));
      for (var i = 0; i < frames.length; i++) {
        var d = null;
        try { d = frames[i].contentDocument; } catch (e) { continue; }
        if (!d || normAccountName(charNameOf(d)) !== n) continue;
        var m = String(frames[i].src || '').match(/account-frame=([^&]+)/);
        if (m) return decodeURIComponent(m[1]);
      }
    } catch (e) {}
    return '';
  }
  // 输入可以是账号名，也可以是角色名
  function resolveAccount(name, accounts, owners) {
    var n = normAccountName(name);
    if (!n) return '';
    for (var i = 0; i < owners.length; i++) {
      var o = owners[i];
      try { o = decodeURIComponent(o); } catch (e) {}
      if (normAccountName(o) === n) return normAccountName(o);
    }
    for (var j = 0; j < accounts.length; j++) {
      if (accounts[j] && normAccountName(accounts[j].username) === n) return n;
    }
    for (var k = 0; k < accounts.length; k++) {
      var a = accounts[k] || {};
      if (a.username && normAccountName(a.lastCharacterName) === n) return normAccountName(a.username);
    }
    // 角色名 → 正在开着的 iframe → 对应账号
    var id = accountIdByCharName(name);
    if (id) {
      for (var m = 0; m < accounts.length; m++) {
        if (accounts[m] && accounts[m].id === id) return normAccountName(accounts[m].username);
      }
    }
    return '';
  }
  function ownerLabel(raw, accounts) {
    var n = raw;
    try { n = decodeURIComponent(raw); } catch (e) {}
    for (var i = 0; i < accounts.length; i++) {
      var a = accounts[i] || {};
      if (normAccountName(a.username) === n && a.lastCharacterName) return n + '（' + a.lastCharacterName + '）';
    }
    return n;
  }
  // 复制账号布局；返回 {ok, msg, done[], keys}
  function copyWindowLayout(srcName) {
    var LAYOUT_KEYS = [
      'rathena-game-window-layout-v17',
      'rathena-autoattack-layout-v1',
      'rathena-statistics-layout-v1',
      'rathena-social-layout-v1',
      'rathena-party-layout-v2'
    ];
    var accounts = readAccounts();
    var byOwner = {}, owners = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i) || '';
        var hit = null;
        for (var j = 0; j < LAYOUT_KEYS.length; j++) {
          if (k.indexOf(LAYOUT_KEYS[j] + ':') === 0) { hit = LAYOUT_KEYS[j]; break; }
        }
        if (!hit) continue;
        var who = k.slice(hit.length + 1);
        if (!byOwner[who]) { byOwner[who] = {}; owners.push(who); }
        byOwner[who][hit] = localStorage.getItem(k);
      }
    } catch (e) { return { ok: false, msg: '读取布局失败：' + e.message }; }

    var src = resolveAccount(srcName, accounts, owners);
    if (!src) {
      var names = owners.map(function (n) { return ownerLabel(n, accounts); });
      return { ok: false, msg: '没有「' + srcName + '」的布局' + (names.length ? '；可选：' + names.join('、') : '（该账号要先登录过）') };
    }
    var srcKey = '';
    for (var s = 0; s < owners.length; s++) {
      var ow = owners[s];
      try { ow = decodeURIComponent(ow); } catch (e) {}
      if (normAccountName(ow) === src) { srcKey = owners[s]; break; }
    }
    var data = (srcKey && byOwner[srcKey]) || {};
    var keys = Object.keys(data);
    if (!keys.length) return { ok: false, msg: '账号「' + src + '」还没存过布局（登录后调整一下窗口再试）' };

    // 目标账号：游戏多开配置里的账号名（与游戏自己写布局用的名字一致）
    var targets = [];
    accounts.forEach(function (a) {
      var n = normAccountName(a && a.username);
      if (n && n !== src && targets.indexOf(n) < 0) targets.push(n);
    });
    if (!targets.length) {
      owners.forEach(function (raw) {
        var n = raw;
        try { n = decodeURIComponent(raw); } catch (e) {}
        if (n && normAccountName(n) !== src && targets.indexOf(normAccountName(n)) < 0) targets.push(normAccountName(n));
      });
    }
    if (!targets.length) return { ok: false, msg: '没找到可套用的其他账号（多开列表为空）' };

    var done = [], fail = [];
    targets.forEach(function (n) {
      var t = ':' + encodeURIComponent(n);
      try {
        keys.forEach(function (k) { localStorage.setItem(k + t, data[k]); });
        done.push(n);
      } catch (e) { fail.push(n); }
    });
    return { ok: true, msg: fail.length ? '写入失败：' + fail.join('、') : '', done: done, keys: keys.length };
  }
  // 野外BOSS 目标地图关键词：留空则选传送列表第一项
  (function initWildKey() {
    var el = $('wild-key');
    if (!el) return;
    el.value = WILD.key || '';
    el.addEventListener('change', function () {
      WILD.key = el.value.trim();
      try { localStorage.setItem(WILD_KEY, WILD.key); } catch (e) {}
      setStatus(WILD.key ? '野外BOSS 目标地图：含「' + WILD.key + '」' : '野外BOSS 目标：传送列表第一项');
    });
  })();
  // 面板「更新」：检查远程热更新
  //   左键      = 检查远端 version.json，有新版就热替换并刷新页面
  //   Shift+左键 = 设置远程更新目录（version.json 所在目录，留空清除）
  //   Alt+左键   = 强制刷新页面
  (function initUpdate() {
    var btn = $('upd');
    var vEl = $('ver');
    if (vEl && SHOWN_VERSION) vEl.textContent = 'v' + SHOWN_VERSION;
    if (!btn) return;
    btn.title = '左键：检查远程更新 · Shift+左键：设置远程地址 · Alt+左键：刷新页面';
    if (!SHOWN_VERSION) { btn.style.display = 'none'; return; }   // 油猴脚本/控制台注入时隐藏

    function viaBridge(msg, cb) {
      var id = 'rq' + Date.now() + Math.floor(Math.random() * 1e6);
      var done = false;
      function fin(data) {
        if (done) return;
        done = true;
        window.removeEventListener('ro-remote-response', onResp);
        if (cb) cb(data || {});
      }
      function onResp(ev) {
        var d = (ev && ev.detail) || {};
        if (d.id === id) fin(d.data);
      }
      window.addEventListener('ro-remote-response', onResp);
      window.dispatchEvent(new CustomEvent('ro-remote-request', { detail: { id: id, msg: msg } }));
      setTimeout(function () { fin({ ok: false, msg: '后台无响应，试试 Alt+点「更新」刷新页面' }); }, 12000);
    }

    btn.addEventListener('click', function (ev) {
      if (ev.altKey) {
        setStatus('更新：正在刷新页面…');
        setTimeout(function () { location.reload(); }, 600);
        return;
      }
      if (ev.shiftKey) {
        viaBridge({ type: 'ro-remote-status' }, function (st) {
          var cur = (st && st.url) || '';
          var input = prompt('远程更新目录（目录下需有 version.json 与脚本），留空则清除：', cur);
          if (input === null) return;
          var url = String(input).trim();
          setStatus(url ? '更新：正在连接 ' + url + ' …' : '更新：正在清除远程地址…');
          viaBridge({ type: 'ro-remote-set-url', url: url }, function (r) {
            setStatus('更新：' + ((r && r.msg) || '完成'));
            if (r && r.updated && vEl) vEl.textContent = 'v' + r.version;
          });
        });
        return;
      }
      setStatus('更新：正在检查远程版本…');
      viaBridge({ type: 'ro-remote-check' }, function (r) {
        if (r && r.ok) {
          if (vEl && r.version) vEl.textContent = 'v' + r.version;
          setStatus('更新：' + (r.msg || ('已是最新 v' + (r.version || SHOWN_VERSION))));
        } else {
          setStatus('更新：' + ((r && r.msg) || '检查失败'));
        }
      });
    });
  })();

  $('acctbtn').addEventListener('click', function () {
    var box = $('acct');
    var show = box.style.display === 'none';
    box.style.display = show ? 'block' : 'none';
    if (!show) return;
    var on = scanOnline();
    var r = mergeOnline(on);
    renderAccounts(on);
    setStatus('当前在线 ' + on.length + ' 个账号 · 新增 ' + r.added + ' 条 · 补全账号名 ' + r.filled + ' 条');
  });
  $('clear').addEventListener('click', function () {
    if (!records.length) return;
    if (!confirm('确定清空全部 ' + records.length + ' 条鉴定记录？')) return;
    records = [];
    saveRecords();
    render();
    setStatus('记录已清空');
  });
  $('min').addEventListener('click', function () {
    wrap.classList.toggle('min');
    $('min').textContent = wrap.classList.contains('min') ? '+' : '–';
  });
  filterEl.addEventListener('input', render);

  render();
  updateButtons();

  /* ---------------- 快捷键：Ctrl+Shift+X 收起/展开 ---------------- */

  function togglePanel() {
    if (host.style.display === 'none') {
      host.style.display = 'block';
      wrap.classList.remove('min');
      $('min').textContent = '–';
      return;
    }
    if (wrap.classList.contains('min')) {
      wrap.classList.remove('min');
      $('min').textContent = '–';
    } else {
      wrap.classList.add('min');
      $('min').textContent = '+';
    }
  }

  var boundDocs = [];
  var lastFire = 0;
  function bindHotkey(d) {
    if (!d || boundDocs.indexOf(d) >= 0) return;
    boundDocs.push(d);
    // 用捕获阶段，抢在游戏自己的按键处理前面
    d.addEventListener('keydown', function (e) {
      // Mac 上按 Option 会改掉 e.key（Option+K 变成 ˚），所以用 e.code 判断
      var code = e.code || '';
      if (code !== HOTKEY.code) return;
      if (HOTKEY.meta) {
        if (!e.metaKey || !e.altKey || e.ctrlKey || e.shiftKey) return;
      } else {
        if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
      }
      // window 和 document 都挂了同一个监听，去重避免一次按键切换两次
      var now = Date.now();
      if (now - lastFire < 250) return;
      lastFire = now;
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    }, true);
  }
  function bindAllDocs() {
    bindHotkey(window);
    bindHotkey(document);
    Array.prototype.slice.call(document.querySelectorAll('iframe')).forEach(function (f) {
      try {
        bindHotkey(f.contentWindow);
        bindHotkey(f.contentDocument);
      } catch (err) {}
    });
  }
  bindAllDocs();
  setInterval(bindAllDocs, 3000);
  applyAcctMode();
  setInterval(applyAcctMode, 5000);

  // 进角色后自动记录一次；之后每 15 秒刷新等级/金钱（切号也会自动新增）
  setTimeout(function () { captureAccount(); }, 1500);
  setInterval(function () { captureAccount(); }, 15000);

  // 记录跟账号走：进角色 / 切号后重新加载该角色自己的鉴定记录
  setTimeout(function () { syncRecordsAcct(); }, 1500);
  setInterval(function () { syncRecordsAcct(); }, 3000);

  // 顶层页面只是账号容器时，各账号 iframe 里会各自出面板；这里把自己撤掉，避免出现重复面板
  if (IS_TOP && !isGameDoc(document)) {
    setTimeout(function () {
      var others = gameDocs().filter(function (x) { return x.doc !== document; });
      if (!others.length) return;
      var h = document.getElementById(PANEL_ID);
      if (h && h.parentNode) h.parentNode.removeChild(h);
      window.__RO_IDENTIFY_TOOL__ = null;
    }, 3000);
  }

  window.__RO_IDENTIFY_TOOL__ = {
    show: function () { host.style.display = 'block'; },
    hide: function () { host.style.display = 'none'; },
    run: function (n) { run(n || MAX_PER_RUN); },
    stop: function () { running = false; },
    records: function () { return records; },
    scan: function () { return unidCount(); },
    sell: function () { return sellRecommended(false); },
    accounts: function () { return accounts; },
    capture: function () { return captureAccount(); },
    cas: function () { return { on: CAS.on, reborns: CAS.reborns, key: CAS.key }; },
    casStart: casRun,
    casCheck: casCheckReborns,
    casWear: function () { return casWearCostumes(getGameDoc() || document); },
    casStop: function () { CAS.on = false; showCasbar(false); }
  };

  console.log('%c自动鉴定工具已加载：右上角面板，剩余未鉴定 ' + unidCount() + ' 件；' + HOTKEY.label + ' 收起/展开', 'color:#4f7a45;font-weight:bold');
})();

}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", __RO_BOOT__, { once: true });
} else { __RO_BOOT__(); }
})();
