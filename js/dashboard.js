import { logout } from "./auth.js";
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { showPeople } from "./people/people.js";
import { renderVehicles } from "./vehicles.js";
import { renderFaceSearch } from "./face.js";
import { renderPlaces } from "./places.js";
import { renderGlobalSearch } from "./search.js";
import { renderDashboardHome } from "./dashboardHome.js";
import { navigate } from "./layout/router.js";

var currentView = "dashboard";
var currentUser = null;

function getMenu(){
  return '<aside class="sidebar">' +
      '<div class="logo"><img src="images/prau-logo.png" alt="PRAU"><h2>PRAU Intelligence</h2></div>' +
      '<nav>' +
        '<button class="menu-item' + (currentView === "dashboard" ? " active" : "") + '" id="navDashboard">' +
          '<i class="bi bi-house-door-fill"></i> Dashboard</button>' +
       '<button class="menu-item' + (currentView === "people" ? " active" : "") + '" id="navPeople">' +
          '<i class="bi bi-person-fill"></i> People</button>' +
        '<button class="menu-item' + (currentView === "vehicles" ? " active" : "") + '" id="navVehicles">' +
          '<i class="bi bi-car-front-fill"></i> Vehicles</button>' +
        '<button class="menu-item' + (currentView === "face" ? " active" : "") + '" id="navFace">' +
          '<i class="bi bi-camera-fill"></i> Face Search</button>' +
        '<button class="menu-item' + (currentView === "places" ? " active" : "") + '" id="navPlaces">' +
          '<i class="bi bi-geo-alt-fill"></i> Places</button>' +
        '<button class="menu-item' + (currentView === "search" ? " active" : "") + '" id="navSearch">' +
          '<i class="bi bi-search"></i> Search</button>' +
      '</nav>' +
    '</aside>';
}

function getDateTime(){
  var now = new Date();
  var datePart = now.toLocaleString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  var timePart = now.toLocaleString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  return datePart + ' <span class="date-time-at">at ' + timePart + '</span>';
}

function getGreeting(){
  var hour = new Date().getHours();
  if(hour < 12) return "☀️ Good Morning";
  if(hour < 18) return "🌤 Good Afternoon";
  return "🌙 Good Evening";
}

function renderShell(displayName){
  Array.prototype.forEach.call(document.querySelectorAll(".modal-backdrop-custom"), function(el){ el.remove(); });
  var app = document.getElementById("app");
  app.innerHTML =
    '<div class="dashboard">' +
      getMenu() +
      '<div class="sidebar-backdrop" id="sidebarBackdrop"></div>' +
      '<main class="content">' +
        '<div class="topbar">' +
          '<button id="sidebarToggle" class="sidebar-toggle" type="button" aria-label="Toggle menu"><i class="bi bi-list"></i></button>' +
          '<div class="welcome-text">' +
            '<h1>' + getGreeting() + ', ' + displayName + '</h1>' +
            '<div class="date-time">' + getDateTime() + '</div>' +
            '<div class="user-role">Administrator</div>' +
          '</div>' +
          '<button id="logoutBtn" class="logout-btn"><i class="bi bi-box-arrow-right"></i> Logout</button>' +
        '</div>' +
        '<div id="contentArea" class="content"></div>' +
      '</main>' +
    '</div>';

  document.getElementById("logoutBtn").onclick = logout;
  var sidebarEl = document.querySelector(".sidebar");
  document.getElementById("sidebarToggle").onclick = function(){ sidebarEl.classList.toggle("open"); };
  document.getElementById("sidebarBackdrop").onclick = function(){ sidebarEl.classList.remove("open"); };
  document.getElementById("navDashboard").onclick = function(){ currentView = "dashboard"; renderShell(displayName); };
  document.getElementById("navPeople").onclick = function(){ currentView = "people"; renderShell(displayName); };
  document.getElementById("navVehicles").onclick = function(){ currentView = "vehicles"; renderShell(displayName); };
  document.getElementById("navFace").onclick = function(){ currentView = "face"; renderShell(displayName); };
  document.getElementById("navPlaces").onclick = function(){ currentView = "places"; renderShell(displayName); };
  document.getElementById("navSearch").onclick = function(){ currentView = "search"; renderShell(displayName); };

  var contentArea = document.getElementById("contentArea");
  if(currentView === "people"){
    showPeople(contentArea);
  } else if(currentView === "vehicles"){
    renderVehicles(contentArea);
  } else if(currentView === "face"){
    renderFaceSearch(contentArea);
  } else if(currentView === "places"){
    renderPlaces(contentArea);
  } else if(currentView === "search"){
    renderGlobalSearch(contentArea);
  } else {
    renderDashboardHome(contentArea, function(view){ currentView = view; renderShell(displayName); });
  }
}

export async function showDashboard(user){
  currentUser = user;
  var displayName = user.email.split("@")[0];
  displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

  try{
    var snap = await getDoc(doc(db, "teamMembers", user.email));
    if(snap.exists() && snap.data().name){
      displayName = snap.data().name;
    }
  }catch(e){ console.error("name lookup failed", e); }

  renderShell(displayName);
}