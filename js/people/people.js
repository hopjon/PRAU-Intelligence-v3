import { db, auth } from "../firebase.js";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc, getDoc, query, where
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ensureModelsLoaded, computeDescriptor, euclidean, photoUrl } from "../face.js";

ensureModelsLoaded();

var MAX_ENCOUNTERS = 6;
var FACE_MATCH_THRESHOLD = 0.6;

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
  snapshot.forEach(function(d){
    var data = d.data();
    if(!data.deleted) people.push(Object.assign({ id: d.id }, data));
  });

  document.getElementById("peopleSearchInput").oninput = function(){ renderList(this.value); };

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
        (p.deceased ? '<span class="deceased-tag">DECEASED</span>' : '') +
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

// ---------- duplicate ID check ----------
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

// ---------- duplicate face check ----------
async function findDuplicateFace(descriptor, excludeId, peopleList){
  if(!descriptor) return null;
  var best = null;
  var bestDist = Infinity;
  peopleList.forEach(function(data){
    if(data.id === excludeId) return;
    (data.photos || []).forEach(function(ph){
      var desc = (typeof ph === "object") ? ph.descriptor : null;
      if(!desc) return;
      var dist = euclidean(descriptor, desc);
      if(dist < bestDist){
        bestDist = dist;
        best = data;
      }
    });
  });
  if(best && bestDist < FACE_MATCH_THRESHOLD){
    return { record: best, distance: bestDist };
  }
  return null;
}

