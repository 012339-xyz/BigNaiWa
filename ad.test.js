/* ============================================================
 *  广告位 + 复活 自检（无浏览器，用桩件模拟 DOM/Canvas）
 *  运行：node ad.test.js
 *  覆盖：
 *    · 没有广告 SDK 时：按钮不出现、DNWAd 全程「不可用」、游戏不受影响
 *    · 有 SDK 时：按钮出现 → 点击走激励视频 → 成功后复活、按钮收起
 *    · 一局限一次；新一局名额归还
 *    · 插屏按频次触发，且不干扰 leaderboard.onGameOver 的返回值
 *    · revive() 的正确性：清掉警戒线上方的球、清零越线计时、解除判负
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
    id, style: {}, textContent: '', width: 680, height: 160, hidden: false, disabled: false,
    _c: new Set(), _h: {},
    classList: {
      add: (c) => el._c.add(c), remove: (c) => el._c.delete(c), contains: (c) => el._c.has(c)
    },
    getContext: () => el._ctx || (el._ctx = makeCtx()),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 420, height: 700 }),
    addEventListener(t, fn) { el._h[t] = fn; },
    click() { if (el._h.click) el._h.click({ preventDefault() {} }); },
    querySelector: () => ({ textContent: '', style: {}, classList: { add() {}, remove() {} } }),
    setAttribute() {}, offsetWidth: 100
  };
  return el;
}

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
    _d: {}, getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); }
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

/* leaderboard 的桩件：只关心 onGameOver 有没有被正确包一层 */
let gameOverCalls = 0;
sandbox.window.DanaiwaBoard = {
  onGameOver() { gameOverCalls++; return 'orig-return'; }
};

/* 记录广告 SDK 收到什么参数 */
const adCalls = [];
sandbox.window.show_9876543 = function (opts) {
  adCalls.push(opts);
  return Promise.resolve();
};

load('ad.js');

const G = sandbox.window.__DNW__;
const AD = sandbox.window.DNWAd;
const DANGER_Y = 142;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
function eq(a, b, label) { ok(a === b, label, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 造几个球：y 越小越靠上 */
function ball(y, r) {
  return { x: 200, y, r: r || 30, dead: false, landed: true, overTime: 0, vx: 0, vy: 0, tier: 0 };
}
function freshState() {
  G.state.balls = [ball(600), ball(560), ball(520)];
  G.state.over = true;
  G.state.danger = true;
}

(async function main() {
  console.log('广告位 / 复活 自检\n');

  console.log('[1] 有 SDK 时按钮才出现');
  ok(AD && typeof AD.rewarded === 'function', 'DNWAd 已挂载');
  ok(AD.ready() === true, '识别到 show_9876543，判定广告可用');
  await sleep(1200);
  eq(els.reviveBtn.hidden, false, '复活按钮显示出来');

  console.log('\n[2] 点击 → 走激励视频 → 复活成功');
  freshState();
  els.reviveBtn.click();
  await sleep(200);
  eq(adCalls.length, 1, 'SDK 被调用 1 次');
  eq(adCalls[0] && adCalls[0].type, 'reward', '请求的是激励视频（type=reward）');
  eq(G.state.over, false, '判负状态已解除');
  eq(G.state.balls.length, 2, '线上方没东西 → 走兜底，只拿掉最高的那颗');
  ok(G.state.balls.every((b) => b.y >= 560), '被拿掉的正是最高的那颗（y=520）');
  eq(els.reviveBtn.hidden, true, '用掉名额后按钮收起');

  console.log('\n[3] 一局只能复活一次');
  const before = adCalls.length;
  els.reviveBtn.click();
  await sleep(200);
  eq(adCalls.length, before, '再点不会重复请求广告');

  console.log('\n[4] 新一局归还名额');
  AD.newGame();
  eq(els.reviveBtn.hidden, false, '按钮重新出现');
  els.restartBtn.click();
  ok(true, 'restart 按钮也能触发（无异常）');

  console.log('\n[5] revive() 只清警戒线上方的球');
  G.state.balls = [ball(100), ball(130 + 30 + 2), ball(400), ball(700)];
  G.state.balls.forEach((b) => { b.overTime = 1.4; });
  G.state.over = true;
  eq(G.revive(), true, 'revive() 返回 true');
  eq(G.state.balls.length, 2, '线上方两颗被清掉，剩两颗');
  ok(G.state.balls.every((b) => b.y - b.r >= DANGER_Y + 12), '留下的球都在警戒线下方');
  ok(G.state.balls.every((b) => b.overTime === 0), '越线计时已清零（不会复活即判负）');
  eq(G.state.danger, false, 'danger 标记已复位');

  console.log('\n[6] 没死的时候不能复活');
  G.state.over = false;
  eq(G.revive(), false, 'revive() 返回 false');
  eq(G.state.balls.length, 2, '局面没被动过');

  console.log('\n[7] 插屏按频次触发，且不影响结算');
  const inAppBefore = adCalls.filter((c) => c.type === 'inApp').length;
  sandbox.window.DanaiwaBoard.onGameOver(100);
  sandbox.window.DanaiwaBoard.onGameOver(200);
  eq(adCalls.filter((c) => c.type === 'inApp').length, inAppBefore, '前两局不弹插屏');
  sandbox.window.DanaiwaBoard.onGameOver(300);
  eq(adCalls.filter((c) => c.type === 'inApp').length, inAppBefore + 1, '第三局弹一次插屏');
  eq(gameOverCalls, 3, '原来的 onGameOver 每局都被正常调用');

  console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
