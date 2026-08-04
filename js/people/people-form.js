import { db } from "../firebase.js";
import { collection, addDoc, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}

export function openPersonForm(existing, onSaved){
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
      '<div class="modal-actions">' +
        '<button id="pfCancel" class="btn-ghost">Cancel</button>' +
        '<button id="pfSave" class="btn-primary">Save</button>' +
      '</div>' +
      '<div class="modal-error" id="pfError"></div>' +
    '</div>';

  document.body.appendChild(backdrop);

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
      details: document.getElementById("pfNotes").value.trim()
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