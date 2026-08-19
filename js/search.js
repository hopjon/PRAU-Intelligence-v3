import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { backToDashboardHTML, wireBackToDashboard } from "./backButton.js";

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

// Module-level cache: fetched once per app session on first Search open, reused after that.
var cache = null;
var loadPromise = null;
var DATA_LOAD_TIMEOUT_MS = 15000;

function loadSearchData(){
  if(cache) return Promise.resolve(cache);
  if(loadPromise) return loadPromise;

  loadPromise = Promise.all([
    getDocs(collection(db, "people")),
    getDocs(collection(db, "vehicles")),
    getDocs(collection(db, "places")),
    getDocs(collection(db, "encounters")),
    getDocs(collection(db, "vehicleEncounters"))
  ]).then(function(snaps){
    var peopleSnap = snaps[0], vehiclesSnap = snaps[1], placesSnap = snaps[2], encSnap = snaps[3], vEncSnap = snaps[4];

    var people = [];
    peopleSnap.forEach(function(d){
      var data = d.data();
      if(!data.deleted) people.push(Object.assign({ id: d.id }, data));
    });

    var vehicles = [];
    vehiclesSnap.forEach(function(d){
      var data = d.data();
      if(!data.deleted) vehicles.push(Object.assign({ id: d.id }, data));
    });

    var places = [];
    placesSnap.forEach(function(d){
      var data = d.data();
      if(!data.deleted) places.push(Object.assign({ id: d.id }, data));
    });

    var peopleById = {};
    people.forEach(function(p){ peopleById[p.id] = p; });
    var vehiclesById = {};
    vehicles.forEach(function(v){ vehiclesById[v.id] = v; });

    var encounters = [];
    encSnap.forEach(function(d){
      var data = d.data();
      var person = peopleById[data.personId];
      if(!person) return; // parent deleted or missing — exclude, consistent with People list filtering
      encounters.push(Object.assign({ id: d.id, parentType: "person", parentId: data.personId, parentName: fullName(person) }, data));
    });

    var vehicleEncounters = [];
    vEncSnap.forEach(function(d){
      var data = d.data();
      var vehicle = vehiclesById[data.vehicleId];
      if(!vehicle) return; // parent deleted or missing — exclude, consistent with Vehicles list filtering
      vehicleEncounters.push(Object.assign({ id: d.id, parentType: "vehicle", parentId: data.vehicleId, parentName: vehicleTitle(vehicle) }, data));
    });

    cache = {
      people: people,
      vehicles: vehicles,
      places: places,
      encounters: encounters.concat(vehicleEncounters)
    };
    return cache;
  });

  return loadPromise;
}

function matches(q, fields){
  for(var i = 0; i < fields.length; i++){
    if((fields[i] || "").toLowerCase().indexOf(q) !== -1) return true;
  }
  return false;
}

function runSearch(data, q){
  q = q.toLowerCase();

  var people = data.people.filter(function(p){
    return matches(q, [fullName(p), p.idNumber, p.aliases, p.origin, p.residence]);
  });
  var vehicles = data.vehicles.filter(function(v){
    return matches(q, [vehicleTitle(v), v.registration, v.colour, v.markings]);
  });
  var places = data.places.filter(function(p){
    return matches(q, [p.name, p.type, p.address]);
  });
  var encounters = data.encounters.filter(function(e){
    return matches(q, [e.notes, e.itemsFound, e.location, e.parentName]);
  });

  return { people: people, vehicles: vehicles, places: places, encounters: encounters };
}

