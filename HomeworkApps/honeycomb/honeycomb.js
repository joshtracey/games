// Honeycomb — Mots de la semaine: shared logic for the menu and the game.
// Puzzle rules (from the homework sheet, adapted from the NYT Spelling Bee):
// 7 letters, the centre letter must be in every word, letters can be reused,
// 4+ letters, real French words. Accents are ignored, so ELAN finds "élan".
//
// Needs fr-words.js, plus ../../boggle/core.js (Halifax date, English
// dictionary). Progress lives only on this device — no accounts, no server.
'use strict';

const MIN_LEN = 4;
const PANGRAM_BONUS = 7;

function stripAccents(w) {
  return String(w).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- French word index ---------- */

// accent-free key -> { display, common }. Where two spellings share a key
// ("pâte"/"pâté"), the common tier wins and then the first alphabetically.
let _frIndex = null;
function frIndex() {
  if (_frIndex) return _frIndex;
  _frIndex = new Map();
  for (const [list, common] of [[FR_COMMON, true], [FR_EXTRA, false]]) {
    for (const w of list.split(' ')) {
      const k = stripAccents(w);
      if (!_frIndex.has(k)) _frIndex.set(k, { display: w, common });
    }
  }
  return _frIndex;
}

/* ---------- Puzzles ---------- */

async function loadPuzzles() {
  const res = await fetch('puzzles.json');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const today = hfxDateString();
  return (data.puzzles || [])
    .map((p) => ({
      week: String(p.week),
      label: String(p.label || p.week),
      center: stripAccents(p.center).replace(/[^a-z]/g, '').slice(0, 1),
      outer: [...stripAccents(p.outer).replace(/[^a-z]/g, '')].slice(0, 6),
    }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.week) && p.center && p.outer.length === 6 && p.week <= today)
    .sort((a, b) => (a.week < b.week ? 1 : -1)); // newest first
}

// The newest released puzzle is "this week"; older ones stay playable.
function isCurrent(puzzles, p) { return puzzles.length && puzzles[0].week === p.week; }

function pointsFor(key, letterCount) {
  const base = key.length === MIN_LEN ? 1 : key.length;
  return new Set(key).size === letterCount ? base + PANGRAM_BONUS : base;
}

// Works out every answer for a puzzle. Common-tier answers make up the
// official list (total, ranks, reveal); rarer real words are bonus words.
function buildPuzzle(p) {
  const letters = new Set([p.center, ...p.outer]);
  const answers = new Map(), bonus = new Map();
  for (const [k, v] of frIndex()) {
    if (k.length < MIN_LEN || !k.includes(p.center)) continue;
    let ok = true;
    for (const ch of k) if (!letters.has(ch)) { ok = false; break; }
    if (!ok) continue;
    const entry = { key: k, display: v.display, pts: pointsFor(k, letters.size), pangram: new Set(k).size === letters.size };
    (v.common ? answers : bonus).set(k, entry);
  }
  let maxScore = 0;
  for (const a of answers.values()) maxScore += a.pts;
  return Object.assign({}, p, { letters, answers, bonus, maxScore });
}

// Returns { ok, lang: 'fr'|'en', entry } or { ok: false, reason }.
function hcCheckWord(puzzle, raw) {
  const k = stripAccents(raw);
  if (k.length < MIN_LEN) return { ok: false, reason: 'Trop court — 4 lettres minimum' };
  for (const ch of k) if (!puzzle.letters.has(ch)) return { ok: false, reason: `La lettre ${ch.toUpperCase()} n'est pas dans la ruche` };
  if (!k.includes(puzzle.center)) return { ok: false, reason: `Il manque la lettre du centre (${puzzle.center.toUpperCase()})` };
  const fr = puzzle.answers.get(k) || puzzle.bonus.get(k);
  if (fr) return { ok: true, lang: 'fr', entry: fr };
  if (typeof dict === 'function' && dict().has(k)) return { ok: true, lang: 'en', entry: { key: k, display: k } };
  return { ok: false, reason: "Pas dans la liste de mots" };
}

// French words only. Bonus (rarer) words score too.
function scoreOf(puzzle, frKeys) {
  let score = 0;
  for (const k of frKeys) {
    const e = puzzle.answers.get(k) || puzzle.bonus.get(k);
    if (e) score += e.pts;
  }
  return score;
}

const RANKS = [
  [0, 'Débutant'], [0.02, 'Bon début'], [0.05, 'En progrès'], [0.08, 'Bien'],
  [0.15, 'Solide'], [0.25, 'Très bien'], [0.40, 'Excellent'], [0.50, 'Génie'],
];

function rankOf(puzzle, frKeys) {
  const found = frKeys.filter((k) => puzzle.answers.has(k)).length;
  if (puzzle.answers.size && found === puzzle.answers.size) return { name: 'Reine des abeilles 🐝', i: RANKS.length, frac: 1 };
  const frac = puzzle.maxScore ? scoreOf(puzzle, frKeys) / puzzle.maxScore : 0;
  let i = 0;
  RANKS.forEach(([t], j) => { if (frac >= t) i = j; });
  return { name: RANKS[i][1], i, frac };
}

/* ---------- Progress (saved on this device) ---------- */

const PROGRESS_KEY = 'honeycomb-progress';

function localProgress(week) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) {}
  const p = all[week] || {};
  return { fr: Array.isArray(p.fr) ? p.fr : [], en: Array.isArray(p.en) ? p.en : [] };
}

function saveLocalProgress(week, prog) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) {}
  all[week] = { fr: prog.fr, en: prog.en };
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(all)); } catch (e) {}
}
