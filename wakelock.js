// Keeps the screen awake while a game page is open. Only game pages load
// this file — the main menu doesn't — so navigating back to the menu
// releases the lock automatically (wake locks are per-page).
(() => {
  if (!('wakeLock' in navigator)) return;
  const acquire = () => {
    // Request can be denied (e.g. battery saver); the screen then just
    // sleeps on its normal schedule, so failures are safely ignored.
    navigator.wakeLock.request('screen').catch(() => {});
  };
  // The browser releases the lock whenever the tab is hidden or the
  // device locks; take it again when the player comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire();
  });
  acquire();
})();
