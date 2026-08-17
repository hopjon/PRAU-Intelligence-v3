// versionCheck.js — detects when a newer deployed version exists (via a
// no-store fetch of version.js) and shows a dismissible "Reload" banner.
// Never auto-reloads: users may be mid-edit on a form/modal, so reloading
// must always be their explicit choice. All failures are silent — this
// check must never interfere with app startup, login, or normal use.
import { APP_VERSION } from "./version.js";

var CHECK_INTERVAL_MS = 5 * 60 * 1000;
var INITIAL_CHECK_DELAY_MS = 10 * 1000;

var bannerEl = null;
var dismissedForVersion = null;
var checkInFlight = false;

function extractVersion(text){
  var m = /APP_VERSION\s*=\s*["']([^"']+)["']/.exec(text || "");
  return m ? m[1] : null;
}

function hideBanner(){
  if(bannerEl){ bannerEl.remove(); bannerEl = null; }
}

function showUpdateBanner(newVersion){
  if(bannerEl) return;
  bannerEl = document.createElement("div");
  bannerEl.id = "versionUpdateBanner";
  bannerEl.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;z-index:10001;" + // above Firebase's own emulator-mode warning banner (z-index:10000)
    "background:#0f0f0f;border-top:1px solid var(--gold);color:var(--text);" +
    "padding:12px 16px calc(12px + env(safe-area-inset-bottom));" +
    "display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;" +
    "font-size:13px;text-align:center;";
  bannerEl.innerHTML =
    '<span>A new version of PRAU Intelligence is available.</span>' +
    '<span style="display:flex;gap:8px;">' +
      '<button type="button" id="versionReloadBtn" style="background:var(--gold);color:#0a0a0a;border:none;border-radius:8px;padding:7px 14px;font-weight:700;cursor:pointer;">Reload</button>' +
      '<button type="button" id="versionLaterBtn" style="background:transparent;color:var(--text);border:1px solid var(--border);border-radius:8px;padding:7px 14px;cursor:pointer;">Later</button>' +
    '</span>';
  document.body.appendChild(bannerEl);
  document.getElementById("versionReloadBtn").onclick = function(){ location.reload(); };
  document.getElementById("versionLaterBtn").onclick = function(){
    dismissedForVersion = newVersion;
    hideBanner();
  };
}

async function checkVersion(isFocusCheck){
  if(checkInFlight) return;
  checkInFlight = true;
  try{
    var res = await fetch("js/version.js", { cache: "no-store" });
    if(!res.ok) return;
    var text = await res.text();
    var remoteVersion = extractVersion(text);
    if(!remoteVersion || remoteVersion === APP_VERSION) return;
    if(bannerEl) return;
    if(dismissedForVersion === remoteVersion && !isFocusCheck) return;
    showUpdateBanner(remoteVersion);
  }catch(e){
    // Network hiccups, offline, blocked requests, etc. — never surface to the user.
  }finally{
    checkInFlight = false;
  }
}

setTimeout(function(){ checkVersion(false); }, INITIAL_CHECK_DELAY_MS);
setInterval(function(){ checkVersion(false); }, CHECK_INTERVAL_MS);
document.addEventListener("visibilitychange", function(){
  if(document.visibilityState === "visible") checkVersion(true);
});
