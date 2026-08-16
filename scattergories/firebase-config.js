// Firebase setup for the Scattergories suite — same project as Boggle.
// Pages that use it load the compat SDK from the CDN first:
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
  // Boggle pages may already have initialized the default app in this tab.
  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
  const db = firebase.database(app);
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

/* ---- Daily submission ----
   Unlike Boggle we store the ANSWERS, not a score: a daily entry only earns
   points for answers nobody else gave, so every sheet's score can change when
   the next person plays. Scores are therefore always recomputed on read. */

function fbSubmitDaily(db, e) {
  return db.ref(`scattergories/daily/days/${e.date}/${nameKey(e.name)}`)
    .transaction((cur) => {
      // One sheet per player per day: first submission wins, so a replay
      // can't quietly overwrite the answers others were scored against.
      if (cur) return undefined;
      return { name: e.name, answers: e.answers || {}, at: e.at };
    });
}

// Drain the offline queue. Safe to call repeatedly.
function fbSyncQueue(db) {
  return ScatQueue.flush(async (e) => {
    if (e.mode === 'daily') await fbSubmitDaily(db, e);
    return true;
  });
}

// Standard boot: init if the SDK loaded (it won't have, offline), sign in,
// drain the queue now and whenever we come back online.
function fbBoot() {
  if (typeof firebase === 'undefined') return null;
  let fb;
  try { fb = fbInit(); } catch (err) { return null; }
  const drain = () => fb.authReady.then((u) => u && fbSyncQueue(fb.db)).catch(() => {});
  drain();
  window.addEventListener('online', drain);
  return fb;
}
