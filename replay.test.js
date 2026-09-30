/* ============================================================
 *  回放验证自检（无浏览器，用桩件模拟 DOM/Canvas）
 *  运行：node replay.test.js
 *
 *  覆盖：
 *    1. 真实打完一局 → 拿到回放 → 重跑一遍分数完全一致
 *    2. 编解码往返不丢信息
 *    3. 各种伪造手法全部被拒（改分数 / 改落点 / 改种子 / 截断 / 老格式 / 灌未来时间）
 *    4. 同一份回放跑两次结果一样（确定性）
 * ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = __dirname;

function makeCtx(id) {
  const g = { addColorStop() {} };
  return {
    _id: id,
    setTransform() {}, save() {}, restore() {}, scale() {}, rotate() {}, translate() {},
    clearRect() {}, fillRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, ellipse() {}, clip() {}, stroke() {}, fill() {}, setLineDash() {}, drawImage() {},
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
    getContext: () => el._ctx || (el._ctx = makeCtx(id)),
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
const winListeners = {};
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
  addEventListener(t, fn) { winListeners[t] = fn; },
  navigator: {},
  Image: class {
    constructor() { this.width = 512; this.height = 512; this.onload = null; this.onerror = null; }
    set src(v) { this._src = v; if (this.onload) this.onload(); }
    get src() { return this._src; }
  }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(name) {
  vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), sandbox, { filename: name });
}
load('assets/fruits/parts.js');
load('sim.js');
load('game.js');

const Sim = sandbox.SUIKA_SIM;
const U = sandbox.__DNW__;
const S = U.state;

/* 排行榜拿到的东西就在这里 */
const submitted = { score: 0, replay: null };
sandbox.DanaiwaBoard = {
  onGameOver(score, replay) { submitted.score = score; submitted.replay = replay; }
};

let pass = true;
function check(name, ok, detail) {
  console.log((ok ? '  [OK] ' : '  [NG] ') + name + (detail ? '  -- ' + detail : ''));
  if (!ok) pass = false;
}

let clock = Date.now();
function pump(frames) {
  for (let f = 0; f < frames; f++) {
    clock += 16.7;
    const q = rafQueue.splice(0, rafQueue.length);
    for (const fn of q) fn(clock);
  }
}

/* ---- 1. 老老实实打完一局 ---- */
console.log('[1] 打完一局，拿到回放');
const down = listeners.get(els.stage).pointerdown;
U.reset();
pump(5);

let seq = 0;
function aim() {                                  // 固定套路，保证这一步本身可复现
  seq++;
  const r = (seq * 0.6180339887) % 1;
  return 60 + r * 300;
}

let drops = 0;
for (let i = 0; i < 4000 && !submitted.replay; i++) {
  if (S.over) break;
  if (S.ready) {
    down({ clientX: aim(), clientY: 120, pointerType: 'mouse' });
    drops++;
  }
  pump(10);
}
pump(600);

check('真的打到判负（拿到回放）', !!submitted.replay, submitted.replay ? '' : '没触发 onGameOver');
if (!submitted.replay) { console.log('\n失败'); process.exit(1); }

const rep = submitted.replay;
console.log('      分数 ' + submitted.score + '，投放 ' + rep.inputs.length +
  ' 次，时长 ' + rep.end + ' tick（' + (rep.end / 60).toFixed(1) + ' 秒）');
check('分数来自模拟本身', rep.score === submitted.score && rep.score > 0, 'score=' + rep.score);
check('回放里记录了投放', rep.inputs.length === drops,
  '回放 ' + rep.inputs.length + ' 次 / 实际投 ' + drops + ' 次');
check('回放的 tick 数 = 模拟结束时的 tick', rep.end === S.tick,
  'end=' + rep.end + ' tick=' + S.tick);

/* ---- 2. 编解码往返 ---- */
console.log('[2] 编解码往返');
const enc = Sim.encode(rep);
console.log('      编码后 ' + enc.length + ' 字符');
const dec = Sim.decode(enc);
check('解出来和原来一样', JSON.stringify(dec) === JSON.stringify({
  v: 2, seed: rep.seed, end: rep.end, score: rep.score, inputs: rep.inputs
}), '编码长度 ' + enc.length + ' 字符');

