import { db, auth } from "../firebase.js";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ensureModelsLoaded, computeDescriptor, photoUrl } from "../face.js";

ensureModelsLoaded();

var MAX_ENCOUNTERS = 6;

// ---------- helpers ----------
function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function fullName(p){
  return ((p.name||"") + " " + (p.surname||"")).trim() || "Unnamed Person";
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
function dataUrlToCanvas(dataUrl){
  return new Promise(function(resolve, reject){
    var img = new Image();
    img.onload = function(){
      var canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// ---------- list ----------
export async function showPeople(){
  var content = document.getElementById("contentArea");
  content.innerHTML =
    '<div class="people-header">' +
      '<h1><i class="bi bi-person-fill"></i> People Database</h1>' +
      '<button class="btn-primary" id="addPersonBtn"><i class="bi bi-plus-circle-fill"></i> Add</button>' +
    '</div>' +
    '<div class="people-search"><i class="bi bi-search"></i><input type="text" id="peopleSearchInput" placeholder="Search people…"></div>' +
    '<div id="peopleListArea">Loading…</div>';

  document.getElementById("addPersonBtn").onclick = function(){ openAddPersonModal(); };

  var snapshot = await getDocs(collection(db, "people"));
  var people = [];
  snapshot.forEach(function(d){ people.push(Object.assign({ id: d.id }, d.data())); });

  document.getElementById("peopleSearchInput").oninput = function(){
    renderList(this.value);
  };

  function renderList(q){
    q = (q || "").trim().toLowerCase();
    var filtered = !q ? people : people.filter(function(p){
      return fullName(p).toLowerCase().indexOf(q) !== -1 || (p.idNumber || "").toLowerCase().indexOf(q) !== -1;
    });
    filtered.sort(function(a, b){ return fullName(a).localeCompare(fullName(b)); });

    var listArea = document.getElementById("peopleListArea");
    if(!filtered.length){
      listArea.innerHTML = '<div class="people-empty">No people found.</div>';
      return;
    }
    listArea.innerHTML = '<div class="people-grid">' + filtered.map(function(p){
      var thumb = p.photos && p.photos[0] ? photoUrl(p.photos[0]) : null;
      return '<div class="people-card" data-id="' + p.id + '">' +
        (thumb ? '<img class="people-card-thumb" src="' + thumb + '">' :
          '<div class="people-card-thumb-empty"><i class="bi bi-person"></i></div>') +
        '<div class="people-card-info">' +
          '<div class="people-card-name">' + escapeHtml(fullName(p)) + '</div>' +
          '<div class="people-card-meta">ID: ' + escapeHtml(p.idNumber || "Unknown") + '</div>' +
        '</div>' +
      '</div>';
    }).join("") + '</div>';

    Array.prototype.forEach.call(listArea.querySelectorAll(".people-card"), function(el){
      el.onclick = function(){ renderPersonProfile(el.getAttribute("data-id")); };
    });
  }

  renderList("");
}

// ---------- duplicate check ----------
async function findDuplicateByIdNumber(idNumber, excludeId){
  if(!idNumber) return null;
  var snapshot = await getDocs(collection(db, "people"));
  var match = null;
  snapshot.forEach(function(d){
    if(d.id === excludeId) return;
    var data = d.data();
    if(data.idNumber && data.idNumber.trim().toLowerCase() === idNumber.trim().toLowerCase()){
      match = Object.assign({ id: d.id }, data);
    }
  });
  return match;
}

// ---------- add person (modal) ----------
function openAddPersonModal(){
  var backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop-custom";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h2>Add Person</h2>' +
      '<label>Name</label><input id="apName">' +
      '<label>Surname</label><input id="apSurname">' +
      '<label>ID Number</label><input id="apIdNumber">' +
      '<label>Date of Birth</label><input type="date" id="apDob">' +
      '<label>Known Aliases</label><input id="apAliases">' +
      '<label>Originally From</label><input id="apOrigin">' +
      '<label>Current Residence</label><input id="apResidence">' +
      '<div class="modal-actions">' +
        '<button class="btn-ghost" id="apCancel">Cancel</button>' +
        '<button class="btn-primary" id="apSave">Save</button>' +
      '</div>' +
      '<div class="modal-error" id="apError"></div>' +
    '</div>';
  document.body.appendChild(backdrop);
  backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };
  document.getElementById("apCancel").onclick = function(){ backdrop.remove(); };

  document.getElementById("apSave").onclick = async function(){
    var errEl = document.getElementById("apError");
    var name = document.getElementById("apName").value.trim();
    var surname = document.getElementById("apSurname").value.trim();
    var idNumber = document.getElementById("apIdNumber").value.trim();
    if(!name || !surname){ errEl.textContent = "Name and Surname are required."; return; }

    this.disabled = true;
    this.textContent = "Checking…";

    var dup = await findDuplicateByIdNumber(idNumber, null);
    if(dup){
      errEl.innerHTML = 'A person with this ID Number already exists: <strong>' + escapeHtml(fullName(dup)) + '</strong>. Open their profile instead to add a new encounter.';
      this.disabled = false;
      this.textContent = "Save";
      return;
    }

    var person = {
      name: name, surname: surname, idNumber: idNumber,
      dob: document.getElementById("apDob").value,
      aliases: document.getElementById("apAliases").value.trim(),
      origin: document.getElementById("apOrigin").value.trim(),
      residence: document.getElementById("apResidence").value.trim(),
      encounters: [],
      photos: [],
      addedAt: new Date().toISOString(),
      addedBy: auth.currentUser ? auth.currentUser.email : "unknown"
    };

    this.textContent = "Saving…";
    try{
      var ref = await addDoc(collection(db, "people"), person);
      backdrop.remove();
      renderPersonProfile(ref.id);
    }catch(e){
      errEl.textContent = "Could not save — check your connection.";
      this.disabled = false;
      this.textContent = "Save";
    }
  };
}

// ---------- full profile page ----------
async function renderPersonProfile(id){
  var content = document.getElementById("contentArea");
  content.innerHTML = '<div class="people-empty">Loading…</div>';

  var snap = await getDoc(doc(db, "people", id));
  if(!snap.exists()){ content.innerHTML = '<div class="people-empty">Record not found.</div>'; return; }

  var p = Object.assign({ id: id }, snap.data());
  var editMode = false;
  var pendingPhotos = p.photos ? p.photos.slice() : [];
  var encounters = p.encounters || [];

  function render(){
    content.innerHTML =
      '<div class="people-header">' +
        '<button class="btn-ghost" id="backToPeople">← Back</button>' +
        '<h1>' + escapeHtml(fullName(p)) + '</h1>' +
        '<button class="btn-ghost" id="toggleEditBtn">' + (editMode ? "Cancel Edit" : "Edit") + '</button>' +
      '</div>' +
      '<div class="modal-card profile-view">' +
        '<div class="profile-field-group">' +
          field("Name", "pfName", p.name, editMode) +
          field("Surname", "pfSurname", p.surname, editMode) +
          field("ID Number", "pfIdNumber", p.idNumber, editMode) +
          field("Date of Birth", "pfDob", p.dob, editMode, "date") +
          field("Known Aliases", "pfAliases", p.aliases, editMode) +
          field("Originally From", "pfOrigin", p.origin, editMode) +
          field("Current Residence", "pfResidence", p.residence, editMode) +
        '</div>' +
        (editMode ?
          '<div class="profile-actions">' +
            '<button class="btn-primary" id="saveProfileBtn">Save Changes</button>' +
            '<button class="btn-ghost" id="deletePersonBtn" style="color:#ef5350;border-color:#ef5350;">Delete Person</button>' +
          '</div>' +
          '<div class="modal-error" id="profileError"></div>'
        : '') +

        '<hr>' +
        '<h3>Photos</h3>' +
        '<div class="pf-photos-row" id="pfPhotosRow"><button class="pf-add-photo" id="pfAddPhotoBtn" type="button">＋</button></div>' +
        '<label class="pf-import-label" for="pfImportFile">🖼 Import from gallery</label>' +
        '<input type="file" id="pfPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
        '<input type="file" id="pfImportFile" accept="image/*" multiple style="display:none;">' +

        '<hr>' +
        '<h3>Encounters</h3>' +
        '<div id="encounterList">' + renderEncounters() + '</div>' +
        '<button class="pf-add-encounter" id="newEncounterBtn" type="button"' + (encounters.length >= MAX_ENCOUNTERS ? ' disabled' : '') + '>' +
          (encounters.length >= MAX_ENCOUNTERS ? "Maximum of 6 encounters reached" : "+ New Encounter (" + encounters.length + "/" + MAX_ENCOUNTERS + ")") +
        '</button>' +
      '</div>';

    wireUp();
  }

  function field(label, id, value, editable, type){
    return '<div class="profile-field"><label>' + label + '</label>' +
      '<input type="' + (type || "text") + '" id="' + id + '" value="' + escapeHtml(value || "") + '"' + (editable ? '' : ' readonly') + '></div>';
  }

  function renderEncounters(){
    if(!encounters.length) return '<div class="people-empty">No encounters recorded yet.</div>';
    return encounters.map(function(enc, i){
      return '<div class="pf-encounter">' +
        '<div class="pf-encounter-head"><span>Encounter ' + (i + 1) + ' — ' + escapeHtml(enc.date || "") + '</span>' +
        '<button class="pf-encounter-remove" data-i="' + i + '" type="button">Remove</button></div>' +
        (enc.location ? '<div class="people-card-meta">📍 ' + escapeHtml(enc.location) + '</div>' : '') +
        (enc.itemsFound ? '<div class="people-card-meta">Items found: ' + escapeHtml(enc.itemsFound) + '</div>' : '') +
        (enc.notes ? '<div class="people-card-meta">' + escapeHtml(enc.notes) + '</div>' : '') +
        (enc.loggedBy ? '<div class="people-card-meta" style="opacity:0.6;">Logged by ' + escapeHtml(enc.loggedBy) + '</div>' : '') +
      '</div>';
    }).join("");
  }

  function renderPhotos(){
    var row = document.getElementById("pfPhotosRow");
    var addBtn = document.getElementById("pfAddPhotoBtn");
    var html = "";
    pendingPhotos.forEach(function(ph, i){
      var takenBy = (typeof ph === "object" && ph.takenBy) ? ph.takenBy : "";
      html += '<div><div class="pf-photo-chip"><img src="' + photoUrl(ph) + '">' +
        '<button class="pf-rm" data-i="' + i + '" type="button">✕</button></div>' +
        (takenBy ? '<div class="pf-photo-caption">' + escapeHtml(takenBy) + '</div>' : '') + '</div>';
    });
    row.innerHTML = html;
    row.appendChild(addBtn);
    Array.prototype.forEach.call(row.querySelectorAll(".pf-rm"), function(btn){
      btn.onclick = async function(){
        pendingPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1);
        await updateDoc(doc(db, "people", id), { photos: pendingPhotos });
        renderPhotos();
      };
    });
  }

  async function addPhoto(dataUrl){
    var entry = { dataUrl: dataUrl, descriptor: null, takenBy: currentUserShortName(), addedAt: new Date().toISOString() };
    pendingPhotos.push(entry);
    await updateDoc(doc(db, "people", id), { photos: pendingPhotos });
    renderPhotos();
    // background face analysis, doesn't block UI
    try{
      var canvas = await dataUrlToCanvas(dataUrl);
      var descriptor = await computeDescriptor(canvas);
      if(descriptor){
        entry.descriptor = descriptor;
        await updateDoc(doc(db, "people", id), { photos: pendingPhotos });
      }
    }catch(e){ console.error("background face analysis failed", e); }
  }

  function wireUp(){
    document.getElementById("backToPeople").onclick = function(){ showPeople(); };

    document.getElementById("toggleEditBtn").onclick = function(){
      editMode = !editMode;
      render();
    };

    if(editMode){
      document.getElementById("saveProfileBtn").onclick = async function(){
        var errEl = document.getElementById("profileError");
        var name = document.getElementById("pfName").value.trim();
        var surname = document.getElementById("pfSurname").value.trim();
        var idNumber = document.getElementById("pfIdNumber").value.trim();
        if(!name || !surname){ errEl.textContent = "Name and Surname are required."; return; }

        this.disabled = true;
        this.textContent = "Checking…";
        var dup = await findDuplicateByIdNumber(idNumber, id);
        if(dup){
          errEl.innerHTML = 'Another person already has this ID Number: <strong>' + escapeHtml(fullName(dup)) + '</strong>.';
          this.disabled = false;
          this.textContent = "Save Changes";
          return;
        }

        var updates = {
          name: name, surname: surname, idNumber: idNumber,
          dob: document.getElementById("pfDob").value,
          aliases: document.getElementById("pfAliases").value.trim(),
          origin: document.getElementById("pfOrigin").value.trim(),
          residence: document.getElementById("pfResidence").value.trim()
        };
        try{
          await updateDoc(doc(db, "people", id), updates);
          Object.assign(p, updates);
          editMode = false;
          render();
        }catch(e){
          errEl.textContent = "Could not save — check your connection.";
          this.disabled = false;
          this.textContent = "Save Changes";
        }
      };

      document.getElementById("deletePersonBtn").onclick = async function(){
        if(!confirm("Delete " + fullName(p) + "? This can't be undone.")) return;
        try{
          await deleteDoc(doc(db, "people", id));
          showPeople();
        }catch(e){
          document.getElementById("profileError").textContent = "Could not delete — check your connection.";
        }
      };
    }

    renderPhotos();
    document.getElementById("pfAddPhotoBtn").onclick = function(){
      document.getElementById("pfPhotoFile").value = "";
      document.getElementById("pfPhotoFile").click();
    };
    document.getElementById("pfPhotoFile").onchange = async function(){
      var file = this.files[0];
      if(!file) return;
      var dataUrl = await fileToCompressedDataUrl(file, 480);
      addPhoto(dataUrl);
    };
    document.getElementById("pfImportFile").onchange = async function(){
      var files = Array.prototype.slice.call(this.files);
      for(var i = 0; i < files.length; i++){
        try{
          var dataUrl = await fileToCompressedDataUrl(files[i], 480);
          await addPhoto(dataUrl);
        }catch(e){ console.error(e); }
      }
    };

    Array.prototype.forEach.call(document.querySelectorAll(".pf-encounter-remove"), function(btn){
      btn.onclick = async function(){
        var i = parseInt(btn.getAttribute("data-i"), 10);
        if(!confirm("Remove this encounter?")) return;
        encounters.splice(i, 1);
        try{ await updateDoc(doc(db, "people", id), { encounters: encounters }); }catch(e){}
        document.getElementById("encounterList").innerHTML = renderEncounters();
        wireUp();
      };
    });

    document.getElementById("newEncounterBtn").onclick = function(){
      if(encounters.length >= MAX_ENCOUNTERS) return;
      openNewEncounterModal();
    };
  }

  function openNewEncounterModal(){
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop-custom";
    backdrop.innerHTML =
      '<div class="modal-card">' +
        '<h2>New Encounter</h2>' +
        '<label>Date</label><input type="date" id="encDate" value="' + new Date().toISOString().slice(0,10) + '">' +
        '<label>Location profiled</label>' +
        '<div style="display:flex;gap:8px;">' +
          '<input id="encLocation" style="flex:1;" placeholder="Where this took place">' +
          '<button class="btn-ghost" id="encGpsBtn" type="button" style="flex-shrink:0;padding:11px 14px;">📍</button>' +
        '</div>' +
        '<div class="modal-error" id="encGpsStatus" style="text-align:left;color:#888;"></div>' +
        '<label>Items found</label><textarea id="encItems"></textarea>' +
        '<label>Notes</label><textarea id="encNotes"></textarea>' +
        '<div class="modal-actions">' +
          '<button class="btn-ghost" id="encCancel">Cancel</button>' +
          '<button class="btn-primary" id="encSave">Save Encounter</button>' +
        '</div>' +
        '<div class="modal-error" id="encError"></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };
    document.getElementById("encCancel").onclick = function(){ backdrop.remove(); };

    var encCoords = null;
    document.getElementById("encGpsBtn").onclick = function(){
      var statusEl = document.getElementById("encGpsStatus");
      var input = document.getElementById("encLocation");
      if(!navigator.geolocation){ statusEl.textContent = "Location isn't available — enter it manually."; return; }
      statusEl.textContent = "Getting current location…";
      navigator.geolocation.getCurrentPosition(async function(pos){
        encCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        input.value = encCoords.lat.toFixed(6) + ", " + encCoords.lng.toFixed(6);
        statusEl.textContent = "Location captured — looking up address…";
        try{
          var url = "https://nominatim.openstreetmap.org/reverse?format=json&lat=" + encCoords.lat + "&lon=" + encCoords.lng + "&zoom=17&addressdetails=1";
          var res = await fetch(url, { headers: { "Accept": "application/json" } });
          var data = await res.json();
          var a = data.address || {};
          var label = [a.road || a.pedestrian || a.footway || "", a.neighbourhood || a.suburb || ""].filter(Boolean).join(", ");
          if(label){ input.value = label; statusEl.textContent = "Location captured."; }
          else{ statusEl.textContent = "No road/suburb found — coordinates saved instead."; }
        }catch(e){ statusEl.textContent = "Location captured, but address lookup failed."; }
      }, function(){
        statusEl.textContent = "Couldn't get location — enter it manually.";
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    };
    document.getElementById("encGpsBtn").click();

    document.getElementById("encSave").onclick = async function(){
      var newEnc = {
        date: document.getElementById("encDate").value,
        location: document.getElementById("encLocation").value.trim(),
        coords: encCoords,
        itemsFound: document.getElementById("encItems").value.trim(),
        notes: document.getElementById("encNotes").value.trim(),
        loggedBy: currentUserShortName()
      };
      this.disabled = true;
      this.textContent = "Saving…";
      try{
        encounters.push(newEnc);
        await updateDoc(doc(db, "people", id), { encounters: encounters });
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

  render();
}