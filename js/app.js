import { watchAuth, login, logout } from "./auth.js";

const appEl = document.getElementById("app");

function renderLogin(){
  appEl.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <img src="images/prau-logo.png" class="login-logo" alt="PRAU Intelligence">
        <div class="login-tagline">Sign in to continue</div>
        <div class="login-field">
          <i class="bi bi-person"></i>
          <input type="email" id="loginEmail" placeholder="Email">
        </div>
        <div class="login-field">
          <i class="bi bi-lock"></i>
          <input type="password" id="loginPassword" placeholder="Password">
          <i class="bi bi-eye login-eye" id="togglePassword"></i>
        </div>
        <button class="login-btn" id="loginBtn"><i class="bi bi-lock-fill"></i> Sign In</button>
        <div class="login-error" id="loginError"></div>
      </div>
      <div class="login-version">v3.0</div>
    </div>
  `;

  document.getElementById("togglePassword").onclick = function(){
    var pw = document.getElementById("loginPassword");
    var isHidden = pw.type === "password";
    pw.type = isHidden ? "text" : "password";
    this.className = isHidden ? "bi bi-eye-slash login-eye" : "bi bi-eye login-eye";
  };

  document.getElementById("loginBtn").onclick = async function(){
    var email = document.getElementById("loginEmail").value.trim();
    var pass = document.getElementById("loginPassword").value;
    var errEl = document.getElementById("loginError");
    errEl.textContent = "";
    this.disabled = true;
    this.textContent = "Signing in…";
    try{
      await login(email, pass);
    }catch(e){
      errEl.textContent = "Access denied.";
      this.disabled = false;
      this.innerHTML = '<i class="bi bi-lock-fill"></i> Sign In';
    }
  };
}

function renderHome(user){
  appEl.innerHTML = `
    <div style="padding:40px;text-align:center;color:#fff;">
      <h2>Welcome, ${user.email}</h2>
      <button id="logoutBtn" class="login-btn" style="max-width:200px;margin:20px auto;">Sign out</button>
    </div>
  `;
  document.getElementById("logoutBtn").onclick = logout;
}

watchAuth(renderHome, renderLogin);