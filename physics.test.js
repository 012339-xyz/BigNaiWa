/* ============================================================
 *  物理手感自检（无浏览器，用桩件模拟 DOM/Canvas）
 *  运行：node physics.test.js
 *  覆盖：回弹高度、球对球弹起、堆叠稳定性、真实投放不穿墙
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
    drawImage() {},
    createLinearGradient: () => g, createRadialGradient: () => g,
    measureText: () => ({ width: 10 }), fillText() {}, strokeText() {},
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '', lineCap: ''
  };
}

const listeners = new Map();
function makeEl(id) {
  const el = {
    id, style: {}, textContent: '', width: 680, height: 160, _c: new Set(),
    classList: { add: c => el._c.add(c), remove: c => el._c.delete(c), contains: c => el._c.has(c) },
    getContext: () => el._ctx || (el._ctx = makeCtx()),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 420, height: 700 }),
    addEventListener(t, fn) { if (!listeners.has(el)) listeners.set(el, {}); listeners.get(el)[t] = fn; },
    querySelector(sel) {
      if (!el._q) el._q = {};
      if (!el._q[sel]) el._q[sel] = { textContent: '', style: {}, classList: { add() {}, remove() {} } };
      return el._q[sel];
    },
    setAttribute() {}, offsetWidth: 100
  };
  return el;
}
const els = {};
['game', 'stage', 'overlay', 'score', 'best', 'finalScore', 'finalBest',
 'next', 'chain', 'soundBtn', 'resetBtn', 'restartBtn'].forEach(id => els[id] = makeEl(id));

const rafQueue = [];
const sandbox = {
  console, Math, Date, JSON, Object, Array, Number, String, Boolean, Error, isNaN,
  performance: { now: () => Date.now() },
  requestAnimationFrame(fn) { rafQueue.push(fn); return 1; },
  setTimeout: fn => setTimeout(fn, 0), clearTimeout,
  document: {
    readyState: 'complete', getElementById: id => els[id] || null,
    addEventListener() {}, createElement: () => makeEl('tmp')
  },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
  addEventListener() {},
  navigator: {},
  /* 桩件图片：设了 src 就立刻“加载完成”，用来覆盖贴图绘制分支 */
  Image: class {
    constructor() { this.width = 512; this.height = 512; this.naturalWidth = 512; this.onload = null; this.onerror = null; }
    set src(v) { this._src = v; if (this.onload) this.onload(); }
    get src() { return this._src; }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'assets', 'fruits', 'parts.js'), 'utf8'),
                sandbox, { filename: 'parts.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'game.js'), 'utf8'), sandbox, { filename: 'game.js' });

const H = 700, W = 420, WALL = 10, R = [17, 23, 31, 39, 48, 58, 69, 81, 94, 108, 124];
const S = sandbox.__DNW__.state;
const U = sandbox.__DNW__;
const step = sandbox.__DNW__.stepPhysics;
const DT = 1 / 180;

function ball(x, tier, y) {
  const r = R[tier];
  const b = U.makeBall(x, y === undefined ? 700 - WALL - r : y, tier);
  b.landed = true;
  b.bornAt = 0;
  return b;
}
function run(n) { for (let i = 0; i < n; i++) step(DT); }
function clear() { S.balls.length = 0; }

/* 碰撞形状是若干小圆，越界检查得看这些小圆的实际范围 */
function bounds(b) {
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (let k = 0; k < b.parts.length; k++) {
    const x = b.wx[k], y = b.wy[k], r = b.ws[k];
    if (x - r < minx) minx = x - r;
    if (x + r > maxx) maxx = x + r;
    if (y - r < miny) miny = y - r;
    if (y + r > maxy) maxy = y + r;
  }
  return { minx: minx, maxx: maxx, miny: miny, maxy: maxy };
}
function outOfBounds(b) {
  if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.vx)) return 'NaN';
  const e = bounds(b);
  if (e.maxy > H - WALL + 1.5) return 'floor maxy=' + e.maxy.toFixed(1);
  if (e.minx < WALL - 1.5) return 'left minx=' + e.minx.toFixed(1) + ' tier=' + b.tier;
  if (e.maxx > W - WALL + 1.5) return 'right maxx=' + e.maxx.toFixed(1) + ' tier=' + b.tier;
  return '';
}

let pass = true;
function check(name, ok, detail) {
  console.log((ok ? '  [OK] ' : '  [NG] ') + name + (detail ? '  -- ' + detail : ''));
  if (!ok) pass = false;
}

/* ---- 1. 落地球的自由回弹高度 ---- */
console.log('[1] 单个水果(猕猴桃 r=48) 从 y=100 落到地面');
clear();
S.balls.push(ball(210, 4, 100));
const floorY = H - WALL - R[4];
let reversed = false, apex = 1e9, bounces = 0, lastVy = 0;
for (let i = 0; i < 180 * 8; i++) {
  step(DT);
  const b = S.balls[0];
  if (lastVy > 0 && b.vy < 0) bounces++;
  lastVy = b.vy;
  if (b.vy < -1) { reversed = true; apex = Math.min(apex, b.y); }
}
const rebound = reversed ? floorY - apex : 0;
check('发生多次回弹（Q 弹）', bounces >= 2, '回弹次数 = ' + bounces);
check('首次回弹高度 > 40px', rebound > 40, '回弹高度 = ' + rebound.toFixed(1) + 'px');
check('最终静止（不抖）', Math.abs(S.balls[0].vy) < 20, 'vy = ' + S.balls[0].vy.toFixed(2));

