// Boggle suite — shared logic: dice, board generation, path validation,
// scoring, input handling, timers, Atlantic-time helpers, settings.
'use strict';

/* ---------- Dice (authentic distributions; Q face plays as "Qu") ---------- */

const BOGGLE_DICE = {
  4: ['AAEEGN','ABBJOO','ACHOPS','AFFKPS','AOOTTW','CIMOTU','DEILRX','DELRVY',
      'DISTTY','EEGHNW','EEINSU','EHRTVW','EIOSST','ELRTTY','HIMNQU','HLNNRZ'],
  5: ['AAAFRS','AAEEEE','AAFIRS','ADENNN','AEEEEM','AEEGMU','AEGMNN','AFIRSY',
      'BJKQXZ','CCNSTW','CEIILT','CEILPT','CEIPST','DDLNOR','DHHLOR','DHHNOT',
      'DHLNOR','EIIITT','EMOTTT','ENSSSU','FIPRSY','GORRVW','HIPRRY','NOOTUW',
      'OOOTTU'],
};

/* ---------- Seedable PRNG (for the daily puzzle and shared multi boards) ---------- */

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Board generation ---------- */

// Returns an array of size*size lowercase tile strings ('a'..'z' or 'qu').
function generateBoard(size, rng) {
  rng = rng || Math.random;
  const dice = BOGGLE_DICE[size].slice();
  for (let i = dice.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [dice[i], dice[j]] = [dice[j], dice[i]];
  }
  return dice.map((d) => {
    const face = d[Math.floor(rng() * 6)].toLowerCase();
    return face === 'q' ? 'qu' : face;
  });
}

function tileDisplay(tile) {
  return tile === 'qu' ? 'Qu' : tile.toUpperCase();
}

/* ---------- Planted boards (Words of the Week) ---------- */

// Builds a board on which every one of `words` is guaranteed findable.
// Each word is threaded along a random path of adjacent tiles (diagonals
// included), sharing tiles with words already down wherever the letters agree
// — without that overlap a homophone set doesn't fit in 25 cells. A word that
// won't go down after 50 tries condemns the whole layout and we start fresh.
// Returns { tiles, paths }, where paths maps each word to its tile indices.
function generatePlantedBoard(words, size, rng) {
  rng = rng || Math.random;
  size = size || 5;
  const cells = size * size;
  const adj = neighbors(size);
  const targets = words
    .map((w) => String(w).toLowerCase().replace(/[^a-z]/g, ''))
    .filter(Boolean);

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // One randomized attempt at threading `word` through `board`. A tile can be
  // taken if it's empty or already holds the letter we need. The node budget
  // cuts a hopeless search short so the caller's next try explores elsewhere
  // instead of grinding through the same dead ends.
  function threadWord(board, word) {
    const used = new Array(cells).fill(false);
    const path = [];
    let budget = 600;

    function step(idx, pos) {
      if (budget-- <= 0) return false;
      used[idx] = true;
      path.push(idx);
      if (pos + 1 === word.length) return true;
      const want = word[pos + 1];
      // Neighbours that already carry the next letter go first: overlapping is
      // what keeps a long word list inside the grid.
      const rank = (i) => (used[i] || (board[i] && board[i] !== want) ? -1 : (board[i] ? 2 : 1));
      const options = shuffled(adj[idx]).sort((a, b) => rank(b) - rank(a));
      for (const n of options) {
        if (rank(n) < 0) continue;
        if (step(n, pos + 1)) return true;
      }
      used[idx] = false;
      path.pop();
      return false;
    }

    const starts = shuffled(Array.from({ length: cells }, (_, i) => i))
      .filter((i) => !board[i] || board[i] === word[0]);
    for (const s of starts) {
      if (step(s, 0)) return path.slice();
      if (budget <= 0) break;
    }
    return null;
  }

  // Gaps are filled mostly from the target words' own letters so stray tiles
  // blend in rather than advertising themselves; the rest are common letters
  // (no lone Q, which would read as a missing "u").
  const FILLER = 'eeeaaariiooottnnsslcudpmhgbfywkv';
  function fillGaps(board) {
    const pool = targets.join('');
    for (let i = 0; i < cells; i++) {
      if (board[i]) continue;
      board[i] = (pool && rng() < 0.75)
        ? pool[Math.floor(rng() * pool.length)]
        : FILLER[Math.floor(rng() * FILLER.length)];
    }
  }

  for (let layout = 0; layout < 200; layout++) {
    const board = new Array(cells).fill('');
    const paths = {};
    // Longest first — the hardest words go down while the board is emptiest.
    const order = shuffled(targets).sort((a, b) => b.length - a.length);
    let placed = true;
    for (const w of order) {
      let path = null;
      for (let attempt = 0; attempt < 50 && !path; attempt++) path = threadWord(board, w);
      if (!path) { placed = false; break; }
      path.forEach((idx, i) => { board[idx] = w[i]; });
      paths[w] = path;
    }
    if (!placed) continue;
    fillGaps(board);
    // Belt and braces: nothing ships until every word really traces.
    if (targets.every((w) => wordHasPath(w, board, size))) return { tiles: board, paths };
  }
  throw new Error('could not fit these words on a ' + size + '×' + size + ' board');
}

