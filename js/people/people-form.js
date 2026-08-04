import { db, auth } from "../firebase.js";
import { collection, addDoc, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ensureModelsLoaded, computeDescriptor, photoUrl } from "../face.js";

ensureModelsLoaded();

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
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

var MAX_ENCOUNTERS = 6;

function blankEncounter(){
  return {
    date: new Date().toISOString().slice(0, 10),
    location: "",
    coords: null,
    notes: "",
    itemsFound: ""
  };
}

export function openPersonForm(existing, onSaved){
  var pendingPhotos = existing && existing.photos ? existing.photos.slice() : [];

  var encounters;
  if(existing && existing.encounters && existing.encounters.length){
    encounters = existing.encounters.slice();
  } else if(existing && (existing.arrestInfo || existing.itemsFound || existing.profileLoc || existing.details)){
    // migrate old single-block records into one encounter so nothing is lost
    encounters = [{
      date: existing.addedAt ? existing.addedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
      location: existing.profileLoc || "",
      coords: existing.profileCoords || null,
      notes: [existing.arrestInfo, existing.details].filter(Boolean).join("\n"),
      itemsFound: existing.itemsFound || ""
    }];
  } else {
    encounters = [blankEncounter()];
  }

  var backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop-custom";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h2>' + (existing ? "Edit Person" : "Add Person") + '</h2>' +
      '<label>Name and surname</label>' +
      '<input type="text" id="pfName" value="' + (existing ? escapeHtml(existing.name) : "") + '">' +
      '<label>Date of birth / ID number</label>' +
      '<input type="text" id="pfDob" value="' + (existing ? escapeHtml(existing.dob) : "") + '">' +
      '<label>Birth origin</label>' +
      '<input type="text" id="pfOrigin" value="' + (existing ? escapeHtml(existing.origin) : "") + '">' +
      '<label>Current address</label>' +
      '<input type="text" id="pfAddress" value="' + (existing ? escapeHtml(existing.address) : "") + '">' +
      '<label>Profiling Encounters</label>' +
      '<div id="pfEncountersContainer"></div>' +
      '<button class="pf-add-encounter" id="pfAddEncounterBtn" type="button">+ Add another encounter</button>' +
      '<label>Photos</label>' +
      '<div class="pf-photos-row" id="pfPhotosRow"><button class="pf-add-photo" id="pfAddPhotoBtn" type="button">＋</button></div>' +
      '<label class="pf-import-label" for="pfImportFile">🖼 Import from gallery</label>' +
      '<input type="file" id="pfPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
      '<input type="file" id="pfImportFile" accept="image/*" multiple style="display:none;">' +
      '<div class="modal-actions">' +
        '<button id="pfCancel" class="btn-ghost">Cancel</button>' +
        '<button id="pfSave" class="btn-primary">Save</button>' +
      '</div>' +
      '<div class="modal-error" id="pfError"></div>' +
    '</div>';

  document.body.appendChild(backdrop);

  // ---------- encounters ----------
  var encContainer = document.getElementById("pfEncountersContainer");
  var addEncBtn = document.getElementById("pfAddEncounterBtn");

  function renderEncounters(){
    encContainer.innerHTML = encounters.map(function(enc, i){
      return '<div class="pf-encounter" data-index="' + i + '">' +
        '<div class="pf-encounter-head"><span>Encounter ' + (i + 1) + '</span>' +
        (encounters.length > 1 ? '<button class="pf-encounter-remove" data-i="' + i + '" type="button">Remove</button>' : '') +
        '</div>' +
        '<label>Date</label>' +
        '<input type="date" class="pf-enc-date" data-i="' + i + '" value="' + escapeHtml(enc.date) + '">' +
        '<label>Location profiled</label>' +
        '<div style="display:flex;gap:8px;">' +
          '<input type="text" class="pf-enc-loc" data-i="' + i + '" style="flex:1;" value="' + escapeHtml(enc.location) + '" placeholder="Where this took place">' +
          '<button class="btn-ghost pf-enc-gps" data-i="' + i + '" type="button" style="flex-shrink:0;padding:11px 14px;">📍</button>' +
        '</div>' +
        '<div class="modal-error pf-enc-gps-status" data-i="' + i + '" style="text-align:left;margin-top:4px;color:#888;"></div>' +
        '<label>Items found</label>' +
        '<textarea class="pf-enc-items" data-i="' + i + '">' + escapeHtml(enc.itemsFound) + '</textarea>' +
        '<label>Notes</label>' +
        '<textarea class="pf-enc-notes" data-i="' + i + '">' + escapeHtml(enc.notes) + '</textarea>' +
      '</div>';
    }).join("");

    // wire up field changes back into the encounters array
    Array.prototype.forEach.call(encContainer.querySelectorAll(".pf-enc-date"), function(el){
      el.onchange = function(){ encounters[+el.getAttribute("data-i")].date = el.value; };
    });
    Array.prototype.forEach.call(encContainer.querySelectorAll(".pf-enc-loc"), function(el){
      el.onchange = function(){ encounters[+el.getAttribute("data-i")].location = el.value; };
    });
    Array.prototype.forEach.call(encContainer.querySelectorAll(".pf-enc-items"), function(el){
      el.onchange = function(){ encounters[+el.getAttribute("data-i")].itemsFound = el.value; };
    });
    Array.prototype.forEach.call(encContainer.querySelectorAll(".pf-enc-notes"), function(el){
      el.onchange = function(){ encounters[+el.getAttribute("data-i")].notes = el.value; };
    });
    Array.prototype.forEach.call(encContainer.querySelectorAll(".pf-encounter-remove"), function(el){
      el.onclick = function(){
        encounters.splice(+el.getAttribute("data-i"), 1);
        renderEncounters();
      };
    });
    Array.prototype.forEach.call(encContainer.querySelectorAll(".pf-enc-gps"), function(el){
      el.onclick = function(){
        var i = +el.getAttribute("data-i");
        var locInput = encContainer.querySelector('.pf-enc-loc[data-i="' + i + '"]');
        var statusEl = encContainer.querySelector('.pf-enc-gps-status[data-i="' + i + '"]');
        if(!navigator.geolocation){ statusEl.textContent = "Location isn't available — enter it manually."; return; }
        statusEl.textContent = "Getting current location…";
        navigator.geolocation.getCurrentPosition(async function(pos){
          var coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          encounters[i].coords = coords;
          locInput.value = coords.lat.toFixed(6) + ", " + coords.lng.toFixed(6);
          encounters[i].location = locInput.value;
          statusEl.textContent = "Location captured — looking up address…";
          try{
            var url = "https://nominatim.openstreetmap.org/reverse?format=json&lat=" + coords.lat + "&lon=" + coords.lng + "&zoom=17&addressdetails=1";
            var res = await fetch(url, { headers: { "Accept": "application/json" } });
            var data = await res.json();
            var a = data.address || {};
            var label = [a.road || a.pedestrian || a.footway || "", a.neighbourhood || a.suburb || ""].filter(Boolean).join(", ");
            if(label){ locInput.value = label; encounters[i].location = label; statusEl.textContent = "Location captured."; }
            else{ statusEl.textContent = "No road/suburb found — coordinates saved instead."; }
          }catch(e){ statusEl.textContent = "Location captured, but the address lookup failed."; }
        }, function(){
          statusEl.textContent = "Couldn't get location — enter it manually.";
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      };
    });

    addEncBtn.disabled = encounters.length >= MAX_ENCOUNTERS;
    addEncBtn.textContent = encounters.length >= MAX_ENCOUNTERS
      ? "Maximum of 6 encounters reached"
      : "+ Add another encounter (" + encounters.length + "/" + MAX_ENCOUNTERS + ")";
  }
  renderEncounters();

  addEncBtn.onclick = function(){
    if(encounters.length >= MAX_ENCOUNTERS) return;
    encounters.push(blankEncounter());
    renderEncounters();
    if(!existing){
      // auto-fire GPS for the newly added encounter, same convenience as before
      var lastBtn = encContainer.querySelector('.pf-enc-gps[data-i="' + (encounters.length - 1) + '"]');
      if(lastBtn) lastBtn.click();
    }
  };

  if(!existing){
    var firstGpsBtn = encContainer.querySelector('.pf-enc-gps[data-i="0"]');
    if(firstGpsBtn) firstGpsBtn.click();
  }

  // ---------- photos ----------
  var photosRow = document.getElementById("pfPhotosRow");
  var addPhotoBtn = document.getElementById("pfAddPhotoBtn");

  function renderPhotos(){
    var html = "";
    pendingPhotos.forEach(function(p, i){
      var takenBy = (typeof p === "object" && p.takenBy) ? p.takenBy : "";
      html += '<div>' +
        '<div class="pf-photo-chip"><img src="' + photoUrl(p) + '"><button class="pf-rm" data-i="' + i + '" type="button">✕</button></div>' +
        (takenBy ? '<div class="pf-photo-caption">' + escapeHtml(takenBy) + '</div>' : '') +
      '</div>';
    });
    photosRow.innerHTML = html;
    photosRow.appendChild(addPhotoBtn);
    Array.prototype.forEach.call(photosRow.querySelectorAll(".pf-rm"), function(btn){
      btn.onclick = function(){
        pendingPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1);
        renderPhotos();
      };
    });
  }
  renderPhotos();

  function addPhoto(dataUrl){
    var takenBy = (auth.currentUser && auth.currentUser.email) ? auth.currentUser.email.split("@")[0] : "unknown";
    pendingPhotos.push({ dataUrl: dataUrl, descriptor: null, takenBy: takenBy, addedAt: new Date().toISOString() });
    renderPhotos();
  }

  addPhotoBtn.onclick = function(){
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
        addPhoto(dataUrl);
      }catch(e){ console.error(e); }
    }
  };

  document.getElementById("pfCancel").onclick = function(){ backdrop.remove(); };
  backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };

  // background face-analysis, runs after save so it never blocks the UI
  async function analyzePhotosInBackground(docId, photosSnapshot){
    var changed = false;
    for(var i = 0; i < photosSnapshot.length; i++){
      if(!photosSnapshot[i].descriptor){
        try{
          var canvas = await dataUrlToCanvas(photosSnapshot[i].dataUrl);
          var descriptor = await computeDescriptor(canvas);
          if(descriptor){ photosSnapshot[i].descriptor = descriptor; changed = true; }
        }catch(e){ console.error("background face analysis failed", e); }
      }
    }
    if(changed){
      try{ await updateDoc(doc(db, "suspects", docId), { photos: photosSnapshot }); }
      catch(e){ console.error("could not save background analysis", e); }
    }
  }

  document.getElementById("pfSave").onclick = async function(){
    var name = document.getElementById("pfName").value.trim();
    var errEl = document.getElementById("pfError");
    if(!name){ errEl.textContent = "Enter a name."; return; }
    var fields = {
      name: name,
      dob: document.getElementById("pfDob").value.trim(),
      origin: document.getElementById("pfOrigin").value.trim(),
      address: document.getElementById("pfAddress").value.trim(),
      encounters: encounters,
      photos: pendingPhotos
    };
    this.disabled = true;
    this.textContent = "Saving…";
    try{
      var docId;
      if(existing){
        await updateDoc(doc(db, "suspects", existing.id), fields);
        docId = existing.id;
      } else {
        fields.addedAt = new Date().toISOString();
        fields.addedBy = auth.currentUser ? auth.currentUser.email : "unknown";
        var ref = await addDoc(collection(db, "suspects"), fields);
        docId = ref.id;
      }
      backdrop.remove();
      if(onSaved) onSaved();
      analyzePhotosInBackground(docId, pendingPhotos.slice());
    }catch(e){
      errEl.textContent = "Could not save — check your connection.";
      this.disabled = false;
      this.textContent = "Save";
    }
  };
}