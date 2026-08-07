import { db, auth } from "./firebase.js";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, query, where
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

var MAX_ENCOUNTERS = 6;

// ---------- helpers ----------
function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function vehicleTitle(v){
  return ((v.make||"") + " " + (v.model||"")).trim() || "Unknown Vehicle";
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

// ---------- list ----------
export async function renderVehicles(){
  var content = document.getElementById("contentArea");
  content.innerHTML =
    '<div class="people-header">' +
      '<h1><i class="bi bi-car-front-fill"></i> Vehicle Database</h1>' +
      '<button class="btn-primary" id="addVehicleBtn"><i class="bi bi-plus-circle-fill"></i> Add</button>' +
    '</div>' +
    '<div class="people-search"><i class="bi bi-search"></i><input type="text" id="vehiclesSearchInput" placeholder="Search make, model, registration, VIN…"></div>' +
    '<div id="vehiclesListArea">Loading…</div>';

  document.getElementById("addVehicleBtn").onclick = function(){ openAddVehicleModal(); };

  var snapshot = await getDocs(collection(db, "vehicles"));
  var vehicles = [];
  snapshot.forEach(function(d){
    var data = d.data();
    if(!data.deleted) vehicles.push(Object.assign({ id: d.id }, data));
  });

  document.getElementById("vehiclesSearchInput").oninput = function(){ renderList(this.value); };

  function renderList(q){
    q = (q || "").trim().toLowerCase();
    var filtered = !q ? vehicles : vehicles.filter(function(v){
      return (vehicleTitle(v) + " " + (v.registration||"")).toLowerCase().indexOf(q) !== -1;
    });
    filtered.sort(function(a, b){ return vehicleTitle(a).localeCompare(vehicleTitle(b)); });

    var listArea = document.getElementById("vehiclesListArea");
    if(!filtered.length){
      listArea.innerHTML = '<div class="people-empty">No vehicles found.</div>';
      return;
    }
    listArea.innerHTML = '<div class="people-grid">' + filtered.map(function(v){
      var thumb = v.photos && v.photos[0] ? v.photos[0].dataUrl : null;
      return '<div class="people-card" data-id="' + v.id + '">' +
        (thumb ? '<img class="people-card-thumb" src="' + thumb + '">' :
          '<div class="people-card-thumb-empty"><i class="bi bi-car-front"></i></div>') +
        '<div class="people-card-info">' +
          '<div class="people-card-name">' + escapeHtml(vehicleTitle(v)) + '</div>' +
          '<div class="people-card-meta">Reg: ' + escapeHtml(v.registration || "Unknown") + '</div>' +
        '</div>' +
      '</div>';
    }).join("") + '</div>';

    Array.prototype.forEach.call(listArea.querySelectorAll(".people-card"), function(el){
      el.onclick = function(){ renderVehicleProfile(el.getAttribute("data-id")); };
    });
  }

  renderList("");
}

// ---------- duplicate registration check ----------
async function findDuplicateByRegistration(registration, excludeId){
  if(!registration) return null;
  var snapshot = await getDocs(collection(db, "vehicles"));
  var match = null;
  snapshot.forEach(function(d){
    if(d.id === excludeId) return;
    var data = d.data();
    if(data.registration && data.registration.trim().toLowerCase() === registration.trim().toLowerCase()){
      match = Object.assign({ id: d.id }, data);
    }
  });
  return match;
}

// ---------- owner search (link to a Person) ----------
async function searchPeople(q){
  q = (q || "").trim().toLowerCase();
  if(!q) return [];
  var snapshot = await getDocs(collection(db, "people"));
  var results = [];
  snapshot.forEach(function(d){
    var data = d.data();
    if(data.deleted) return;
    var name = ((data.name||"") + " " + (data.surname||"")).trim();
    if(name.toLowerCase().indexOf(q) !== -1){
      results.push({ id: d.id, name: name });
    }
  });
  return results;
}

function ownerSearchWidget(containerEl, currentOwnerId, currentOwnerName, onSelect){
  containerEl.innerHTML =
    '<label>Owner (linked to People)</label>' +
    '<div id="ownerCurrent">' + (currentOwnerName ? '<span class="owner-link" id="ownerViewBtn">' + escapeHtml(currentOwnerName) + '</span> ' : '<span style="color:#888;">No owner linked</span> ') +
      '<button class="btn-ghost" id="ownerChangeBtn" type="button" style="padding:4px 10px;font-size:12px;">' + (currentOwnerName ? "Change" : "Link") + '</button>' +
    '</div>' +
    '<div class="owner-search-box" id="ownerSearchBox" style="display:none;">' +
      '<input id="ownerSearchInput" placeholder="Type a name…">' +
      '<div class="merge-search-results" id="ownerResults"></div>' +
    '</div>';

  var ownerId = currentOwnerId || null;
  var ownerName = currentOwnerName || null;

  if(document.getElementById("ownerViewBtn")){
    document.getElementById("ownerViewBtn").onclick = function(){
      if(ownerId) window.__openPersonProfile && window.__openPersonProfile(ownerId);
    };
  }

  document.getElementById("ownerChangeBtn").onclick = function(){
    var box = document.getElementById("ownerSearchBox");
    box.style.display = box.style.display === "none" ? "block" : "none";
  };

  document.getElementById("ownerSearchInput").oninput = async function(){
    var results = await searchPeople(this.value);
    document.getElementById("ownerResults").innerHTML = results.map(function(r){
      return '<div class="merge-search-row" data-id="' + r.id + '" data-name="' + escapeHtml(r.name) + '">' + escapeHtml(r.name) + '</div>';
    }).join("");
    Array.prototype.forEach.call(document.getElementById("ownerResults").querySelectorAll(".merge-search-row"), function(row){
      row.onclick = function(){
        ownerId = row.getAttribute("data-id");
        ownerName = row.getAttribute("data-name");
        onSelect(ownerId, ownerName);
        ownerSearchWidget(containerEl, ownerId, ownerName, onSelect);
      };
    });
  };

  return { getOwnerId: function(){ return ownerId; }, getOwnerName: function(){ return ownerName; } };
}

// ---------- add vehicle (modal) ----------
function openAddVehicleModal(){
  var pendingPhotos = [];
  var linkedOwnerId = null;
  var linkedOwnerName = null;

  var backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop-custom";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h2>Add Vehicle</h2>' +
      '<label>Photos</label>' +
      '<div class="pf-photos-row" id="avPhotosRow"><button class="pf-add-photo" id="avAddPhotoBtn" type="button">＋</button></div>' +
      '<label class="pf-import-label" for="avImportFile">🖼 Import from gallery</label>' +
      '<input type="file" id="avPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
      '<input type="file" id="avImportFile" accept="image/*" multiple style="display:none;">' +
      '<label>Registration</label><input id="avRegistration" placeholder="e.g. CAA123456">' +
      '<label>Make and Model</label><input id="avMake" placeholder="e.g. VW Citi Golf">' +
      '<label>Colour</label><input id="avColour" placeholder="e.g. White">' +
      '<div id="avOwnerWidget"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn-ghost" id="avCancel">Cancel</button>' +
        '<button class="btn-primary" id="avSave">Save</button>' +
      '</div>' +
      '<div class="modal-error" id="avError"></div>' +
    '</div>';
  document.body.appendChild(backdrop);
  backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };
  document.getElementById("avCancel").onclick = function(){ backdrop.remove(); };

  ownerSearchWidget(document.getElementById("avOwnerWidget"), null, null, function(id, name){
    linkedOwnerId = id; linkedOwnerName = name;
  });

  function renderAvPhotos(){
    var row = document.getElementById("avPhotosRow");
    var addBtn = document.getElementById("avAddPhotoBtn");
    var html = "";
    pendingPhotos.forEach(function(ph, i){
      html += '<div class="pf-photo-chip"><img src="' + ph.dataUrl + '"><button class="pf-rm" data-i="' + i + '" type="button">✕</button></div>';
    });
    row.innerHTML = html;
    row.appendChild(addBtn);
    Array.prototype.forEach.call(row.querySelectorAll(".pf-rm"), function(btn){
      btn.onclick = function(){ pendingPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1); renderAvPhotos(); };
    });
  }
  document.getElementById("avAddPhotoBtn").onclick = function(){
    document.getElementById("avPhotoFile").value = "";
    document.getElementById("avPhotoFile").click();
  };
  document.getElementById("avPhotoFile").onchange = async function(){
    var file = this.files[0];
    if(!file) return;
    var dataUrl = await fileToCompressedDataUrl(file, 480);
    pendingPhotos.push({ dataUrl: dataUrl, takenBy: currentUserShortName(), addedAt: new Date().toISOString() });
    renderAvPhotos();
  };
  document.getElementById("avImportFile").onchange = async function(){
    var files = Array.prototype.slice.call(this.files);
    for(var i = 0; i < files.length; i++){
      try{
        var dataUrl = await fileToCompressedDataUrl(files[i], 480);
        pendingPhotos.push({ dataUrl: dataUrl, takenBy: currentUserShortName(), addedAt: new Date().toISOString() });
        renderAvPhotos();
      }catch(e){ console.error(e); }
    }
  };

  document.getElementById("avSave").onclick = async function(){
    var errEl = document.getElementById("avError");
    var registration = document.getElementById("avRegistration").value.trim();
    var make = document.getElementById("avMake").value.trim();
    var model = "";
    if(!registration && !make && !model){
      errEl.textContent = "Enter at least a registration, make, or model.";
      return;
    }

    this.disabled = true;
    this.textContent = "Checking…";

    var dup = await findDuplicateByRegistration(registration, null);
    if(dup){
      errEl.innerHTML = 'A vehicle with this registration already exists: <strong>' + escapeHtml(vehicleTitle(dup)) + '</strong>. Open its profile instead to add a new encounter.';
      this.disabled = false;
      this.textContent = "Save";
      return;
    }

    var vehicle = {
      registration: registration,
      make: make,
      model: model,
      colour: document.getElementById("avColour").value.trim(),
      ownerId: linkedOwnerId,
      ownerName: linkedOwnerName,
      deceased: false,
      photos: pendingPhotos,
      addedAt: new Date().toISOString(),
      addedBy: auth.currentUser ? auth.currentUser.email : "unknown"
    };

    this.textContent = "Saving…";
    try{
      var ref = await addDoc(collection(db, "vehicles"), vehicle);
      backdrop.remove();
      renderVehicleProfile(ref.id);
    }catch(e){
      errEl.textContent = "Could not save — check your connection.";
      this.disabled = false;
      this.textContent = "Save";
    }
  };
}

