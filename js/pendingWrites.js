function storageKey(k){ return "praui_pending_" + k; }

export function markPending(k){
  var n = parseInt(localStorage.getItem(storageKey(k)) || "0", 10) + 1;
  localStorage.setItem(storageKey(k), String(n));
}

export function clearPending(k){
  var n = Math.max(0, parseInt(localStorage.getItem(storageKey(k)) || "0", 10) - 1);
  if(n === 0) localStorage.removeItem(storageKey(k));
  else localStorage.setItem(storageKey(k), String(n));
}

export function isPending(k){
  return parseInt(localStorage.getItem(storageKey(k)) || "0", 10) > 0;
}

// Reuses the exact visual style of the existing #offlineBanner (index.html)
// for a short-lived, action-specific confirmation toast. Auto-dismisses.
// Shared by People/Vehicles/Places so the wording/appearance stays identical.
export function showSyncToast(message){
  var el = document.createElement("div");
  el.textContent = message;
  // Anchored directly beneath #offlineBanner's actual rendered height (not a
  // guessed pixel value) — this toast only ever shows while offline, which is
  // exactly when that banner is visible, so its live height is a reliable
  // reference point on both desktop and mobile regardless of safe-area insets.
  var topPx = 0;
  var bannerEl = document.getElementById("offlineBanner");
  if(bannerEl && bannerEl.style.display === "block"){
    topPx = bannerEl.getBoundingClientRect().bottom;
  }
  el.style.cssText =
    "display:block;position:fixed;top:" + topPx + "px;left:0;right:0;text-align:center;" +
    "font-size:12px;letter-spacing:.5px;color:#0a0a0a;padding:8px 16px calc(8px + env(safe-area-inset-bottom));" +
    "background:var(--gold);z-index:9998;pointer-events:none;"; // directly below #offlineBanner (top, 9999) — clear of the Firebase emulator warning bar, which docks at the bottom
  document.body.appendChild(el);
  setTimeout(function(){ el.remove(); }, 6000);
}

// Online: unchanged — waits for the normal write acknowledgement, and any
// real rejection (e.g. document-too-large) still propagates as before.
// Offline: Firestore has already applied the write to its local cache
// synchronously (this is how offline persistence works — it's not
// contingent on the returned Promise settling), so instead of blocking the
// UI on a network round-trip that can't complete until reconnection, this
// waits only a short grace window for a fast/synchronous rejection (like
// doc-too-large, which is validated client-side) before treating the write
// as locally queued. The underlying write Promise is left to settle in the
// background and sync automatically via Firestore's existing offline queue.
// Shared by People/Vehicles/Places.
var OFFLINE_WRITE_GRACE_MS = 800;
export function writeLocalFirst(writePromise){
  if(navigator.onLine){
    return writePromise.then(function(){ return { queued: false }; });
  }
  return new Promise(function(resolve, reject){
    var settled = false;
    var timer = setTimeout(function(){
      if(settled) return;
      settled = true;
      resolve({ queued: true });
    }, OFFLINE_WRITE_GRACE_MS);
    writePromise.then(function(){
      clearTimeout(timer);
      if(settled) return;
      settled = true;
      resolve({ queued: false });
    }, function(e){
      clearTimeout(timer);
      if(settled) return;
      settled = true;
      reject(e);
    });
  });
}
