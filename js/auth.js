import { auth, db } from "./firebase.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Single-session enforcement: a fresh login mints a random token, writes it
// to sessions/{uid}, and remembers it in localStorage (shared by every tab
// on this device/browser, unlike sessionStorage). Any other device holding
// an older token notices the mismatch via onSnapshot and signs itself out.
var SESSION_TOKEN_KEY = "prau_session_token";
var sessionUnsub = null;
var onSessionKicked = null;
// True only while login() is between writing its own sessions/{uid} doc and
// that write landing. Suppresses the onAuthStateChanged-driven watch start
// below, so this device's own watcher never reads the *previous* device's
// still-current token and false-positive-kicks itself before its own write
// has taken effect. login() starts its own watcher itself once safe.
var freshLoginInFlight = false;

function generateSessionToken(){
  if(window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

function stopSessionWatch(){
  if(sessionUnsub){ sessionUnsub(); sessionUnsub = null; }
}

// Starts (or restarts) watching this device's session validity. Reuses
// whatever token is already in localStorage — does NOT mint a new one.
function watchSessionValidity(uid){
  stopSessionWatch();
  var localToken = localStorage.getItem(SESSION_TOKEN_KEY);
  if(!localToken) return;
  sessionUnsub = onSnapshot(doc(db, "sessions", uid), function(snap){
    if(!snap.exists()) return;
    var remoteToken = snap.data().sessionToken;
    if(remoteToken && remoteToken !== localToken){
      stopSessionWatch();
      signOut(auth);
      if(onSessionKicked) onSessionKicked();
    }
  }, function(err){ console.error("Session watch failed:", err); });
}

export function watchAuth(onLogin, onLogout, onKicked){
  onSessionKicked = onKicked;
  onAuthStateChanged(auth, function(user){
    if(user){
      // Resumed session (page load/refresh, or another tab on this same
      // device) — no in-flight login() write to wait for here, so it's
      // safe to watch immediately using whatever token is already stored.
      if(!freshLoginInFlight) watchSessionValidity(user.uid);
      onLogin(user);
    }else{
      stopSessionWatch();
      onLogout();
    }
  });
}

export async function login(email, password){
  freshLoginInFlight = true;
  try{
    var token = generateSessionToken();
    localStorage.setItem(SESSION_TOKEN_KEY, token);
    var result = await signInWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "sessions", result.user.uid), {
      sessionToken: token,
      loggedInAt: new Date().toISOString()
    });
    watchSessionValidity(result.user.uid);
    return result;
  } finally {
    freshLoginInFlight = false;
  }
}

export function logout(){
  stopSessionWatch();
  return signOut(auth);
}
