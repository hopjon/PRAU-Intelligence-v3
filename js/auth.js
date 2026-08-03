import { auth } from "./firebase.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

export function watchAuth(onLogin, onLogout){
  onAuthStateChanged(auth, function(user){
    if(user){ onLogin(user); } else { onLogout(); }
  });
}

export async function login(email, password){
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout(){
  return signOut(auth);
}