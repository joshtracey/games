// Scattergories suite — shared logic: letter roll, seeded sheet selection,
// answer normalization and scoring, timers, Atlantic-time helpers, settings.
'use strict';

/* ---------- Letters ---------- */

// The classic 20-sided letter die: no Q, U, V, X, Y or Z.
const SCAT_LETTERS = 'ABCDEFGHIJKLMNOPRSTW';

const CATS_PER_SHEET = 12;

/* ---------- Seedable PRNG (daily sheet + shared room sheets) ---------- */

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

/* ---------- Sheet generation ---------- */

function rollLetter(rng) {
  rng = rng || Math.random;
  return SCAT_LETTERS[Math.floor(rng() * SCAT_LETTERS.length)];
}

// `n` distinct categories, drawn without replacement.
function pickCategories(rng, n) {
  rng = rng || Math.random;
  n = n || CATS_PER_SHEET;
  const pool = SCAT_CATEGORIES.slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

// A whole round: one letter plus a category sheet, from a single rng.
function makeSheet(rng) {
  return { letter: rollLetter(rng), categories: pickCategories(rng, CATS_PER_SHEET) };
}

function dailySheet(date) {
  return makeSheet(mulberry32(hashSeed('scattergories-daily-' + date)));
}

/* ---------- Answers: normalizing, checking, scoring ---------- */

// House rule (and the printed rules): a leading article is ignored, so
// "The Beatles" answers B. Everything else is compared on letters and
// digits only, so "hot-dog", "Hot Dog" and "hotdog" are one answer.
const ARTICLE_RE = /^(a|an|the)\s+/i;

function stripArticle(s) {
  return String(s).trim().replace(ARTICLE_RE, '').trim();
}

// Comparison key for duplicate detection. Accents are folded so "Elephant"
// and "élephant" match; empty string means "no answer".
function normalizeAnswer(s) {
  return stripArticle(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Does an answer satisfy the letter rule? Returns {ok} or {ok:false, reason}.
function checkAnswer(answer, letter) {
  const bare = stripArticle(answer);
  if (!normalizeAnswer(bare)) return { ok: false, reason: 'blank' };
  const first = normalizeAnswer(bare)[0];
  if (first !== letter.toLowerCase()) {
    return { ok: false, reason: `must start with ${letter.toUpperCase()}` };
  }
  return { ok: true };
}

// Printed rules: one point per word in the answer that starts with the key
// letter, so on M "Macho Man" is worth 2 and "Mickey Mouse Movie" 3. A leading
// article was already dropped by stripArticle, and hyphens split words the way
// spaces do ("Mud-Munching Monster" = 3). House rule on top of the printed
// ones: a repeated word only scores once, so "Massive Massive Monster" is 2,
// not 3 — padding an answer with the same word shouldn't beat a real one.
const WORD_SPLIT_RE = /[\s/\-‐-―]+/;

function scoreAnswer(answer, letter) {
  const target = letter.toLowerCase();
  const counted = new Set();
  for (const word of stripArticle(answer).split(WORD_SPLIT_RE)) {
    const key = normalizeAnswer(word);
    if (key && key[0] === target) counted.add(key);
  }
  return counted.size;
}

// Score a whole table of answers at once.
//   sheets: { playerId: { c0: 'answer', c1: '…' } }   (missing keys = blank)
//   vetoed: { playerId: { c0: true } }  answers the table struck out
// Returns { byPlayer: { pid: { total, scored, cells: [ {answer, state, reason,
// points} ] } } } where state is 'unique' | 'duplicate' | 'invalid' | 'vetoed'
// | 'blank'; `total` is points, `scored` is how many answers earned any.
function scoreRound(sheets, letter, categoryCount, vetoed) {
  vetoed = vetoed || {};
  const pids = Object.keys(sheets);

  // Count valid, un-vetoed answers per category so duplicates cancel.
  const counts = [];
  for (let c = 0; c < categoryCount; c++) {
    const seen = {};
    for (const pid of pids) {
      if (vetoed[pid] && vetoed[pid]['c' + c]) continue;
      const raw = (sheets[pid] || {})['c' + c] || '';
      if (!checkAnswer(raw, letter).ok) continue;
      const key = normalizeAnswer(raw);
      seen[key] = (seen[key] || 0) + 1;
    }
    counts.push(seen);
  }

  const byPlayer = {};
  for (const pid of pids) {
    const cells = [];
    let total = 0, scored = 0;
    for (let c = 0; c < categoryCount; c++) {
      const raw = (sheets[pid] || {})['c' + c] || '';
      const key = normalizeAnswer(raw);
      if (vetoed[pid] && vetoed[pid]['c' + c]) {
        cells.push({ answer: raw, state: 'vetoed', points: 0, reason: 'struck by the table' });
        continue;
      }
      const check = checkAnswer(raw, letter);
      if (!check.ok) {
        cells.push({ answer: raw, state: key ? 'invalid' : 'blank', points: 0, reason: check.reason });
        continue;
      }
      if (counts[c][key] > 1) {
        cells.push({ answer: raw, state: 'duplicate', points: 0, reason: 'someone else said it too' });
        continue;
      }
      const points = scoreAnswer(raw, letter);
      cells.push({ answer: raw, state: 'unique', points });
      total += points;
      scored += 1;
    }
    byPlayer[pid] = { total, scored, cells };
  }
  return { byPlayer };
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

const SETTINGS_KEY = 'scat-settings';

function getSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) {}
  return {
    name: typeof s.name === 'string' ? s.name : '',
    minutes: s.minutes === 2 ? 2 : 3,
  };
}

function saveSettings(patch) {
  const s = Object.assign(getSettings(), patch);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  return s;
}

// Boggle stores a name under its own key; reuse it as the default so the
// family doesn't get asked twice on the same phone.
function ensurePlayerName() {
  const s = getSettings();
  if (s.name) return s.name;
  let n = '';
  try { n = (JSON.parse(localStorage.getItem('boggle-settings')) || {}).name || ''; } catch (e) {}
  if (!n) n = (window.prompt('What name should we show on leaderboards?') || '').trim();
  n = n.trim().slice(0, 24) || 'Player';
  saveSettings({ name: n });
  return n;
}

// Firebase keys forbid . # $ / [ ]; also normalize case so "gus" === "Gus".
function nameKey(name) {
  const k = name.trim().toLowerCase().replace(/[.#$/\[\]]/g, '').slice(0, 24);
  return k || 'player';
}

/* ---------- Room codes ---------- */

// Short list of 3-letter combos we'd rather not show a family; mirrors the
// 3-letter entries in the Boggle blocklist plus a few obvious spellings.
const SCAT_CODE_BLOCKLIST = new Set([
  'ASS', 'BBW', 'CUM', 'FAG', 'SEX', 'TIT', 'XXX',
  'AZZ', 'CNT', 'COK', 'DIK', 'FCK', 'FUK', 'JIZ', 'PIS', 'SHT', 'TWT', 'WTF',
]);

function randomRoomCode(rng) {
  rng = rng || Math.random;
  for (;;) {
    let code = '';
    for (let i = 0; i < 3; i++) code += String.fromCharCode(65 + Math.floor(rng() * 26));
    if (!SCAT_CODE_BLOCKLIST.has(code)) return code;
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

/* ---------- Answer sheet UI ---------- */

// Renders the 12 numbered category rows with a text input each.
//   opts: { categories, letter, values, interactive, onChange(index, value) }
// Returns { values(), setEnabled(v), focusFirst() }.
function createSheetUI(container, opts) {
  const interactive = opts.interactive !== false;
  container.classList.add('sheet');
  container.classList.toggle('disabled', !interactive);
  container.innerHTML = '';
  const inputs = [];

  opts.categories.forEach((cat, i) => {
    const row = document.createElement('div');
    row.className = 'sheet-row';

    const num = document.createElement('div');
    num.className = 'sheet-num';
    num.textContent = i + 1;
    row.appendChild(num);

    const body = document.createElement('div');
    body.className = 'sheet-body';
    const label = document.createElement('label');
    label.className = 'sheet-cat';
    label.textContent = cat;
    label.htmlFor = 'ans' + i;
    body.appendChild(label);

    if (interactive) {
      const input = document.createElement('input');
      input.className = 'text sheet-input';
      input.id = 'ans' + i;
      input.type = 'text';
      input.autocomplete = 'off';
      input.autocapitalize = 'words';
      input.spellcheck = false;
      input.maxLength = 40;
      input.value = (opts.values && opts.values['c' + i]) || '';
      input.placeholder = opts.letter + '…';
      input.addEventListener('input', () => {
        markRow(row, input.value);
        if (opts.onChange) opts.onChange(i, input.value);
      });
      // Enter moves to the next blank rather than submitting anything.
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const next = inputs[i + 1];
        if (next) next.focus(); else input.blur();
      });
      markRow(row, input.value);
      body.appendChild(input);
      inputs.push(input);
    }

    row.appendChild(body);
    container.appendChild(row);
  });

  // Live hint: a filled answer that breaks the letter rule is flagged as you
  // type, so nobody loses a point to a typo they could have seen.
  function markRow(row, value) {
    const res = checkAnswer(value, opts.letter);
    row.classList.toggle('good', res.ok);
    row.classList.toggle('bad', !res.ok && !!normalizeAnswer(value));
  }

  return {
    values() {
      const out = {};
      inputs.forEach((inp, i) => {
        const v = inp.value.trim();
        if (v) out['c' + i] = v;
      });
      return out;
    },
    setEnabled(v) {
      container.classList.toggle('disabled', !v);
      inputs.forEach((inp) => { inp.disabled = !v; });
    },
    focusFirst() {
      if (inputs[0]) inputs[0].focus();
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Offline score queue (daily) ---------- */

const QUEUE_KEY = 'scat-queue';

const ScatQueue = {
  all() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch (e) { return []; }
  },
  push(entry) {
    const q = ScatQueue.all();
    q.push(entry);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  },
  // handler(entry) resolves truthy when the entry has been synced.
  async flush(handler) {
    const q = ScatQueue.all();
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
