import { db } from "../firebase.js";
import { collection, addDoc, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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

export function openPersonForm(existing, onSaved){
  var pendingPhotos = existing && existing.photos ? existing.photos.slice() : [];

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
      '<label>Previous arrest info</label>' +
      '<textarea id="pfArrest">' + (existing ? escapeHtml(existing.arrestInfo) : "") + '</textarea>' +
      '<label>Items found</label>' +
      '<textarea id="pfItems">' + (existing ? escapeHtml(existing.itemsFound) : "") + '</textarea>' +
      '<label>Notes</label>' +
      '<textarea id="pfNotes">' + (existing ? escapeHtml(existing.details) : "") + '</textarea>' +
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

  var photosRow = document.getElementById("pfPhotosRow");
  var addPhotoBtn = document.getElementById("pfAddPhotoBtn");

  function renderPhotos(){
    var html = "";
    pendingPhotos.forEach(function(p, i){
      html += '<div class="pf-photo-chip"><img src="' + p + '"><button class="pf-rm" data-i="' + i + '" type="button">✕</button></div>';
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

  addPhotoBtn.onclick = function(){
    document.getElementById("pfPhotoFile").value = "";
    document.getElementById("pfPhotoFile").click();
  };
  document.getElementById("pfPhotoFile").onchange = async function(){
    var file = this.files[0];
    if(!file) return;
    var dataUrl = await fileToCompressedDataUrl(file, 480);
    pendingPhotos.push(dataUrl);
    renderPhotos();
  };
  document.getElementById("pfImportFile").onchange = async function(){
    var files = Array.prototype.slice.call(this.files);
    for(var i = 0; i < files.length; i++){
      try{
        var dataUrl = await fileToCompressedDataUrl(files[i], 480);
        pendingPhotos.push(dataUrl);
        renderPhotos();
      }catch(e){ console.error(e); }
    }
  };

  document.getElementById("pfCancel").onclick = function(){ backdrop.remove(); };
  backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };

  document.getElementById("pfSave").onclick = async function(){
    var name = document.getElementById("pfName").value.trim();
    var errEl = document.getElementById("pfError");
    if(!name){ errEl.textContent = "Enter a name."; return; }
    var fields = {
      name: name,
      dob: document.getElementById("pfDob").value.trim(),
      origin: document.getElementById("pfOrigin").value.trim(),
      address: document.getElementById("pfAddress").value.trim(),
      arrestInfo: document.getElementById("pfArrest").value.trim(),
      itemsFound: document.getElementById("pfItems").value.trim(),
      details: document.getElementById("pfNotes").value.trim(),
      photos: pendingPhotos
    };
    this.disabled = true;
    this.textContent = "Saving…";
    try{
      if(existing){
        await updateDoc(doc(db, "suspects", existing.id), fields);
      } else {
        fields.addedAt = new Date().toISOString();
        await addDoc(collection(db, "suspects"), fields);
      }
      backdrop.remove();
      if(onSaved) onSaved();
    }catch(e){
      errEl.textContent = "Could not save — check your connection.";
      this.disabled = false;
      this.textContent = "Save";
    }
  };
}