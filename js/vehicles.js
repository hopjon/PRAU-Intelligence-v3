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
  container.innerHTML = records.slice().reverse().map(function(r){
    var title = ((r.make||"")+" "+(r.model||"")).trim() || "Unknown vehicle";
    return '<div class="vehicles-row" data-id="' + r.id + '">' +
      '<div class="vehicles-row-name">' + escapeHtml(title) + '</div>' +
      '<div class="vehicles-row-meta">' + escapeHtml(r.plate || "No plate on file") + '</div>' +
    '</div>';
  }).join("");

  Array.prototype.forEach.call(container.querySelectorAll(".vehicles-row"), function(el){
    el.onclick = function(){
      var record = allVehicles.find(function(r){ return r.id === el.getAttribute("data-id"); });
      if(record) openVehicleForm(record);
    };
  });
}

function openVehicleForm(existing){
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
      '<div class="modal-actions">' +
        '<button id="vfCancel" class="btn-ghost">Cancel</button>' +
        '<button id="vfSave" class="btn-primary">Save</button>' +
      '</div>' +
      '<div class="modal-error" id="vfError"></div>' +
    '</div>';

  document.body.appendChild(backdrop);

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
      notes: document.getElementById("vfNotes").value.trim()
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