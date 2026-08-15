// backButton.js — shared "Back to Dashboard" control for the top-level pages
// (People, Unidentified People, Vehicles, Places, Search). Reuses the
// sidebar's own Dashboard navigation (dashboard.js exposes
// window.__goToDashboard) instead of duplicating navigation logic.

export function backToDashboardHTML(){
  return '<button class="btn-ghost back-to-dashboard-btn" id="backToDashboardBtn" type="button">' +
    '<i class="bi bi-house-door-fill"></i> Dashboard</button>';
}

export function wireBackToDashboard(){
  var btn = document.getElementById("backToDashboardBtn");
  if(btn) btn.onclick = function(){ if(window.__goToDashboard) window.__goToDashboard(); };
}