/* ---------- Dictionary, path validation, scoring ---------- */

let _dict = null;
function dict() {
  if (!_dict) {
    if (typeof BOGGLE_WORDS === 'undefined') throw new Error('words.js not loaded');
    _dict = new Set(BOGGLE_WORDS.split(' '));
  }
  return _dict;
}

function minWordLength(size) { return size === 5 ? 4 : 3; }

// Authentic scoring; "Qu" counts as two letters via word length.
function scoreWord(word) {
  const n = word.length;
  if (n <= 4) return 1;
  if (n === 5) return 2;
  if (n === 6) return 3;
  if (n === 7) return 5;
  return 11;
}

const NEIGHBORS_CACHE = {};
function neighbors(size) {
  if (NEIGHBORS_CACHE[size]) return NEIGHBORS_CACHE[size];
  const out = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const list = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < size && nc >= 0 && nc < size) list.push(nr * size + nc);
        }
      }
      out.push(list);
    }
  }
  NEIGHBORS_CACHE[size] = out;
  return out;
}

// Can `word` be traced on `board` using each tile at most once,
// moving only between adjacent tiles (incl. diagonals)?
function wordHasPath(word, board, size) {
  word = word.toLowerCase();
  const adj = neighbors(size);
  const used = new Array(board.length).fill(false);
  function dfs(idx, pos) {
    const tile = board[idx];
    if (!word.startsWith(tile, pos)) return false;
    const next = pos + tile.length;
    if (next === word.length) return true;
    used[idx] = true;
    for (const n of adj[idx]) {
      if (!used[n] && dfs(n, next)) return true;
    }
    used[idx] = false;
    return false;
  }
  for (let i = 0; i < board.length; i++) {
    if (dfs(i, 0)) return true;
  }
  return false;
}

// Full check for a submitted word. Returns {ok} or {ok:false, reason}.
// Blocklisted words are simply absent from the dictionary, so they
// fail with the same "not a word" result as any other invalid entry.
function checkWord(word, board, size) {
  word = word.toLowerCase();
  if (word.length < minWordLength(size)) {
    return { ok: false, reason: `${minWordLength(size)} letters minimum` };
  }
  if (!dict().has(word)) return { ok: false, reason: 'not in word list' };
  if (!wordHasPath(word, board, size)) return { ok: false, reason: 'not on the board' };
  return { ok: true, score: scoreWord(word) };
}

/* ---------- Atlantic time (family home timezone; DST-safe via IANA zone) ---------- */

const HFX_TZ = 'America/Halifax';

function hfxDateString(date) {
  // en-CA yields YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: HFX_TZ }).format(date || new Date());
}

