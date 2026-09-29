/* ============================================================
 *  合成大奶娃 · 广告位
 *
 *  设计原则：**没广告时，本文件等于不存在。**
 *    · 没粘 SDK / SDK 被拦截 / 没填充 → 按钮不出现、游戏完全不受影响
 *    · 所有 SDK 调用都包在 try/catch 里，永远不会把游戏卡死
 *    · 不在 window 上写任何全局变量（只挂一个 DNWAd）
 *
 *  接入方式：
 *    1. 把 Monetag 后台「Ad formats → Get code」给的 <script> 整段
 *       粘到 index.html 里标了位置的那一行
 *    2. 完事。zone ID 不用填到这里，本文件自己去 window 上找 show_<数字>
 *
 *  ⚠️ ADAPTER 那一段是唯一需要按实际 SDK 文档核对的地方，
 *     其余（按钮、复活、频次控制）都与广告平台无关。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 可调参数 ---------------- */

  const REVIVE_PER_GAME = 1;      // 一局最多复活几次（防刷）
  const INTERSTITIAL_EVERY = 3;   // 每几局弹一次插屏；填 0 关闭插屏
  const REWARD_TIMEOUT = 60000;   // 激励视频最长等多久（毫秒），超时当没看成

  /* ---------------- ADAPTER（按需改这一段） ----------------
   * Monetag 的 SDK 加载后会在 window 上挂一个 show_<zoneId> 函数。
   * 这里不写死 zone，扫出来用 —— 以后换号换 zone 不用改代码。
   * 调用约定若与你后台给的文档不一致，只改下面两个函数即可。
   * ------------------------------------------------------ */

  function sdk() {
    try {
      const keys = Object.keys(window);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (/^show_\d+$/.test(k) && typeof window[k] === 'function') return window[k];
      }
    } catch (e) { /* 某些脚本/扩展会让遍历 window 抛错 */ }
    return null;
  }

  function ready() {
    return !!sdk();
  }

  /* 激励视频：看完 resolve(true)，中途关掉/没填充 resolve(false) */
  function rewarded() {
    const fn = sdk();
    if (!fn) return Promise.resolve(false);
    return new Promise(function (resolve) {
      let done = false;
      function fin(ok) { if (!done) { done = true; resolve(ok); } }
      try {
        const r = fn({ type: 'reward' });
        if (r && typeof r.then === 'function') r.then(function () { fin(true); }, function () { fin(false); });
        else fin(true);
      } catch (e) {
        fin(false);
      }
      setTimeout(function () { fin(false); }, REWARD_TIMEOUT);
    });
  }

  /* 插屏：不关心结果 */
  function interstitial() {
    const fn = sdk();
    if (!fn) return;
    try { fn({ type: 'inApp' }); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 界面 ---------------- */

  let busy = false;
  let revivedThisGame = 0;
  let games = 0;

  function el(id) { return document.getElementById(id); }

  /* 按钮只在「真的有广告可用」时才出现 */
  function syncReviveBtn() {
    const btn = el('reviveBtn');
    if (!btn) return;
    const show = ready() && revivedThisGame < REVIVE_PER_GAME;
    btn.hidden = !show;
  }

  function onReviveClick() {
    if (busy) return;
    if (revivedThisGame >= REVIVE_PER_GAME) return;

    busy = true;
    const btn = el('reviveBtn');
    if (btn) btn.disabled = true;

    rewarded().then(function (ok) {
      busy = false;
      if (btn) btn.disabled = false;
      if (!ok) { syncReviveBtn(); return; }

      const g = window.__DNW__;
      if (!g || typeof g.revive !== 'function') { syncReviveBtn(); return; }
      if (!g.revive()) { syncReviveBtn(); return; }

      revivedThisGame++;
      syncReviveBtn();
    }, function () {
      busy = false;
      if (btn) btn.disabled = false;
      syncReviveBtn();
    });
  }

  /* 新一局开始：把复活名额还回去 */
  function newGame() {
    revivedThisGame = 0;
    syncReviveBtn();
  }

  /* 结算时按频次弹插屏（包一层，不改 leaderboard 本身） */
  function wrapGameOver() {
    const B = window.DanaiwaBoard;
    if (!B || B.__adWrapped || typeof B.onGameOver !== 'function') return false;
    const orig = B.onGameOver;
    B.onGameOver = function () {
      games++;
      if (INTERSTITIAL_EVERY > 0 && games % INTERSTITIAL_EVERY === 0) interstitial();
      try { return orig.apply(this, arguments); } catch (e) { return undefined; }
    };
    B.__adWrapped = true;
    return true;
  }

  function bind() {
    const btn = el('reviveBtn');
    if (btn) btn.addEventListener('click', onReviveClick);

    const restart = el('restartBtn');
    if (restart) restart.addEventListener('click', newGame);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'r' || e.key === 'R') newGame();
    });

    syncReviveBtn();
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    bind();
    /* SDK 是异步加载的，隔一小会儿看一次；找不到就一直不显示按钮 */
    let tries = 0;
    const timer = setInterval(function () {
      tries++;
      wrapGameOver();
      if (ready() || tries > 20) clearInterval(timer);
      syncReviveBtn();
    }, 500);
    window.addEventListener('load', syncReviveBtn);
  }

  /* 给别处留的钩子（控制台调试用） */
  window.DNWAd = {
    ready: ready,
    rewarded: rewarded,
    interstitial: interstitial,
    newGame: newGame
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