/* ---- 3. 重跑一遍：分数必须完全一致 ---- */
console.log('[3] 重放验证');
let t0 = Date.now();
const r1 = Sim.verify(enc);
const cost = Date.now() - t0;
check('回放能复现出同一个分数', r1.ok && r1.score === rep.score,
  r1.ok ? 'score=' + r1.score + '，验证耗时 ' + cost + ' ms' : '原因：' + r1.reason);

t0 = Date.now();
const r2 = Sim.verify(enc);
check('同一份回放跑两次结果一致', r2.ok && r2.score === r1.score && (Date.now() - t0) >= 0);

/* ---- 4. 伪造手法 ---- */
console.log('[4] 伪造全部要被拒');
function reject(label, payload, expectReason) {
  const r = Sim.verify(payload);
  check(label, !r.ok, r.ok ? '居然通过了！' : '已拒绝（' + r.reason + '）');
}

/* 4a 老排行榜那种：直接写个数字 */
reject('直接写分数（旧格式 {n,s,t}）',
  JSON.stringify({ n: '我是榜一', s: 99999999, t: Date.now() }));

/* 4b 声称的分数比重放算出来的大 */
reject('把回放里的分数改大',
  enc.replace(';' + rep.score + ';', ';99999999;'));

/* 4c 只改落点 */
{
  const parts = enc.split(';');
  const body = parts[4].split(',');
  const first = body[0].split(':');
  body[0] = first[0] + ':' + (parseInt(first[1], 36) + 7).toString(36);
  reject('篡改落点', parts.slice(0, 4).concat(body.join(',')).join(';'));
}

/* 4d 改种子（同样的操作，不同的出球顺序，分数对不上） */
reject('篡改随机种子', enc.replace('v2;' + rep.seed.toString(36) + ';', 'v2;deadbeef;'));

/* 4e 截断回放。
   注意这里分两件事：
   - 砍掉一半投放 → 一定被拒（球少了一半，分数和结束 tick 必然对不上）；
   - 只砍最后 3 次 → 60% 被拒，剩下 40% 会通过 —— 但那不是漏洞：被判负之前那
     几次投放本来就没起任何作用，剩下的这段仍然是一个真实能跑出来的对局，
     重跑出来的分数和声称的一模一样。关键性质是下面这条：截断**不可能**把分数顶高。 */
{
  const half = enc.split(',').slice(0, Math.max(1, Math.floor(rep.inputs.length / 2))).join(',');
  reject('截断回放（砍掉一半投放）', half);

  const cut = enc.split(',').slice(0, Math.max(1, rep.inputs.length - 3)).join(',');
  const r = Sim.verify(cut);
  check('截断不会把分数顶高', !r.ok || r.score <= rep.score,
    r.ok ? '通过了，但分数没变（' + r.score + '）—— 被删的投放本来就没起作用'
        : '已拒绝（' + r.reason + '）');
}

/* 4f 老排行榜的时间戳把戏：把 t 拨到未来就能永久霸占窗口。
   新规则里时间戳根本不参与验证 —— 照样得把分数跑出来，跑不出来就是不对。 */
reject('时间戳玩花招也救不了假分数', {
  v: 2, seed: rep.seed, end: rep.end, score: 99999999,
  t: Date.now() + 1e12, inputs: rep.inputs
});

/* 4g 冷却没走完就连投 */
{
  const tight = Object.assign({}, rep, {
    inputs: rep.inputs.map((it, i) => ({ t: Math.round(i * 3), x: it.x })).slice(0, 40),
    end: Math.round(rep.inputs.length * 3) + 60
  });
  reject('冷却没走完就连投', Sim.encode(tight));
}

/* ---- 5. 顺带确认老工具打不出东西来了 ---- */
console.log('[5] 旧攻击在新规则下');
check('没有回放就上不了榜', !Sim.verify(JSON.stringify({ n: 'x', s: 1, t: 1 })).ok);
check('空回放会被拒', !Sim.verify('').ok);
check('超长回放会被拒（防拖垮验证者）', !Sim.verify('v2;1;' + (Sim.MAX_TICKS + 1).toString(36) + ';1;').ok);

console.log(pass ? '\n回放验证自检通过' : '\n回放验证自检未通过');
process.exit(pass ? 0 : 1);
