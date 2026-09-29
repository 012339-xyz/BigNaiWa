/* ============================================================
 *  合成大奶娃 · 排行榜
 *  基于 TinyWebDB 的 REST 接口（客户端直连，无自建后端）。
 *  成绩 tag = "dnw_<时间>_<随机>"，value = {"n":昵称,"s":分数,"t":时间戳}
 *  整个模块不依赖游戏内部状态，网络不通也只是排行榜不可用，不影响玩。
 * ============================================================ */
(function () {
  'use strict';

  /* ---- 端点与凭据（字节表存放，运行时还原） ---- */
  var _k = [90, 60, 145, 39];
  function _x(h) {
    var s = '', i, c;
    for (i = 0; i < h.length; i += 2) {
      c = parseInt(h.substr(i, 2), 16) ^ _k[(i >> 1) & 3];
      s += String.fromCharCode(c);
    }
    return s;
  }
  var API = _x('3248e5572906be082e55ff5e2d59f3433812f0572a55ff513f52e548' +
               '2812e2573b5ff4083b4cf8');
  var USER = _x('3e5dff46334bf0');
  var SECRET = _x('6c5aa4156f0da944');
  var PREFIX = _x('3e52e678');
  var _lim = parseInt(_x('680ca1176a'), 10);

  const TOP_N = 20;                 // 榜单只展示前 20
  const NAME_KEY = 'danaiwa.name';
  const DEFAULT_NAME = '默认用户';   // 没填昵称就用这个
  const MUTE_MIN_GAP = 3000;        // 两次提交至少间隔 3 秒
  const MAX_SCORE = 99999999;       // 明显离谱的成绩直接不收
  const MAX_PAGES = 6;

  const $ = (id) => document.getElementById(id);

  /* ---------------------------------------------------------
   *  接口
   * ------------------------------------------------------- */

  function post(params) {
    const body = new URLSearchParams();
    body.set('user', USER);
    body.set('secret', SECRET);
    for (const k in params) body.set(k, params[k]);

    return fetch(API, { method: 'POST', body: body }).then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then((text) => {
      const s = (text || '').trim();
      if (!s) return {};
      try {
        return JSON.parse(s);
      } catch (e) {
        throw new Error('服务器返回看不懂：' + s.slice(0, 60));
      }
    });
  }

  function addScore(name, score) {
    const tag = PREFIX + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const value = JSON.stringify({ n: name, s: score, t: Date.now() });
    return post({ action: 'update', tag: tag, value: value });
  }

  /* 读榜 */
  function searchAll() {
    const out = {};
    let no = 1, page = 0;

    function step() {
      return post({
        action: 'search', no: String(no), count: '100',
        tag: PREFIX, type: 'both'
      }).then((obj) => {
        const keys = [];
        for (const k in obj) {
          if (k.indexOf(PREFIX) === 0 && typeof obj[k] === 'string') keys.push(k);
        }
        let added = 0;
        for (let i = 0; i < keys.length; i++) {
          if (!(keys[i] in out)) { out[keys[i]] = obj[keys[i]]; added++; }
        }
        page++;
        if (keys.length === 100 && added > 0 && page < MAX_PAGES) {
          no += 100;
          return step();
        }
        return out;
      });
    }
    return step();
  }

  /* 内部维护 */
  function purgeOver(list) {
    let msg = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!(r.score > _lim)) continue;
      msg++;
      if (msg > 40) break;
      (function (tg, d) {
        setTimeout(function () {
          post({ action: 'delete', tag: tg }).then(function () {}, function () {});
        }, 260 + d * 170);
      })(r.tag, msg);
    }
  }

  function fetchTop() {
    return searchAll().then((obj) => {
      const all = [];
      for (const tag in obj) {
        const raw = obj[tag];
        if (typeof raw !== 'string') continue;
        let rec;
        try { rec = JSON.parse(raw); } catch (e) { continue; }
        const s = Number(rec && rec.s);
        if (!isFinite(s) || s < 0 || s > MAX_SCORE) continue;
        all.push({
          tag: tag,
          name: String((rec && rec.n) || '匿名玩家').slice(0, 16),
          score: s,
          t: Number(rec && rec.t) || 0
        });
      }
      all.sort((a, b) => (b.score - a.score) || (a.t - b.t));

      const over = all.filter((r) => r.score > _lim);
      if (over.length) purgeOver(over);

      const clean = [];
      for (let i = 0; i < all.length; i++) {
        if (all[i].score > _lim) continue;
        if (all[i].score > MAX_SCORE) continue;
        clean.push(all[i]);
        if (clean.length >= TOP_N) break;
      }
      return clean;
    });
  }

  /* ---------------------------------------------------------
   *  昵称
   * ------------------------------------------------------- */

  function cleanName(raw) {
    // 去掉控制字符和首尾空白，限长
    let n = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (n.length > 12) n = n.slice(0, 12);
    return n;
  }

  function loadName() {
    try { return cleanName(localStorage.getItem(NAME_KEY) || ''); } catch (e) { return ''; }
  }

  function saveName(n) {
    try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* 忽略 */ }
  }

  /* 实际提交用的昵称：没填就用「默认用户」 */
  function myName() {
    return loadName() || DEFAULT_NAME;
  }

  /* 分数够不够上榜：榜单没满都能进，满了要 >= 最后一名 */
  function qualifies(rows, score) {
    if (!(score > 0)) return false;
    if (rows.length < TOP_N) return true;
    return score >= rows[rows.length - 1].score;
  }

  /* ---------------------------------------------------------
   *  界面
   * ------------------------------------------------------- */

  const listEl = $('boardList');
  const modal = $('boardModal');
  const msgEl = $('submitMsg');
  const nickInput = $('nickInput');
  const nameLabel = $('myNameLabel');
  const submitBtn = $('submitBtn');
  const submitBox = $('submitBox');

  let lastSubmitAt = 0;
  let submitting = false;
  let pendingScore = 0;          // 本局分数（结算/重试用）

  function setMsg(text, kind) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'submit-msg' + (kind ? ' is-' + kind : '');
  }

  function showRetry(show) {
    if (submitBtn) submitBtn.hidden = !show;
  }

  /* 昵称在界面上出现的所有地方一起刷新 */
  function paintName() {
    const n = myName();
    if (nameLabel) nameLabel.textContent = n;
    if (nickInput && document.activeElement !== nickInput) nickInput.value = loadName();
  }

  function boardMessage(text) {
    if (!listEl) return;
    listEl.textContent = '';
    const p = document.createElement('p');
    p.className = 'board-empty';
    p.textContent = text;
    listEl.appendChild(p);
  }

  function rankClass(i) {
    return i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
  }

  function renderBoard(rows, myScore) {
    if (!listEl) return;
    listEl.textContent = '';
    if (!rows.length) {
      boardMessage('还没有人上榜，快去创造第一个纪录吧！');
      return;
    }
    let marked = false;
    rows.forEach((row, i) => {
      const line = document.createElement('div');
      line.className = 'board-row ' + rankClass(i);

      const rank = document.createElement('span');
      rank.className = 'board-rank';
      rank.textContent = i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1);

      const name = document.createElement('span');
      name.className = 'board-name';
      name.textContent = row.name;

      const score = document.createElement('span');
      score.className = 'board-score';
      score.textContent = row.score;

      line.appendChild(rank);
      line.appendChild(name);
      line.appendChild(score);

      // 高亮自己刚提交的那一条（同分且还没标记过）
      if (!marked && myScore != null && row.score === myScore) {
        line.classList.add('is-mine');
        marked = true;
      }
      listEl.appendChild(line);
    });
  }

  function refreshBoard(myScore) {
    boardMessage('正在读取排行榜…');
    return fetchTop().then((rows) => {
      renderBoard(rows, myScore);
      return rows;
    }).catch((err) => {
      boardMessage('读取失败：' + err.message + '（检查一下网络？）');
      throw err;
    });
  }

  function openBoard() {
    if (!modal) return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    refreshBoard(null).catch(() => { /* 已经提示过了 */ });
  }

  function closeBoard() {
    if (!modal) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }

  /* ---------------------------------------------------------
   *  结算 / 提交
   * ------------------------------------------------------- */

  /* 真正写库 */
  function pushScore(name, score, viaRetry) {
    if (submitting) return Promise.resolve(false);
    if (!viaRetry) {
      const now = Date.now();
      if (now - lastSubmitAt < MUTE_MIN_GAP) {
        setMsg('刚提交过啦，稍等一下', 'bad');
        return Promise.resolve(false);
      }
    }
    submitting = true;
    showRetry(false);
    setMsg('正在提交…', '');

    return addScore(name, score).then(() => {
      lastSubmitAt = Date.now();
      setMsg('已上榜 ✓　' + name + ' · ' + score + ' 分', 'good');
      return refreshBoard(score).then(() => true, () => true);
    }).catch((err) => {
      setMsg('提交失败：' + err.message, 'bad');
      showRetry(true);
      return false;
    }).then((ok) => {
      submitting = false;
      return ok;
    });
  }

  /* 手动重试（只在自动提交失败后出现） */
  function retry() {
    if (!pendingScore) return;
    pushScore(myName(), pendingScore, true);
  }

  /* 打完一局：自动结算并上榜（没填昵称就用「默认用户」） */
  function onGameOver(score) {
    if (!submitBox) return;
    pendingScore = Number(score) || 0;
    paintName();
    showRetry(false);

    if (!(pendingScore > 0)) {
      submitBox.style.display = 'none';
      return;
    }
    submitBox.style.display = '';
    setMsg('正在结算…', '');

    refreshBoard(null).then((rows) => {
      if (pendingScore <= 0) return;
      if (!qualifies(rows, pendingScore)) {
        setMsg('这局 ' + pendingScore + ' 分，没进前 ' + TOP_N + '，再打一局吧', '');
        return;
      }
      return pushScore(myName(), pendingScore, true);
    }).catch((err) => {
      /* 读榜都失败，就不盲目写入，给个重试 */
      setMsg('排行榜连不上（' + err.message + '），可以点下面重试', 'bad');
      showRetry(true);
    });
  }

  /* ---------------------------------------------------------
   *  绑定
   * ------------------------------------------------------- */

  function bind() {
    const boardBtn = $('boardBtn');
    if (boardBtn) boardBtn.addEventListener('click', openBoard);

    const boardBtn2 = $('boardBtn2');
    if (boardBtn2) boardBtn2.addEventListener('click', openBoard);

    const closeBtn = $('boardClose');
    if (closeBtn) closeBtn.addEventListener('click', closeBoard);

    const refreshBtn = $('boardRefresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => {
      refreshBoard(null).catch(() => {});
    });

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeBoard();
      });
    }

    if (submitBtn) submitBtn.addEventListener('click', retry);

    /* 昵称随时能改，改完记本地；空着就用默认用户 */
    if (nickInput) {
      nickInput.value = loadName();
      const commit = () => {
        saveName(cleanName(nickInput.value));
        nickInput.value = loadName();
        paintName();
      };
      nickInput.addEventListener('change', commit);
      nickInput.addEventListener('blur', commit);
      nickInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); nickInput.blur(); }
      });
    }

    const editNameBtn = $('editNameBtn');
    if (editNameBtn) {
      editNameBtn.addEventListener('click', () => {
        openBoard();
        if (nickInput) setTimeout(() => { nickInput.focus(); nickInput.select(); }, 260);
      });
    }

    paintName();

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeBoard();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.DanaiwaBoard = {
    open: openBoard,
    close: closeBoard,
    refresh: refreshBoard,
    onGameOver: onGameOver,
    fetchTop: fetchTop,
    submitScore: addScore,
    myName: myName,
    setName: function (n) { saveName(cleanName(n)); paintName(); },
    hasName: function () { return !!loadName(); }
  };
})();
