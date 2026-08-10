import { db, auth } from "../firebase.js";
import {
  collection, getDocs, addDoc, updateDoc, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ensureModelsLoaded, computeDescriptor, photoUrl } from "../face.js";

ensureModelsLoaded();

// ---------- helpers ----------
function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function currentUserShortName(){
  return (auth.currentUser && auth.currentUser.email) ? auth.currentUser.email.split("@")[0] : "unknown";
}
function isDocTooLargeError(e){
  return e && e.code === "invalid-argument" && /longer than \d+ bytes/i.test(e.message || "");
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
function recordLabel(u){
  return u.label && u.label.trim() ? u.label.trim() : "Unlabeled";
}

// ---------- list ----------
export async function renderUnidentifiedPeople(container, backToPeople){
  container.innerHTML =
    '<div class="people-header">' +
      '<button class="btn-ghost" id="backToPeopleFromUnid">← Back</button>' +
      '<h1><i class="bi bi-question-circle-fill"></i> Unidentified People</h1>' +
      '<button class="btn-primary" id="addUnidBtn"><i class="bi bi-plus-circle-fill"></i> Add</button>' +
    '</div>' +
    '<div class="people-search" style="max-width:400px;margin:0 auto 16px;"><i class="bi bi-search"></i><input type="text" id="unidSearchInput" placeholder="Search label or notes…" style="width:100%;"></div>' +
    '<div id="unidListArea">Loading…</div>';

  document.getElementById("backToPeopleFromUnid").onclick = function(){ backToPeople(); };
  document.getElementById("addUnidBtn").onclick = function(){ openAddUnidentifiedModal(container, backToPeople); };

  var snapshot = await getDocs(collection(db, "unidentifiedPeople"));
  var records = [];
  snapshot.forEach(function(d){
    var data = d.data();
    if(!data.deleted) records.push(Object.assign({ id: d.id }, data));
  });

  document.getElementById("unidSearchInput").oninput = function(){ renderList(this.value); };

  function renderList(q){
    q = (q || "").trim().toLowerCase();
    var filtered = !q ? records : records.filter(function(u){
      return (recordLabel(u) + " " + (u.notes || "")).toLowerCase().indexOf(q) !== -1;
    });
    filtered.sort(function(a, b){ return (b.addedAt || "").localeCompare(a.addedAt || ""); });

    var listArea = document.getElementById("unidListArea");
    if(!filtered.length){
      listArea.innerHTML = '<div class="people-empty">No unidentified people recorded yet.</div>';
      return;
    }
    listArea.innerHTML = '<div class="people-grid">' + filtered.map(function(u){
      var thumb = u.photos && u.photos[0] ? photoUrl(u.photos[0]) : null;
      return '<div class="people-card" data-id="' + u.id + '">' +
        (thumb ? '<img class="people-card-thumb" src="' + thumb + '">' :
          '<div class="people-card-thumb-empty"><i class="bi bi-question-circle"></i></div>') +
        '<div class="people-card-info">' +
          '<div class="people-card-name">' + escapeHtml(recordLabel(u)) + '</div>' +
          '<div class="people-card-meta">' + (u.photos ? u.photos.length : 0) + ' photo' + ((u.photos && u.photos.length === 1) ? "" : "s") + '</div>' +
        '</div>' +
      '</div>';
    }).join("") + '</div>';

    Array.prototype.forEach.call(listArea.querySelectorAll(".people-card"), function(el){
      el.onclick = function(){ renderUnidentifiedProfile(container, el.getAttribute("data-id"), backToPeople); };
    });
  }

  renderList("");
}

// ---------- add (modal) ----------
function openAddUnidentifiedModal(container, backToPeople){
  var pendingPhotos = [];

  var backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop-custom";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h2>Add Unidentified Person</h2>' +
      '<label>Photos</label>' +
      '<div class="pf-photos-row" id="auPhotosRow"><button class="pf-add-photo" id="auAddPhotoBtn" type="button" title="Take Photo"><i class="bi bi-camera-fill"></i></button></div>' +
      '<label class="pf-import-label" for="auImportFile"><i class="bi bi-images"></i>Import from gallery</label>' +
      '<input type="file" id="auPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
      '<input type="file" id="auImportFile" accept="image/*" multiple style="display:none;">' +
      '<label>Reference Label (optional)</label><input id="auLabel" placeholder="e.g. Unknown Person 001">' +
      '<label>Location (optional)</label><input id="auLocation" placeholder="e.g. Corner of Main and Voortrekker">' +
      '<label>Notes</label><textarea id="auNotes" placeholder="Any details worth recording"></textarea>' +
      '<div class="modal-actions">' +
        '<button class="btn-ghost" id="auCancel">Cancel</button>' +
        '<button class="btn-primary" id="auSave">Save</button>' +
      '</div>' +
      '<div class="modal-error" id="auError"></div>' +
    '</div>';
  document.body.appendChild(backdrop);
  backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };
  document.getElementById("auCancel").onclick = function(){ backdrop.remove(); };

  function renderAuPhotos(){
    var row = document.getElementById("auPhotosRow");
    var addBtn = document.getElementById("auAddPhotoBtn");
    var html = "";
    pendingPhotos.forEach(function(ph, i){
      html += '<div class="pf-photo-chip"><img src="' + ph.dataUrl + '"><button class="pf-rm" data-i="' + i + '" type="button">✕</button></div>';
    });
    row.innerHTML = html;
    row.appendChild(addBtn);
    Array.prototype.forEach.call(row.querySelectorAll(".pf-rm"), function(btn){
      btn.onclick = function(){ pendingPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1); renderAuPhotos(); };
    });
  }

  document.getElementById("auAddPhotoBtn").onclick = function(){
    document.getElementById("auPhotoFile").value = "";
    document.getElementById("auPhotoFile").click();
  };
  document.getElementById("auPhotoFile").onchange = async function(){
    var file = this.files[0];
    if(!file) return;
    var dataUrl = await fileToCompressedDataUrl(file, 480);
    var canvas = await dataUrlToCanvas(dataUrl);
    var descriptor = await computeDescriptor(canvas);
    pendingPhotos.push({ dataUrl: dataUrl, descriptorV2: descriptor, takenBy: currentUserShortName(), addedAt: new Date().toISOString() });
    renderAuPhotos();
  };
  document.getElementById("auImportFile").onchange = async function(){
    var files = Array.prototype.slice.call(this.files);
    for(var i = 0; i < files.length; i++){
      try{
        var dataUrl = await fileToCompressedDataUrl(files[i], 480);
        var canvas = await dataUrlToCanvas(dataUrl);
        var descriptor = await computeDescriptor(canvas);
        pendingPhotos.push({ dataUrl: dataUrl, descriptorV2: descriptor, takenBy: currentUserShortName(), addedAt: new Date().toISOString() });
        renderAuPhotos();
      }catch(e){ console.error(e); }
    }
  };

  document.getElementById("auSave").onclick = async function(){
    var errEl = document.getElementById("auError");

    var record = {
      label: document.getElementById("auLabel").value.trim(),
      location: document.getElementById("auLocation").value.trim(),
      notes: document.getElementById("auNotes").value.trim(),
      photos: pendingPhotos,
      loggedBy: currentUserShortName(),
      addedAt: new Date().toISOString(),
      deleted: false
    };

    this.disabled = true;
    this.textContent = "Saving…";
    try{
      var ref = await addDoc(collection(db, "unidentifiedPeople"), record);
      backdrop.remove();
      renderUnidentifiedProfile(container, ref.id, backToPeople);
    }catch(e){
      console.error("Unidentified Person save failed:", e && e.code, e && e.message, e);
      errEl.textContent = isDocTooLargeError(e)
        ? "This record's photos are too large to save. Remove a photo and try again."
        : "Could not save — check your connection. (" + ((e && e.code) || (e && e.message) || "unknown error") + ")";
      this.disabled = false;
      this.textContent = "Save";
    }
  };
}

