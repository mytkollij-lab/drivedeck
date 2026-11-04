/* Gridlock: DriveDeck's falling-block puzzle, for when you're parked.
 *
 * Pieces made of four squares fall into a 10 × 20 well. Fill a row edge to edge to clear it;
 * clearing several rows at once scores more. Every 10 rows raises the level and the speed.
 *
 * Self-contained: window.Gridlock.create(root, options) wires the screen inside `root`
 * (well, hold and next canvases, stats, overlay, touch keys, keyboard and gestures).
 *   options.isActive()      is the screen showing? Keys are ignored otherwise
 *   options.best            best score so far
 *   options.onBest(score)   called with a new best score, to save it
 * Returns { start, pause, resume, setLocked, retheme, fit, status, peek }.
 */
(() => {
  'use strict';

  const COLS = 10;
  const ROWS = 20;
  const TOP = 2; // hidden rows above the well, where pieces appear
  const LOCK_MS = 500; // a landed piece can still slide this long before it sets
  const LOCK_RESETS = 15; // moves that restart that timer, per piece
  const CLEAR_MS = 260; // row-clear animation
  const REPEAT_DELAY = 170; // hold Left/Right: wait, then repeat
  const REPEAT_MS = 45;
  const SOFT_MS = 32; // fall speed while Down is held
  const LINE_POINTS = [0, 100, 300, 500, 800];
  const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [-1, -1], [1, -1]];

  // Each shape in its starting position, as [x, y] cells inside an n × n box.
  const SHAPES = {
    I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    O: { n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
    J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  };
  const KINDS = Object.keys(SHAPES);
  const ROT = {}; // all four clockwise turns of each shape
  KINDS.forEach((k) => {
    const { n, cells } = SHAPES[k];
    const turns = [cells];
    for (let i = 1; i < 4; i++) turns.push(turns[i - 1].map(([x, y]) => [n - 1 - y, x]));
    ROT[k] = turns;
  });

  const gravityMs = (level) => Math.max(55, Math.round(800 * 0.84 ** (level - 1)));
  const num = new Intl.NumberFormat();

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Size a canvas in CSS pixels with a sharp backing store; returns its 2D context.
  function sizeCanvas(cv, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function create(root, opts = {}) {
    const q = (s) => root.querySelector(s);
    const els = {
      well: q('[data-gl-well]'),
      board: q('[data-gl-board]'),
      hold: q('[data-gl-hold]'),
      next: q('[data-gl-next]'),
      overlay: q('[data-gl-overlay]'),
      title: q('[data-gl-title]'),
      text: q('[data-gl-text]'),
      hint: q('[data-gl-hint]'),
      primary: q('[data-gl-primary]'),
      secondary: q('[data-gl-secondary]'),
      pause: q('[data-gl-pause]'),
      stat: Object.fromEntries(['score', 'level', 'lines', 'best'].map((k) => [k, q(`[data-gl-stat="${k}"]`)])),
    };
    const isActive = opts.isActive || (() => true);

    let grid = [];
    let bag = [];
    let queue = [];
    let cur = null; // { k, r, x, y }
    let held = null;
    let canHold = true;
    let score = 0;
    let lines = 0;
    let level = 1;
    let best = Number(opts.best) || 0;
    let newBest = false;
    let status = 'ready'; // ready | playing | paused | over
    let locked = false; // driving lock
    let clearing = null; // { rows, t }
    let fallT = 0;
    let lockT = 0;
    let lockResets = 0;
    let soft = false;
    let raf = 0;
    let last = 0;
    let shownScore = -1;
    let cell = 0;
    let bctx = null;
    const colors = {};
    const sheens = new Map();

    // ------------------------------------------------------------ rules
    const emptyRow = () => new Array(COLS).fill(null);
    const fits = (k, r, x, y) => ROT[k][r].every(([cx, cy]) => {
      const gx = x + cx;
      const gy = y + cy;
      return gx >= 0 && gx < COLS && gy >= 0 && gy < ROWS + TOP && !grid[gy][gx];
    });
    const fitsAt = (x, y, r = cur.r) => fits(cur.k, r, x, y);
    const grounded = () => !fitsAt(cur.x, cur.y + 1);
    const canAct = () => status === 'playing' && cur && !clearing;

    function takeNext() {
      while (queue.length < 4) {
        if (!bag.length) {
          bag = KINDS.slice();
          for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
          }
        }
        queue.push(bag.pop());
      }
      return queue.shift();
    }

    function spawn(kind) {
      const k = kind || takeNext();
      cur = { k, r: 0, x: Math.floor((COLS - SHAPES[k].n) / 2), y: TOP - 1 };
      fallT = 0;
      lockT = 0;
      lockResets = 0;
      if (!fitsAt(cur.x, cur.y)) {
        cur.y -= 1;
        if (!fitsAt(cur.x, cur.y)) { gameOver(); return; }
      }
      drawMinis();
    }

    // A move or turn while resting on something restarts the lock timer (a limited number of times).
    function afterMove() {
      if (grounded() && lockResets < LOCK_RESETS) { lockT = 0; lockResets++; }
    }

    function move(dx) {
      if (!canAct() || !fitsAt(cur.x + dx, cur.y)) return false;
      cur.x += dx;
      afterMove();
      return true;
    }

    function rotate(dir) {
      if (!canAct() || cur.k === 'O') return;
      const r = (cur.r + dir + 4) % 4;
      for (const [kx, ky] of KICKS) {
        const x = cur.x + kx * dir;
        const y = cur.y + ky;
        if (fitsAt(x, y, r)) {
          Object.assign(cur, { r, x, y });
          afterMove();
          return;
        }
      }
    }

    function softStep() {
      if (!canAct() || grounded()) return false;
      cur.y++;
      score += 1;
      fallT = 0;
      return true;
    }

    function hardDrop() {
      if (!canAct()) return;
      let d = 0;
      while (!grounded()) { cur.y++; d++; }
      score += d * 2;
      settle();
      renderStats();
    }

    function hold() {
      if (!canAct() || !canHold) return;
      const k = cur.k;
      const swap = held;
      held = k;
      canHold = false;
      spawn(swap);
    }

    function settle() {
      const cells = ROT[cur.k][cur.r].map(([cx, cy]) => [cur.x + cx, cur.y + cy]);
      cells.forEach(([x, y]) => { grid[y][x] = cur.k; });
      const hidden = cells.every(([, y]) => y < TOP);
      const full = [];
      for (let y = 0; y < ROWS + TOP; y++) if (grid[y].every(Boolean)) full.push(y);
      cur = null;
      canHold = true;
      if (full.length) {
        clearing = { rows: full, t: CLEAR_MS };
        const before = level;
        score += LINE_POINTS[full.length] * level;
        lines += full.length;
        level = 1 + Math.floor(lines / 10);
        renderStats();
        if (level !== before) bump(els.stat.level);
      } else if (hidden) {
        gameOver();
      } else {
        spawn();
      }
    }

    function finishClear() {
      const rows = new Set(clearing.rows);
      grid = grid.filter((_, y) => !rows.has(y));
      while (grid.length < ROWS + TOP) grid.unshift(emptyRow());
      clearing = null;
      spawn();
    }

    function step(dt) {
      if (clearing) {
        clearing.t -= dt;
        if (clearing.t <= 0) finishClear();
        return;
      }
      if (!cur) return;
      if (!grounded()) {
        lockT = 0;
        const interval = soft ? Math.min(SOFT_MS, gravityMs(level)) : gravityMs(level);
        fallT += dt;
        while (fallT >= interval && !grounded()) {
          fallT -= interval;
          cur.y++;
          if (soft) score += 1;
        }
        if (grounded()) fallT = 0;
      } else {
        lockT += dt;
        if (lockT >= LOCK_MS) settle();
      }
    }

    // ------------------------------------------------------------ game flow
    function start() {
      if (locked) return;
      grid = Array.from({ length: ROWS + TOP }, emptyRow);
      bag = [];
      queue = [];
      held = null;
      canHold = true;
      score = 0;
      lines = 0;
      level = 1;
      newBest = false;
      clearing = null;
      soft = false;
      status = 'playing';
      spawn();
      renderStats();
      renderOverlay();
      loop();
    }

    function pause() {
      if (status !== 'playing') return;
      status = 'paused';
      releaseAll();
      renderOverlay();
      draw();
    }

    function resume() {
      if (status !== 'paused' || locked) return;
      status = 'playing';
      renderOverlay();
      loop();
    }

    function gameOver() {
      status = 'over';
      cur = null;
      releaseAll();
      if (score > best) {
        best = score;
        newBest = true;
        if (opts.onBest) opts.onBest(best);
      }
      renderStats();
      renderOverlay();
      draw();
    }

    function setLocked(on) {
      locked = !!on;
      if (locked) pause();
      renderOverlay();
    }

    function loop() {
      if (raf) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    }

    function frame(t) {
      raf = 0;
      if (status !== 'playing') { draw(); return; }
      const dt = last ? Math.min(t - last, 100) : 16;
      last = t;
      step(dt);
      if (score !== shownScore) renderStats();
      draw();
      if (status === 'playing') raf = requestAnimationFrame(frame);
    }

    // ------------------------------------------------------------ screen text
    function bump(el) {
      if (!el) return;
      el.classList.remove('is-bump');
      void el.offsetWidth; // restart the animation
      el.classList.add('is-bump');
    }

    function renderStats() {
      shownScore = score;
      els.stat.score.textContent = num.format(score);
      els.stat.level.textContent = String(level);
      els.stat.lines.textContent = String(lines);
      els.stat.best.textContent = num.format(Math.max(best, score));
    }

    function renderOverlay() {
      const playing = status === 'playing';
      els.overlay.hidden = playing;
      const p = els.pause;
      p.disabled = locked || !(status === 'playing' || status === 'paused');
      p.querySelector('use').setAttribute('href', status === 'paused' ? '#i-play' : '#i-pause');
      p.querySelector('[data-gl-pause-text]').textContent = status === 'paused' ? 'Resume' : 'Pause';
      p.setAttribute('aria-label', status === 'paused' ? 'Resume' : 'Pause');
      if (playing) return;

      let title;
      let text;
      let primary = null;
      let secondary = null;
      let hint = false;
      if (locked) {
        title = 'Paused while driving';
        text = 'Gridlock is for when you’re parked. A passenger can play with Passenger mode on in Settings.';
      } else if (status === 'ready') {
        title = 'Gridlock';
        text = 'Fill a row edge to edge to clear it. Clear several rows at once for more points.';
        primary = 'Start game';
        hint = true;
      } else if (status === 'paused') {
        title = 'Paused';
        text = `Score ${num.format(score)} · Level ${level}`;
        primary = 'Resume';
        secondary = 'New game';
        hint = true;
      } else {
        title = 'Gridlocked';
        text = newBest ? `New best score: ${num.format(score)}` : `Score ${num.format(score)} · Best ${num.format(best)}`;
        primary = 'Play again';
      }
      els.overlay.classList.toggle('is-driving', locked);
      els.title.textContent = title;
      els.text.textContent = text;
      els.hint.hidden = !hint;
      els.primary.hidden = !primary;
      els.primary.textContent = primary || '';
      els.secondary.hidden = !secondary;
      els.secondary.textContent = secondary || '';
    }

    function primaryAction() {
      if (locked) return;
      if (status === 'paused') resume();
      else if (status === 'ready' || status === 'over') start();
    }

    // ------------------------------------------------------------ drawing
    function readColors() {
      const cs = getComputedStyle(root);
      const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
      KINDS.forEach((k) => { colors[k] = v(`--gl-${k}`, '#8a8f99'); });
      colors.grid = v('--gl-grid', 'rgba(255, 255, 255, 0.06)');
      colors.flash = v('--gl-flash', '#ffffff');
      sheens.clear();
    }

    function sheen(ctx, s) {
      const key = ctx === bctx ? `b${s}` : `m${s}`;
      let g = sheens.get(key);
      if (!g) {
        g = ctx.createLinearGradient(0, 0, 0, s);
        g.addColorStop(0, 'rgba(255, 255, 255, 0.40)');
        g.addColorStop(0.42, 'rgba(255, 255, 255, 0.06)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
        sheens.set(key, g);
      }
      return g;
    }

    // One square: rounded, with a soft top sheen. `scale` shrinks it about its centre.
    function block(ctx, x, y, s, color, { alpha = 1, scale = 1 } = {}) {
      const inset = Math.max(1, s * 0.06);
      const w = (s - inset * 2) * scale;
      const off = inset + ((s - inset * 2) - w) / 2;
      const r = Math.max(1.5, w * 0.22);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x + off, y + off);
      roundRect(ctx, 0, 0, w, w, r);
      ctx.fillStyle = color;
      ctx.fill();
      if (scale === 1) {
        ctx.fillStyle = sheen(ctx, w);
        ctx.fill();
      }
      ctx.restore();
    }

    function ghost(ctx, x, y, s, color) {
      const inset = Math.max(1.5, s * 0.1);
      const w = s - inset * 2;
      ctx.save();
      roundRect(ctx, x + inset, y + inset, w, w, Math.max(1.5, w * 0.22));
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = Math.max(1.5, s * 0.07);
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.restore();
    }

    function draw() {
      if (!bctx || !cell) return;
      const ctx = bctx;
      const s = cell;
      const W = COLS * s;
      const H = ROWS * s;
      ctx.clearRect(0, 0, W, H);

      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < COLS; x++) { ctx.moveTo(x * s + 0.5, 0); ctx.lineTo(x * s + 0.5, H); }
      for (let y = 1; y < ROWS; y++) { ctx.moveTo(0, y * s + 0.5); ctx.lineTo(W, y * s + 0.5); }
      ctx.stroke();

      if (!grid.length) return;
      const clearSet = clearing ? new Set(clearing.rows) : null;
      const p = clearing ? 1 - Math.max(0, clearing.t) / CLEAR_MS : 0;
      for (let y = TOP; y < ROWS + TOP; y++) {
        const row = grid[y];
        const flashing = clearSet && clearSet.has(y);
        for (let x = 0; x < COLS; x++) {
          if (!row[x]) continue;
          block(ctx, x * s, (y - TOP) * s, s, flashing ? colors.flash : colors[row[x]], flashing ? { scale: 1 - p * 0.9 } : undefined);
        }
        if (flashing) {
          ctx.save();
          ctx.globalAlpha = 0.55 * (1 - p);
          ctx.fillStyle = colors.flash;
          ctx.fillRect(0, (y - TOP) * s, W, s);
          ctx.restore();
        }
      }

      if (cur) {
        const cells = ROT[cur.k][cur.r];
        let gy = cur.y;
        while (fitsAt(cur.x, gy + 1)) gy++;
        if (gy !== cur.y) {
          cells.forEach(([cx, cy]) => {
            if (gy + cy >= TOP) ghost(ctx, (cur.x + cx) * s, (gy + cy - TOP) * s, s, colors[cur.k]);
          });
        }
        cells.forEach(([cx, cy]) => {
          if (cur.y + cy >= TOP) block(ctx, (cur.x + cx) * s, (cur.y + cy - TOP) * s, s, colors[cur.k]);
        });
      }
    }

    // Small previews: pieces centred in equal slots, stacked unless the box is very wide.
    function drawMini(cv, kinds, dimFirst) {
      const box = cv.parentElement;
      const W = box.clientWidth;
      const H = box.clientHeight;
      if (!W || !H) return;
      const ctx = sizeCanvas(cv, W, H);
      ctx.clearRect(0, 0, W, H);
      const slots = Math.max(1, kinds.length);
      const vertical = H >= W * 0.5;
      const sw = vertical ? W : W / slots;
      const sh = vertical ? H / slots : H;
      const s = Math.max(4, Math.floor(Math.min(sw / 4.4, sh / 2.7, 30)));
      kinds.forEach((k, i) => {
        if (!k) return;
        const cells = ROT[k][0];
        const xs = cells.map((c) => c[0]);
        const ys = cells.map((c) => c[1]);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const bw = (Math.max(...xs) - minX + 1) * s;
        const bh = (Math.max(...ys) - minY + 1) * s;
        const ox = (vertical ? 0 : i * sw) + (sw - bw) / 2;
        const oy = (vertical ? i * sh : 0) + (sh - bh) / 2;
        const alpha = dimFirst && i === 0 ? 0.35 : 1;
        cells.forEach(([cx, cy]) => block(ctx, Math.round(ox + (cx - minX) * s), Math.round(oy + (cy - minY) * s), s, colors[k], { alpha }));
      });
    }

    function drawMinis() {
      drawMini(els.hold, [held], !canHold);
      drawMini(els.next, queue.slice(0, 3), false);
    }

    function fit() {
      const well = els.well;
      const frame = els.board.parentElement;
      const fs = getComputedStyle(frame);
      const padX = parseFloat(fs.paddingLeft) + parseFloat(fs.paddingRight) + parseFloat(fs.borderLeftWidth) + parseFloat(fs.borderRightWidth);
      const padY = parseFloat(fs.paddingTop) + parseFloat(fs.paddingBottom) + parseFloat(fs.borderTopWidth) + parseFloat(fs.borderBottomWidth);
      const availW = well.clientWidth - padX;
      const availH = well.clientHeight - padY;
      if (availW <= 0 || availH <= 0) return;
      const s = Math.max(6, Math.floor(Math.min(availW / COLS, availH / ROWS)));
      if (s !== cell || !bctx) {
        cell = s;
        bctx = sizeCanvas(els.board, COLS * s, ROWS * s);
        sheens.clear();
      }
      draw();
      drawMinis();
    }

    // ------------------------------------------------------------ touch keys
    const repeats = {};
    function stopRepeat(act) {
      clearTimeout(repeats[act]);
      clearInterval(repeats[act]);
      delete repeats[act];
    }
    function press(act) {
      if (status !== 'playing') return;
      if (act === 'left' || act === 'right') {
        const dx = act === 'left' ? -1 : 1;
        stopRepeat(act);
        move(dx);
        repeats[act] = setTimeout(() => { repeats[act] = setInterval(() => move(dx), REPEAT_MS); }, REPEAT_DELAY);
      } else if (act === 'down') {
        soft = true;
        softStep();
      } else if (act === 'rotate') rotate(1);
      else if (act === 'drop') hardDrop();
      else if (act === 'hold') hold();
    }
    function release(act) {
      if (act === 'left' || act === 'right') stopRepeat(act);
      if (act === 'down') soft = false;
    }
    function releaseAll() {
      Object.keys(repeats).forEach(stopRepeat);
      soft = false;
      root.querySelectorAll('.gl-key.is-down').forEach((b) => b.classList.remove('is-down'));
    }

    root.querySelectorAll('[data-gl]').forEach((b) => {
      const act = b.dataset.gl;
      b.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
        b.classList.add('is-down');
        press(act);
      });
      const up = () => { b.classList.remove('is-down'); release(act); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      // Enter/Space on a focused key (keyboard users) arrives as a click with no pointer.
      b.addEventListener('click', (e) => { if (e.detail === 0) { press(act); release(act); } });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    // Drop the highlight once it has played, or it replays whenever the screen is shown again.
    els.stat.level.addEventListener('animationend', () => els.stat.level.classList.remove('is-bump'));

    els.primary.addEventListener('click', primaryAction);
    els.secondary.addEventListener('click', () => start());
    els.pause.addEventListener('click', () => (status === 'paused' ? resume() : pause()));

    // ------------------------------------------------------------ gestures on the well
    // Tap: rotate. Drag sideways: move a column per square. Drag down: soft drop.
    // Quick flick down: drop. Quick flick up: hold.
    let g = null;
    els.board.addEventListener('pointerdown', (e) => {
      if (status !== 'playing' || e.button > 0) return;
      e.preventDefault();
      try { els.board.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t0: performance.now(), moved: false };
    });
    els.board.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id || !cell) return;
      const stepX = cell * 0.9;
      while (e.clientX - g.lx >= stepX) { move(1); g.lx += stepX; g.moved = true; }
      while (e.clientX - g.lx <= -stepX) { move(-1); g.lx -= stepX; g.moved = true; }
      while (e.clientY - g.ly >= cell) { softStep(); g.ly += cell; g.moved = true; }
      if (e.clientY < g.ly) g.ly = e.clientY;
    });
    const endGesture = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dt = performance.now() - g.t0;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      const s = cell || 24;
      if (e.type === 'pointerup') {
        if (dt < 260 && dy > s * 2 && dy > Math.abs(dx) * 1.5) hardDrop();
        else if (dt < 320 && -dy > s * 2 && -dy > Math.abs(dx) * 1.5) hold();
        else if (!g.moved && Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 320) rotate(1);
      }
      g = null;
    };
    els.board.addEventListener('pointerup', endGesture);
    els.board.addEventListener('pointercancel', endGesture);
    els.board.addEventListener('contextmenu', (e) => e.preventDefault());

    // ------------------------------------------------------------ keyboard
    document.addEventListener('keydown', (e) => {
      if (!isActive() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      const k = e.key;
      if (k === 'p' || k === 'P' || k === 'Escape') {
        if (status === 'playing') pause(); else if (status === 'paused') resume(); else return;
        e.preventDefault();
        return;
      }
      if (status !== 'playing') {
        if ((k === 'Enter' || k === ' ') && !(e.target && e.target.closest && e.target.closest('button'))) {
          primaryAction();
          e.preventDefault();
        }
        return;
      }
      let handled = true;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') move(-1);
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') move(1);
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { soft = true; if (!e.repeat) softStep(); }
      else if (e.repeat) handled = ['ArrowUp', ' ', 'x', 'X', 'z', 'Z', 'w', 'W', 'c', 'C', 'Shift'].includes(k);
      else if (k === 'ArrowUp' || k === 'x' || k === 'X' || k === 'w' || k === 'W') rotate(1);
      else if (k === 'z' || k === 'Z') rotate(-1);
      else if (k === ' ') hardDrop();
      else if (k === 'c' || k === 'C' || k === 'Shift') hold();
      else handled = false;
      if (handled) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') soft = false;
    });

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pause(); });
    window.addEventListener('blur', releaseAll);

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => fit());
      ro.observe(els.well);
      ro.observe(els.hold.parentElement);
      ro.observe(els.next.parentElement);
    }
    window.addEventListener('resize', () => fit());

    readColors();
    renderStats();
    renderOverlay();
    fit();

    return {
      start,
      pause,
      resume,
      setLocked,
      fit,
      retheme() { readColors(); draw(); drawMinis(); },
      get status() { return status; },
      // Read-only view of the game, for debugging and tests.
      peek() {
        return {
          status, score, lines, level, held, canHold, next: queue.slice(0, 3),
          cur: cur && { ...cur, cells: ROT[cur.k][cur.r].map(([cx, cy]) => [cur.x + cx, cur.y - TOP + cy]) },
          grid: grid.slice(TOP).map((row) => row.map((c) => c || '')),
        };
      },
    };
  }

  window.Gridlock = { create };
})();
