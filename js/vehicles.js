import { db } from "./firebase.js";
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

var allVehicles = [];
var unsub = null;

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

export function renderVehicles(container){
  container.innerHTML =
    '<div class="vehicles-header">' +
      '<h1>Vehicle Database</h1>' +
      '<button id="addVehicleBtn" class="btn-primary"><i class="bi bi-plus-lg"></i> Add Vehicle</button>' +
    '</div>' +
    '<div class="vehicles-search">' +
      '<i class="bi bi-search"></i>' +
      '<input type="text" id="vehiclesSearchInput" placeholder="Search make, model, plate…">' +
    '</div>' +
    '<div id="vehiclesListArea"></div>';

  var listArea = document.getElementById("vehiclesListArea");

  document.getElementById("addVehicleBtn").onclick = function(){
    openVehicleForm(null);
  };

  document.getElementById("vehiclesSearchInput").oninput = function(){
    applyFilter(this.value, listArea);
  };

  if(unsub) unsub();
  unsub = onSnapshot(query(collection(db, "vehicles"), orderBy("addedAt", "asc")), function(snap){
    allVehicles = snap.docs.map(function(d){ var v = d.data(); v.id = d.id; return v; });
    applyFilter(document.getElementById("vehiclesSearchInput").value, listArea);
  });
}

function applyFilter(q, listArea){
  q = (q || "").trim().toLowerCase();
  var filtered = !q ? allVehicles : allVehicles.filter(function(r){
    return ((r.make||"")+" "+(r.model||"")+" "+(r.plate||"")).toLowerCase().indexOf(q) !== -1;
  });
  renderList(listArea, filtered);
}

function renderList(container, records){
  if(!records.length){
    container.innerHTML = '<div class="vehicles-empty">No records found.</div>';
    return;
  }

  var sorted = records.slice().sort(function(a, b){
    var an = ((a.make||"")+" "+(a.model||"")).trim();
    var bn = ((b.make||"")+" "+(b.model||"")).trim();
    return an.localeCompare(bn);
  });

  container.innerHTML = '<div class="people-grid">' + sorted.map(function(r){
    var thumb = r.photos && r.photos[0] ? r.photos[0] : null;
    var title = ((r.make||"")+" "+(r.model||"")).trim() || "Unknown vehicle";
    return '<div class="people-card" data-id="' + r.id + '">' +
      (thumb
        ? '<img class="people-card-thumb" src="' + thumb + '">'
        : '<div class="people-card-thumb-empty"><i class="bi bi-car-front"></i></div>') +
      '<div class="people-card-info">' +
        '<div class="people-card-name">' + escapeHtml(title) + '</div>' +
        '<div class="people-card-meta">' + escapeHtml(r.plate || "No plate on file") + '</div>' +
      '</div>' +
    '</div>';
  }).join("") + '</div>';

  Array.prototype.forEach.call(container.querySelectorAll(".people-card"), function(el){
    el.onclick = function(){
      var record = allVehicles.find(function(r){ return r.id === el.getAttribute("data-id"); });
      if(record) openVehicleForm(record);
    };
  });
}

function openVehicleForm(existing){
  var pendingPhotos = existing && existing.photos ? existing.photos.slice() : [];

  var backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop-custom";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h2>' + (existing ? "Edit Vehicle" : "Add Vehicle") + '</h2>' +
      '<label>Make</label>' +
      '<input type="text" id="vfMake" value="' + (existing ? escapeHtml(existing.make) : "") + '">' +
      '<label>Model</label>' +
      '<input type="text" id="vfModel" value="' + (existing ? escapeHtml(existing.model) : "") + '">' +
      '<label>Colour</label>' +
      '<input type="text" id="vfColor" value="' + (existing ? escapeHtml(existing.color) : "") + '">' +
      '<label>Registration / plate</label>' +
      '<input type="text" id="vfPlate" value="' + (existing ? escapeHtml(existing.plate) : "") + '">' +
      '<label>Owner / driver</label>' +
      '<input type="text" id="vfOwner" value="' + (existing ? escapeHtml(existing.owner) : "") + '">' +
      '<label>Notes</label>' +
      '<textarea id="vfNotes">' + (existing ? escapeHtml(existing.notes) : "") + '</textarea>' +
      '<label>Photos</label>' +
      '<div class="vf-photos-row" id="vfPhotosRow"><button class="vf-add-photo" id="vfAddPhotoBtn" type="button">＋</button></div>' +
      '<label class="vf-import-label" for="vfImportFile">🖼 Import from gallery</label>' +
      '<input type="file" id="vfPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
      '<input type="file" id="vfImportFile" accept="image/*" multiple style="display:none;">' +
      '<div class="modal-actions">' +
        '<button id="vfCancel" class="btn-ghost">Cancel</button>' +
        '<button id="vfSave" class="btn-primary">Save</button>' +
      '</div>' +
      '<div class="modal-error" id="vfError"></div>' +
    '</div>';

  document.body.appendChild(backdrop);

  var photosRow = document.getElementById("vfPhotosRow");
  var addPhotoBtn = document.getElementById("vfAddPhotoBtn");

  function renderPhotos(){
    var html = "";
    pendingPhotos.forEach(function(p, i){
      html += '<div class="vf-photo-chip"><img src="' + p + '"><button class="vf-rm" data-i="' + i + '" type="button">✕</button></div>';
    });
    photosRow.innerHTML = html;
    photosRow.appendChild(addPhotoBtn);
    Array.prototype.forEach.call(photosRow.querySelectorAll(".vf-rm"), function(btn){
      btn.onclick = function(){
        pendingPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1);
        renderPhotos();
      };
    });
  }
  renderPhotos();

  addPhotoBtn.onclick = function(){
    document.getElementById("vfPhotoFile").value = "";
    document.getElementById("vfPhotoFile").click();
  };
  document.getElementById("vfPhotoFile").onchange = async function(){
    var file = this.files[0];
    if(!file) return;
    var dataUrl = await fileToCompressedDataUrl(file, 480);
    pendingPhotos.push(dataUrl);
    renderPhotos();
  };
  document.getElementById("vfImportFile").onchange = async function(){
    var files = Array.prototype.slice.call(this.files);
    for(var i = 0; i < files.length; i++){
      try{
        var dataUrl = await fileToCompressedDataUrl(files[i], 480);
        pendingPhotos.push(dataUrl);
        renderPhotos();
      }catch(e){ console.error(e); }
    }
  };

  document.getElementById("vfCancel").onclick = function(){ backdrop.remove(); };
  backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };

  document.getElementById("vfSave").onclick = async function(){
    var make = document.getElementById("vfMake").value.trim();
    var model = document.getElementById("vfModel").value.trim();
    var plate = document.getElementById("vfPlate").value.trim();
    var errEl = document.getElementById("vfError");
    if(!make && !model && !plate){ errEl.textContent = "Enter at least a make, model, or plate."; return; }
    var fields = {
      make: make, model: model,
      color: document.getElementById("vfColor").value.trim(),
      plate: plate,
      owner: document.getElementById("vfOwner").value.trim(),
      notes: document.getElementById("vfNotes").value.trim(),
      photos: pendingPhotos
    };
    this.disabled = true;
    this.textContent = "Saving…";
    try{
      if(existing){
        await updateDoc(doc(db, "vehicles", existing.id), fields);
      } else {
        fields.addedAt = new Date().toISOString();
        await addDoc(collection(db, "vehicles"), fields);
      }
      backdrop.remove();
    }catch(e){
      errEl.textContent = "Could not save — check your connection.";
      this.disabled = false;
      this.textContent = "Save";
    }
  };
}