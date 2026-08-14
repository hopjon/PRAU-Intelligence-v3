import { db, auth } from "../firebase.js";
import {
  collection, getDocs, addDoc, updateDoc, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ensureModelsLoaded, computeDescriptorWhenReady, photoUrl, photoDescriptor, matchThreshold, euclidean } from "../face.js";
import { getDisplayName } from "../userDisplay.js";
import { profilingLocationViewHTML, profilingLocationEditHTML, wireProfilingLocationView, wireProfilingLocationEditor, profilingLocationPatch } from "../profilingLocation.js";
import { PEOPLE_TAG_GROUPS, tagsViewHTML, tagsEditHTML, wireTagsEditor, tagsPatch } from "../tags.js";

ensureModelsLoaded();

// ---------- helpers ----------
function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
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
function isPlaceholderLabel(s){
  var norm = (s || "").trim().toLowerCase();
  return !norm || norm === "unlabeled" || /^unknown( (male|female))?$/.test(norm);
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
      '<label>Notes</label><textarea id="auNotes" placeholder="Any details worth recording"></textarea>' +
      profilingLocationEditHTML("auPl", null) +
      tagsEditHTML("auTags", [], PEOPLE_TAG_GROUPS) +
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
    var result = await computeDescriptorWhenReady(canvas);
    if(!result.engineReady){
      document.getElementById("auError").textContent = "Face-matching engine unavailable — this photo was saved without face data.";
    }
    pendingPhotos.push({ dataUrl: dataUrl, descriptorV2: result.descriptor, takenBy: (auth.currentUser && auth.currentUser.email) || "", addedAt: new Date().toISOString() });
    renderAuPhotos();
  };
  document.getElementById("auImportFile").onchange = async function(){
    var files = Array.prototype.slice.call(this.files);
    var engineWarned = false;
    for(var i = 0; i < files.length; i++){
      try{
        var dataUrl = await fileToCompressedDataUrl(files[i], 480);
        var canvas = await dataUrlToCanvas(dataUrl);
        var result = await computeDescriptorWhenReady(canvas);
        if(!result.engineReady && !engineWarned){
          document.getElementById("auError").textContent = "Face-matching engine unavailable — these photos were saved without face data.";
          engineWarned = true;
        }
        pendingPhotos.push({ dataUrl: dataUrl, descriptorV2: result.descriptor, takenBy: (auth.currentUser && auth.currentUser.email) || "", addedAt: new Date().toISOString() });
        renderAuPhotos();
      }catch(e){ console.error(e); }
    }
  };

  var auPlEditor = wireProfilingLocationEditor("auPl", null);
  var auTagsEditor = wireTagsEditor("auTags", [], PEOPLE_TAG_GROUPS);

  document.getElementById("auSave").onclick = async function(){
    var errEl = document.getElementById("auError");

    var record = Object.assign({
      label: document.getElementById("auLabel").value.trim(),
      notes: document.getElementById("auNotes").value.trim(),
      photos: pendingPhotos,
      loggedBy: (auth.currentUser && auth.currentUser.email) || "unknown",
      dateProfiled: new Date().toISOString().slice(0, 10),
      addedAt: new Date().toISOString(),
      deleted: false
    }, profilingLocationPatch(auPlEditor.getState()), tagsPatch(auTagsEditor.getState()));

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
  var ufPlEditor = null;
  var ufTagsEditor = null;

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
          field("Notes", "ufNotes", u.notes, editMode, "textarea", "Any details worth recording") +
          field("Date Profiled", "ufDateProfiled", u.dateProfiled || "Not recorded", false) +
        '</div>' +
        (editMode ? profilingLocationEditHTML("ufPl", u) : profilingLocationViewHTML("ufPl", u)) +
        (editMode ? tagsEditHTML("ufTags", u.tags || [], PEOPLE_TAG_GROUPS) : tagsViewHTML("ufTags", u.tags || [], PEOPLE_TAG_GROUPS)) +
        '<div class="people-card-meta">Logged by ' + escapeHtml(getDisplayName(u.loggedBy)) + '</div>' +
        (u.promotedTo ? '<div class="people-card-meta">Promoted to <span class="linked-person-view" id="viewPromotedBtn" style="cursor:pointer;">Person profile</span></div>' : '') +
        (editMode ?
          '<div class="profile-actions">' +
            '<button class="btn-primary" id="saveProfileBtn">Save Changes</button>' +
            (u.promotedTo ? '' : '<button class="btn-ghost" id="createProfileBtn">Create Profile</button>') +
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

        ((u.photos && u.photos.length) ?
          '<hr>' +
          '<h3>Possible Matches</h3>' +
          '<button class="btn-ghost" id="findMatchesBtn" type="button"><i class="bi bi-person-bounding-box"></i> Find Possible Matches</button>' +
          '<div id="matchResultsArea"></div>'
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
        '</div>' + (takenBy ? '<div class="pf-photo-caption">' + escapeHtml(getDisplayName(takenBy)) + '</div>' : '') + '</div>';
    });
    row.innerHTML = html;
    if(editMode && addBtn){
      row.appendChild(addBtn);
      Array.prototype.forEach.call(row.querySelectorAll(".pf-rm"), function(btn){
        btn.onclick = async function(){
          pendingPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1);
          u.photos = pendingPhotos;
          await updateDoc(doc(db, "unidentifiedPeople", id), { photos: pendingPhotos });
          renderPhotos();
        };
      });
    }
  }

  async function addPhoto(dataUrl){
    var canvas = await dataUrlToCanvas(dataUrl);
    var result = await computeDescriptorWhenReady(canvas);
    var entry = { dataUrl: dataUrl, descriptorV2: result.descriptor, takenBy: (auth.currentUser && auth.currentUser.email) || "", addedAt: new Date().toISOString() };
    pendingPhotos.push(entry);
    u.photos = pendingPhotos;
    await updateDoc(doc(db, "unidentifiedPeople", id), { photos: pendingPhotos });
    renderPhotos();
    if(!result.engineReady){
      var errEl = document.getElementById("profileError");
      if(errEl) errEl.textContent = "Face-matching engine unavailable — this photo was saved without face data.";
    }
  }

  async function findPossibleMatches(){
    var resultsEl = document.getElementById("matchResultsArea");
    resultsEl.innerHTML = '<div class="people-empty">Analyzing…</div>';

    var uDescriptors = (u.photos || []).map(photoDescriptor).filter(Boolean);
    if(!uDescriptors.length){
      resultsEl.innerHTML = '<div class="people-empty">This record\'s photo(s) have no matchable face data yet.</div>';
      return;
    }

    var peopleSnap = await getDocs(collection(db, "people"));
    var scored = [];
    peopleSnap.forEach(function(d){
      var data = d.data();
      if(data.deleted) return;
      var person = Object.assign({ id: d.id }, data);
      var best = null;
      (person.photos || []).forEach(function(ph){
        var desc = photoDescriptor(ph);
        if(!desc) return;
        var threshold = matchThreshold(ph);
        uDescriptors.forEach(function(uDesc){
          var dist = euclidean(uDesc, desc);
          var sim = 1 - dist / threshold; // normalized similarity, comparable across descriptor versions with differing thresholds
          if(!best || sim > best.sim){
            best = { dist: dist, threshold: threshold, sim: sim, photoUrl: photoUrl(ph) };
          }
        });
      });
      if(best) scored.push({ person: person, dist: best.dist, threshold: best.threshold, sim: best.sim, photoUrl: best.photoUrl });
    });

    scored.sort(function(a, b){ return b.sim - a.sim; });
    var top = scored.filter(function(s){ return s.sim > 0; }).slice(0, 5);

    if(!top.length){
      resultsEl.innerHTML = '<div class="people-empty">No People records have matchable face data yet.</div>';
      return;
    }

    resultsEl.innerHTML = top.map(function(t, i){
      var pct = Math.max(0, Math.round(t.sim * 100));
      var label = t.dist < t.threshold ? "Likely match" : "Possible match";
      var fullName = ((t.person.name || "") + " " + (t.person.surname || "")).trim() || "Unnamed Person";
      return '<div class="people-row" data-mi="' + i + '">' +
        '<img class="people-row-thumb" src="' + t.photoUrl + '">' +
        '<div><div class="people-row-name">' + escapeHtml(fullName) + '</div>' +
        '<div class="people-row-meta">' + label + ' · ' + pct + '% similarity</div></div>' +
        '<button class="btn-ghost" data-open-i="' + i + '" type="button">Open Profile</button>' +
      '</div>';
    }).join("");

    Array.prototype.forEach.call(resultsEl.querySelectorAll("[data-open-i]"), function(btn){
      btn.onclick = function(){
        var t = top[parseInt(btn.getAttribute("data-open-i"), 10)];
        if(t && window.__openPersonProfile) window.__openPersonProfile(t.person.id);
      };
    });
  }

  async function promoteToPerson(){
    var errEl = document.getElementById("profileError");
    var name = (u.label || "").trim();
    if(isPlaceholderLabel(name)){
      errEl.textContent = "Enter the person's real name in the Reference Label field before creating a profile.";
      return;
    }
    if(!window.__openAddPersonModal){
      errEl.textContent = "Person creation isn't available right now.";
      return;
    }

    var normalizedName = name.toLowerCase().replace(/\s+/g, " ");
    try{
      var peopleSnap = await getDocs(collection(db, "people"));
      var likelyMatch = false;
      peopleSnap.forEach(function(d){
        var data = d.data();
        if(data.deleted) return;
        var fn = ((data.name || "") + " " + (data.surname || "")).trim().toLowerCase().replace(/\s+/g, " ");
        if(fn === normalizedName) likelyMatch = true;
      });
      if(likelyMatch && !confirm('A person named "' + name + '" already exists. Continue creating a new profile anyway?')) return;
    }catch(e){ /* if the lookup itself fails, don't block promotion */ }

    if(!confirm('Create a full Person profile for "' + name + '" and remove this unidentified record?')) return;

    var promotionPrefill = { name: name, notes: u.notes || "", photos: (u.photos || []).slice() };
    if(typeof u.profilingLatitude === "number" && typeof u.profilingLongitude === "number"){
      promotionPrefill.profilingLatitude = u.profilingLatitude;
      promotionPrefill.profilingLongitude = u.profilingLongitude;
      promotionPrefill.profilingAddress = u.profilingAddress || "";
      promotionPrefill.profilingRoad = u.profilingRoad || "";
      promotionPrefill.profilingSuburb = u.profilingSuburb || "";
    }
    if(u.dateProfiled) promotionPrefill.dateProfiled = u.dateProfiled;
    if(u.tags && u.tags.length) promotionPrefill.tags = u.tags.slice();

    window.__openAddPersonModal(promotionPrefill, async function(newPerson){
      try{
        await updateDoc(doc(db, "unidentifiedPeople", id), {
          deleted: true,
          deletedAt: new Date().toISOString(),
          deletedBy: auth.currentUser ? auth.currentUser.email : "unknown",
          promotedTo: newPerson.id
        });
        renderUnidentifiedPeople(container, backToPeople);
      }catch(e){
        alert('The profile for "' + name + '" was created, but this unidentified record could not be updated — you can find and remove it manually.');
        renderUnidentifiedPeople(container, backToPeople);
      }
    });
  }

  function wireUp(){
    document.getElementById("backToUnidList").onclick = function(){ renderUnidentifiedPeople(container, backToPeople); };

    if(document.getElementById("viewPromotedBtn")){
      document.getElementById("viewPromotedBtn").onclick = function(){
        if(u.promotedTo && window.__openPersonProfile) window.__openPersonProfile(u.promotedTo);
      };
    }

    if(document.getElementById("findMatchesBtn")){
      document.getElementById("findMatchesBtn").onclick = function(){ findPossibleMatches(); };
    }

    document.getElementById("toggleEditBtn").onclick = function(){
      editMode = !editMode;
      render();
    };

    if(editMode){
      ufPlEditor = wireProfilingLocationEditor("ufPl", u);
      ufTagsEditor = wireTagsEditor("ufTags", u.tags || [], PEOPLE_TAG_GROUPS);
    }else{
      ufPlEditor = null;
      ufTagsEditor = null;
      wireProfilingLocationView("ufPl", u);
    }

    if(editMode){
      document.getElementById("saveProfileBtn").onclick = async function(){
        var errEl = document.getElementById("profileError");
        var updates = Object.assign({
          label: document.getElementById("ufLabel").value.trim(),
          notes: document.getElementById("ufNotes").value.trim()
        }, profilingLocationPatch(ufPlEditor && ufPlEditor.getState()), tagsPatch(ufTagsEditor && ufTagsEditor.getState()));
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

      if(document.getElementById("createProfileBtn")){
        document.getElementById("createProfileBtn").onclick = function(){ promoteToPerson(); };
      }

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
