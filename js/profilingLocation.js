// profilingLocation.js — shared Leaflet-based Profiling Location capture, reused by
// Person and Unidentified Person profiles.
//
// Geocoding provider: OpenStreetMap Nominatim, used only via explicit user actions
// (Search button click, map tap/drag, "Use My Location") — never per-keystroke
// autocomplete — to stay within Nominatim's usage policy (max ~1 request/sec,
// no autocomplete). No API key, no paid tier, no Cloud Functions required.

var goldPinIcon = L.divIcon({
  className: "gold-pin-icon",
  html: '<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M15 0C6.7 0 0 6.7 0 15c0 11.2 15 27 15 27s15-15.8 15-27C30 6.7 23.3 0 15 0z" fill="var(--gold)" stroke="var(--gold-dark)" stroke-width="1"/>' +
    '<circle cx="15" cy="15" r="6" fill="#1a1400"/>' +
    '</svg>',
  iconSize: [30, 42],
  iconAnchor: [15, 42],
  popupAnchor: [0, -38]
});

var OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}

function hasCoords(loc){
  return !!loc && typeof loc.profilingLatitude === "number" && typeof loc.profilingLongitude === "number";
}

// Restricts address search to South Africa via Nominatim's own country
// filter (not client-side post-filtering). To add more countries later,
// extend this comma-separated list — no other code needs to change.
var SEARCH_COUNTRY_CODES = "za";

function extractLeadingHouseNumber(q){
  var m = String(q || "").trim().match(/^(\d+[a-zA-Z]?)\b/);
  return m ? m[1].toLowerCase() : null;
}

// Reorders (never filters) results so an entry whose house number, road,
// and/or suburb actually match the typed query is preferred over whatever
// Nominatim ranked first.
function rankAddressResults(q, results){
  var houseNumber = extractLeadingHouseNumber(q);
  var qLower = String(q || "").toLowerCase();
  return results
    .map(function(r, i){
      var addr = r.address || {};
      var score = 0;
      if(houseNumber && addr.house_number && String(addr.house_number).toLowerCase() === houseNumber) score += 3;
      var road = (addr.road || "").toLowerCase();
      if(road && qLower.indexOf(road) !== -1) score += 2;
      var locality = (addr.suburb || addr.neighbourhood || addr.village || addr.town || "").toLowerCase();
      if(locality && qLower.indexOf(locality) !== -1) score += 1;
      return { r: r, score: score, i: i };
    })
    .sort(function(a, b){ return (b.score - a.score) || (a.i - b.i); })
    .map(function(x){ return x.r; });
}

async function nominatimSearch(q){
  var params = "format=json&addressdetails=1&limit=5" +
    (SEARCH_COUNTRY_CODES ? "&countrycodes=" + SEARCH_COUNTRY_CODES : "");
  // Structured params (street/city) query Nominatim's address-point index
  // directly, instead of its free-text tokenizer — which is what was
  // silently dropping house numbers from "23 X Street, Suburb" queries.
  var commaIdx = String(q).indexOf(",");
  if(commaIdx !== -1){
    var street = q.slice(0, commaIdx).trim();
    var rest = q.slice(commaIdx + 1).trim();
    params += "&street=" + encodeURIComponent(street) + (rest ? "&city=" + encodeURIComponent(rest) : "");
  }else{
    params += "&q=" + encodeURIComponent(q);
  }
  var url = "https://nominatim.openstreetmap.org/search?" + params;
  var res = await fetch(url, { headers: { "Accept": "application/json" } });
  var results = await res.json();
  return rankAddressResults(q, results || []);
}

async function nominatimReverse(lat, lng){
  var url = "https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=" + lat + "&lon=" + lng;
  var res = await fetch(url, { headers: { "Accept": "application/json" } });
  return res.json();
}

function extractAddressParts(addr, displayName){
  addr = addr || {};
  return {
    address: displayName || "",
    road: addr.road || addr.pedestrian || addr.footway || addr.cycleway || "",
    suburb: addr.suburb || addr.neighbourhood || addr.quarter || addr.village || addr.town || ""
  };
}

// ---------- read-only view (profile page, not editing) ----------
export function profilingLocationViewHTML(idPrefix, loc){
  if(!hasCoords(loc)) return "";
  var lines = [];
  if(loc.profilingAddress) lines.push(escapeHtml(loc.profilingAddress));
  var parts = [];
  if(loc.profilingRoad) parts.push(escapeHtml(loc.profilingRoad));
  if(loc.profilingSuburb) parts.push(escapeHtml(loc.profilingSuburb));
  if(parts.length) lines.push(parts.join(", "));
  return (
    '<h3><i class="bi bi-geo-alt-fill"></i> Profiling Location</h3>' +
    '<div class="map-container profile" id="' + idPrefix + 'ViewMap"></div>' +
    (lines.length ? '<div class="people-card-meta">' + lines.join("<br>") + '</div>' : '') +
    '<div style="font-size:10px;color:var(--text-gray-dark);margin-top:4px;">Map data ' + OSM_ATTRIBUTION + '</div>'
  );
}

