import { watchAuth, login, logout } from "./auth.js";
import { showDashboard } from "./dashboard.js";
import { registerRoute } from "./layout/router.js";
import { showPeople } from "./people/people.js";
import { APP_VERSION } from "./version.js";
import "./versionCheck.js";

const appEl = document.getElementById("app");

var appVersionEl = document.getElementById("appVersion");
if(appVersionEl) appVersionEl.textContent = APP_VERSION;

var offlineBannerEl = document.getElementById("offlineBanner");
function updateOfflineBanner(){
  if(offlineBannerEl) offlineBannerEl.style.display = navigator.onLine ? "none" : "block";
}
updateOfflineBanner();
window.addEventListener("offline", updateOfflineBanner);
window.addEventListener("online", updateOfflineBanner);

var pendingForcedLogoutModal = false;

function openForcedLogoutModal(){
  var el = document.createElement("div");
  el.className = "modal fade";
  el.tabIndex = -1;
  el.innerHTML =
    '<div class="modal-dialog modal-dialog-centered">' +
      '<div class="modal-content" style="background:#0f0f0f;color:var(--text);border:1px solid var(--gold);">' +
        '<div class="modal-header" style="border-bottom:1px solid var(--border);">' +
          '<h5 class="modal-title" style="color:var(--gold);">Signed out</h5>' +
        '</div>' +
        '<div class="modal-body">' +
          '<p style="color:var(--text);margin:0;">Your account was logged in on another device. You have been signed out of this device.</p>' +
        '</div>' +
        '<div class="modal-footer" style="border-top:1px solid var(--border);">' +
          '<button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);
  el.style.zIndex = "2200"; // above every other app overlay (.modal-backdrop-custom: 2000, #imageViewer: 2100)
  el.addEventListener("hidden.bs.modal", function(){ el.remove(); });
  new bootstrap.Modal(el).show();
  var bsBackdrop = document.body.querySelector(".modal-backdrop:last-of-type");
  if(bsBackdrop) bsBackdrop.style.zIndex = "2199";
}

function renderLogin(){
  Array.prototype.forEach.call(document.querySelectorAll(".modal-backdrop-custom"), function(el){ el.remove(); });
  var imageViewerEl = document.getElementById("imageViewer");
  if(imageViewerEl) imageViewerEl.style.display = "none";

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
      <div class="login-version">v${APP_VERSION}</div>
    </div>
  `;

  if(pendingForcedLogoutModal){
    pendingForcedLogoutModal = false;
    openForcedLogoutModal();
  }

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



watchAuth(function(user){
  showDashboard(user);
}, renderLogin, function(){
  pendingForcedLogoutModal = true;
});
registerRoute("people", showPeople);