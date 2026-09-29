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
  const REWARD_TIMEOUT = 60000;   // 广告最长等多久（毫秒），超时当没看成

  /* 复活要不要真的先过一遍广告？
   *   true （当前）= 严格模式：页面上没有可调用的广告函数时，**根本不问复活**，
   *                  直接进结算；有广告时先播广告、播完才给复活。
   *   false        = 宽松模式：没有广告也让点，直接复活（文案会如实写「复活一次」）。
   *
   * 实测（2026-09-29）：线上只挂了 Push Notifications 的 tag，它不产生可调用的
   * show_ 函数、页面上也不渲染任何广告 —— 所以在拿到真正的激励/插屏广告位之前，
   * 严格模式下的复活入口不会出现。 */
  const REQUIRE_AD = true;

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

  /* 弹窗里有两屏：第一屏问要不要复活（#revivePrompt），第二屏才是正式结算（#overPanel）。
     没接广告模块时 HTML 默认就是「第一屏隐藏、第二屏显示」，所以游戏本身不受影响。 */
  function showPrompt(show) {
    const p = el('revivePrompt'), s = el('overPanel');
    if (p) p.hidden = !show;
    if (s) s.hidden = !!show;
  }

  /* 能不能给一次复活机会 */
  function canOffer() {
    if (revivedThisGame >= REVIVE_PER_GAME) return false;
    if (REQUIRE_AD && !sdk()) return false;
    if (!el('revivePrompt') || !el('overPanel')) return false;
    return true;
  }

  /* 复活按钮的文案随「有没有真广告」切换，不骗玩家 */
  function syncReviveBtn() {
    const btn = el('reviveBtn');
    if (!btn) return;
    const ad = ready();
    btn.textContent = ad ? '📺 看广告复活' : '🔄 复活一次';
    btn.title = ad ? '看完广告，消除最顶上那颗水果' : '消除最顶上那颗水果（一局限一次）';
    const hint = el('reviveHint');
    if (hint) {
      hint.textContent = ad
        ? '看一段广告，消除最顶上那颗水果，接着玩'
        : '消除最顶上那颗水果，接着玩（一局限一次）';
    }
    const sc = el('reviveScore');
    const g = window.__DNW__;
    if (sc && g && g.state) sc.textContent = g.state.score;
  }

  /* 由 game.js 的 gameOver() 调用：接管弹窗，先问要不要复活。
     返回 true = 我接管了，结算推迟；false = 按正常流程直接结算。 */
  function offerRevive() {
    if (!canOffer()) { showPrompt(false); return false; }
    syncReviveBtn();
    showPrompt(true);
    const ov = el('overlay');
    if (ov) ov.classList.add('show');       // 遮罩得自己弹出来，gameOver 已经不再管这事了
    return true;
  }

  /* 玩家拒绝复活（或复活用完了）：切到正式结算 */
  function toSettle() {
    showPrompt(false);
    const g = window.__DNW__;
    if (g && typeof g.settle === 'function') g.settle();
  }

  function onReviveClick() {
    if (busy) return;
    if (revivedThisGame >= REVIVE_PER_GAME) return;

    const g = window.__DNW__;
    if (!g || typeof g.revive !== 'function') return;

    busy = true;
    const btn = el('reviveBtn');
    if (btn) btn.disabled = true;

    /* 有广告就先播广告；没有广告（且不是严格模式）就直接放行 */
    const gate = sdk() ? rewarded() : Promise.resolve(!REQUIRE_AD);

    gate.then(function (ok) {
      busy = false;
      if (btn) btn.disabled = false;
      if (!ok) return;
      if (!g.revive()) { toSettle(); return; }
      revivedThisGame++;
      showPrompt(false);          // 遮罩由 revive() 收起
    }, function () {
      busy = false;
      if (btn) btn.disabled = false;
    });
  }

  /* 新一局开始：把复活名额还回去 */
  function newGame() {
    revivedThisGame = 0;
    showPrompt(false);
    syncReviveBtn();
  }

  /* 结算时按频次弹插屏（包一层，不改 leaderboard 本身） */
  function wrapGameOver() {
    const B = window.DanaiwaBoard;
    if (!B || B.__adWrapped || typeof B.onGameOver !== 'function') return false;
    const orig = B.onGameOver;
    B.onGameOver = function () {
      games++;
      /* SDK 是异步来的，而且不一定什么时候到；结算时再确认一次文案 */
      setTimeout(syncReviveBtn, 900);
      if (INTERSTITIAL_EVERY > 0 && games % INTERSTITIAL_EVERY === 0) interstitial();
      try { return orig.apply(this, arguments); } catch (e) { return undefined; }
    };
    B.__adWrapped = true;
    return true;
  }

  function bind() {
    const btn = el('reviveBtn');
    if (btn) btn.addEventListener('click', onReviveClick);

    const giveUp = el('giveUpBtn');
    if (giveUp) giveUp.addEventListener('click', toSettle);

    const restart = el('restartBtn');
    if (restart) restart.addEventListener('click', newGame);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'r' || e.key === 'R') newGame();
    });

    showPrompt(false);
    syncReviveBtn();
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    bind();
    /* 立刻包一层（排行榜脚本在本文件之前加载，这时它已经在了），
       免得页面刚打开就结束的第一局漏掉结算钩子 */
    wrapGameOver();
    /* SDK 是异步加载的，而且不一定马上到（实测同一个 tag 有时几秒有时十几秒），
       所以这里一直轻量地看；一旦发现就停。每隔 1.5 秒看一次 window 的键，开销可忽略。 */
    let tries = 0;
    const timer = setInterval(function () {
      tries++;
      wrapGameOver();
      if (ready() || tries > 120) clearInterval(timer);
      syncReviveBtn();
    }, 1500);
    window.addEventListener('load', syncReviveBtn);
    document.addEventListener('visibilitychange', syncReviveBtn);
  }

  /* 给别处留的钩子（game.js 调 offerRevive，控制台也能调试） */
  window.DNWAd = {
    ready: ready,
    rewarded: rewarded,
    interstitial: interstitial,
    offerRevive: offerRevive,
    settle: toSettle,
    newGame: newGame
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