// ---------- add person (modal) ----------
function openAddPersonModal(){
  var pendingPhotos = [];

  var backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop-custom";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h2>Add Person</h2>' +
      '<label>Photos</label>' +
      '<div class="pf-photos-row" id="apPhotosRow"><button class="pf-add-photo" id="apAddPhotoBtn" type="button">＋</button></div>' +
      '<label class="pf-import-label" for="apImportFile">🖼 Import from gallery</label>' +
      '<input type="file" id="apPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
      '<input type="file" id="apImportFile" accept="image/*" multiple style="display:none;">' +
      '<label>Name</label><input id="apName">' +
      '<label>Surname</label><input id="apSurname">' +
      '<label>ID Number</label><input id="apIdNumber">' +
      '<label>Date of Birth</label><input type="date" id="apDob">' +
      '<label>Known Aliases</label><input id="apAliases">' +
      '<label>Originally From</label><input id="apOrigin">' +
      '<label>Current Residence</label><input id="apResidence">' +
      'Previous Arrests' +
'<textarea id="apPreviousArrests"></textarea>' +

'<label><i class="bi bi-geo-alt-fill"></i> Profiling Location</label>' +
'<div style="display:flex;gap:8px;">' +
    '<input id="apProfilingLocation" style="flex:1;" placeholder="Where was this person first profiled?">' +
    '<button class="btn-ghost" id="apGpsBtn" type="button">📍</button>' +
'</div>' +
'<div class="modal-error" id="apGpsStatus" style="text-align:left;color:#888;"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn-ghost" id="apCancel">Cancel</button>' +
        '<button class="btn-primary" id="apSave">Save</button>' +
      '</div>' +
      '<div class="modal-error" id="apError"></div>' +
    '</div>';
  document.body.appendChild(backdrop);
  backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };

  function renderApPhotos(){
    var row = document.getElementById("apPhotosRow");
    var addBtn = document.getElementById("apAddPhotoBtn");
    var html = "";
    pendingPhotos.forEach(function(ph, i){
      html += '<div class="pf-photo-chip"><img src="' + ph.dataUrl + '"><button class="pf-rm" data-i="' + i + '" type="button">✕</button></div>';
    });
    row.innerHTML = html;
    row.appendChild(addBtn);
    Array.prototype.forEach.call(row.querySelectorAll(".pf-rm"), function(btn){
      btn.onclick = function(){ pendingPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1); renderApPhotos(); };
    });
  }

  document.getElementById("apAddPhotoBtn").onclick = function(){
    document.getElementById("apPhotoFile").value = "";
    document.getElementById("apPhotoFile").click();
  };
  document.getElementById("apPhotoFile").onchange = async function(){
    var file = this.files[0];
    if(!file) return;
    var dataUrl = await fileToCompressedDataUrl(file, 480);
    var canvas = await dataUrlToCanvas(dataUrl);
    var descriptor = await computeDescriptor(canvas);
    pendingPhotos.push({ dataUrl: dataUrl, descriptor: descriptor, takenBy: currentUserShortName(), addedAt: new Date().toISOString() });
    renderApPhotos();
  };
  document.getElementById("apImportFile").onchange = async function(){
    var files = Array.prototype.slice.call(this.files);
    for(var i = 0; i < files.length; i++){
      try{
        var dataUrl = await fileToCompressedDataUrl(files[i], 480);
        var canvas = await dataUrlToCanvas(dataUrl);
        var descriptor = await computeDescriptor(canvas);
        pendingPhotos.push({ dataUrl: dataUrl, descriptor: descriptor, takenBy: currentUserShortName(), addedAt: new Date().toISOString() });
        renderApPhotos();
      }catch(e){ console.error(e); }
    }
  };

  document.getElementById("apGpsBtn").onclick = function () {

    const status = document.getElementById("apGpsStatus");

    status.textContent = "Getting location...";

    navigator.geolocation.getCurrentPosition(

        function (pos) {

            const lat = pos.coords.latitude.toFixed(6);
            const lng = pos.coords.longitude.toFixed(6);
            console.log(pos.coords);
alert(
`Latitude: ${lat}
Longitude: ${lng}
Accuracy: ${pos.coords.accuracy} metres`
);

            document.getElementById("apProfilingLocation").value = lat + ", " + lng;

            status.textContent = "GPS captured.";

        },

        function () {

            status.textContent = "Unable to get GPS location.";

        }

    );

};
  

  document.getElementById("apSave").onclick = async function(){
    var errEl = document.getElementById("apError");
    var name = document.getElementById("apName").value.trim();
    var surname = document.getElementById("apSurname").value.trim();
    var idNumber = document.getElementById("apIdNumber").value.trim();
    var previousArrests = document.getElementById("apPreviousArrests").value.trim();
var profilingLocation = document.getElementById("apProfilingLocation").value.trim();
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
  name: name,
  surname: surname,
  idNumber: idNumber,

  dob: document.getElementById("apDob").value,

  aliases: document.getElementById("apAliases").value.trim(),

  origin: document.getElementById("apOrigin").value.trim(),

  residence: document.getElementById("apResidence").value.trim(),

  previousArrests: previousArrests,

  profilingLocation: profilingLocation,

  deceased: false,

  encounters: [],

  photos: pendingPhotos,

  addedAt: new Date().toISOString(),

  addedBy: auth.currentUser ? auth.currentUser.email : "unknown"
};

    this.textContent = "Saving…";
    try{
      var ref = await addDoc(collection(db, "people"), Object.assign({}, person, {
        previousArrests: previousArrests,
        profilingLocation: profilingLocation
      }));
      backdrop.remove();
      renderPersonProfile(ref.id);
    }catch(e){
      errEl.textContent = "Could not save — check your connection.";
      this.disabled = false;
      this.textContent = "Save";
    }
  };
}