// ---------- full profile page ----------
async function renderVehicleProfile(id){
  var content = document.getElementById("contentArea");
  content.innerHTML = '<div class="people-empty">Loading…</div>';

  var snap = await getDoc(doc(db, "vehicles", id));
  if(!snap.exists()){ content.innerHTML = '<div class="people-empty">Record not found.</div>'; return; }

  var v = Object.assign({ id: id }, snap.data());
  var editMode = false;
  var pendingPhotos = v.photos ? v.photos.slice() : [];
  var encounters = [];
  var editOwnerId = v.ownerId || null;
  var editOwnerName = v.ownerName || null;

  async function loadEncounters(){
    var q = query(collection(db, "vehicleEncounters"), where("vehicleId", "==", id));
    var snap2 = await getDocs(q);
    encounters = [];
    snap2.forEach(function(d){ encounters.push(Object.assign({ id: d.id }, d.data())); });
    encounters.sort(function(a, b){ return (a.date || "").localeCompare(b.date || ""); });
  }

  function render(){
    content.innerHTML =
      '<div class="people-header">' +
        '<button class="btn-ghost" id="backToVehicles">← Back</button>' +
        '<h1>' + escapeHtml(vehicleTitle(v)) + '</h1>' +
        '<button class="btn-ghost" id="toggleEditBtn">' + (editMode ? "Cancel Edit" : "Edit") + '</button>' +
      '</div>' +
      '<div class="modal-card profile-view">' +
        '<div class="profile-field-group">' +
          field("Registration", "vfRegistration", v.registration, editMode, null, "e.g. CAA123456") +
          '<div class="profile-field" style="grid-column:1 / -1;">' +
            '<label>Make and Model</label><input type="text" id="vfMake" value="' + escapeHtml(vehicleTitle(v)) + '"' + (editMode ? '' : ' readonly') + ' placeholder="e.g. VW Citi Golf">' +
          '</div>' +
          field("Colour", "vfColour", v.colour, editMode, null, "e.g. White") +
          field("Distinct Markings", "vfMarkings", v.markings, editMode, "textarea", "e.g. Missing front headlight") +
        '</div>' +
        '<label>Location spotted</label>' +
        '<div style="display:flex;gap:8px;">' +
          '<input id="vfLocationSpotted" style="flex:1;" value="' + escapeHtml(v.locationSpotted || "") + '"' + (editMode ? '' : ' readonly') + ' placeholder="Where this vehicle was seen">' +
          (editMode ? '<button class="btn-ghost" id="vfLocationGpsBtn" type="button" style="flex-shrink:0;padding:11px 14px;">📍</button>' : '') +
        '</div>' +
        (editMode ? '<div class="modal-error" id="vfLocationGpsStatus" style="text-align:left;color:#888;"></div>' : '') +
        '<div id="ownerWidgetArea">' +
          (v.ownerName ? '<label>Owner (linked to People)</label><div><span class="owner-link" id="ownerViewLink">' + escapeHtml(v.ownerName) + '</span></div>' :
            '<label>Owner</label><div style="color:#888;">No owner linked</div>') +
        '</div>' +
        (editMode ?
          '<div id="vfOwnerWidget" style="margin-top:14px;"></div>' +
          '<div class="profile-actions">' +
            '<button class="btn-primary" id="saveProfileBtn">Save Changes</button>' +
            '<button class="btn-ghost" id="deleteVehicleBtn" style="color:#ef5350;border-color:#ef5350;">Delete Vehicle</button>' +
          '</div>' +
          '<div class="modal-error" id="profileError"></div>'
        : '') +

        '<hr>' +
        '<h3>Photos</h3>' +
        '<div class="pf-photos-row" id="vfPhotosRow"></div>' +
        (editMode ?
          '<button class="pf-take-photo-btn" id="vfAddPhotoBtn" type="button"><i class="bi bi-camera-fill"></i>Take Photo</button>' +
          '<label class="pf-import-label" for="vfImportFile"><i class="bi bi-images"></i>Import from Gallery</label>' +
          '<input type="file" id="vfPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
          '<input type="file" id="vfImportFile" accept="image/*" multiple style="display:none;">'
        : '') +

        '<hr>' +
        '<h3>Encounters</h3>' +
        '<div id="encounterList">' + renderEncounters() + '</div>' +
        '<button class="pf-add-encounter" id="newEncounterBtn" type="button"' + (encounters.length >= MAX_ENCOUNTERS ? ' disabled' : '') + '>' +
          (encounters.length >= MAX_ENCOUNTERS ? "Maximum of 6 encounters reached" : "+ New Encounter (" + encounters.length + "/" + MAX_ENCOUNTERS + ")") +
        '</button>' +
      '</div>';

    wireUp();
  }

  function field(label, id, value, editable, type, placeholder){
    var ph = placeholder ? ' placeholder="' + escapeHtml(placeholder) + '"' : '';
    return '<div class="profile-field"><label>' + label + '</label>' +
      '<input type="' + (type || "text") + '" id="' + id + '" value="' + escapeHtml(value || "") + '"' + ph + (editable ? '' : ' readonly') + '></div>';
  }

  function renderEncounters(){
    if(!encounters.length) return '<div class="people-empty">No encounters recorded yet.</div>';
    return encounters.map(function(enc, i){
      var itemsPhotos = enc.itemsPhotos || [];
      return '<div class="pf-encounter">' +
        '<div class="pf-encounter-head"><span>Encounter ' + (i + 1) + ' — ' + escapeHtml(enc.date || "") + '</span>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="pf-encounter-edit" data-i="' + i + '" type="button">✏ Edit</button>' +
          '<button class="pf-encounter-remove" data-id="' + enc.id + '" type="button">Remove</button>' +
        '</div></div>' +
        (enc.location ? '<div class="people-card-meta">📍 ' + escapeHtml(enc.location) + '</div>' : '') +
        (enc.itemsFound ? '<div class="people-card-meta">Items found: ' + escapeHtml(enc.itemsFound) + '</div>' : '') +
        (itemsPhotos.length ? '<div class="pf-photos-row" style="margin-top:8px;">' +
          itemsPhotos.map(function(ph){ return '<div class="pf-photo-chip"><img src="' + ph + '"></div>'; }).join("") +
        '</div>' : '') +
        (enc.notes ? '<div class="people-card-meta">' + escapeHtml(enc.notes) + '</div>' : '') +
        (enc.loggedBy ? '<div class="people-card-meta" style="opacity:0.6;">Logged by ' + escapeHtml(enc.loggedBy) + '</div>' : '') +
      '</div>';
    }).join("");
  }

  function renderPhotos(){
    var row = document.getElementById("vfPhotosRow");
    var addBtn = document.getElementById("vfAddPhotoBtn");
    var html = "";
    pendingPhotos.forEach(function(ph, i){
      var takenBy = (typeof ph === "object" && ph.takenBy) ? ph.takenBy : "";
      html += '<div><div class="pf-photo-chip"><img src="' + ph.dataUrl + '">' +
        (editMode ? '<button class="pf-rm" data-i="' + i + '" type="button">✕</button>' : '') +
        '</div>' + (takenBy ? '<div class="pf-photo-caption">' + escapeHtml(takenBy) + '</div>' : '') + '</div>';
    });
    row.innerHTML = html;
    if(editMode && addBtn){
      row.appendChild(addBtn);
      Array.prototype.forEach.call(row.querySelectorAll(".pf-rm"), function(btn){
        btn.onclick = async function(){
          pendingPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1);
          await updateDoc(doc(db, "vehicles", id), { photos: pendingPhotos });
          renderPhotos();
        };
      });
    }
  }

  async function addPhoto(dataUrl){
    var entry = { dataUrl: dataUrl, takenBy: currentUserShortName(), addedAt: new Date().toISOString() };
    pendingPhotos.push(entry);
    await updateDoc(doc(db, "vehicles", id), { photos: pendingPhotos });
    renderPhotos();
  }

  function wireUp(){
    document.getElementById("backToVehicles").onclick = function(){ renderVehicles(); };

    document.getElementById("toggleEditBtn").onclick = function(){
      editMode = !editMode;
      render();
    };

    if(document.getElementById("ownerViewLink")){
      document.getElementById("ownerViewLink").onclick = function(){
        if(v.ownerId && window.__openPersonProfile) window.__openPersonProfile(v.ownerId);
      };
    }

    if(editMode){
      ownerSearchWidget(document.getElementById("vfOwnerWidget"), editOwnerId, editOwnerName, function(oid, oname){
        editOwnerId = oid; editOwnerName = oname;
      });
      if(document.getElementById("vfLocationGpsBtn")){
        document.getElementById("vfLocationGpsBtn").onclick = function(){
          var statusEl = document.getElementById("vfLocationGpsStatus");
          var input = document.getElementById("vfLocationSpotted");
          if(!navigator.geolocation){ statusEl.textContent = "Location isn't available — enter it manually."; return; }
          statusEl.textContent = "Getting current location…";
          navigator.geolocation.getCurrentPosition(function(pos){
            input.value = "Lat " + pos.coords.latitude.toFixed(5) + ", Lon " + pos.coords.longitude.toFixed(5);
            statusEl.textContent = "Location found.";
          }, function(){
            statusEl.textContent = "Could not determine location — enter it manually.";
          }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
        };
      }

      document.getElementById("saveProfileBtn").onclick = async function(){
        var errEl = document.getElementById("profileError");
        var registration = document.getElementById("vfRegistration").value.trim();

        this.disabled = true;
        this.textContent = "Checking…";
        var dup = await findDuplicateByRegistration(registration, id);
        if(dup){
          errEl.innerHTML = 'Another vehicle already has this registration: <strong>' + escapeHtml(vehicleTitle(dup)) + '</strong>.';
          this.disabled = false;
          this.textContent = "Save Changes";
          return;
        }

        var updates = {
          registration: registration,
          make: document.getElementById("vfMake").value.trim(),
          model: "",
          colour: document.getElementById("vfColour").value.trim(),
          markings: document.getElementById("vfMarkings").value.trim(),
          locationSpotted: document.getElementById("vfLocationSpotted").value.trim(),
          ownerId: editOwnerId,
          ownerName: editOwnerName
        };
        try{
          await updateDoc(doc(db, "vehicles", id), updates);
          Object.assign(v, updates);
          editMode = false;
          render();
        }catch(e){
          errEl.textContent = "Could not save — check your connection.";
          this.disabled = false;
          this.textContent = "Save Changes";
        }
      };

      document.getElementById("deleteVehicleBtn").onclick = async function(){
        var typed = prompt('Type "' + vehicleTitle(v) + '" to confirm deletion.');
        if(typed === null) return;
        if(typed.trim().toLowerCase() !== vehicleTitle(v).trim().toLowerCase()){
          alert("Didn't match — deletion cancelled.");
          return;
        }
        try{
          await updateDoc(doc(db, "vehicles", id), {
            deleted: true,
            deletedAt: new Date().toISOString(),
            deletedBy: auth.currentUser ? auth.currentUser.email : "unknown"
          });
          renderVehicles();
        }catch(e){
          document.getElementById("profileError").textContent = "Could not delete — check your connection.";
        }
      };
    }

    renderPhotos();
    if(editMode){
      document.getElementById("vfAddPhotoBtn").onclick = function(){
        document.getElementById("vfPhotoFile").value = "";
        document.getElementById("vfPhotoFile").click();
      };
      document.getElementById("vfPhotoFile").onchange = async function(){
        var file = this.files[0];
        if(!file) return;
        var dataUrl = await fileToCompressedDataUrl(file, 480);
        addPhoto(dataUrl);
      };
      document.getElementById("vfImportFile").onchange = async function(){
        var files = Array.prototype.slice.call(this.files);
        for(var i = 0; i < files.length; i++){
          try{
            var dataUrl = await fileToCompressedDataUrl(files[i], 480);
            await addPhoto(dataUrl);
          }catch(e){ console.error(e); }
        }
      };
    }

    Array.prototype.forEach.call(document.querySelectorAll(".pf-encounter-remove"), function(btn){
      btn.onclick = async function(){
        var encId = btn.getAttribute("data-id");
        if(!confirm("Remove this encounter?")) return;
        try{ await deleteDoc(doc(db, "vehicleEncounters", encId)); }catch(e){}
        await loadEncounters();
        document.getElementById("encounterList").innerHTML = renderEncounters();
        wireUp();
      };
    });

    Array.prototype.forEach.call(document.querySelectorAll(".pf-encounter-edit"), function(btn){
      btn.onclick = function(){
        var i = parseInt(btn.getAttribute("data-i"), 10);
        openEditEncounterModal(encounters[i]);
      };
    });

    document.getElementById("newEncounterBtn").onclick = function(){
      if(encounters.length >= MAX_ENCOUNTERS) return;
      openNewEncounterModal();
    };
  }

  function encounterFormHtml(existing){
    return '<label>Date</label><input type="date" id="encDate" value="' + escapeHtml(existing ? existing.date : new Date().toISOString().slice(0,10)) + '">' +
      '<label>Location profiled</label>' +
      '<div style="display:flex;gap:8px;">' +
        '<input id="encLocation" style="flex:1;" value="' + escapeHtml(existing ? existing.location : "") + '" placeholder="Where this took place">' +
        '<button class="btn-ghost" id="encGpsBtn" type="button" style="flex-shrink:0;padding:11px 14px;">📍</button>' +
      '</div>' +
      '<div class="modal-error" id="encGpsStatus" style="text-align:left;color:#888;"></div>' +
      '<label>Items found</label><textarea id="encItems">' + escapeHtml(existing ? existing.itemsFound : "") + '</textarea>' +
      '<label>Photos of items found</label>' +
      '<div class="pf-photos-row" id="encItemsPhotosRow"><button class="pf-add-photo" id="encAddItemsPhotoBtn" type="button">＋</button></div>' +
      '<input type="file" id="encItemsPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
      '<label>Notes</label><textarea id="encNotes">' + escapeHtml(existing ? existing.notes : "") + '</textarea>';
  }

  function wireEncounterForm(itemsPhotos, encCoordsSetter){
    function renderItemsPhotos(){
      var row = document.getElementById("encItemsPhotosRow");
      var addBtn = document.getElementById("encAddItemsPhotoBtn");
      var html = "";
      itemsPhotos.forEach(function(ph, i){
        html += '<div class="pf-photo-chip"><img src="' + ph + '"><button class="pf-rm" data-i="' + i + '" type="button">✕</button></div>';
      });
      row.innerHTML = html;
      row.appendChild(addBtn);
      Array.prototype.forEach.call(row.querySelectorAll(".pf-rm"), function(btn){
        btn.onclick = function(){ itemsPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1); renderItemsPhotos(); };
      });
    }
    renderItemsPhotos();
    document.getElementById("encAddItemsPhotoBtn").onclick = function(){
      document.getElementById("encItemsPhotoFile").value = "";
      document.getElementById("encItemsPhotoFile").click();
    };
    document.getElementById("encItemsPhotoFile").onchange = async function(){
      var file = this.files[0];
      if(!file) return;
      var dataUrl = await fileToCompressedDataUrl(file, 480);
      itemsPhotos.push(dataUrl);
      renderItemsPhotos();
    };
    document.getElementById("encGpsBtn").onclick = function(){
      var statusEl = document.getElementById("encGpsStatus");
      var input = document.getElementById("encLocation");
      if(!navigator.geolocation){ statusEl.textContent = "Location isn't available — enter it manually."; return; }
      statusEl.textContent = "Getting current location…";
      navigator.geolocation.getCurrentPosition(function(position){
        encCoordsSetter([position.coords.latitude, position.coords.longitude]);
        input.value = "Lat " + position.coords.latitude.toFixed(5) + ", Lon " + position.coords.longitude.toFixed(5);
        statusEl.textContent = "Location found.";
      }, function(){
        statusEl.textContent = "Could not determine location — enter it manually.";
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    };
  }

  function openNewEncounterModal(){
    var itemsPhotos = [];
    var encCoords = null;
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop-custom";
    backdrop.innerHTML =
      '<div class="modal-card"><h2>New Encounter</h2>' + encounterFormHtml(null) +
      '<div class="modal-actions"><button class="btn-ghost" id="encCancel">Cancel</button><button class="btn-primary" id="encSave">Save Encounter</button></div>' +
      '<div class="modal-error" id="encError"></div></div>';
    document.body.appendChild(backdrop);
    backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };
    document.getElementById("encCancel").onclick = function(){ backdrop.remove(); };
    wireEncounterForm(itemsPhotos, function(c){ encCoords = c; });
    document.getElementById("encGpsBtn").click();

    document.getElementById("encSave").onclick = async function(){
      var newEnc = {
        vehicleId: id,
        date: document.getElementById("encDate").value,
        location: document.getElementById("encLocation").value.trim(),
        coords: encCoords,
        itemsFound: document.getElementById("encItems").value.trim(),
        itemsPhotos: itemsPhotos,
        notes: document.getElementById("encNotes").value.trim(),
        loggedBy: currentUserShortName(),
        createdAt: new Date().toISOString()
      };
      this.disabled = true;
      this.textContent = "Saving…";
      try{
        await addDoc(collection(db, "vehicleEncounters"), newEnc);
        await loadEncounters();
        backdrop.remove();
        document.getElementById("encounterList").innerHTML = renderEncounters();
        wireUp();
      }catch(e){
        document.getElementById("encError").textContent = "Could not save — check your connection.";
        this.disabled = false;
        this.textContent = "Save Encounter";
      }
    };
  }

  function openEditEncounterModal(existing){
    var itemsPhotos = existing.itemsPhotos ? existing.itemsPhotos.slice() : [];
    var encCoords = existing.coords || null;
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop-custom";
    backdrop.innerHTML =
      '<div class="modal-card"><h2>Edit Encounter</h2>' + encounterFormHtml(existing) +
      '<div class="modal-actions"><button class="btn-ghost" id="encCancel">Cancel</button><button class="btn-primary" id="encSave">Save Changes</button></div>' +
      '<div class="modal-error" id="encError"></div></div>';
    document.body.appendChild(backdrop);
    backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };
    document.getElementById("encCancel").onclick = function(){ backdrop.remove(); };
    wireEncounterForm(itemsPhotos, function(c){ encCoords = c; });

    document.getElementById("encSave").onclick = async function(){
      var updates = {
        date: document.getElementById("encDate").value,
        location: document.getElementById("encLocation").value.trim(),
        coords: encCoords,
        itemsFound: document.getElementById("encItems").value.trim(),
        itemsPhotos: itemsPhotos,
        notes: document.getElementById("encNotes").value.trim()
      };
      this.disabled = true;
      this.textContent = "Saving…";
      try{
        await updateDoc(doc(db, "vehicleEncounters", existing.id), updates);
        await loadEncounters();
        backdrop.remove();
        document.getElementById("encounterList").innerHTML = renderEncounters();
        wireUp();
      }catch(e){
        document.getElementById("encError").textContent = "Could not save — check your connection.";
        this.disabled = false;
        this.textContent = "Save Changes";
      }
    };
  }

  await loadEncounters();
  render();
}