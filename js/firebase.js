import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

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