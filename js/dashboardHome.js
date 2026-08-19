import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function fullName(p){
  return ((p.name||"") + " " + (p.surname||"")).trim() || "Unnamed Person";
}
function vehicleTitle(v){
  return ((v.make||"") + " " + (v.model||"")).trim() || "Unknown Vehicle";
}
function timeAgo(iso){
  if(!iso) return "";
  var diffMs = Date.now() - new Date(iso).getTime();
  var mins = Math.floor(diffMs / 60000);
  if(mins < 1) return "just now";
  if(mins < 60) return mins + "m ago";
  var hrs = Math.floor(mins / 60);
  if(hrs < 24) return hrs + "h ago";
  var days = Math.floor(hrs / 24);
  return days + "d ago";
}

var DATA_LOAD_TIMEOUT_MS = 15000;

export async function renderDashboardHome(container, navigateTo){
  container.innerHTML = '<div class="people-empty">Loading dashboard…</div>';

  function showLoadError(){
    container.innerHTML =
      '<div class="people-empty">Couldn\'t load dashboard data.</div>' +
      '<div style="text-align:center;margin-top:12px;">' +
        '<button class="btn-primary" id="dashRetryBtn" style="display:inline-flex;">Retry</button>' +
      '</div>';
    document.getElementById("dashRetryBtn").onclick = function(){ renderDashboardHome(container, navigateTo); };
  }

  var settled = false;
  var timeoutId = setTimeout(function(){
    if(settled) return;
    settled = true;
    console.error("Dashboard data load timed out");
    showLoadError();
  }, DATA_LOAD_TIMEOUT_MS);

  var peopleSnap, vehiclesSnap, placesSnap, unidentifiedSnap, encSnap, vEncSnap;
  try{
    peopleSnap = await getDocs(collection(db, "people"));
    vehiclesSnap = await getDocs(collection(db, "vehicles"));
    placesSnap = await getDocs(collection(db, "places"));
    unidentifiedSnap = await getDocs(collection(db, "unidentifiedPeople"));
    encSnap = await getDocs(collection(db, "encounters"));
    vEncSnap = await getDocs(collection(db, "vehicleEncounters"));
  }catch(e){
    clearTimeout(timeoutId);
    if(settled) return;
    settled = true;
    console.error("Dashboard data load failed:", e);
    showLoadError();
    return;
  }

  clearTimeout(timeoutId);
  if(settled) return; // timeout already showed the error state — don't overwrite it with a late success render
  settled = true;

  var people = [], peopleMap = {};
  peopleSnap.forEach(function(d){
    var data = d.data();
    if(!data.deleted){ var rec = Object.assign({ id: d.id }, data); people.push(rec); peopleMap[d.id] = rec; }
  });

  var vehicles = [], vehiclesMap = {};
  vehiclesSnap.forEach(function(d){
    var data = d.data();
    if(!data.deleted){ var rec = Object.assign({ id: d.id }, data); vehicles.push(rec); vehiclesMap[d.id] = rec; }
  });

  var places = [];
  placesSnap.forEach(function(d){
    var data = d.data();
    if(!data.deleted) places.push(Object.assign({ id: d.id }, data));
  });

  var unidentifiedPeople = [];
  unidentifiedSnap.forEach(function(d){
    var data = d.data();
    if(!data.deleted) unidentifiedPeople.push(Object.assign({ id: d.id }, data));
  });

  var encounters = [];
  encSnap.forEach(function(d){ encounters.push(Object.assign({ id: d.id }, d.data())); });

  var vehicleEncounters = [];
  vEncSnap.forEach(function(d){ vehicleEncounters.push(Object.assign({ id: d.id }, d.data())); });

  var activeEncounters = encounters.filter(function(e){ return peopleMap[e.personId]; });
  var activeVehicleEncounters = vehicleEncounters.filter(function(e){ return vehiclesMap[e.vehicleId]; });

  var today = new Date().toISOString().slice(0, 10);
  var todaysCount = activeEncounters.filter(function(e){ return e.date === today; }).length +
                     activeVehicleEncounters.filter(function(e){ return e.date === today; }).length;

  // ---- recent activity ----
  var activity = [];
  people.forEach(function(p){ activity.push({ ts: p.addedAt, label: "Person added: " + fullName(p), action: function(){ window.__openPersonProfile && window.__openPersonProfile(p.id); } }); });
  vehicles.forEach(function(v){ activity.push({ ts: v.addedAt, label: "Vehicle added: " + vehicleTitle(v), action: function(){ window.__openVehicleProfile && window.__openVehicleProfile(v.id); } }); });
  places.forEach(function(pl){ activity.push({ ts: pl.addedAt, label: "Place added: " + (pl.name || "Unnamed place"), action: function(){ window.__openPlaceProfile && window.__openPlaceProfile(pl.id); } }); });
  encounters.forEach(function(e){
    var person = peopleMap[e.personId];
    if(!person) return;
    activity.push({ ts: e.createdAt, label: "Encounter logged: " + fullName(person),
      action: function(){ window.__openPersonProfile && window.__openPersonProfile(person.id); } });
  });
  vehicleEncounters.forEach(function(e){
    var vehicle = vehiclesMap[e.vehicleId];
    activity.push({ ts: e.createdAt, label: "Encounter logged: " + (vehicle ? vehicleTitle(vehicle) : "Unknown vehicle"),
      action: function(){ if(vehicle) window.__openVehicleProfile && window.__openVehicleProfile(vehicle.id); } });
  });
  activity = activity.filter(function(a){ return a.ts; });
  activity.sort(function(a, b){ return new Date(b.ts) - new Date(a.ts); });
  activity = activity.slice(0, 10);

  // ---- hotspots (by location text across both encounter types) ----
  var locationCounts = {};
  activeEncounters.concat(activeVehicleEncounters).forEach(function(e){
    var loc = (e.location || "").trim();
    if(!loc) return;
    locationCounts[loc] = (locationCounts[loc] || 0) + 1;
  });
  var hotspots = Object.keys(locationCounts).map(function(loc){ return { location: loc, count: locationCounts[loc] }; });
  hotspots.sort(function(a, b){ return b.count - a.count; });
  hotspots = hotspots.slice(0, 5);

  // ---- most encountered people ----
  var personCounts = {};
  encounters.forEach(function(e){
    if(!e.personId) return;
    personCounts[e.personId] = (personCounts[e.personId] || 0) + 1;
  });
  var mostEncountered = Object.keys(personCounts).map(function(pid){
    return { person: peopleMap[pid], count: personCounts[pid] };
  }).filter(function(x){ return x.person; });
  mostEncountered.sort(function(a, b){ return b.count - a.count; });
  mostEncountered = mostEncountered.slice(0, 5);

  // ---- render ----
  container.innerHTML =
    '<div class="stat-cards">' +
      '<div class="stat-card" id="statPeople"><div class="stat-number">' + people.length + '</div><div class="stat-label">People</div></div>' +
      '<div class="stat-card" id="statVehicles"><div class="stat-number">' + vehicles.length + '</div><div class="stat-label">Vehicles</div></div>' +
      '<div class="stat-card" id="statPlaces"><div class="stat-number">' + places.length + '</div><div class="stat-label">Places</div></div>' +
      '<div class="stat-card" id="statUnidentified"><div class="stat-number">' + unidentifiedPeople.length + '</div><div class="stat-label">Unidentified</div></div>' +
    '</div>' +

    '<div class="dash-section">' +
      '<h3><i class="bi bi-calendar-check"></i> Today\'s Encounters</h3>' +
      (todaysCount > 0
        ? '<div class="dash-row" style="cursor:default;"><span>Logged today</span><span class="dash-row-count">' + todaysCount + '</span></div>'
        : '<div class="people-empty">No encounters logged today yet.</div>') +
    '</div>' +

    '<div class="dash-section">' +
      '<h3><i class="bi bi-clock-history"></i> Recent Activity</h3>' +
      (activity.length
        ? activity.map(function(a, i){
            return '<div class="dash-row" data-i="' + i + '"><span>' + escapeHtml(a.label) + '</span><span class="dash-row-sub">' + timeAgo(a.ts) + '</span></div>';
          }).join("")
        : '<div class="people-empty">No activity yet.</div>') +
    '</div>' +

    '<div class="dash-section">' +
      '<h3><i class="bi bi-fire"></i> Hotspots</h3>' +
      (hotspots.length
        ? hotspots.map(function(h){
            return '<div class="dash-row" style="cursor:default;"><span>📍 ' + escapeHtml(h.location) + '</span><span class="dash-row-count">' + h.count + '</span></div>';
          }).join("")
        : '<div class="people-empty">No location data recorded yet.</div>') +
    '</div>' +

    '<div class="dash-section">' +
      '<h3><i class="bi bi-person-lines-fill"></i> Most Encountered People</h3>' +
      (mostEncountered.length
        ? mostEncountered.map(function(m, i){
            return '<div class="dash-row" data-mep="' + i + '"><span>' + escapeHtml(fullName(m.person)) + '</span><span class="dash-row-count">' + m.count + '×</span></div>';
          }).join("")
        : '<div class="people-empty">No encounters logged yet.</div>') +
    '</div>';

  document.getElementById("statPeople").onclick = function(){ navigateTo("people"); };
  document.getElementById("statVehicles").onclick = function(){ navigateTo("vehicles"); };
  document.getElementById("statPlaces").onclick = function(){ navigateTo("places"); };
  document.getElementById("statUnidentified").onclick = function(){ navigateTo("people"); };

  Array.prototype.forEach.call(container.querySelectorAll("[data-i]"), function(row){
    row.onclick = function(){ activity[parseInt(row.getAttribute("data-i"), 10)].action(); };
  });
  Array.prototype.forEach.call(container.querySelectorAll("[data-mep]"), function(row){
    row.onclick = function(){
      var m = mostEncountered[parseInt(row.getAttribute("data-mep"), 10)];
      window.__openPersonProfile && window.__openPersonProfile(m.person.id);
    };
  });
}