export function wireProfilingLocationView(idPrefix, loc){
  if(!hasCoords(loc)) return;
  var mapEl = document.getElementById(idPrefix + "ViewMap");
  if(!mapEl) return;
  var map = L.map(mapEl, { scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
  L.marker([loc.profilingLatitude, loc.profilingLongitude], { icon: goldPinIcon }).addTo(map);
  map.setView([loc.profilingLatitude, loc.profilingLongitude], 16);
  setTimeout(function(){ map.invalidateSize(); }, 0);
}

// ---------- interactive editor (add/edit forms) ----------
export function profilingLocationEditHTML(idPrefix, loc){
  var latVal = hasCoords(loc) ? loc.profilingLatitude.toFixed(6) : "";
  var lngVal = hasCoords(loc) ? loc.profilingLongitude.toFixed(6) : "";
  return (
    '<label><i class="bi bi-geo-alt-fill"></i> Profiling Location (optional)</label>' +
    '<div style="display:flex;gap:8px;">' +
      '<input type="text" id="' + idPrefix + 'Search" style="flex:1;" placeholder="Search road, address or suburb…">' +
      '<button type="button" class="btn-ghost" id="' + idPrefix + 'SearchBtn" style="flex-shrink:0;">Search</button>' +
    '</div>' +
    '<div class="address-suggestions-list" id="' + idPrefix + 'Results" style="position:static;max-height:160px;overflow-y:auto;"></div>' +
    '<div style="font-size:12px;color:var(--text-gray-dark);margin:4px 0 8px;">Can\'t find the exact address? Search for the street/suburb, then drag the pin to the exact location.</div>' +
    '<div class="map-container profile" id="' + idPrefix + 'Map"></div>' +
    '<button type="button" class="btn-ghost" id="' + idPrefix + 'GpsBtn" style="width:100%;margin-bottom:8px;">📍 Use My Location</button>' +
    '<div class="modal-error" id="' + idPrefix + 'Status" style="text-align:left;color:#888;"></div>' +
    '<div class="profile-field-group">' +
      '<div class="profile-field"><label>Latitude</label><input type="text" id="' + idPrefix + 'Lat" value="' + latVal + '" readonly></div>' +
      '<div class="profile-field"><label>Longitude</label><input type="text" id="' + idPrefix + 'Lng" value="' + lngVal + '" readonly></div>' +
      '<div class="profile-field" style="grid-column:1 / -1;"><label>Address</label><input type="text" id="' + idPrefix + 'Address" value="' + escapeHtml(loc && loc.profilingAddress || "") + '" readonly></div>' +
      '<div class="profile-field"><label>Road</label><input type="text" id="' + idPrefix + 'Road" value="' + escapeHtml(loc && loc.profilingRoad || "") + '" readonly></div>' +
      '<div class="profile-field"><label>Suburb</label><input type="text" id="' + idPrefix + 'Suburb" value="' + escapeHtml(loc && loc.profilingSuburb || "") + '" readonly></div>' +
    '</div>' +
    '<div style="font-size:10px;color:var(--text-gray-dark);margin:-6px 0 12px;">Map data ' + OSM_ATTRIBUTION + '</div>'
  );
}

// Wires the interactive map/search/GPS controls rendered by profilingLocationEditHTML.
// Returns { getState() } — call getState() at save time to read the latest values;
// coordinates are only ever set by explicit user action (tap, drag, search pick, GPS),
// so an untouched editor returns exactly the `loc` it was initialized with.
export function wireProfilingLocationEditor(idPrefix, loc){
  var state = {
    latitude: hasCoords(loc) ? loc.profilingLatitude : null,
    longitude: hasCoords(loc) ? loc.profilingLongitude : null,
    address: (loc && loc.profilingAddress) || "",
    road: (loc && loc.profilingRoad) || "",
    suburb: (loc && loc.profilingSuburb) || ""
  };

  var mapEl = document.getElementById(idPrefix + "Map");
  if(!mapEl) return { getState: function(){ return state; } };

  var statusEl = document.getElementById(idPrefix + "Status");
  var latEl = document.getElementById(idPrefix + "Lat");
  var lngEl = document.getElementById(idPrefix + "Lng");
  var addrEl = document.getElementById(idPrefix + "Address");
  var roadEl = document.getElementById(idPrefix + "Road");
  var suburbEl = document.getElementById(idPrefix + "Suburb");
  var searchInput = document.getElementById(idPrefix + "Search");
  var searchBtn = document.getElementById(idPrefix + "SearchBtn");
  var resultsEl = document.getElementById(idPrefix + "Results");
  var gpsBtn = document.getElementById(idPrefix + "GpsBtn");
  var searchInFlight = false;

  var map = L.map(mapEl);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);

  var marker = null;
  var startView = (state.latitude != null) ? [state.latitude, state.longitude] : [-30.5595, 22.9375];
  var startZoom = (state.latitude != null) ? 16 : 5;
  map.setView(startView, startZoom);

  function refreshFields(){
    if(latEl) latEl.value = state.latitude != null ? state.latitude.toFixed(6) : "";
    if(lngEl) lngEl.value = state.longitude != null ? state.longitude.toFixed(6) : "";
    if(addrEl) addrEl.value = state.address || "";
    if(roadEl) roadEl.value = state.road || "";
    if(suburbEl) suburbEl.value = state.suburb || "";
  }

  function placePin(lat, lng){
    state.latitude = lat; state.longitude = lng;
    if(marker){
      marker.setLatLng([lat, lng]);
    }else{
      marker = L.marker([lat, lng], { icon: goldPinIcon, draggable: true }).addTo(map);
      marker.on("dragend", function(){
        var pos = marker.getLatLng();
        state.latitude = pos.lat; state.longitude = pos.lng;
        refreshFields();
        reverseAndFill(pos.lat, pos.lng);
      });
    }
    refreshFields();
  }

  async function reverseAndFill(lat, lng){
    if(statusEl) statusEl.textContent = "Looking up address…";
    try{
      var data = await nominatimReverse(lat, lng);
      var parts = extractAddressParts(data && data.address, data && data.display_name);
      state.address = parts.address; state.road = parts.road; state.suburb = parts.suburb;
      refreshFields();
      if(statusEl) statusEl.textContent = "Location set.";
    }catch(e){
      if(statusEl) statusEl.textContent = "Location set (address lookup failed — you can still save the coordinates).";
    }
  }

  if(state.latitude != null) placePin(state.latitude, state.longitude);

  map.on("click", function(e){
    placePin(e.latlng.lat, e.latlng.lng);
    reverseAndFill(e.latlng.lat, e.latlng.lng);
  });

  if(gpsBtn){
    gpsBtn.onclick = function(){
      if(!navigator.geolocation){
        if(statusEl) statusEl.textContent = "Location isn't available on this device.";
        return;
      }
      if(statusEl) statusEl.textContent = "Getting current location…";
      navigator.geolocation.getCurrentPosition(function(pos){
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        placePin(lat, lng);
        map.setView([lat, lng], 16);
        reverseAndFill(lat, lng);
      }, function(){
        if(statusEl) statusEl.textContent = "Couldn't get location — search or tap the map instead.";
      }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
    };
  }

  async function doSearch(){
    var q = (searchInput && searchInput.value || "").trim();
    if(q.length < 3 || searchInFlight) return;
    searchInFlight = true;
    if(searchBtn) searchBtn.disabled = true;
    if(statusEl) statusEl.textContent = "Searching…";
    try{
      var results = await nominatimSearch(q);
      if(!results || !results.length){
        if(resultsEl) resultsEl.innerHTML = "";
        if(statusEl) statusEl.textContent = "No results found.";
      }else{
        if(resultsEl){
          resultsEl.innerHTML = results.map(function(r, i){
            return '<div class="address-suggestion-row" data-i="' + i + '">' + escapeHtml(r.display_name) + '</div>';
          }).join("");
          Array.prototype.forEach.call(resultsEl.querySelectorAll(".address-suggestion-row"), function(row){
            row.onclick = function(){
              var r = results[parseInt(row.getAttribute("data-i"), 10)];
              var lat = parseFloat(r.lat), lng = parseFloat(r.lon);
              var parts = extractAddressParts(r.address, r.display_name);
              state.address = parts.address; state.road = parts.road; state.suburb = parts.suburb;
              placePin(lat, lng);
              map.setView([lat, lng], 16);
              resultsEl.innerHTML = "";
              if(searchInput) searchInput.value = "";
              if(statusEl) statusEl.textContent = "Location set from search.";
            };
          });
        }
        if(statusEl) statusEl.textContent = "Select a result below.";
      }
    }catch(e){
      if(statusEl) statusEl.textContent = "Search failed — check your connection.";
    }
    searchInFlight = false;
    if(searchBtn) searchBtn.disabled = false;
  }

  if(searchBtn) searchBtn.onclick = doSearch;
  if(searchInput) searchInput.onkeydown = function(e){ if(e.key === "Enter"){ e.preventDefault(); doSearch(); } };

  refreshFields();
  setTimeout(function(){ map.invalidateSize(); }, 0);

  return { getState: function(){ return state; } };
}

// Builds the Firestore field patch for a saved location — only includes the
// profiling* keys when a coordinate is actually set, so saving a record whose
// location was never touched never writes/fabricates location fields.
export function profilingLocationPatch(editorState){
  if(!editorState || editorState.latitude == null || editorState.longitude == null) return {};
  return {
    profilingLatitude: editorState.latitude,
    profilingLongitude: editorState.longitude,
    profilingAddress: editorState.address || "",
    profilingRoad: editorState.road || "",
    profilingSuburb: editorState.suburb || ""
  };
}
