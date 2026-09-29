/* ============================================================
 *  复活 + 广告位 自检（无浏览器，用桩件模拟 DOM/Canvas）
 *  运行：node ad.test.js
 *
 *  覆盖：
 *    · revive() 只消除「最顶上那一个」，其余球不动、越线计时清零、解除判负
 *    · 没有广告 SDK 时：按钮仍然出现（REQUIRE_AD=false），标签写「复活一次」，
 *      点击直接复活、不去调任何 SDK
 *    · 有广告 SDK 时：标签变成「看广告复活」，点击先调 SDK，成功后才复活
 *    · 一局限一次；新一局归还名额
 *    · 插屏按频次触发，且不干扰 leaderboard.onGameOver
 * ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = __dirname;

function makeCtx() {
  const g = { addColorStop() {} };
  return {
    setTransform() {}, save() {}, restore() {}, scale() {}, rotate() {}, translate() {},
    clearRect() {}, fillRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, ellipse() {}, clip() {}, stroke() {}, fill() {}, setLineDash() {},
    drawImage() {}, createLinearGradient: () => g, createRadialGradient: () => g,
    measureText: () => ({ width: 10 }), fillText() {}, strokeText() {},
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '', lineCap: ''
  };
}

function makeEl(id) {
  const el = {
    id, style: {}, textContent: '', title: '', width: 680, height: 160,
    hidden: false, disabled: false, _c: new Set(), _h: {},
    classList: { add: (c) => el._c.add(c), remove: (c) => el._c.delete(c), contains: (c) => el._c.has(c) },
    getContext: () => el._ctx || (el._ctx = makeCtx()),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 420, height: 700 }),
    addEventListener(t, fn) { el._h[t] = fn; },
    click() { if (el._h.click) el._h.click({ preventDefault() {} }); },
    querySelector: () => ({ textContent: '', style: {}, classList: { add() {}, remove() {} } }),
    setAttribute() {}, offsetWidth: 100
  };
  return el;
}

/* 搭一个独立的运行环境；withSdk=true 时挂上假的 show_9876543 */
function setup(withSdk) {
  const els = {};
  ['game', 'stage', 'overlay', 'score', 'best', 'finalScore', 'finalBest', 'next', 'chain',
   'soundBtn', 'resetBtn', 'restartBtn', 'reviveBtn'].forEach((id) => { els[id] = makeEl(id); });
  els.reviveBtn.hidden = true;

  const sandbox = {
    console, Math, Date, JSON, Object, Array, Number, String, Boolean, Error, isNaN,
    performance: { now: () => Date.now() },
    requestAnimationFrame() { return 1; },
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: {
      readyState: 'complete',
      getElementById: (id) => els[id] || null,
      addEventListener() {}, createElement: () => makeEl('tmp')
    },
    localStorage: {
      _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }
    },
    addEventListener() {}, navigator: {},
    Image: class {
      constructor() { this.width = 512; this.height = 512; this.naturalWidth = 512; }
      set src(v) { this._src = v; if (this.onload) this.onload(); }
      get src() { return this._src; }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const load = (f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
  load('assets/fruits/parts.js');
  load('game.js');

  const state = { gameOverCalls: 0, adCalls: [] };
  sandbox.window.DanaiwaBoard = {
    onGameOver() { state.gameOverCalls++; return 'orig'; }
  };
  if (withSdk) {
    sandbox.window.show_9876543 = function (opts) { state.adCalls.push(opts); return Promise.resolve(); };
  }
  load('ad.js');

  return { sandbox, els, state, G: sandbox.window.__DNW__, AD: sandbox.window.DNWAd };
}

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
function eq(a, b, label) { ok(a === b, label, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 造球：y 越小越靠上 */
const ball = (y, r) => ({ x: 200, y, r: r || 30, dead: false, landed: true, overTime: 0, vx: 0, vy: 0, tier: 0 });

(async function main() {
  console.log('复活 / 广告位 自检\n');

  /* ---------- A. 纯游戏逻辑 ---------- */
  console.log('[A] revive() 只消除最顶上那一个');
  const A = setup(false);
  A.G.state.balls = [ball(600), ball(560), ball(100), ball(520)];
  A.G.state.balls.forEach((b) => { b.overTime = 1.4; });
  A.G.state.over = true;
  A.G.state.danger = true;

  eq(A.G.revive(), true, 'revive() 返回 true');
  eq(A.G.state.balls.length, 3, '只少了 1 个球');
  ok(!A.G.state.balls.some((b) => b.y === 100), '被拿走的是最顶上那颗（y=100）');
  ok(A.G.state.balls.every((b) => b.y >= 520), '其余三个原样保留');
  ok(A.G.state.balls.every((b) => b.overTime === 0), '越线计时清零');
  eq(A.G.state.over, false, '判负已解除');
  eq(A.G.state.danger, false, 'danger 标记复位');
  eq(A.els.overlay.classList.contains('show'), false, '结算遮罩已收起');

  eq(A.G.revive(), false, '没死的时候 revive() 返回 false');
  eq(A.G.state.balls.length, 3, '局面没被动过');

  A.G.state.balls = [];
  A.G.state.over = true;
  eq(A.G.revive(), true, '空场也能复活（不报错）');
  eq(A.G.state.balls.length, 0, '空场没有球可拿');

  /* ---------- B. 没有广告 ---------- */
  console.log('\n[B] 没有广告 SDK（REQUIRE_AD=false）');
  const B = setup(false);
  ok(B.AD.ready() === false, 'DNWAd.ready() = false');
  await sleep(200);
  eq(B.els.reviveBtn.hidden, false, '按钮仍然出现（功能先能用）');
  eq(B.els.reviveBtn.textContent, '🔄 复活一次', '标签如实写「复活一次」，不骗玩家');

  B.G.state.balls = [ball(600), ball(120)];
  B.G.state.over = true;
  B.els.reviveBtn.click();
  await sleep(200);
  eq(B.state.adCalls.length, 0, '没有调用任何广告 SDK');
  eq(B.G.state.over, false, '直接复活成功');
  eq(B.G.state.balls.length, 1, '最顶上那颗被消除');
  eq(B.els.reviveBtn.hidden, true, '用掉名额后按钮收起');

  B.els.reviveBtn.click();
  await sleep(150);
  eq(B.G.state.balls.length, 1, '再点无效（一局限一次）');
  B.AD.newGame();
  eq(B.els.reviveBtn.hidden, false, '新一局名额归还');
  B.els.restartBtn.click();
  eq(B.els.reviveBtn.hidden, false, 'restart 按钮也走归还逻辑');

  /* ---------- C. 有广告 ---------- */
  console.log('\n[C] 有广告 SDK');
  const C = setup(true);
  ok(C.AD.ready() === true, '识别到 show_9876543');
  await sleep(200);
  eq(C.els.reviveBtn.hidden, false, '按钮出现');
  eq(C.els.reviveBtn.textContent, '📺 看广告复活', '标签变成「看广告复活」');

  C.G.state.balls = [ball(700), ball(300)];
  C.G.state.over = true;
  C.els.reviveBtn.click();
  await sleep(200);
  eq(C.state.adCalls.length, 1, 'SDK 被调用 1 次');
  eq(C.state.adCalls[0] && C.state.adCalls[0].type, 'reward', '请求类型是 reward');
  eq(C.G.state.over, false, '广告看完后才复活');
  eq(C.G.state.balls.length, 1, '最顶上那颗被消除');

  /* ---------- D. 插屏与结算 ---------- */
  console.log('\n[D] 插屏按频次触发，不影响结算');
  const before = C.state.adCalls.filter((c) => c.type === 'inApp').length;
  C.sandbox.window.DanaiwaBoard.onGameOver(1);
  C.sandbox.window.DanaiwaBoard.onGameOver(2);
  eq(C.state.adCalls.filter((c) => c.type === 'inApp').length, before, '前两局不弹插屏');
  C.sandbox.window.DanaiwaBoard.onGameOver(3);
  eq(C.state.adCalls.filter((c) => c.type === 'inApp').length, before + 1, '第三局弹一次插屏');
  eq(C.state.gameOverCalls, 3, '原 onGameOver 每局都被正常调用');

  console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