// ---------- profile ----------
async function renderUnidentifiedProfile(container, id, backToPeople){
  container.innerHTML = '<div class="people-empty">Loading…</div>';

  var snap = await getDoc(doc(db, "unidentifiedPeople", id));
  if(!snap.exists()){ container.innerHTML = '<div class="people-empty">Record not found.</div>'; return; }

  var u = Object.assign({ id: id }, snap.data());
  var editMode = false;
  var pendingPhotos = u.photos ? u.photos.slice() : [];

  function render(){
    container.innerHTML =
      '<div class="people-header">' +
        '<button class="btn-ghost" id="backToUnidList">← Back</button>' +
        '<h1>' + escapeHtml(recordLabel(u)) + '</h1>' +
        '<button class="btn-ghost" id="toggleEditBtn">' + (editMode ? "Cancel Edit" : "Edit") + '</button>' +
      '</div>' +
      '<div class="modal-card profile-view">' +
        '<div class="profile-field-group">' +
          field("Reference Label", "ufLabel", u.label, editMode, null, "e.g. Unknown Person 001") +
          field("Location", "ufLocation", u.location, editMode, null, "e.g. Corner of Main and Voortrekker") +
          field("Notes", "ufNotes", u.notes, editMode, "textarea", "Any details worth recording") +
        '</div>' +
        '<div class="people-card-meta">Logged by ' + escapeHtml(u.loggedBy || "unknown") + '</div>' +
        (editMode ?
          '<div class="profile-actions">' +
            '<button class="btn-primary" id="saveProfileBtn">Save Changes</button>' +
            '<button class="btn-ghost" id="deleteUnidBtn" style="color:#ef5350;border-color:#ef5350;">Delete Record</button>' +
          '</div>' +
          '<div class="modal-error" id="profileError"></div>'
        : '') +

        '<hr>' +
        '<h3>Photos</h3>' +
        '<div class="pf-photos-row" id="ufPhotosRow"></div>' +
        (editMode ?
          '<button class="pf-take-photo-btn" id="ufAddPhotoBtn" type="button"><i class="bi bi-camera-fill"></i>Take Photo</button>' +
          '<label class="pf-import-label" for="ufImportFile"><i class="bi bi-images"></i>Import from Gallery</label>' +
          '<input type="file" id="ufPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
          '<input type="file" id="ufImportFile" accept="image/*" multiple style="display:none;">'
        : '') +
      '</div>';

    wireUp();
  }

  function field(label, id, value, editable, type, placeholder){
    var ph = placeholder ? ' placeholder="' + escapeHtml(placeholder) + '"' : '';
    if(type === "textarea"){
      return '<div class="profile-field" style="grid-column:1 / -1;"><label>' + label + '</label>' +
        '<textarea id="' + id + '"' + ph + (editable ? '' : ' readonly') + '>' + escapeHtml(value || "") + '</textarea></div>';
    }
    return '<div class="profile-field"><label>' + label + '</label>' +
      '<input type="text" id="' + id + '" value="' + escapeHtml(value || "") + '"' + ph + (editable ? '' : ' readonly') + '></div>';
  }

  function renderPhotos(){
    var row = document.getElementById("ufPhotosRow");
    var addBtn = document.getElementById("ufAddPhotoBtn");
    var html = "";
    pendingPhotos.forEach(function(ph, i){
      var takenBy = (typeof ph === "object" && ph.takenBy) ? ph.takenBy : "";
      html += '<div><div class="pf-photo-chip"><img src="' + photoUrl(ph) + '">' +
        (editMode ? '<button class="pf-rm" data-i="' + i + '" type="button">✕</button>' : '') +
        '</div>' + (takenBy ? '<div class="pf-photo-caption">' + escapeHtml(takenBy) + '</div>' : '') + '</div>';
    });
    row.innerHTML = html;
    if(editMode && addBtn){
      row.appendChild(addBtn);
      Array.prototype.forEach.call(row.querySelectorAll(".pf-rm"), function(btn){
        btn.onclick = async function(){
          pendingPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1);
          await updateDoc(doc(db, "unidentifiedPeople", id), { photos: pendingPhotos });
          renderPhotos();
        };
      });
    }
  }

  async function addPhoto(dataUrl){
    var canvas = await dataUrlToCanvas(dataUrl);
    var descriptor = await computeDescriptor(canvas);
    var entry = { dataUrl: dataUrl, descriptorV2: descriptor, takenBy: currentUserShortName(), addedAt: new Date().toISOString() };
    pendingPhotos.push(entry);
    await updateDoc(doc(db, "unidentifiedPeople", id), { photos: pendingPhotos });
    renderPhotos();
  }

  function wireUp(){
    document.getElementById("backToUnidList").onclick = function(){ renderUnidentifiedPeople(container, backToPeople); };

    document.getElementById("toggleEditBtn").onclick = function(){
      editMode = !editMode;
      render();
    };

    if(editMode){
      document.getElementById("saveProfileBtn").onclick = async function(){
        var errEl = document.getElementById("profileError");
        var updates = {
          label: document.getElementById("ufLabel").value.trim(),
          location: document.getElementById("ufLocation").value.trim(),
          notes: document.getElementById("ufNotes").value.trim()
        };
        this.disabled = true;
        this.textContent = "Saving…";
        try{
          await updateDoc(doc(db, "unidentifiedPeople", id), updates);
          Object.assign(u, updates);
          editMode = false;
          render();
        }catch(e){
          errEl.textContent = isDocTooLargeError(e)
            ? "This record's photos are too large to save. Remove a photo and try again."
            : "Could not save — check your connection.";
          this.disabled = false;
          this.textContent = "Save Changes";
        }
      };

      document.getElementById("deleteUnidBtn").onclick = async function(){
        if(!confirm('Delete "' + recordLabel(u) + '"? This can be undone by a database admin, but not from here.')) return;
        try{
          await updateDoc(doc(db, "unidentifiedPeople", id), {
            deleted: true,
            deletedAt: new Date().toISOString(),
            deletedBy: auth.currentUser ? auth.currentUser.email : "unknown"
          });
          renderUnidentifiedPeople(container, backToPeople);
        }catch(e){
          document.getElementById("profileError").textContent = "Could not delete — check your connection.";
        }
      };
    }

    renderPhotos();
    if(editMode){
      document.getElementById("ufAddPhotoBtn").onclick = function(){
        document.getElementById("ufPhotoFile").value = "";
        document.getElementById("ufPhotoFile").click();
      };
      document.getElementById("ufPhotoFile").onchange = async function(){
        var file = this.files[0];
        if(!file) return;
        var dataUrl = await fileToCompressedDataUrl(file, 480);
        addPhoto(dataUrl);
      };
      document.getElementById("ufImportFile").onchange = async function(){
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
