'use strict';

(() => {
  // ───────────── 상수 ─────────────
  const COLS = 10;
  const ROWS = 20;
  const CELL = 30;                       // 보드 셀 크기 (CSS px)
  const MINI = 20;                       // 미리보기 셀 크기
  const LINE_SCORE = [0, 100, 300, 500, 800];
  const MAX_DT = 100;                    // 탭 복귀 시 프레임 폭주 방지 (ms)
  const LOCK_DELAY = 450;                // 바닥 접지 후 고정까지 유예 (ms)
  const MAX_LOCK_RESETS = 15;            // 무한 회전으로 고정 회피 방지
  const REPEAT_DELAY = 160, REPEAT_RATE = 50;   // 터치 버튼 연속 입력
  const STORAGE_KEY = 'blockfall.best.v1';

  // id 0 = 빈칸. 독자 팔레트
  const COLORS = ['', '#5eead4', '#fde047', '#f472b6', '#a3e635', '#fb7185', '#818cf8', '#fdba74'];
  const SHAPES = [
    null,
    [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[1, 1], [1, 1]],
    [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  ].map((m, id) => m && m.map(row => row.map(v => v * id)));   // 셀 값 = 색 id

  // 회전 실패 시 시도할 오프셋 (간이 월킥)
  const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0]];

  const KEYMAP = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down',
    ArrowUp: 'rotateCW', KeyX: 'rotateCW', KeyZ: 'rotateCCW',
    Space: 'drop', KeyC: 'hold', ShiftLeft: 'hold', ShiftRight: 'hold',
    KeyP: 'pause', Escape: 'pause', Enter: 'start',
  };
  const NO_REPEAT = new Set(['rotateCW', 'rotateCCW', 'drop', 'hold', 'pause', 'start']);

  // ───────────── DOM ─────────────
  const $ = id => document.getElementById(id);
  const ui = {
    score: $('score'), best: $('best'), level: $('level'), lines: $('lines'),
    overlay: $('overlay'), msg: $('overlay-msg'), startBtn: $('start-btn'),
  };
  const boardCtx = setupCanvas($('board'), COLS * CELL, ROWS * CELL);
  const holdCtx = setupCanvas($('hold'), 4.8 * MINI, 4.8 * MINI);
  const nextCtx = setupCanvas($('next'), 4.8 * MINI, 12 * MINI);

  // ───────────── 상태 ─────────────
  const board = new Uint8Array(COLS * ROWS);   // 200바이트, GC 부담 0
  const s = {
    status: 'idle',            // idle | running | paused | over
    piece: null, queue: [], bag: [],
    hold: 0, canHold: true,
    score: 0, lines: 0, level: 1, best: loadBest(),
    gravityAcc: 0, lockAcc: 0, lockResets: 0,
    dirty: true,
  };

  // ───────────── 유틸 ─────────────
  function setupCanvas(cv, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);   // 3x 기기 메모리 낭비 방지
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d', { alpha: false });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function loadBest() {
    try {
      const v = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isSafeInteger(v) && v > 0 ? v : 0;      // 변조값·NaN 방어
    } catch { return 0; }                                   // 프라이빗 모드 등
  }

  function saveBest() {
    try { localStorage.setItem(STORAGE_KEY, String(s.best)); } catch { /* 저장 불가 무시 */ }
  }

  const rotate = (m, dir) => {
    const n = m.length;
    return m.map((row, y) => row.map((_, x) => (dir > 0 ? m[n - 1 - x][y] : m[x][n - 1 - y])));
  };

  function collide(m, ox, oy) {
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m.length; x++) {
        if (!m[y][x]) continue;
        const bx = ox + x, by = oy + y;
        if (bx < 0 || bx >= COLS || by >= ROWS) return true;
        if (by >= 0 && board[by * COLS + bx]) return true;
      }
    }
    return false;
  }

  function nextId() {
    if (!s.bag.length) {                                     // 7-bag: 같은 블록 가뭄 방지
      s.bag = [1, 2, 3, 4, 5, 6, 7];
      for (let i = s.bag.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [s.bag[i], s.bag[j]] = [s.bag[j], s.bag[i]];
      }
    }
    return s.bag.pop();
  }

  function makePiece(id) {
    const m = SHAPES[id];
    const top = m.findIndex(row => row.some(Boolean));       // 빈 윗줄만큼 위로 올려 스폰
    return { id, m, x: (COLS - m.length) >> 1, y: -top };
  }

  // ───────────── 게임 로직 ─────────────
  function reset() {
    board.fill(0);
    Object.assign(s, {
      queue: [], bag: [], hold: 0, canHold: true,
      score: 0, lines: 0, level: 1,
      gravityAcc: 0, lockAcc: 0, lockResets: 0,
    });
    while (s.queue.length < 3) s.queue.push(nextId());
    spawn();
  }

  function spawn(id) {
    if (id === undefined) { id = s.queue.shift(); s.queue.push(nextId()); }
    s.piece = makePiece(id);
    s.lockAcc = 0;
    s.lockResets = 0;
    if (collide(s.piece.m, s.piece.x, s.piece.y)) gameOver();
    s.dirty = true;
  }

  const gravityMs = () => Math.max(60, 1000 * Math.pow(0.82, s.level - 1));
  const grounded = () => collide(s.piece.m, s.piece.x, s.piece.y + 1);

  function tryMove(dx, dy) {
    const p = s.piece;
    if (collide(p.m, p.x + dx, p.y + dy)) return false;
    p.x += dx;
    p.y += dy;
    onMoved();
    return true;
  }

  function tryRotate(dir) {
    const p = s.piece;
    if (p.id === 2) return;                                  // O블록 회전 불필요
    const m = rotate(p.m, dir);
    for (const [kx, ky] of KICKS) {
      if (!collide(m, p.x + kx, p.y + ky)) {
        Object.assign(p, { m, x: p.x + kx, y: p.y + ky });
        onMoved();
        return;
      }
    }
  }

  function onMoved() {
    if (s.lockAcc > 0 && s.lockResets < MAX_LOCK_RESETS) {   // 접지 중 조작 → 유예 리셋(횟수 제한)
      s.lockAcc = 0;
      s.lockResets++;
    }
    s.dirty = true;
  }

  function hardDrop() {
    let d = 0;
    while (!collide(s.piece.m, s.piece.x, s.piece.y + d + 1)) d++;
    s.piece.y += d;
    s.score += d * 2;
    lock();
  }

  function lock() {
    const { m, x, y } = s.piece;
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m.length; c++) {
        if (!m[r][c]) continue;
        if (y + r < 0) return gameOver();                    // 천장 밖에 고정 = 패배
        board[(y + r) * COLS + x + c] = m[r][c];
      }
    }
    clearLines();
    s.canHold = true;
    if (s.status === 'running') spawn();
  }

  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (!board.subarray(y * COLS, (y + 1) * COLS).every(Boolean)) continue;
      board.copyWithin(COLS, 0, y * COLS);                   // 윗줄 전체를 한 칸 아래로 (in-place)
      board.fill(0, 0, COLS);
      cleared++;
      y++;                                                   // 같은 줄 재검사
    }
    if (!cleared) return;
    s.score += LINE_SCORE[cleared] * s.level;
    s.lines += cleared;
    s.level = Math.floor(s.lines / 10) + 1;
  }

  function holdPiece() {
    if (!s.canHold) return;
    const prev = s.hold;
    s.hold = s.piece.id;
    s.canHold = false;
    spawn(prev || undefined);                                // 홀드가 비었으면 큐에서 꺼냄
  }

  function gameOver() {
    s.status = 'over';
    if (s.score > s.best) { s.best = s.score; saveBest(); }
    showOverlay(`GAME OVER\n${s.score.toLocaleString()}점`, '다시 하기');
    s.dirty = true;
  }

  // ───────────── 입력 ─────────────
  function act(action) {
    if (action === 'start') {
      if (s.status === 'idle' || s.status === 'over') start();
      else if (s.status === 'paused') togglePause();
      return;
    }
    if (action === 'pause') return togglePause();
    if (s.status !== 'running') return;

    switch (action) {
      case 'left': tryMove(-1, 0); break;
      case 'right': tryMove(1, 0); break;
      case 'down': if (tryMove(0, 1)) { s.score += 1; s.gravityAcc = 0; } break;
      case 'rotateCW': tryRotate(1); break;
      case 'rotateCCW': tryRotate(-1); break;
      case 'drop': hardDrop(); break;
      case 'hold': holdPiece(); break;
    }
  }

  function start() {
    reset();
    s.status = 'running';
    ui.overlay.hidden = true;
    last = performance.now();
  }

  function togglePause() {
    if (s.status === 'running') {
      s.status = 'paused';
      showOverlay('PAUSED', '계속하기');
    } else if (s.status === 'paused') {
      s.status = 'running';
      ui.overlay.hidden = true;
      last = performance.now();
    }
  }

  function showOverlay(msg, btn) {
    ui.msg.textContent = msg;                                // textContent → XSS 경로 없음
    ui.startBtn.textContent = btn;
    ui.overlay.hidden = false;
    ui.startBtn.focus({ preventScroll: true });
  }

  document.addEventListener('keydown', e => {
    const action = KEYMAP[e.code];
    if (!action) return;
    e.preventDefault();                                      // 방향키·스페이스 스크롤 차단
    if (e.repeat && NO_REPEAT.has(action)) return;
    if (action === 'start' && e.target === ui.startBtn) return;   // 버튼 click과 중복 방지
    act(action);
  });

  ui.startBtn.addEventListener('click', () => act('start'));

  // 터치 버튼: 포인터 이벤트 하나로 마우스/터치 통합, 꾹 누르면 연속 입력
  document.querySelectorAll('.touch button').forEach(btn => {
    const action = btn.dataset.action;
    const repeat = btn.hasAttribute('data-repeat');
    let delayT = 0, rateT = 0;
    const stop = () => { clearTimeout(delayT); clearInterval(rateT); delayT = rateT = 0; };

    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      stop();
      act(action);
      if (repeat) delayT = setTimeout(() => { rateT = setInterval(() => act(action), REPEAT_RATE); }, REPEAT_DELAY);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => btn.addEventListener(t, stop));
    btn.addEventListener('contextmenu', e => e.preventDefault());
  });

  // 탭 이탈·창 포커스 상실 시 자동 일시정지
  document.addEventListener('visibilitychange', () => { if (document.hidden && s.status === 'running') togglePause(); });
  window.addEventListener('blur', () => { if (s.status === 'running') togglePause(); });

  // ───────────── 렌더링 ─────────────
  function drawCell(ctx, x, y, size, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.fillRect(x + 1, y + 1, size - 2, 3);
  }

  function drawBoard() {
    const ctx = boardCtx;
    ctx.fillStyle = '#070b18';
    ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

    ctx.strokeStyle = '#121a33';                             // 그리드: path 1개로 일괄 stroke
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) { ctx.moveTo(x * CELL + .5, 0); ctx.lineTo(x * CELL + .5, ROWS * CELL); }
    for (let y = 1; y < ROWS; y++) { ctx.moveTo(0, y * CELL + .5); ctx.lineTo(COLS * CELL, y * CELL + .5); }
    ctx.stroke();

    for (let i = 0; i < board.length; i++) {
      if (board[i]) drawCell(ctx, (i % COLS) * CELL, ((i / COLS) | 0) * CELL, CELL, COLORS[board[i]]);
    }

    const p = s.piece;
    if (!p || s.status === 'idle') return;

    let gy = p.y;                                            // 고스트 위치
    while (!collide(p.m, p.x, gy + 1)) gy++;

    ctx.strokeStyle = COLORS[p.id];
    ctx.globalAlpha = .45;
    eachCell(p.m, (c, r) => ctx.strokeRect((p.x + c) * CELL + 2.5, (gy + r) * CELL + 2.5, CELL - 5, CELL - 5));
    ctx.globalAlpha = 1;

    eachCell(p.m, (c, r, v) => { if (p.y + r >= 0) drawCell(ctx, (p.x + c) * CELL, (p.y + r) * CELL, CELL, COLORS[v]); });
  }

  function eachCell(m, fn) {
    for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) if (m[r][c]) fn(c, r, m[r][c]);
  }

  function drawMini(ctx, id, cx, cy, dim = false) {
    const m = SHAPES[id];
    let minX = 4, maxX = -1, minY = 4, maxY = -1;            // 실제 블록 영역으로 중앙 정렬
    eachCell(m, (c, r) => {
      minX = Math.min(minX, c); maxX = Math.max(maxX, c);
      minY = Math.min(minY, r); maxY = Math.max(maxY, r);
    });
    const ox = cx - ((maxX - minX + 1) * MINI) / 2 - minX * MINI;
    const oy = cy - ((maxY - minY + 1) * MINI) / 2 - minY * MINI;
    ctx.globalAlpha = dim ? .35 : 1;
    eachCell(m, (c, r, v) => drawCell(ctx, ox + c * MINI, oy + r * MINI, MINI, COLORS[v]));
    ctx.globalAlpha = 1;
  }

  function drawSide() {
    const w = 4.8 * MINI;
    holdCtx.fillStyle = nextCtx.fillStyle = '#131a30';
    holdCtx.fillRect(0, 0, w, w);
    nextCtx.fillRect(0, 0, w, 12 * MINI);
    if (s.hold) drawMini(holdCtx, s.hold, w / 2, w / 2, !s.canHold);
    if (s.status !== 'idle') s.queue.forEach((id, i) => drawMini(nextCtx, id, w / 2, (i * 4 + 2) * MINI));
  }

  const shown = {};
  function syncStats() {                                     // 값이 바뀐 경우에만 DOM 갱신
    for (const k of ['score', 'best', 'level', 'lines']) {
      const v = k === 'best' ? Math.max(s.best, s.score) : s[k];
      if (shown[k] !== v) { shown[k] = v; ui[k].textContent = v.toLocaleString(); }
    }
  }

  // ───────────── 메인 루프 ─────────────
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(now - last, MAX_DT);
    last = now;

    if (s.status === 'running') {
      if (grounded()) {
        s.lockAcc += dt;
        if (s.lockAcc >= LOCK_DELAY) { lock(); s.dirty = true; }
      } else {
        s.lockAcc = 0;
        s.gravityAcc += dt;
        const g = gravityMs();
        while (s.gravityAcc >= g && !grounded()) { s.gravityAcc -= g; s.piece.y++; s.dirty = true; }
        if (grounded()) s.gravityAcc = 0;
      }
    }

    if (s.dirty) {
      s.dirty = false;
      drawBoard();
      drawSide();
      syncStats();
    }
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