// ---------- merge duplicate profiles ----------
async function openMergeModal(currentPerson, currentId, onMerged){
  var backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop-custom";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h2>Merge With Another Record</h2>' +
      '<p style="color:#888;font-size:13px;">Search for the duplicate record. Its photos and encounters will be copied into <strong>' + escapeHtml(fullName(currentPerson)) + '</strong>, then it will be deleted.</p>' +
      '<label>Search by name</label>' +
      '<input id="mergeSearch" placeholder="Type a name…">' +
      '<div class="merge-search-results" id="mergeResults"></div>' +
      '<div class="modal-actions"><button class="btn-ghost" id="mergeCancel">Cancel</button></div>' +
      '<div class="modal-error" id="mergeError"></div>' +
    '</div>';
  document.body.appendChild(backdrop);
  backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };
  document.getElementById("mergeCancel").onclick = function(){ backdrop.remove(); };

  var snapshot = await getDocs(collection(db, "people"));
  var all = [];
  snapshot.forEach(function(d){ if(d.id !== currentId) all.push(Object.assign({ id: d.id }, d.data())); });

  document.getElementById("mergeSearch").oninput = function(){
    var q = this.value.trim().toLowerCase();
    var matches = !q ? [] : all.filter(function(p){ return fullName(p).toLowerCase().indexOf(q) !== -1; });
    document.getElementById("mergeResults").innerHTML = matches.map(function(p){
      return '<div class="merge-search-row" data-id="' + p.id + '">' + escapeHtml(fullName(p)) +
        ' <span style="color:#888;">(ID: ' + escapeHtml(p.idNumber || "none") + ')</span></div>';
    }).join("");
    Array.prototype.forEach.call(document.getElementById("mergeResults").querySelectorAll(".merge-search-row"), function(row){
      row.onclick = async function(){
        var otherId = row.getAttribute("data-id");
        if(!confirm("Merge this record into " + fullName(currentPerson) + "? The other record will be permanently deleted.")) return;
        try{
          var otherSnap = await getDoc(doc(db, "people", otherId));
          var other = otherSnap.data();
          var mergedPhotos = (currentPerson.photos || []).concat(other.photos || []);
          await updateDoc(doc(db, "people", currentId), { photos: mergedPhotos });

          var otherEncSnap = await getDocs(query(collection(db, "encounters"), where("personId", "==", otherId)));
          var reassignJobs = [];
          otherEncSnap.forEach(function(d){
            reassignJobs.push(updateDoc(doc(db, "encounters", d.id), { personId: currentId }));
          });
          await Promise.all(reassignJobs);

          await deleteDoc(doc(db, "people", otherId));
          backdrop.remove();
          onMerged();
        }catch(e){
          document.getElementById("mergeError").textContent = "Merge failed — check your connection.";
        }
      };
    });
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
  var encounters = [];
  var allPeopleCache = null;
  async function getAllPeopleCached(){
    if(!allPeopleCache){
      var snap0 = await getDocs(collection(db, "people"));
      allPeopleCache = [];
      snap0.forEach(function(d){ allPeopleCache.push(Object.assign({ id: d.id }, d.data())); });
    }
    return allPeopleCache;
  }

  async function loadEncounters(){
    var q = query(collection(db, "encounters"), where("personId", "==", id));
    var snap2 = await getDocs(q);
    encounters = [];
    snap2.forEach(function(d){ encounters.push(Object.assign({ id: d.id }, d.data())); });
    encounters.sort(function(a, b){ return (a.date || "").localeCompare(b.date || ""); });
  }

  function render(){
    content.innerHTML =
      '<div class="people-header">' +
        '<button class="btn-ghost" id="backToPeople">← Back</button>' +
        '<h1>' + escapeHtml(fullName(p)) + (p.deceased ? '<span class="deceased-badge">Deceased</span>' : '') + '</h1>' +
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
          field("Previous Arrests", "pfPreviousArrests", p.previousArrests, editMode, "textarea") +
          field("📍 Profiling Location", "pfProfilingLocation", p.profilingLocation, editMode) +
        '</div>' +
        (editMode ?
          '<div class="deceased-checkbox-row">' +
            '<input type="checkbox" id="pfDeceased"' + (p.deceased ? ' checked' : '') + '>' +
            '<label style="margin:0;">Mark as deceased</label>' +
          '</div>' +
          '<div class="profile-actions">' +
            '<button class="btn-primary" id="saveProfileBtn">Save Changes</button>' +
            '<button class="btn-ghost" id="mergeBtn">Merge With Another Record</button>' +
            '<button class="btn-ghost" id="deletePersonBtn" style="color:#ef5350;border-color:#ef5350;">Delete Person</button>' +
          '</div>' +
          '<div class="modal-error" id="profileError"></div>'
        : '') +

        '<hr>' +
        '<hr>' +

'<h3>Photos</h3>' +

'<div class="pf-photos-row" id="pfPhotosRow"></div>' +

(editMode ?

'<button class="pf-add-photo" id="pfAddPhotoBtn" type="button">＋ Add Photo</button>' +

'<label class="pf-import-label" for="pfImportFile">🖼 Import from Gallery</label>' +

'<input type="file" id="pfPhotoFile" accept="image/*" capture="environment" style="display:none;">' +

'<input type="file" id="pfImportFile" accept="image/*" multiple style="display:none;">'

: '') +

'<div id="faceWarningArea"></div>' +

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

    if(type === "textarea"){

        return '<div class="profile-field">' +
            '<label>' + label + '</label>' +
            '<textarea id="' + id + '"' +
            (editable ? '' : ' readonly') +
            '>' + escapeHtml(value || "") + '</textarea>' +
        '</div>';

    }

    return '<div class="profile-field">' +
        '<label>' + label + '</label>' +
        '<input type="' + (type || "text") + '" id="' + id + '"' +
        ' value="' + escapeHtml(value || "") + '"' +
        (editable ? '' : ' readonly') +
        '>' +
    '</div>';

}

  function renderEncounters(){
    if(!encounters.length) return '<div class="people-empty">No encounters recorded yet.</div>';
    return encounters.map(function(enc, i){
      var itemsPhotos = enc.itemsPhotos || [];
      return '<div class="pf-encounter">' +
        '<div class="pf-encounter-head"><span>Encounter ' + (i + 1) + ' — ' + escapeHtml(enc.date || "") + '</span>' +
        '<div style="display:flex;gap:8px;">' +

'<button class="pf-encounter-edit" data-i="' + i + '" type="button">✏ Edit</button>' +

'<button class="pf-encounter-remove" data-id="' + enc.id + '" type="button">Remove</button></div>' +

'</div>' +
        (enc.location ? '<div class="people-card-meta">📍 ' + escapeHtml(enc.location) + '</div>' : '') +
        (enc.itemsFound ? '<div class="people-card-meta">Items found: ' + escapeHtml(enc.itemsFound) + '</div>' : '') +
        (itemsPhotos.length ? '<div class="pf-photos-row" style="margin-top:8px;">' +
          itemsPhotos.map(function(ph){ return '<div class="pf-photo-chip"><img src="' + photoUrl(ph) + '"></div>'; }).join("") +
        '</div>' : '') +
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

        var takenBy = (typeof ph === "object" && ph.takenBy)
            ? ph.takenBy
            : "";

        html += '<div><div class="pf-photo-chip">' +

            '<img src="' + photoUrl(ph) + '">' +

            (editMode
                ? '<button class="pf-rm" data-i="' + i + '" type="button">✕</button>'
                : ''
            ) +

            '</div>' +

            (takenBy
                ? '<div class="pf-photo-caption">' + escapeHtml(takenBy) + '</div>'
                : ''
            ) +

            '</div>';

    });

    row.innerHTML = html;

    if(editMode && addBtn){

        row.appendChild(addBtn);

        Array.prototype.forEach.call(row.querySelectorAll(".pf-rm"), function(btn){

            btn.onclick = async function(){

                pendingPhotos.splice(parseInt(btn.getAttribute("data-i"),10),1);

                await updateDoc(doc(db,"people",id),{
                    photos: pendingPhotos
                });

                renderPhotos();

            };

        });

    }

}

  async function addPhoto(dataUrl){
    var entry = { dataUrl: dataUrl, descriptor: null, takenBy: currentUserShortName(), addedAt: new Date().toISOString() };
    pendingPhotos.push(entry);
    await updateDoc(doc(db, "people", id), { photos: pendingPhotos });
    renderPhotos();

    try{
      var canvas = await dataUrlToCanvas(dataUrl);
      var descriptor = await computeDescriptor(canvas);
      if(descriptor){
        entry.descriptor = descriptor;
        await updateDoc(doc(db, "people", id), { photos: pendingPhotos });

        var peopleList = await getAllPeopleCached();
        var dupFace = await findDuplicateFace(descriptor, id, peopleList);
        if(dupFace){
          var pct = Math.max(0, Math.round((1 - dupFace.distance) * 100));
          document.getElementById("faceWarningArea").innerHTML =
            '<div class="face-warning">⚠️ This photo closely resembles an existing record: <strong>' +
            escapeHtml(fullName(dupFace.record)) + '</strong> (' + pct + '% similarity). This might be a duplicate.<br>' +
            '<button class="btn-ghost" id="viewDupBtn" type="button">View that profile</button>' +
            '<button class="btn-ghost" id="mergeDupBtn" type="button" style="margin-left:8px;">Merge into this record</button>' +
            '</div>';
          document.getElementById("viewDupBtn").onclick = function(){ renderPersonProfile(dupFace.record.id); };
          document.getElementById("mergeDupBtn").onclick = async function(){
            if(!confirm("Merge " + fullName(dupFace.record) + " into " + fullName(p) + "? The other record will be permanently deleted.")) return;
            var mergedPhotos = pendingPhotos.concat(dupFace.record.photos || []);
            await updateDoc(doc(db, "people", id), { photos: mergedPhotos });

            var otherEncSnap2 = await getDocs(query(collection(db, "encounters"), where("personId", "==", dupFace.record.id)));
            var reassignJobs2 = [];
            otherEncSnap2.forEach(function(d){
              reassignJobs2.push(updateDoc(doc(db, "encounters", d.id), { personId: id }));
            });
            await Promise.all(reassignJobs2);

            await deleteDoc(doc(db, "people", dupFace.record.id));
            renderPersonProfile(id);
          };
        }
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
          residence: document.getElementById("pfResidence").value.trim(),
          previousArrests: document.getElementById("pfPreviousArrests").value.trim(),
          profilingLocation: document.getElementById("pfProfilingLocation").value.trim(),
          deceased: document.getElementById("pfDeceased").checked
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

      document.getElementById("mergeBtn").onclick = function(){
        openMergeModal(p, id, function(){ renderPersonProfile(id); });
      };

      document.getElementById("deletePersonBtn").onclick = async function(){
        var typed = prompt('Type the full name "' + fullName(p) + '" to confirm deletion.');
        if(typed === null) return;
        if(typed.trim().toLowerCase() !== fullName(p).trim().toLowerCase()){
          alert("Name didn't match — deletion cancelled.");
          return;
        }
        try{
          await updateDoc(doc(db, "people", id), {
            deleted: true,
            deletedAt: new Date().toISOString(),
            deletedBy: auth.currentUser ? auth.currentUser.email : "unknown"
          });
          showPeople();
        }catch(e){
          document.getElementById("profileError").textContent = "Could not delete — check your connection.";
        }
      };
    }

    renderPhotos();

if (editMode) {

    document.getElementById("pfAddPhotoBtn").onclick = function () {

        document.getElementById("pfPhotoFile").value = "";

        document.getElementById("pfPhotoFile").click();

    };

    document.getElementById("pfPhotoFile").onchange = async function () {

        var file = this.files[0];

        if (!file) return;

        var dataUrl = await fileToCompressedDataUrl(file, 480);

        addPhoto(dataUrl);

    };

    document.getElementById("pfImportFile").onchange = async function () {

        var files = Array.prototype.slice.call(this.files);

        for (var i = 0; i < files.length; i++) {

            try {

                var dataUrl = await fileToCompressedDataUrl(files[i], 480);

                await addPhoto(dataUrl);

            } catch (e) {

                console.error(e);

            }

        }

    };

}

    Array.prototype.forEach.call(document.querySelectorAll(".pf-encounter-remove"), function(btn){
      btn.onclick = async function(){
        var encId = btn.getAttribute("data-id");
        if(!confirm("Remove this encounter?")) return;
        try{ await deleteDoc(doc(db, "encounters", encId)); }catch(e){}
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

  function openNewEncounterModal(){
    var itemsPhotos = [];
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
        '<label>Photos of items found</label>' +
        '<div class="pf-photos-row" id="encItemsPhotosRow"><button class="pf-add-photo" id="encAddItemsPhotoBtn" type="button">＋</button></div>' +
        '<input type="file" id="encItemsPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
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

    var encCoords = null;
    document.getElementById("encGpsBtn").onclick = function(){
      var statusEl = document.getElementById("encGpsStatus");
      var input = document.getElementById("encLocation");
      if(!navigator.geolocation){
        statusEl.textContent = "Location isn't available — enter it manually.";
        return;
      }
      statusEl.textContent = "Getting current location…";
      navigator.geolocation.getCurrentPosition(
        function(position){
          encCoords = [position.coords.latitude, position.coords.longitude];
          input.value = "Lat " + position.coords.latitude.toFixed(5) + ", Lon " + position.coords.longitude.toFixed(5);
          statusEl.textContent = "Location found.";
        },
        function(){
          statusEl.textContent = "Could not determine location — enter it manually.";
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0
        }
      );
    };
    document.getElementById("encGpsBtn").click();

    document.getElementById("encSave").onclick = async function(){
      var newEnc = {
        personId: id,
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
        await addDoc(collection(db, "encounters"), newEnc);
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
      '<div class="modal-card">' +
        '<h2>Edit Encounter</h2>' +
        '<label>Date</label><input type="date" id="encDate" value="' + escapeHtml(existing.date || "") + '">' +
        '<label>Location profiled</label>' +
        '<div style="display:flex;gap:8px;">' +
          '<input id="encLocation" style="flex:1;" value="' + escapeHtml(existing.location || "") + '" placeholder="Where this took place">' +
          '<button class="btn-ghost" id="encGpsBtn" type="button" style="flex-shrink:0;padding:11px 14px;">📍</button>' +
        '</div>' +
        '<div class="modal-error" id="encGpsStatus" style="text-align:left;color:#888;"></div>' +
        '<label>Items found</label><textarea id="encItems">' + escapeHtml(existing.itemsFound || "") + '</textarea>' +
        '<label>Photos of items found</label>' +
        '<div class="pf-photos-row" id="encItemsPhotosRow"><button class="pf-add-photo" id="encAddItemsPhotoBtn" type="button">＋</button></div>' +
        '<input type="file" id="encItemsPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
        '<label>Notes</label><textarea id="encNotes">' + escapeHtml(existing.notes || "") + '</textarea>' +
        '<div class="modal-actions">' +
          '<button class="btn-ghost" id="encCancel">Cancel</button>' +
          '<button class="btn-primary" id="encSave">Save Changes</button>' +
        '</div>' +
        '<div class="modal-error" id="encError"></div>' +
      '</div>';
    document.body.appendChild(backdrop);
    backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };
    document.getElementById("encCancel").onclick = function(){ backdrop.remove(); };

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
      if(!navigator.geolocation){
        statusEl.textContent = "Location isn't available — enter it manually.";
        return;
      }
      statusEl.textContent = "Getting current location…";
      navigator.geolocation.getCurrentPosition(
        function(position){
          encCoords = [position.coords.latitude, position.coords.longitude];
          input.value = "Lat " + position.coords.latitude.toFixed(5) + ", Lon " + position.coords.longitude.toFixed(5);
          statusEl.textContent = "Location found.";
        },
        function(){
          statusEl.textContent = "Could not determine location — enter it manually.";
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    };

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
        await updateDoc(doc(db, "encounters", existing.id), updates);
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