import { db, auth } from "./firebase.js";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function currentUserShortName(){
  return (auth.currentUser && auth.currentUser.email) ? auth.currentUser.email.split("@")[0] : "unknown";
}
function fileToCompressedDataUrl(file, maxDim){
  return new Promise(function(resolve, reject){
    var img = new Image();
    var reader = new FileReader();
    reader.onload = function(e){
      img.onload = function(){
        var w = img.width, h = img.height;
        var scale = Math.min(1, maxDim / Math.max(w, h));
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var canvas = document.createElement("canvas");
        canvas.width = cw; canvas.height = ch;
        canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function getBestLocation(statusEl, onResult, timeoutMs){
  timeoutMs = timeoutMs || 8000;
  if(!navigator.geolocation){ statusEl.textContent = "Location isn't available on this device."; return; }
  var best = null, watchId = null, finished = false;
  function finish(){
    if(finished) return;
    finished = true;
    if(watchId !== null) navigator.geolocation.clearWatch(watchId);
    if(best){ onResult(best); } else{ statusEl.textContent = "Couldn't get a location fix — enter it manually."; }
  }
  statusEl.textContent = "Getting current location…";
  watchId = navigator.geolocation.watchPosition(function(pos){
    if(!best || pos.coords.accuracy < best.coords.accuracy){
      best = pos;
      statusEl.textContent = "Refining location… (±" + Math.round(pos.coords.accuracy) + "m so far)";
    }
    if(pos.coords.accuracy <= 15){ finish(); }
  }, function(){ if(!best) statusEl.textContent = "Couldn't get location — enter it manually."; },
  { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs });
  setTimeout(finish, timeoutMs);
}

// ---------- duplicate name+type check (light touch, no hard block) ----------
async function findSimilarPlace(name, excludeId){
  if(!name) return null;
  var snapshot = await getDocs(collection(db, "places"));
  var match = null;
  snapshot.forEach(function(d){
    if(d.id === excludeId) return;
    var data = d.data();
    if(!data.deleted && data.name && data.name.trim().toLowerCase() === name.trim().toLowerCase()){
      match = Object.assign({ id: d.id }, data);
    }
  });
  return match;
}

// ---------- list + overview map ----------
export async function renderPlaces(){
  var content = document.getElementById("contentArea");
  content.innerHTML =
    '<div class="people-header">' +
      '<h1><i class="bi bi-geo-alt-fill"></i> Places</h1>' +
      '<button class="btn-primary" id="addPlaceBtn"><i class="bi bi-plus-circle-fill"></i> Add</button>' +
    '</div>' +
    '<div class="map-container overview" id="placesOverviewMap"></div>' +
    '<div class="people-search"><i class="bi bi-search"></i><input type="text" id="placesSearchInput" placeholder="Search places…"></div>' +
    '<div id="placesListArea">Loading…</div>';

  document.getElementById("addPlaceBtn").onclick = function(){ openAddPlaceModal(); };

  var snapshot = await getDocs(collection(db, "places"));
  var places = [];
  snapshot.forEach(function(d){
    var data = d.data();
    if(!data.deleted) places.push(Object.assign({ id: d.id }, data));
  });

  var mapEl = document.getElementById("placesOverviewMap");
  var map = L.map(mapEl, { attributionControl: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

  var withCoords = places.filter(function(p){ return p.coords; });
  if(withCoords.length){
    var bounds = [];
    withCoords.forEach(function(p){
      var m = L.marker([p.coords.lat, p.coords.lng]).addTo(map);
      m.bindPopup('<strong>' + escapeHtml(p.name || "Unnamed place") + '</strong><br>' + escapeHtml(p.type || "") +
        '<br><a href="#" data-id="' + p.id + '" class="place-popup-link">View profile</a>');
      m.on("popupopen", function(){
        var link = document.querySelector('.place-popup-link[data-id="' + p.id + '"]');
        if(link) link.onclick = function(e){ e.preventDefault(); renderPlaceProfile(p.id); };
      });
      bounds.push([p.coords.lat, p.coords.lng]);
    });
    map.fitBounds(bounds, { padding: [30, 30] });
  } else {
    map.setView([-30.5595, 22.9375], 5); // South Africa default view
  }

  document.getElementById("placesSearchInput").oninput = function(){ renderList(this.value); };

  function renderList(q){
    q = (q || "").trim().toLowerCase();
    var filtered = !q ? places : places.filter(function(p){
      return ((p.name||"") + " " + (p.type||"") + " " + (p.address||"")).toLowerCase().indexOf(q) !== -1;
    });
    filtered.sort(function(a, b){ return (a.name||"").localeCompare(b.name||""); });

    var listArea = document.getElementById("placesListArea");
    if(!filtered.length){
      listArea.innerHTML = '<div class="people-empty">No places found.</div>';
      return;
    }
    listArea.innerHTML = '<div class="people-grid">' + filtered.map(function(p){
      var thumb = p.photos && p.photos[0] ? p.photos[0].dataUrl : null;
      return '<div class="people-card" data-id="' + p.id + '">' +
        (p.type ? '<span class="type-tag">' + escapeHtml(p.type) + '</span>' : '') +
        (thumb ? '<img class="people-card-thumb" src="' + thumb + '">' :
          '<div class="people-card-thumb-empty"><i class="bi bi-geo-alt"></i></div>') +
        '<div class="people-card-info">' +
          '<div class="people-card-name">' + escapeHtml(p.name || "Unnamed place") + '</div>' +
          '<div class="people-card-meta">' + escapeHtml(p.address || "No address on file") + '</div>' +
        '</div>' +
      '</div>';
    }).join("") + '</div>';

    Array.prototype.forEach.call(listArea.querySelectorAll(".people-card"), function(el){
      el.onclick = function(){ renderPlaceProfile(el.getAttribute("data-id")); };
    });
  }

  renderList("");
}

// ---------- add place (modal) ----------
function openAddPlaceModal(){
  var pendingPhotos = [];
  var coords = null;

  var backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop-custom";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h2>Add Place</h2>' +
      '<label>Photos</label>' +
      '<div class="pf-photos-row" id="plPhotosRow"><button class="pf-add-photo" id="plAddPhotoBtn" type="button" title="Take Photo"><i class="bi bi-camera-fill"></i></button></div>' +
      '<label class="pf-import-label" for="plImportFile"><i class="bi bi-images"></i>Import from gallery</label>' +
      '<input type="file" id="plPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
      '<input type="file" id="plImportFile" accept="image/*" multiple style="display:none;">' +
      '<label>Name</label><input id="plName" placeholder="e.g. Corner house, Voortrekker Road">' +
      '<label>Type</label><input id="plType" placeholder="e.g. Drug House">' +
      '<label>Address</label><input id="plAddress" placeholder="e.g. 45 Voortrekker Road, Bellville">' +
      '<label><i class="bi bi-geo-alt-fill"></i> GPS Location</label>' +
      '<div style="display:flex;gap:8px;">' +
        '<input id="plCoordsDisplay" style="flex:1;" readonly placeholder="Not captured yet">' +
        '<button class="btn-ghost" id="plGpsBtn" type="button">📍</button>' +
      '</div>' +
      '<div class="modal-error" id="plGpsStatus" style="text-align:left;color:#888;"></div>' +
      '<label>Notes</label><textarea id="plNotes" placeholder="Anything worth recording"></textarea>' +
      '<div class="modal-actions">' +
        '<button class="btn-ghost" id="plCancel">Cancel</button>' +
        '<button class="btn-primary" id="plSave">Save</button>' +
      '</div>' +
      '<div class="modal-error" id="plError"></div>' +
    '</div>';
  document.body.appendChild(backdrop);
  backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };
  document.getElementById("plCancel").onclick = function(){ backdrop.remove(); };

  function renderPlPhotos(){
    var row = document.getElementById("plPhotosRow");
    var addBtn = document.getElementById("plAddPhotoBtn");
    var html = "";
    pendingPhotos.forEach(function(ph, i){
      html += '<div class="pf-photo-chip"><img src="' + ph.dataUrl + '"><button class="pf-rm" data-i="' + i + '" type="button">✕</button></div>';
    });
    row.innerHTML = html;
    row.appendChild(addBtn);
    Array.prototype.forEach.call(row.querySelectorAll(".pf-rm"), function(btn){
      btn.onclick = function(){ pendingPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1); renderPlPhotos(); };
    });
  }
  document.getElementById("plAddPhotoBtn").onclick = function(){
    document.getElementById("plPhotoFile").value = "";
    document.getElementById("plPhotoFile").click();
  };
  document.getElementById("plPhotoFile").onchange = async function(){
    var file = this.files[0];
    if(!file) return;
    var dataUrl = await fileToCompressedDataUrl(file, 480);
    pendingPhotos.push({ dataUrl: dataUrl, takenBy: currentUserShortName(), addedAt: new Date().toISOString() });
    renderPlPhotos();
  };
  document.getElementById("plImportFile").onchange = async function(){
    var files = Array.prototype.slice.call(this.files);
    for(var i = 0; i < files.length; i++){
      try{
        var dataUrl = await fileToCompressedDataUrl(files[i], 480);
        pendingPhotos.push({ dataUrl: dataUrl, takenBy: currentUserShortName(), addedAt: new Date().toISOString() });
        renderPlPhotos();
      }catch(e){ console.error(e); }
    }
  };

  document.getElementById("plGpsBtn").onclick = function(){
    var statusEl = document.getElementById("plGpsStatus");
    getBestLocation(statusEl, function(pos){
      coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      document.getElementById("plCoordsDisplay").value = coords.lat.toFixed(6) + ", " + coords.lng.toFixed(6);
      statusEl.textContent = "Location captured (accuracy ±" + Math.round(pos.coords.accuracy) + "m).";
    });
  };

  document.getElementById("plSave").onclick = async function(){
    var errEl = document.getElementById("plError");
    var name = document.getElementById("plName").value.trim();
    if(!name){ errEl.textContent = "Enter a name for this place."; return; }

    this.disabled = true;
    this.textContent = "Checking…";

    var similar = await findSimilarPlace(name, null);
    if(similar){
      errEl.innerHTML = 'A place with this exact name already exists: <strong>' + escapeHtml(similar.name) + '</strong>. Open its profile instead if this is the same location.';
      this.disabled = false;
      this.textContent = "Save";
      return;
    }

    var place = {
      name: name,
      type: document.getElementById("plType").value.trim(),
      address: document.getElementById("plAddress").value.trim(),
      coords: coords,
      notes: document.getElementById("plNotes").value.trim(),
      photos: pendingPhotos,
      addedAt: new Date().toISOString(),
      addedBy: auth.currentUser ? auth.currentUser.email : "unknown"
    };

    this.textContent = "Saving…";
    try{
      var ref = await addDoc(collection(db, "places"), place);
      backdrop.remove();
      renderPlaceProfile(ref.id);
    }catch(e){
      errEl.textContent = "Could not save — check your connection.";
      this.disabled = false;
      this.textContent = "Save";
    }
  };
}

// ---------- full profile page ----------
async function renderPlaceProfile(id){
  var content = document.getElementById("contentArea");
  content.innerHTML = '<div class="people-empty">Loading…</div>';

  var snap = await getDoc(doc(db, "places", id));
  if(!snap.exists()){ content.innerHTML = '<div class="people-empty">Record not found.</div>'; return; }

  var p = Object.assign({ id: id }, snap.data());
  var editMode = false;
  var pendingPhotos = p.photos ? p.photos.slice() : [];
  var coords = p.coords || null;

  function field(label, id2, value, editable, type, placeholder){
    var ph = placeholder ? ' placeholder="' + escapeHtml(placeholder) + '"' : '';
    if(type === "textarea"){
      return '<div class="profile-field"><label>' + label + '</label><textarea id="' + id2 + '"' + (editable ? '' : ' readonly') + ph + '>' + escapeHtml(value || "") + '</textarea></div>';
    }
    return '<div class="profile-field"><label>' + label + '</label>' +
      '<input type="text" id="' + id2 + '" value="' + escapeHtml(value || "") + '"' + ph + (editable ? '' : ' readonly') + '></div>';
  }

  function render(){
    content.innerHTML =
      '<div class="people-header">' +
        '<button class="btn-ghost" id="backToPlaces">← Back</button>' +
        '<h1>' + escapeHtml(p.name || "Unnamed place") + '</h1>' +
        '<button class="btn-ghost" id="toggleEditBtn">' + (editMode ? "Cancel Edit" : "Edit") + '</button>' +
      '</div>' +
      '<div class="modal-card profile-view">' +
        (coords ? '<div class="map-container profile" id="placeProfileMap"></div>' : '<div class="people-empty">No GPS location captured yet.</div>') +
        '<div class="profile-field-group">' +
          field("Name", "plfName", p.name, editMode) +
          field("Type", "plfType", p.type, editMode, null, "e.g. Drug House") +
          field("Address", "plfAddress", p.address, editMode) +
          field("Notes", "plfNotes", p.notes, editMode, "textarea") +
        '</div>' +
        (editMode ?
          '<label><i class="bi bi-geo-alt-fill"></i> GPS Location</label>' +
          '<div style="display:flex;gap:8px;">' +
            '<input id="plfCoordsDisplay" style="flex:1;" readonly value="' + (coords ? coords.lat.toFixed(6) + ", " + coords.lng.toFixed(6) : "") + '" placeholder="Not captured yet">' +
            '<button class="btn-ghost" id="plfGpsBtn" type="button">📍</button>' +
          '</div>' +
          '<div class="modal-error" id="plfGpsStatus" style="text-align:left;color:#888;"></div>' +
          '<div class="profile-actions">' +
            '<button class="btn-primary" id="saveProfileBtn">Save Changes</button>' +
            '<button class="btn-ghost" id="deletePlaceBtn" style="color:#ef5350;border-color:#ef5350;">Delete Place</button>' +
          '</div>' +
          '<div class="modal-error" id="profileError"></div>'
        : '') +

        '<hr>' +
        '<h3>Photos</h3>' +
        '<div class="pf-photos-row" id="plfPhotosRow"></div>' +
        (editMode ?
          '<button class="pf-take-photo-btn" id="plfAddPhotoBtn" type="button"><i class="bi bi-camera-fill"></i>Take Photo</button>' +
          '<label class="pf-import-label" for="plfImportFile"><i class="bi bi-images"></i>Import from Gallery</label>' +
          '<input type="file" id="plfPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
          '<input type="file" id="plfImportFile" accept="image/*" multiple style="display:none;">'
        : '') +
      '</div>';

    if(coords){
      var mapEl = document.getElementById("placeProfileMap");
      if(mapEl){
        var map = L.map(mapEl);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
        L.marker([coords.lat, coords.lng]).addTo(map);
        map.setView([coords.lat, coords.lng], 16);
      }
    }

    wireUp();
  }

  function renderPhotos(){
    var row = document.getElementById("plfPhotosRow");
    var addBtn = document.getElementById("plfAddPhotoBtn");
    var html = "";
    pendingPhotos.forEach(function(ph, i){
      var takenBy = (typeof ph === "object" && ph.takenBy) ? ph.takenBy : "";
      html += '<div><div class="pf-photo-chip"><img class="pf-photo-view" data-photo-i="' + i + '" src="' + ph.dataUrl + '">' +
        (editMode ? '<button class="pf-rm" data-i="' + i + '" type="button">✕</button>' : '') +
        '</div>' + (takenBy ? '<div class="pf-photo-caption">' + escapeHtml(takenBy) + '</div>' : '') + '</div>';
    });
    row.innerHTML = html;
    Array.prototype.forEach.call(row.querySelectorAll(".pf-photo-view"), function(img){
      img.onclick = function(){
        var allSrcs = pendingPhotos.map(function(ph){ return ph.dataUrl; });
        if(window.__openImageViewer) window.__openImageViewer(allSrcs, parseInt(img.getAttribute("data-photo-i"), 10));
      };
    });
    if(editMode && addBtn){
      row.appendChild(addBtn);
      Array.prototype.forEach.call(row.querySelectorAll(".pf-rm"), function(btn){
        btn.onclick = async function(){
          pendingPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1);
          await updateDoc(doc(db, "places", id), { photos: pendingPhotos });
          renderPhotos();
        };
      });
    }
  }

  async function addPhoto(dataUrl){
    pendingPhotos.push({ dataUrl: dataUrl, takenBy: currentUserShortName(), addedAt: new Date().toISOString() });
    await updateDoc(doc(db, "places", id), { photos: pendingPhotos });
    renderPhotos();
  }

  function wireUp(){
    document.getElementById("backToPlaces").onclick = function(){ renderPlaces(); };
    document.getElementById("toggleEditBtn").onclick = function(){ editMode = !editMode; render(); };

    if(editMode){
      document.getElementById("plfGpsBtn").onclick = function(){
        var statusEl = document.getElementById("plfGpsStatus");
        getBestLocation(statusEl, function(pos){
          coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          document.getElementById("plfCoordsDisplay").value = coords.lat.toFixed(6) + ", " + coords.lng.toFixed(6);
          statusEl.textContent = "Location captured (accuracy ±" + Math.round(pos.coords.accuracy) + "m).";
        });
      };

      document.getElementById("saveProfileBtn").onclick = async function(){
        var errEl = document.getElementById("profileError");
        var name = document.getElementById("plfName").value.trim();
        if(!name){ errEl.textContent = "Enter a name for this place."; return; }

        this.disabled = true;
        this.textContent = "Checking…";
        var similar = await findSimilarPlace(name, id);
        if(similar){
          errEl.innerHTML = 'Another place already has this name: <strong>' + escapeHtml(similar.name) + '</strong>.';
          this.disabled = false;
          this.textContent = "Save Changes";
          return;
        }

        var updates = {
          name: name,
          type: document.getElementById("plfType").value.trim(),
          address: document.getElementById("plfAddress").value.trim(),
          notes: document.getElementById("plfNotes").value.trim(),
          coords: coords
        };
        try{
          await updateDoc(doc(db, "places", id), updates);
          Object.assign(p, updates);
          editMode = false;
          render();
        }catch(e){
          errEl.textContent = "Could not save — check your connection.";
          this.disabled = false;
          this.textContent = "Save Changes";
        }
      };

      document.getElementById("deletePlaceBtn").onclick = async function(){
        var typed = prompt('Type "' + p.name + '" to confirm deletion.');
        if(typed === null) return;
        if(typed.trim().toLowerCase() !== (p.name||"").trim().toLowerCase()){
          alert("Didn't match — deletion cancelled.");
          return;
        }
        try{
          await updateDoc(doc(db, "places", id), {
            deleted: true,
            deletedAt: new Date().toISOString(),
            deletedBy: auth.currentUser ? auth.currentUser.email : "unknown"
          });
          renderPlaces();
        }catch(e){
          document.getElementById("profileError").textContent = "Could not delete — check your connection.";
        }
      };
    }

    renderPhotos();
    if(editMode){
      document.getElementById("plfAddPhotoBtn").onclick = function(){
        document.getElementById("plfPhotoFile").value = "";
        document.getElementById("plfPhotoFile").click();
      };
      document.getElementById("plfPhotoFile").onchange = async function(){
        var file = this.files[0];
        if(!file) return;
        var dataUrl = await fileToCompressedDataUrl(file, 480);
        addPhoto(dataUrl);
      };
      document.getElementById("plfImportFile").onchange = async function(){
        var files = Array.prototype.slice.call(this.files);
        for(var i = 0; i < files.length; i++){
          try{
            var dataUrl = await fileToCompressedDataUrl(files[i], 480);
            await addPhoto(dataUrl);
          }catch(e){ console.error(e); }
        }
      };
    }
  }

  render();
}