function renderResults(resultsEl, results){
  var total = results.people.length + results.vehicles.length + results.places.length + results.encounters.length;
  if(!total){
    resultsEl.innerHTML = '<div class="people-empty">No matches found.</div>';
    return;
  }

  var html = "";

  if(results.people.length){
    html += '<div class="dash-section"><h3>People (' + results.people.length + ')</h3>' +
      results.people.map(function(p){
        return '<div class="dash-row" data-type="person" data-id="' + p.id + '">' +
          '<span><strong>PERSON</strong> — ' + escapeHtml(fullName(p)) + '</span>' +
          '<span class="dash-row-sub">' + escapeHtml(p.idNumber || "") + '</span>' +
        '</div>';
      }).join("") + '</div>';
  }

  if(results.vehicles.length){
    html += '<div class="dash-section"><h3>Vehicles (' + results.vehicles.length + ')</h3>' +
      results.vehicles.map(function(v){
        return '<div class="dash-row" data-type="vehicle" data-id="' + v.id + '">' +
          '<span><strong>VEHICLE</strong> — ' + escapeHtml(vehicleTitle(v)) + '</span>' +
          '<span class="dash-row-sub">' + escapeHtml(v.registration || "") + '</span>' +
        '</div>';
      }).join("") + '</div>';
  }

  if(results.places.length){
    html += '<div class="dash-section"><h3>Places (' + results.places.length + ')</h3>' +
      results.places.map(function(p){
        return '<div class="dash-row" data-type="place" data-id="' + p.id + '">' +
          '<span><strong>PLACE</strong> — ' + escapeHtml(p.name || "Unnamed place") + '</span>' +
          '<span class="dash-row-sub">' + escapeHtml(p.address || "") + '</span>' +
        '</div>';
      }).join("") + '</div>';
  }

  if(results.encounters.length){
    html += '<div class="dash-section"><h3>Encounters (' + results.encounters.length + ')</h3>' +
      results.encounters.map(function(e){
        var snippet = (e.notes || e.itemsFound || e.location || "").slice(0, 80);
        return '<div class="dash-row" data-type="encounter" data-parent-type="' + e.parentType + '" data-parent-id="' + e.parentId + '">' +
          '<span><strong>ENCOUNTER</strong> — ' + escapeHtml(e.parentName) + (snippet ? ': ' + escapeHtml(snippet) : '') + '</span>' +
          '<span class="dash-row-sub">' + escapeHtml(e.date || "") + '</span>' +
        '</div>';
      }).join("") + '</div>';
  }

  resultsEl.innerHTML = html;

  Array.prototype.forEach.call(resultsEl.querySelectorAll(".dash-row"), function(row){
    row.onclick = function(){
      var type = row.getAttribute("data-type");
      if(type === "person" && window.__openPersonProfile){
        window.__openPersonProfile(row.getAttribute("data-id"));
      } else if(type === "vehicle" && window.__openVehicleProfile){
        window.__openVehicleProfile(row.getAttribute("data-id"));
      } else if(type === "place" && window.__openPlaceProfile){
        window.__openPlaceProfile(row.getAttribute("data-id"));
      } else if(type === "encounter"){
        var parentType = row.getAttribute("data-parent-type");
        var parentId = row.getAttribute("data-parent-id");
        if(parentType === "person" && window.__openPersonProfile) window.__openPersonProfile(parentId);
        else if(parentType === "vehicle" && window.__openVehicleProfile) window.__openVehicleProfile(parentId);
      }
    };
  });
}

export function renderGlobalSearch(container){
  container.innerHTML =
    '<div class="people-header">' + backToDashboardHTML() + '<h1><i class="bi bi-search"></i> Global Search</h1></div>' +
    '<div class="people-search" style="max-width:500px;margin:0 auto 16px;"><i class="bi bi-search"></i>' +
      '<input type="text" id="globalSearchInput" placeholder="Search people, vehicles, places, encounters…" style="width:100%;"></div>' +
    '<div id="globalSearchResults"></div>';

  wireBackToDashboard();
  var input = document.getElementById("globalSearchInput");
  var resultsEl = document.getElementById("globalSearchResults");

  var loadedData = null;
  function showLoadError(){
    resultsEl.innerHTML =
      '<div class="people-empty">Couldn\'t load search data.</div>' +
      '<div style="text-align:center;margin-top:12px;">' +
        '<button class="btn-primary" id="searchRetryBtn" style="display:inline-flex;">Retry</button>' +
      '</div>';
    document.getElementById("searchRetryBtn").onclick = attemptLoad;
  }
  function attemptLoad(){
    cache = null;
    loadPromise = null;
    resultsEl.innerHTML = '<div class="people-empty">Loading…</div>';
    var settled = false;
    var timeoutId = setTimeout(function(){
      if(settled) return;
      settled = true;
      console.error("Search data load timed out");
      showLoadError();
    }, DATA_LOAD_TIMEOUT_MS);
    loadSearchData().then(function(data){
      clearTimeout(timeoutId);
      if(settled) return;
      settled = true;
      loadedData = data;
      resultsEl.innerHTML = '<div class="people-empty">Type to search across People, Vehicles, Places and Encounters.</div>';
    }).catch(function(e){
      clearTimeout(timeoutId);
      if(settled) return;
      settled = true;
      console.error("Search data load failed:", e);
      showLoadError();
    });
  }
  attemptLoad();

  var debounceTimer = null;
  input.oninput = function(){
    var q = this.value.trim();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function(){
      if(!loadedData) return; // still loading — no Firestore call is ever made here
      if(!q){
        resultsEl.innerHTML = '<div class="people-empty">Type to search across People, Vehicles, Places and Encounters.</div>';
        return;
      }
      renderResults(resultsEl, runSearch(loadedData, q));
    }, 300);
  };
}