function hfxSecondsIntoDay(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HFX_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date || new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return (get('hour') % 24) * 3600 + get('minute') * 60 + get('second');
}

// Epoch ms of the next Halifax midnight (used for room expiry).
function hfxNextMidnight() {
  const now = Date.now();
  return now + (86400 - hfxSecondsIntoDay(new Date(now))) * 1000;
}

/* ---------- Settings ---------- */

const SETTINGS_KEY = 'boggle-settings';

function getSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) {}
  return {
    name: typeof s.name === 'string' ? s.name : '',
    size: s.size === 5 ? 5 : 4,
    input: s.input === 'select' ? 'select' : 'drag',
  };
}

function saveSettings(patch) {
  const s = Object.assign(getSettings(), patch);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  return s;
}

// Prompt once for a name on pages that need one (solo/daily/multi).
function ensurePlayerName() {
  const s = getSettings();
  if (s.name) return s.name;
  let n = (window.prompt('What name should we show on leaderboards?') || '').trim().slice(0, 24);
  if (!n) n = 'Player';
  saveSettings({ name: n });
  return n;
}

// Firebase keys forbid . # $ / [ ]; also normalize case so "gus" === "Gus".
function nameKey(name) {
  const k = name.trim().toLowerCase().replace(/[.#$/\[\]]/g, '').slice(0, 24);
  return k || 'player';
}

/* ---------- Room codes ---------- */

function randomRoomCode(rng) {
  rng = rng || Math.random;
  const blocked = typeof BOGGLE_BLOCKLIST !== 'undefined'
    ? new Set(BOGGLE_BLOCKLIST.split(' ').filter((w) => w.length === 3)) : new Set();
  for (;;) {
    let code = '';
    for (let i = 0; i < 3; i++) code += String.fromCharCode(65 + Math.floor(rng() * 26));
    if (!blocked.has(code.toLowerCase())) return code;
  }
}

/* ---------- Countdown timer (timestamp-based; survives tab throttling) ---------- */

function createCountdown(onTick, onEnd) {
  let endAt = 0, interval = null, ended = false;
  function tick() {
    const left = Math.max(0, endAt - Date.now());
    onTick(Math.ceil(left / 1000), left);
    if (left <= 0 && !ended) {
      ended = true;
      clearInterval(interval);
      onEnd();
    }
  }
  return {
    start(durationMs, endAtMs) {
      endAt = endAtMs || (Date.now() + durationMs);
      ended = false;
      clearInterval(interval);
      interval = setInterval(tick, 200);
      tick();
    },
    stop() { clearInterval(interval); ended = true; },
    remaining() { return Math.max(0, endAt - Date.now()); },
  };
}

function fmtTime(totalSec) {
  const m = Math.floor(totalSec / 60), s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ---------- Board UI + input (drag and select both always active) ---------- */

// Renders the grid into `container` and wires pointer input.
//   opts: { size, tiles, rotated, interactive, onPathChange(word), onSubmit(word) }
// Tap = select mode (tap last tile again to remove it); press-and-swipe = drag
// mode (submits on release; sliding back over the previous tile backtracks).
function createBoardUI(container, opts) {
  const size = opts.size;
  const adj = neighbors(size);
  let tiles = opts.tiles;
  let enabled = opts.interactive !== false;
  let path = [];
  let dragging = false;
  let pointerDownIdx = -1;
  const rng = Math.random;

  container.classList.add('board');
  container.classList.toggle('disabled', !enabled);
  container.dataset.size = size;
  container.innerHTML = '';
  const tileEls = tiles.map((t, i) => {
    const el = document.createElement('div');
    el.className = 'tile';
    el.dataset.idx = i;
    const span = document.createElement('span');
    span.className = 'tile-letter';
    if (opts.rotated) {
      span.classList.add('underlined', 'rot' + (Math.floor(rng() * 4) * 90));
    }
    span.textContent = tileDisplay(t);
    el.appendChild(span);
    container.appendChild(el);
    return el;
  });

  function currentWord() {
    return path.map((i) => tiles[i]).join('');
  }
  function render() {
    tileEls.forEach((el, i) => {
      el.classList.toggle('sel', path.includes(i));
      el.classList.toggle('sel-last', path.length > 0 && path[path.length - 1] === i);
    });
    if (opts.onPathChange) opts.onPathChange(currentWord());
  }
  function clearPath() {
    path = [];
    render();
  }
  function flash(idx) {
    const el = tileEls[idx];
    el.classList.remove('deny');
    void el.offsetWidth;
    el.classList.add('deny');
  }
  function submit() {
    const w = currentWord();
    clearPath();
    if (w && opts.onSubmit) opts.onSubmit(w);
  }
  function canAppend(idx) {
    if (path.includes(idx)) return false;
    if (path.length === 0) return true;
    return adj[path[path.length - 1]].includes(idx);
  }

  // Hit-test against the central 70% of each tile so diagonal swipes don't
  // clip orthogonal neighbours.
  function tileAt(x, y, strict) {
    const el = document.elementFromPoint(x, y);
    const tile = el && el.closest && el.closest('.tile');
    if (!tile || tile.parentElement !== container) return -1;
    const idx = Number(tile.dataset.idx);
    if (strict) {
      const r = tile.getBoundingClientRect();
      const dx = Math.abs(x - (r.left + r.width / 2)) / (r.width / 2);
      const dy = Math.abs(y - (r.top + r.height / 2)) / (r.height / 2);
      if (dx > 0.7 || dy > 0.7) return -1;
    }
    return idx;
  }

  function onDown(e) {
    if (!enabled) return;
    e.preventDefault();
    pointerDownIdx = tileAt(e.clientX, e.clientY, false);
    dragging = false;
  }
  function onMove(e) {
    if (!enabled || pointerDownIdx < 0) return;
    const idx = tileAt(e.clientX, e.clientY, true);
    if (!dragging) {
      if (idx === pointerDownIdx || idx === -1) return;
      // Finger left the pressed tile: this is a drag — restart the path there.
      dragging = true;
      path = [pointerDownIdx];
    }
    if (idx === -1 || idx === path[path.length - 1]) return;
    if (path.length > 1 && idx === path[path.length - 2]) {
      path.pop(); // backtrack
    } else if (canAppend(idx)) {
      path.push(idx);
    }
    render();
  }
  function onUp(e) {
    if (!enabled || pointerDownIdx < 0) return;
    const startIdx = pointerDownIdx;
    pointerDownIdx = -1;
    if (dragging) {
      dragging = false;
      submit();
      return;
    }
    // Tap: select-mode logic.
    const idx = tileAt(e.clientX, e.clientY, false);
    if (idx === -1 || idx !== startIdx) return;
    if (path.length && idx === path[path.length - 1]) {
      path.pop();
    } else if (canAppend(idx)) {
      path.push(idx);
    } else {
      flash(idx);
      return;
    }
    render();
  }

  if (opts.interactive !== false) {
    container.style.touchAction = 'none';
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', () => { pointerDownIdx = -1; dragging = false; clearPath(); });
  }

  return {
    clearPath,
    submitCurrent: submit,
    currentWord,
    setEnabled(v) {
      enabled = v;
      container.classList.toggle('disabled', !v);
      if (!v) clearPath();
    },
  };
}

/* ---------- Offline score queue (solo + daily) ---------- */

const QUEUE_KEY = 'boggle-queue';

const BoggleQueue = {
  all() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch (e) { return []; }
  },
  push(entry) {
    const q = BoggleQueue.all();
    q.push(entry);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  },
  // handler(entry) resolves truthy when the entry has been synced.
  async flush(handler) {
    const q = BoggleQueue.all();
    if (!q.length) return;
    const remaining = [];
    for (const entry of q) {
      try {
        if (!(await handler(entry))) remaining.push(entry);
      } catch (e) {
        remaining.push(entry);
      }
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  },
};
