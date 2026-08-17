// Firebase setup for the Boggle suite. Pages that use it load the compat SDK
// from the CDN first:
//   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-database-compat.js"></script>
'use strict';

const firebaseConfig = {
  apiKey: "AIzaSyBklZemb6gLhv6N7kAw1NkPcNYf39DqyJM",
  authDomain: "pgames-60b14.firebaseapp.com",
  databaseURL: "https://pgames-60b14-default-rtdb.firebaseio.com",
  projectId: "pgames-60b14",
  storageBucket: "pgames-60b14.firebasestorage.app",
  messagingSenderId: "1046807851765",
  appId: "1:1046807851765:web:ece66ea270e127b0e68bbc"
};

let _fb = null;

// Lazy init + anonymous sign-in. Returns { db, authReady } where authReady
// resolves with the user (or null if sign-in failed, e.g. offline).
function fbInit() {
  if (_fb) return _fb;
  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();
  const authReady = firebase.auth().signInAnonymously()
    .then((cred) => cred.user)
    .catch(() => null);
  _fb = { db, authReady };
  return _fb;
}

// Milliseconds to add to Date.now() to approximate Firebase server time.
function fbServerOffset(db) {
  return new Promise((resolve) => {
    db.ref('.info/serverTimeOffset').once('value',
      (snap) => resolve(snap.val() || 0),
      () => resolve(0));
  });
}

/* ---- Score submission (transactions keep only each player's best) ---- */

function fbTxMax(ref, entry) {
  return ref.transaction((cur) => (cur && cur.score >= entry.score) ? undefined : entry);
}

function fbSubmitSolo(db, e) {
  return fbTxMax(db.ref(`boggle/solo/s${e.size}/${nameKey(e.name)}`),
    { name: e.name, score: e.score, at: e.at });
}

async function fbSubmitDaily(db, e) {
  const nk = nameKey(e.name);
  await fbTxMax(db.ref(`boggle/daily/days/${e.date}/${nk}`),
    { name: e.name, score: e.score, at: e.at });
  await db.ref(`boggle/daily/history/${nk}/${e.date}`)
    .transaction((cur) => (typeof cur === 'number' && cur >= e.score) ? undefined : e.score);
  await fbTxMax(db.ref(`boggle/daily/best/${nk}`),
    { name: e.name, score: e.score, date: e.date });
}

// Words of the Week: one record per player per week, holding their best
// (lowest) adjusted time plus a per-day best, so the day-by-day tab needs no
// second read. Lists reset cleanly because the week id is part of the path.
function fbSubmitWeekly(db, e) {
  return db.ref(`boggle/weekly/${e.week}/${nameKey(e.name)}`).transaction((cur) => {
    const rec = (cur && typeof cur === 'object') ? cur : {};
    const days = rec.days || {};
    const day = days[e.date];
    if (!day || e.bestTime < day.bestTime) {
      days[e.date] = { bestTime: e.bestTime, rawTime: e.rawTime, errors: e.errors };
    }
    if (typeof rec.bestTime !== 'number' || e.bestTime < rec.bestTime) {
      return {
        name: e.name, bestTime: e.bestTime, rawTime: e.rawTime,
        errors: e.errors, completedAt: e.completedAt, days,
      };
    }
    rec.name = e.name;
    rec.days = days;
    return rec;
  });
}

// Drain the offline queue (solo + daily + weekly entries). Safe to call repeatedly.
function fbSyncQueue(db) {
  return BoggleQueue.flush(async (e) => {
    if (e.mode === 'solo') await fbSubmitSolo(db, e);
    else if (e.mode === 'daily') await fbSubmitDaily(db, e);
    else if (e.mode === 'weekly') await fbSubmitWeekly(db, e);
    return true;
  });
}

// Standard boot for pages with leaderboards: init if the SDK loaded (it won't
// have, offline), sign in, drain the queue now and whenever we come online.
function fbBoot() {
  if (typeof firebase === 'undefined') return null;
  let fb;
  try { fb = fbInit(); } catch (err) { return null; }
  const drain = () => fb.authReady.then((u) => u && fbSyncQueue(fb.db)).catch(() => {});
  drain();
  window.addEventListener('online', drain);
  return fb;
}