/* ---- 2. 球对球回弹（不同级别） ---- */
console.log('[2] 橘子(r=31) 砸向静止的椰子(r=94)');
clear();
S.balls.push(ball(210, 8, 700 - WALL - R[8]));
S.balls.push(ball(210, 2, 180));
let hitUp = 0;
for (let i = 0; i < 180 * 6; i++) {
  step(DT);
  if (S.balls[1] && S.balls[1].vy < -30) hitUp++;
}
check('上方水果被弹起', hitUp > 3, '向上速度帧数 = ' + hitUp);

/* ---- 3. 堆叠稳定性（不抖、不漂、无 NaN） ---- */
console.log('[3] 6 颗不同大小的水果堆 12 秒');
clear();
[[60, 0], [300, 0], [120, 3], [260, 3], [180, 6], [190, 1]].forEach(function (p, i) {
  S.balls.push(ball(p[0], p[1], 620 - i * 5));
});
run(180 * 12);
const snap = S.balls.map(b => ({ x: b.x, y: b.y }));
let maxV = 0, bad = '';
for (const b of S.balls) {
  maxV = Math.max(maxV, Math.hypot(b.vx, b.vy));
  const o = outOfBounds(b);
  if (o) bad = o;
}
run(180);
let drift = 0;
S.balls.forEach((b, i) => { drift = Math.max(drift, Math.hypot(b.x - snap[i].x, b.y - snap[i].y)); });
check('数值健康（无 NaN / 无穿墙）', !bad, bad || '');
check('残余速度小', maxV < 45, 'max |v| = ' + maxV.toFixed(1) + ' px/s');
check('1 秒内位移 < 6px', drift < 6, 'drift = ' + drift.toFixed(2) + 'px');

/* 形状碰撞的硬指标：静止后任意两个水果的轮廓圆之间不应该有明显穿透 */
let deepest = 0;
for (let i = 0; i < S.balls.length; i++) {
  for (let j = i + 1; j < S.balls.length; j++) {
    const a = S.balls[i], b = S.balls[j];
    for (let m = 0; m < a.parts.length; m++) {
      for (let k = 0; k < b.parts.length; k++) {
        const dx = b.wx[k] - a.wx[m], dy = b.wy[k] - a.wy[m];
        const sum = a.ws[m] + b.ws[k];
        const d = Math.hypot(dx, dy);
        if (sum - d > deepest) deepest = sum - d;
      }
    }
  }
}
check('静止后无互相穿透（形状碰撞生效）', deepest < 2.5, '最深穿透 = ' + deepest.toFixed(2) + 'px');

/* ---- 4. 真实投放 60 次：走完整的 update/渲染循环 ---- */
console.log('[4] 自动投放 60 次');
clear();
els.score.textContent = '0';
let t = Date.now();
function pump(frames) {
  for (let f = 0; f < frames; f++) {
    t += 16.7;
    const q = rafQueue.splice(0, rafQueue.length);
    for (const fn of q) fn(t);
  }
}
const down = listeners.get(els.stage).pointerdown;
let seed = 7;
function nx() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return 0.15 + (seed % 1000) / 1000 * 0.7; }
let escaped = '';
for (let i = 0; i < 60; i++) {
  down({ clientX: nx() * W, clientY: 120, pointerType: 'mouse' });
  pump(30);
  for (const b of S.balls) {
    if (!escaped) escaped = outOfBounds(b);
  }
}
pump(600);
check('60 次投放无水果穿墙/飞出', !escaped, escaped || ('剩余球数 = ' + S.balls.length));
check('有合成得分', Number(els.score.textContent) > 0,
  '得分 = ' + els.score.textContent + '（最高分 ' + els.best.textContent + '）');

/* ---- 5. 触屏交互：拖动瞄准、松手投放 ---- */
console.log('[5] 触屏：拖动瞄准、松手投放');
sandbox.__DNW__.reset();
pump(30);
const L = listeners.get(els.stage);
const n0 = S.balls.length;

L.pointerdown({ clientX: 100, clientY: 400, pointerType: 'touch', pointerId: 1 });
check('按下的瞬间不投放', S.balls.length === n0, '球数 = ' + S.balls.length);

L.pointermove({ clientX: 250, clientY: 400, pointerType: 'touch' });
check('拖动实时更新落点', Math.abs(S.aimX - 250) < 1.5, 'aimX = ' + S.aimX.toFixed(1));

L.pointerup({ clientX: 250, clientY: 400, pointerType: 'touch' });
check('松手才投放', S.balls.length === n0 + 1, '球数 = ' + S.balls.length);

/* 鼠标仍然是“按下即投”，保持桌面手感 */
pump(30);                       // 等投放冷却走完
const n1 = S.balls.length;
L.pointerdown({ clientX: 300, clientY: 400, pointerType: 'mouse' });
check('鼠标按下即投放', S.balls.length === n1 + 1, '球数 = ' + S.balls.length);

console.log(pass ? '\n物理手感自检通过' : '\n物理手感自检未通过');
process.exit(pass ? 0 : 1);
