import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";

import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
const firebaseConfig = {
  apiKey: "AIzaSyBlTKFQWEzBbcSi0rm5RgC5uKSAYVwLukk",
  authDomain: "prau-profiling-67d34.firebaseapp.com",
  projectId: "prau-profiling-67d34",
  storageBucket: "prau-profiling-67d34.firebasestorage.app",
  messagingSenderId: "405888273288",
  appId: "1:405888273288:web:b612d63506ec7de958c83d"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

var db;
try{
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
}catch(e){
  console.error("Persistent Firestore cache unavailable, falling back to memory-only cache", e);
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false
  });
}

// Development only: route Auth/Firestore to the local emulators when the app
// is served from a local/LAN address (e.g. `firebase emulators:start`, opened
// either as 127.0.0.1 on this PC or as this PC's LAN IP from another device
// on the same Wi-Fi). Uses whatever hostname the browser actually connected
// with — no IP hardcoded — so it works unchanged if the LAN IP ever changes.
// Production Hosting's real deployed domain (a *.web.app/*.firebaseapp.com
// address) never matches this check, so it always talks to real Firebase.
var isLocalDevHost = location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(location.hostname);

if(isLocalDevHost){
  connectAuthEmulator(auth, "http://" + location.hostname + ":9099");
  connectFirestoreEmulator(db, location.hostname, 8080);
}

export { db };