/* ============================================================
 *  合成大奶娃 · 排行榜
 *  基于 TinyWebDB（tinywebdb.appinventor.space）的 REST 接口：
 *    POST  user=danaiwa  secret=6f52518c  action=update|get|delete|count|search
 *  成绩存在 tag = "dnw_<时间>_<随机>"，value = {"n":昵称,"s":分数,"t":时间戳}
 *  读榜用 action=search 按前缀拉回（最多 100 条），再在本地排序取前 N。
 *  整个模块不依赖游戏内部状态，网络不通也只是排行榜不可用，不影响玩。
 * ============================================================ */
(function () {
  'use strict';

  const API = 'https://tinywebdb.appinventor.space/api';
  const USER = 'danaiwa';
  const SECRET = '6f52518c';

  const PREFIX = 'dnw_';            // 所有成绩的 tag 前缀，search 靠它过滤
  const FETCH_LIMIT = 100;          // 接口单次最多返回 100 条
  const TOP_N = 20;                 // 榜单只展示前 20
  const NAME_KEY = 'danaiwa.name';
  const MUTE_MIN_GAP = 3000;        // 两次提交至少间隔 3 秒
  const MAX_SCORE = 99999999;       // 明显离谱的成绩直接不收

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

  function fetchTop() {
    return post({
      action: 'search', no: '1', count: String(FETCH_LIMIT),
      tag: PREFIX, type: 'both'
    }).then((obj) => {
      const rows = [];
      for (const tag in obj) {
        if (tag.indexOf(PREFIX) !== 0) continue;
        const raw = obj[tag];
        if (typeof raw !== 'string') continue;
        let rec;
        try { rec = JSON.parse(raw); } catch (e) { continue; }
        const s = Number(rec && rec.s);
        if (!isFinite(s) || s < 0 || s > MAX_SCORE) continue;
        rows.push({
          name: String((rec && rec.n) || '匿名玩家').slice(0, 16),
          score: s,
          t: Number(rec && rec.t) || 0
        });
      }
      rows.sort((a, b) => (b.score - a.score) || (a.t - b.t));
      return rows.slice(0, TOP_N);
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

  /* ---------------------------------------------------------
   *  界面
   * ------------------------------------------------------- */

  const listEl = $('boardList');
  const modal = $('boardModal');
  const msgEl = $('submitMsg');
  const nameInput = $('nameInput');
  const submitBtn = $('submitBtn');
  const submitBox = $('submitBox');

  let lastSubmitAt = 0;
  let submitting = false;

  function setMsg(text, kind) {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'submit-msg' + (kind ? ' is-' + kind : '');
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
   *  提交
   * ------------------------------------------------------- */

  function submit() {
    if (submitting || !submitBtn) return;
    const score = Number(submitBtn.dataset.score || 0);
    const name = cleanName(nameInput && nameInput.value);

    if (!name) {
      setMsg('先起个昵称吧', 'bad');
      if (nameInput) nameInput.focus();
      return;
    }
    if (!score) {
      setMsg('0 分就不用上榜了，再玩一局吧', 'bad');
      return;
    }
    const now = Date.now();
    if (now - lastSubmitAt < MUTE_MIN_GAP) {
      setMsg('提交太快啦，稍等一下', 'bad');
      return;
    }

    submitting = true;
    submitBtn.disabled = true;
    setMsg('正在提交…', '');
    saveName(name);

    addScore(name, score).then(() => {
      lastSubmitAt = Date.now();
      setMsg('已上榜 ✓', 'good');
      submitBtn.textContent = '已提交';
      return refreshBoard(score).catch(() => {});
    }).catch((err) => {
      setMsg('提交失败：' + err.message, 'bad');
    }).then(() => {
      submitting = false;
      submitBtn.disabled = false;
    });
  }

  /* 游戏结束时调用：把本局分数接过来，允许提交 */
  function onGameOver(score) {
    if (!submitBox || !submitBtn) return;
    submitBtn.dataset.score = String(score);
    submitBtn.textContent = '提交到排行榜';
    if (nameInput && !nameInput.value) nameInput.value = loadName();

    const canSubmit = score > 0;
    submitBox.style.display = canSubmit ? '' : 'none';
    setMsg(canSubmit ? '' : '', '');
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

    if (submitBtn) submitBtn.addEventListener('click', submit);
    if (nameInput) {
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    }

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
    submitScore: addScore
  };
})();
