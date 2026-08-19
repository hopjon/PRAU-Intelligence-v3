import { db, auth } from "../firebase.js";
import {
  collection, getDocs, addDoc, setDoc, updateDoc, deleteDoc, doc, getDoc, getDocFromCache, query, where
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ensureModelsLoaded, computeDescriptorWhenReady, euclidean, photoUrl } from "../face.js";
import { reassignVehicleLinks } from "../vehicles.js";
import { renderUnidentifiedPeople } from "./unidentified.js";
import { markPending, clearPending, isPending, showSyncToast, writeLocalFirst } from "../pendingWrites.js";
import { getDisplayName } from "../userDisplay.js";
import { profilingLocationViewHTML, profilingLocationEditHTML, wireProfilingLocationView, wireProfilingLocationEditor, profilingLocationPatch } from "../profilingLocation.js";
import { PEOPLE_TAG_GROUPS, tagsViewHTML, tagsEditHTML, wireTagsEditor, tagsPatch } from "../tags.js";
import { backToDashboardHTML, wireBackToDashboard } from "../backButton.js";

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
function isDocTooLargeError(e){
  return e && e.code === "invalid-argument" && /longer than \d+ bytes/i.test(e.message || "");
}
function fileToCompressedDataUrl(file, maxDim, quality){
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
        resolve(canvas.toDataURL("image/jpeg", quality || 0.7));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Connection-mode detection, used by the cache-first profile photo loading
// below. Capture/compression is NOT connection-dependent — every photo is
// always compressed the same way (see fileToCompressedDataUrl call sites,
// all fixed at maxDim 480, default quality) regardless of connection type,
// so the database always receives the same standard quality photo. This
// function only informs READ/DISPLAY decisions.
function detectConnectionMode(){
  if(!navigator.onLine) return "OFFLINE-UNKNOWN";
  var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if(!c) return "HIGH"; // Network Information API unavailable — default to normal behaviour
  var isCellular = (typeof c.type === "string" && c.type === "cellular") ||
    (typeof c.effectiveType === "string" && /^(slow-2g|2g|3g)$/.test(c.effectiveType));
  // NOTE: effectiveType is a throughput/RTT estimate, not a reliable proxy for
  // "on a cellular radio" — a slow/throttled Wi-Fi connection can also report
  // 2g/3g here. This is a known limitation of the Network Information API.
  return isCellular ? "CELLULAR" : "HIGH";
}
var viewerImages = [];
var viewerIndex = 0;
var viewerScale = 1;
var viewerPanX = 0, viewerPanY = 0;
var viewerTouchState = null;

function applyViewerTransform(){
  var img = document.getElementById("imageViewerImg");
  if(img) img.style.transform = "translate(" + viewerPanX + "px," + viewerPanY + "px) scale(" + viewerScale + ")";
}
function showViewerImage(){
  var img = document.getElementById("imageViewerImg");
  var counter = document.getElementById("imageViewerCounter");
  if(!img || !viewerImages.length) return;
  viewerScale = 1; viewerPanX = 0; viewerPanY = 0;
  applyViewerTransform();
  img.src = viewerImages[viewerIndex];
  if(counter) counter.textContent = (viewerIndex + 1) + " / " + viewerImages.length;
  var prevBtn = document.getElementById("imageViewerPrev");
  var nextBtn = document.getElementById("imageViewerNext");
  if(prevBtn) prevBtn.style.display = viewerImages.length > 1 ? "block" : "none";
  if(nextBtn) nextBtn.style.display = viewerImages.length > 1 ? "block" : "none";
}
function openImageViewer(images, startIndex){
  var viewer = document.getElementById("imageViewer");
  if(!viewer){ console.error("Image viewer elements are missing from index.html"); return; }
  viewerImages = images;
  viewerIndex = startIndex || 0;
  viewer.style.display = "flex";
  showViewerImage();
}
window.__openImageViewer = openImageViewer;
function closeImageViewer(){
  var viewer = document.getElementById("imageViewer");
  if(viewer) viewer.style.display = "none";
}
function viewerNext(){ if(!viewerImages.length) return; viewerIndex = (viewerIndex + 1) % viewerImages.length; showViewerImage(); }
function viewerPrev(){ if(!viewerImages.length) return; viewerIndex = (viewerIndex - 1 + viewerImages.length) % viewerImages.length; showViewerImage(); }

(function setupViewerControls(){
  var closeBtn = document.getElementById("imageViewerClose");
  var nextBtn = document.getElementById("imageViewerNext");
  var prevBtn = document.getElementById("imageViewerPrev");
  var viewer = document.getElementById("imageViewer");
  var stage = document.getElementById("imageViewerStage");
  if(!viewer || !stage) return;

  if(closeBtn) closeBtn.onclick = closeImageViewer;
  if(nextBtn) nextBtn.onclick = function(e){ e.stopPropagation(); viewerNext(); };
  if(prevBtn) prevBtn.onclick = function(e){ e.stopPropagation(); viewerPrev(); };
  viewer.onclick = function(e){ if(e.target === viewer) closeImageViewer(); };

  var touchStartX = 0, touchStartTime = 0;

  stage.addEventListener("touchstart", function(e){
    if(e.touches.length === 2){
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      viewerTouchState = { mode: "pinch", startDist: Math.sqrt(dx*dx+dy*dy), startScale: viewerScale };
    } else if(e.touches.length === 1){
      touchStartX = e.touches[0].clientX;
      touchStartTime = Date.now();
      viewerTouchState = viewerScale > 1
        ? { mode: "pan", startX: e.touches[0].clientX, startY: e.touches[0].clientY, startPanX: viewerPanX, startPanY: viewerPanY }
        : { mode: "swipe" };
    }
  }, { passive: true });

  stage.addEventListener("touchmove", function(e){
    if(!viewerTouchState) return;
    if(viewerTouchState.mode === "pinch" && e.touches.length === 2){
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.sqrt(dx*dx+dy*dy);
      viewerScale = Math.max(1, Math.min(4, viewerTouchState.startScale * (dist / viewerTouchState.startDist)));
      applyViewerTransform();
    } else if(viewerTouchState.mode === "pan" && e.touches.length === 1){
      viewerPanX = viewerTouchState.startPanX + (e.touches[0].clientX - viewerTouchState.startX);
      viewerPanY = viewerTouchState.startPanY + (e.touches[0].clientY - viewerTouchState.startY);
      applyViewerTransform();
    }
  }, { passive: true });

  stage.addEventListener("touchend", function(e){
    if(viewerTouchState && viewerTouchState.mode === "swipe"){
      var touchEndX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : touchStartX;
      var dx = touchEndX - touchStartX;
      if(Date.now() - touchStartTime < 600 && Math.abs(dx) > 50){
        if(dx < 0) viewerNext(); else viewerPrev();
      }
    }
    if(viewerScale <= 1.02){ viewerScale = 1; viewerPanX = 0; viewerPanY = 0; applyViewerTransform(); }
    viewerTouchState = null;
  }, { passive: true });

  stage.addEventListener("dblclick", function(){
    viewerScale = viewerScale > 1 ? 1 : 2;
    viewerPanX = 0; viewerPanY = 0;
    applyViewerTransform();
  });
})();
function getBestLocation(statusEl, onResult, timeoutMs){
  timeoutMs = timeoutMs || 8000;
  if(!navigator.geolocation){
    statusEl.textContent = "Location isn't available on this device.";
    return;
  }
  var best = null;
  var watchId = null;
  var finished = false;

  function finish(){
    if(finished) return;
    finished = true;
    if(watchId !== null) navigator.geolocation.clearWatch(watchId);
    if(best){ onResult(best); }
    else{ statusEl.textContent = "Couldn't get a location fix — enter it manually."; }
  }

  statusEl.textContent = "Getting current location…";
  watchId = navigator.geolocation.watchPosition(function(pos){
    if(!best || pos.coords.accuracy < best.coords.accuracy){
      best = pos;
      statusEl.textContent = "Refining location… (±" + Math.round(pos.coords.accuracy) + "m so far)";
    }
    if(pos.coords.accuracy <= 15){ finish(); }
  }, function(){
    if(!best) statusEl.textContent = "Couldn't get location — enter it manually.";
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs });

  setTimeout(finish, timeoutMs);
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
window.__openPersonProfile = function(id){ renderPersonProfile(id); };
window.__openAddPersonModal = function(prefill, onCreated){ openAddPersonModal(prefill, onCreated); };

export async function showPeople(){
  var content = document.getElementById("contentArea");
  content.innerHTML =
    '<div class="people-header">' +
      backToDashboardHTML() +
      '<h1><i class="bi bi-person-fill"></i> People Database</h1>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn-ghost" id="unidentifiedPeopleBtn"><i class="bi bi-question-circle-fill"></i> Unidentified People</button>' +
        '<button class="btn-primary" id="addPersonBtn"><i class="bi bi-plus-circle-fill"></i> Add</button>' +
      '</div>' +
    '</div>' +
    '<div class="people-search" style="max-width:400px;margin:0 auto 16px;"><i class="bi bi-search"></i><input type="text" id="peopleSearchInput" placeholder="Search people…" style="width:100%;"></div>' +
    '<div id="peopleListArea">Loading…</div>';

  wireBackToDashboard();
  document.getElementById("addPersonBtn").onclick = function(){ openAddPersonModal(); };
  document.getElementById("unidentifiedPeopleBtn").onclick = function(){
    renderUnidentifiedPeople(content, function(){ showPeople(); });
  };

  var snapshot = await getDocs(collection(db, "people"));
  var people = [];
  snapshot.forEach(function(d){
    var data = d.data();
    if(!data.deleted) people.push(Object.assign({ id: d.id }, data));
  });

  document.getElementById("peopleSearchInput").oninput = function(){ renderList(this.value); };

  // TEMP POC — mobile-data thumbnail test only. Not persisted, not saved, no
  // schema change. Detects a likely-cellular connection and, only for the
  // People list thumbnails, swaps the existing full 480px photo for a
  // smaller client-side-regenerated copy of that same data. Safe no-op if
  // navigator.connection isn't available.
  function isLikelyCellular(){
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if(!c) return false;
    if(typeof c.type === "string") return c.type === "cellular";
    if(typeof c.effectiveType === "string") return /^(slow-2g|2g|3g)$/.test(c.effectiveType);
    return false;
  }
  function shrinkDataUrlPoc(dataUrl, maxDim, quality){
    return new Promise(function(resolve){
      var img = new Image();
      img.onload = function(){
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
        var canvas = document.createElement("canvas");
        canvas.width = cw; canvas.height = ch;
        canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = function(){ resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

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
        '</div>' +
      '</div>';
    }).join("") + '</div>';

    Array.prototype.forEach.call(listArea.querySelectorAll(".people-card"), function(el){
      el.onclick = function(){
        var id = el.getAttribute("data-id");
        console.log("Opening person:", id);
        renderPersonProfile(id);
      };
    });

    // TEMP POC — see isLikelyCellular()/shrinkDataUrlPoc() above.
    if(isLikelyCellular()){
      Array.prototype.forEach.call(listArea.querySelectorAll(".people-card-thumb"), function(imgEl){
        var full = imgEl.getAttribute("src");
        shrinkDataUrlPoc(full, 110, 0.55).then(function(small){ imgEl.src = small; });
      });
    }
  }

  renderList("");
}

// Bounds any single Firestore getDocs()/getDoc() call so it can never wait
// indefinitely offline — same 15s pattern used by dashboardHome.js/search.js.
var FIRESTORE_READ_TIMEOUT_MS = 15000;
function withReadTimeout(promise){
  return new Promise(function(resolve, reject){
    var settled = false;
    var timeoutId = setTimeout(function(){
      if(settled) return;
      settled = true;
      reject(new Error("Firestore read timed out"));
    }, FIRESTORE_READ_TIMEOUT_MS);
    promise.then(function(v){
      clearTimeout(timeoutId);
      if(settled) return;
      settled = true;
      resolve(v);
    }, function(e){
      clearTimeout(timeoutId);
      if(settled) return;
      settled = true;
      reject(e);
    });
  });
}

// ---------- duplicate ID check ----------
async function findDuplicateByIdNumber(idNumber, excludeId){
  if(!idNumber) return null;
  var snapshot = await withReadTimeout(getDocs(collection(db, "people")));
  var match = null;
  snapshot.forEach(function(d){
    if(d.id === excludeId) return;
    var data = d.data();
    if(data.deleted) return;
    if(data.idNumber && data.idNumber.trim().toLowerCase() === idNumber.trim().toLowerCase()){
      match = Object.assign({ id: d.id }, data);
    }
  });
  return match;
}

// ---------- duplicate face check ----------
// PATH B: Check both old descriptor (Human.js) and new descriptorV2 (face-api)
async function findDuplicateFace(descriptor, excludeId, peopleList){
  if(!descriptor) return null;
  var best = null;
  var bestDist = Infinity;
  peopleList.forEach(function(data){
    if(data.id === excludeId) return;
    (data.photos || []).forEach(function(ph){
      var desc = null;
      if(typeof ph === "object"){
        // PATH B: Prefer new face-api descriptor, fallback to old Human.js descriptor
        if(ph.descriptorV2) desc = ph.descriptorV2;
        else if(ph.descriptor) desc = ph.descriptor;
      }
      if(!desc) return;
      // PATH B: Use appropriate threshold based on descriptor type
      var threshold = (ph.descriptorV2) ? 0.6 : 1.0;
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
function openAddPersonModal(prefill, onCreated){
  var pendingPhotos = (prefill && prefill.photos) ? prefill.photos.slice() : [];
  var prefillLoc = (prefill && typeof prefill.profilingLatitude === "number" && typeof prefill.profilingLongitude === "number")
    ? {
        profilingLatitude: prefill.profilingLatitude,
        profilingLongitude: prefill.profilingLongitude,
        profilingAddress: prefill.profilingAddress || "",
        profilingRoad: prefill.profilingRoad || "",
        profilingSuburb: prefill.profilingSuburb || ""
      }
    : null;

  var backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop-custom";
  backdrop.innerHTML =
    '<div class="modal-card">' +
      '<h2>Add Person</h2>' +
      '<label>Photos</label>' +
      '<div class="pf-photos-row" id="apPhotosRow"><button class="pf-add-photo" id="apAddPhotoBtn" type="button" title="Take Photo"><i class="bi bi-camera-fill"></i></button></div>' +
      '<label class="pf-import-label" for="apImportFile"><i class="bi bi-images"></i>Import from gallery</label>' +
      '<input type="file" id="apPhotoFile" accept="image/*" capture="environment" style="display:none;">' +
      '<input type="file" id="apImportFile" accept="image/*" multiple style="display:none;">' +
      '<label>Name and Surname</label><input id="apName" placeholder="e.g. John Doe" value="' + escapeHtml(prefill && prefill.name ? prefill.name : "") + '">' +
      '<label>ID Number</label><input id="apIdNumber" placeholder="e.g. 9001015800086">' +
      '<label>Date of Birth</label><input type="text" id="apDob" placeholder="DD/MM/YYYY">' +
      '<label>Known Alias</label><input id="apAliases" placeholder="e.g. Skhokho">' +
      '<label>Originally From</label><input id="apOrigin" placeholder="e.g. Gugulethu">' +
      '<label>Current Residence</label><input id="apResidence" placeholder="e.g. 12 Main Road, Khayelitsha">' +
      '<label>Previous Arrests</label>' +
      '<textarea id="apPreviousArrests" placeholder="e.g. Shoplifting, March 2024"></textarea>' +
      '<label>Notes</label>' +
      '<textarea id="apNotes" placeholder="Any other details worth recording">' + escapeHtml(prefill && prefill.notes ? prefill.notes : "") + '</textarea>' +
      profilingLocationEditHTML("apPl", prefillLoc) +
      tagsEditHTML("apTags", (prefill && prefill.tags) || [], PEOPLE_TAG_GROUPS) +
      '<div class="modal-actions">' +
        '<button class="btn-ghost" id="apCancel">Cancel</button>' +
        '<button class="btn-primary" id="apSave">Save</button>' +
      '</div>' +
      '<div class="modal-error" id="apError"></div>' +
    '</div>';
  document.body.appendChild(backdrop);
  backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };
  document.getElementById("apCancel").onclick = function(){ backdrop.remove(); };

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
  renderApPhotos();

  document.getElementById("apAddPhotoBtn").onclick = function(){
    document.getElementById("apPhotoFile").value = "";
    document.getElementById("apPhotoFile").click();
  };
  document.getElementById("apPhotoFile").onchange = async function(){
    var file = this.files[0];
    if(!file) return;
    var dataUrl = await fileToCompressedDataUrl(file, 480);
    var canvas = await dataUrlToCanvas(dataUrl);
    var result = await computeDescriptorWhenReady(canvas);
    if(!result.engineReady){
      document.getElementById("apError").textContent = "Face-matching engine unavailable — this photo was saved without face data.";
    }
    // PATH B: Save new face-api descriptor to descriptorV2, keep old descriptor field empty
    pendingPhotos.push({ dataUrl: dataUrl, descriptorV2: result.descriptor, takenBy: (auth.currentUser && auth.currentUser.email) || "", addedAt: new Date().toISOString() });
    renderApPhotos();
  };
  document.getElementById("apImportFile").onchange = async function(){
    var files = Array.prototype.slice.call(this.files);
    var engineWarned = false;
    for(var i = 0; i < files.length; i++){
      try{
        var dataUrl = await fileToCompressedDataUrl(files[i], 480);
        var canvas = await dataUrlToCanvas(dataUrl);
        var result = await computeDescriptorWhenReady(canvas);
        if(!result.engineReady && !engineWarned){
          document.getElementById("apError").textContent = "Face-matching engine unavailable — these photos were saved without face data.";
          engineWarned = true;
        }
        // PATH B: Save new face-api descriptor to descriptorV2
        pendingPhotos.push({ dataUrl: dataUrl, descriptorV2: result.descriptor, takenBy: (auth.currentUser && auth.currentUser.email) || "", addedAt: new Date().toISOString() });
        renderApPhotos();
      }catch(e){ console.error(e); }
    }
  };

  var apPlEditor = wireProfilingLocationEditor("apPl", prefillLoc);
  var apTagsEditor = wireTagsEditor("apTags", (prefill && prefill.tags) || [], PEOPLE_TAG_GROUPS);

  document.getElementById("apSave").onclick = async function(){
    var errEl = document.getElementById("apError");
    var name = document.getElementById("apName").value.trim();
    var surname = "";
    var idNumber = document.getElementById("apIdNumber").value.trim();
    var previousArrests = document.getElementById("apPreviousArrests").value.trim();
    if(!name){ errEl.textContent = "Full name is required."; return; }

    if(isPending("people") && !confirm("A previous Add may still be syncing from before a reload. Add another anyway?")) return;

    this.disabled = true;
    this.textContent = "Checking…";

    var dup;
    try{
      dup = await findDuplicateByIdNumber(idNumber, null);
    }catch(e){
      errEl.textContent = "Could not check for duplicates — check your connection.";
      this.disabled = false;
      this.textContent = "Save";
      return;
    }
    if(dup){
      errEl.innerHTML = 'A person with this ID Number already exists: <strong>' + escapeHtml(fullName(dup)) + '</strong>. Open their profile instead to add a new encounter.';
      this.disabled = false;
      this.textContent = "Save";
      return;
    }

    var person = Object.assign({
      name: name,
      surname: surname,
      idNumber: idNumber,
      dob: document.getElementById("apDob").value,
      aliases: document.getElementById("apAliases").value.trim(),
      origin: document.getElementById("apOrigin").value.trim(),
      residence: document.getElementById("apResidence").value.trim(),
      previousArrests: previousArrests,
      notes: document.getElementById("apNotes").value.trim(),
      deceased: false,
      encounters: [],
      photos: pendingPhotos,
      dateProfiled: (prefill && prefill.dateProfiled) ? prefill.dateProfiled : new Date().toISOString().slice(0, 10),
      addedAt: new Date().toISOString(),
      addedBy: auth.currentUser ? auth.currentUser.email : "unknown"
    }, profilingLocationPatch(apPlEditor.getState()), tagsPatch(apTagsEditor.getState()));

    this.textContent = "Saving…";
    markPending("people");
    var ref = doc(collection(db, "people"));
    try{
      var writeResult = await writeLocalFirst(setDoc(ref, person));
      clearPending("people");
      backdrop.remove();
      if(writeResult.queued){
        showSyncToast("Saved locally — it will sync when you're back online.");
      }
      if(onCreated){
        onCreated({ id: ref.id, name: fullName(person) });
      }else{
        renderPersonProfile(ref.id);
      }
    }catch(e){
      clearPending("people");
      errEl.textContent = isDocTooLargeError(e)
        ? "This record's photos are too large to save. Remove a photo and try again."
        : "Could not save — check your connection.";
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
  snapshot.forEach(function(d){
    if(d.id === currentId) return;
    var data = d.data();
    if(data.deleted) return;
    all.push(Object.assign({ id: d.id }, data));
  });

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

          await reassignVehicleLinks(otherId, currentId, fullName(currentPerson));

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
async function renderPersonProfile(id, forceServerLoad){
  var content = document.getElementById("contentArea");
  content.innerHTML = '<div class="people-empty">Loading…</div>';

  console.log("Loading person:", id);

  // Cache-first photo/profile read. The full person document (including
  // photos[]) is one Firestore doc, so "is the photo cached" and "is the
  // document cached" are the same question here. This does not change what's
  // written/stored — only which read path is taken.
  var personRef = doc(db, "people", id);
  var snap;
  if(forceServerLoad){
    snap = await getDoc(personRef); // explicit user tap — always allow the real read
  }else{
    try{
      snap = await getDocFromCache(personRef);
      console.log("[ProfileCache] served from local cache — no network request made");
    }catch(cacheMiss){
      var mode = detectConnectionMode();
      if(mode === "CELLULAR" || mode === "OFFLINE-UNKNOWN"){
        console.log("[ProfileCache] not cached, mode=" + mode + " — deferring, showing placeholder");
        content.innerHTML =
          '<div class="people-empty">Image not loaded — tap to load.</div>' +
          '<div style="text-align:center;margin-top:12px;">' +
            '<button class="btn-primary" id="loadPersonPhotoBtn" style="display:inline-flex;">Load</button>' +
          '</div>';
        document.getElementById("loadPersonPhotoBtn").onclick = function(){ renderPersonProfile(id, true); };
        return;
      }
      console.log("[ProfileCache] not cached, mode=" + mode + " — fetching from server");
      snap = await getDoc(personRef);
    }
  }

  console.log("Document exists:", snap.exists());
  if(!snap.exists()){ content.innerHTML = '<div class="people-empty">Record not found.</div>'; return; }

  var p = Object.assign({ id: id }, snap.data());
  var editMode = false;
  var pendingPhotos = p.photos ? p.photos.slice() : [];
  var pfPlEditor = null;
  var pfTagsEditor = null;
  var encounters = [];
  var allPeopleCache = null;
  async function getAllPeopleCached(){
    if(!allPeopleCache){
      var snap0 = await withReadTimeout(getDocs(collection(db, "people")));
      allPeopleCache = [];
      snap0.forEach(function(d){
        var data = d.data();
        if(data.deleted) return;
        allPeopleCache.push(Object.assign({ id: d.id }, data));
      });
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
          '<div class="profile-field" style="grid-column:1 / -1;">' +
            '<label>Name and Surname</label><input type="text" id="pfName" value="' + escapeHtml(fullName(p)) + '"' + (editMode ? '' : ' readonly') + ' placeholder="e.g. John Doe">' +
          '</div>' +
          field("ID Number", "pfIdNumber", p.idNumber, editMode, null, "e.g. 9001015800086") +
          field("Date of Birth", "pfDob", p.dob, editMode, "text", "DD/MM/YYYY") +
          field("Known Alias", "pfAliases", p.aliases, editMode, null, "e.g. Skhokho") +
          field("Originally From", "pfOrigin", p.origin, editMode, null, "e.g. Gugulethu") +
          field("Current Residence", "pfResidence", p.residence, editMode, null, "e.g. 12 Main Road, Khayelitsha") +
          field("Previous Arrests", "pfPreviousArrests", p.previousArrests, editMode, "textarea", "e.g. Shoplifting, March 2024") +
          field("Notes", "pfNotes", p.notes, editMode, "textarea", "Any other details worth recording") +
          field("Date Profiled", "pfDateProfiled", p.dateProfiled || "Not recorded", false) +
        '</div>' +
        (editMode ? profilingLocationEditHTML("pfPl", p) : profilingLocationViewHTML("pfPl", p)) +
        (editMode ? tagsEditHTML("pfTags", p.tags || [], PEOPLE_TAG_GROUPS) : tagsViewHTML("pfTags", p.tags || [], PEOPLE_TAG_GROUPS)) +
        '<div class="people-card-meta">Added by ' + escapeHtml(getDisplayName(p.addedBy)) + '</div>' +
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
          '<button class="pf-take-photo-btn" id="pfAddPhotoBtn" type="button"><i class="bi bi-camera-fill"></i>Take Photo</button>' +
          '<label class="pf-import-label" for="pfImportFile"><i class="bi bi-images"></i>Import from Gallery</label>' +
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
      return '<div class="pf-encounter" data-i="' + i + '" style="cursor:pointer;">' +
        '<div class="pf-encounter-head"><span>Encounter ' + (i + 1) + ' — ' + escapeHtml(enc.date || "") + '</span>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="pf-encounter-edit" data-i="' + i + '" type="button">✏ Edit</button>' +
          '<button class="pf-encounter-remove" data-id="' + enc.id + '" type="button">Remove</button></div>' +
        '</div>' +
        (enc.location ? '<div class="people-card-meta">📍 ' + escapeHtml(enc.location) + '</div>' : '') +
        (enc.itemsFound ? '<div class="people-card-meta">Items found: ' + escapeHtml(enc.itemsFound) + '</div>' : '') +
        (itemsPhotos.length ? '<div class="pf-photos-row" style="margin-top:8px;">' +
          itemsPhotos.map(function(ph, pi){ return '<div class="pf-photo-chip"><img class="pf-photo-view enc-photo-view" data-enc-i="' + i + '" data-photo-i="' + pi + '" src="' + photoUrl(ph) + '" style="cursor:pointer;"></div>'; }).join("") +
        '</div>' : '') +
        (enc.notes ? '<div class="people-card-meta">' + escapeHtml(enc.notes) + '</div>' : '') +
        (enc.loggedBy ? '<div class="people-card-meta" style="opacity:0.6;">Logged by ' + escapeHtml(getDisplayName(enc.loggedBy)) + '</div>' : '') +
      '</div>';
    }).join("");
  }

  function renderPhotos(){
    var row = document.getElementById("pfPhotosRow");
    var addBtn = document.getElementById("pfAddPhotoBtn");
    var html = "";

    pendingPhotos.forEach(function(ph, i){
      var takenBy = (typeof ph === "object" && ph.takenBy) ? ph.takenBy : "";
      html += '<div><div class="pf-photo-chip">' +
            '<img class="pf-photo-view" data-photo-i="' + i + '" src="' + photoUrl(ph) + '">' +
        (editMode ? '<button class="pf-rm" data-i="' + i + '" type="button">✕</button>' : '') +
        '</div>' +
        (takenBy ? '<div class="pf-photo-caption">' + escapeHtml(getDisplayName(takenBy)) + '</div>' : '') +
        '</div>';
    });

    row.innerHTML = html;

    Array.prototype.forEach.call(row.querySelectorAll(".pf-photo-view"), function(img){
      img.onclick = function(){
        var allSrcs = pendingPhotos.map(function(ph){ return photoUrl(ph); });
        openImageViewer(allSrcs, parseInt(img.getAttribute("data-photo-i"), 10));
      };
    });

    if(editMode && addBtn){
      row.appendChild(addBtn);
      Array.prototype.forEach.call(row.querySelectorAll(".pf-rm"), function(btn){
        btn.onclick = async function(){
          pendingPhotos.splice(parseInt(btn.getAttribute("data-i"), 10), 1);
          await updateDoc(doc(db, "people", id), { photos: pendingPhotos });
          renderPhotos();
        };
      });
    }
  }

  async function addPhoto(dataUrl){
    // PATH B: Save new face-api descriptor to descriptorV2, leave old descriptor empty
    var entry = { dataUrl: dataUrl, descriptorV2: null, takenBy: (auth.currentUser && auth.currentUser.email) || "", addedAt: new Date().toISOString() };
    pendingPhotos.push(entry);
    var writeResult;
    try{
      writeResult = await writeLocalFirst(updateDoc(doc(db, "people", id), { photos: pendingPhotos }));
    }catch(e){
      pendingPhotos.pop();
      document.getElementById("faceWarningArea").innerHTML = '<div class="modal-error">' +
        (isDocTooLargeError(e) ? "This photo is too large to save. Remove a photo and try again." : "Could not save photo — check your connection.") +
        '</div>';
      return;
    }
    renderPhotos();
    if(writeResult.queued){
      showSyncToast("Photo added — it will sync when you're back online.");
    }

    try{
      var canvas = await dataUrlToCanvas(dataUrl);
      var result = await computeDescriptorWhenReady(canvas);
      if(!result.engineReady){
        document.getElementById("faceWarningArea").innerHTML = '<div class="modal-error">Face-matching engine unavailable — this photo was saved without face data.</div>';
        return;
      }
      var descriptor = result.descriptor;
      if(descriptor){
        entry.descriptorV2 = descriptor;
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
            try{
              var mergedPhotos = pendingPhotos.concat(dupFace.record.photos || []);
              await updateDoc(doc(db, "people", id), { photos: mergedPhotos });

              var otherEncSnap2 = await getDocs(query(collection(db, "encounters"), where("personId", "==", dupFace.record.id)));
              var reassignJobs2 = [];
              otherEncSnap2.forEach(function(d){
                reassignJobs2.push(updateDoc(doc(db, "encounters", d.id), { personId: id }));
              });
              await Promise.all(reassignJobs2);

              await reassignVehicleLinks(dupFace.record.id, id, fullName(p));

              await deleteDoc(doc(db, "people", dupFace.record.id));
              renderPersonProfile(id);
            }catch(e){
              document.getElementById("faceWarningArea").innerHTML += '<div class="modal-error">Merge failed — check your connection.</div>';
            }
          };
        }
      }
    }catch(e){ console.error("background face analysis failed", e); }
  }

  async function wireUp(){
    document.getElementById("backToPeople").onclick = function(){ showPeople(); };

    document.getElementById("toggleEditBtn").onclick = function(){
      editMode = !editMode;
      render();
    };

    if(editMode){
      pfPlEditor = wireProfilingLocationEditor("pfPl", p);
      pfTagsEditor = wireTagsEditor("pfTags", p.tags || [], PEOPLE_TAG_GROUPS);
    }else{
      pfPlEditor = null;
      pfTagsEditor = null;
      wireProfilingLocationView("pfPl", p);
    }

    if(editMode){
      document.getElementById("saveProfileBtn").onclick = async function(){
        var errEl = document.getElementById("profileError");
        var name = document.getElementById("pfName").value.trim();
        var idNumber = document.getElementById("pfIdNumber").value.trim();
        if(!name){ errEl.textContent = "Name and Surname are required."; return; }

        this.disabled = true;
        this.textContent = "Checking…";
        var dup;
        try{
          dup = await findDuplicateByIdNumber(idNumber, id);
        }catch(e){
          errEl.textContent = "Could not check for duplicates — check your connection.";
          this.disabled = false;
          this.textContent = "Save Changes";
          return;
        }
        if(dup){
          errEl.innerHTML = 'Another person already has this ID Number: <strong>' + escapeHtml(fullName(dup)) + '</strong>.';
          this.disabled = false;
          this.textContent = "Save Changes";
          return;
        }

        var updates = Object.assign({
          name: name, surname: "", idNumber: idNumber,
          dob: document.getElementById("pfDob").value,
          aliases: document.getElementById("pfAliases").value.trim(),
          origin: document.getElementById("pfOrigin").value.trim(),
          residence: document.getElementById("pfResidence").value.trim(),
          previousArrests: document.getElementById("pfPreviousArrests").value.trim(),
          notes: document.getElementById("pfNotes").value.trim(),
          deceased: document.getElementById("pfDeceased").checked
        }, profilingLocationPatch(pfPlEditor && pfPlEditor.getState()), tagsPatch(pfTagsEditor && pfTagsEditor.getState()));
        try{
          var writeResult = await writeLocalFirst(updateDoc(doc(db, "people", id), updates));
          Object.assign(p, updates);
          editMode = false;
          render();
          if(writeResult.queued){
            showSyncToast("Changes saved locally — they will sync when you're back online.");
          }
        }catch(e){
          errEl.textContent = isDocTooLargeError(e)
            ? "This record's photos are too large to save. Remove a photo and try again."
            : "Could not save — check your connection.";
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
        var newEncounterBtn = document.getElementById("newEncounterBtn");
        newEncounterBtn.disabled = encounters.length >= MAX_ENCOUNTERS;
        newEncounterBtn.textContent = encounters.length >= MAX_ENCOUNTERS ? "Maximum of 6 encounters reached" : "+ New Encounter (" + encounters.length + "/" + MAX_ENCOUNTERS + ")";
        wireUp();
      };
    });

    Array.prototype.forEach.call(document.querySelectorAll(".pf-encounter-edit"), function(btn){
      btn.onclick = function(){
        var i = parseInt(btn.getAttribute("data-i"), 10);
        openEditEncounterModal(encounters[i]);
      };
    });
    // Make encounter item photos tapable for full-screen viewer
    Array.prototype.forEach.call(document.querySelectorAll(".enc-photo-view"), function(img){
      img.onclick = function(){
        var encIdx = parseInt(img.getAttribute("data-enc-i"), 10);
        var photoIdx = parseInt(img.getAttribute("data-photo-i"), 10);
        var enc = encounters[encIdx];
        var srcs = (enc.itemsPhotos || []).map(function(ph){ return photoUrl(ph); });
        openImageViewer(srcs, photoIdx);
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("#encounterList .pf-photo-view"), function(img){
      img.onclick = function(){
        var enc = encounters[parseInt(img.getAttribute("data-enc-i"), 10)];
        var srcs = (enc.itemsPhotos || []).map(function(ph){ return photoUrl(ph); });
        openImageViewer(srcs, parseInt(img.getAttribute("data-photo-i"), 10));
      };
    });

    document.getElementById("newEncounterBtn").onclick = function(){
      if(encounters.length >= MAX_ENCOUNTERS) return;
      openNewEncounterModal();
    };

    Array.prototype.forEach.call(document.querySelectorAll(".pf-encounter"), function(row){
      row.onclick = function(e){
        if(e.target.closest(".pf-encounter-edit, .pf-encounter-remove, .pf-photo-view")) return;
        var i = parseInt(row.getAttribute("data-i"), 10);
        openEncounterDetailsModal(encounters[i]);
      };
    });
  }

  function openEncounterDetailsModal(enc){
    var itemsPhotos = enc.itemsPhotos || [];
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop-custom";
    backdrop.innerHTML =
      '<div class="modal-card">' +
        '<h2>Encounter Details</h2>' +
        '<label>Date</label><div class="people-card-meta">' + escapeHtml(enc.date || "Not recorded") + '</div>' +
        '<label>Location</label><div class="people-card-meta">' + escapeHtml(enc.location || "Not recorded") + '</div>' +
        (enc.coords ? '<label>Coordinates</label><div class="people-card-meta">Lat ' + enc.coords[0] + ', Lon ' + enc.coords[1] + '</div>' : '') +
        '<label>Items Found</label><div class="people-card-meta">' + escapeHtml(enc.itemsFound || "None recorded") + '</div>' +
        '<label>Notes</label><div class="people-card-meta">' + escapeHtml(enc.notes || "None recorded") + '</div>' +
        (itemsPhotos.length ?
          '<label>Photos</label><div class="pf-photos-row" id="edPhotosRow">' +
            itemsPhotos.map(function(ph, pi){ return '<div class="pf-photo-chip"><img class="pf-photo-view" data-photo-i="' + pi + '" src="' + photoUrl(ph) + '" style="cursor:pointer;"></div>'; }).join("") +
          '</div>'
        : '') +
        '<label>Logged By</label><div class="people-card-meta">' + escapeHtml(getDisplayName(enc.loggedBy)) + '</div>' +
        '<div class="modal-actions">' +
          '<button class="btn-ghost" id="edCloseBtn">Close</button>' +
          '<button class="btn-ghost" id="edEditBtn">Edit</button>' +
          '<button class="btn-ghost" id="edDeleteBtn" style="color:#ef5350;border-color:#ef5350;">Delete</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    backdrop.onclick = function(e){ if(e.target === backdrop) backdrop.remove(); };
    document.getElementById("edCloseBtn").onclick = function(){ backdrop.remove(); };

    Array.prototype.forEach.call(backdrop.querySelectorAll(".pf-photo-view"), function(img){
      img.onclick = function(){
        var srcs = itemsPhotos.map(function(ph){ return photoUrl(ph); });
        openImageViewer(srcs, parseInt(img.getAttribute("data-photo-i"), 10));
      };
    });

    document.getElementById("edEditBtn").onclick = function(){
      backdrop.remove();
      openEditEncounterModal(enc, function(){
        var updated = encounters.filter(function(e){ return e.id === enc.id; })[0];
        if(updated) openEncounterDetailsModal(updated);
      });
    };

    document.getElementById("edDeleteBtn").onclick = async function(){
      if(!confirm("Remove this encounter?")) return;
      try{ await deleteDoc(doc(db, "encounters", enc.id)); }catch(e){}
      await loadEncounters();
      document.getElementById("encounterList").innerHTML = renderEncounters();
      var newEncounterBtn = document.getElementById("newEncounterBtn");
      newEncounterBtn.disabled = encounters.length >= MAX_ENCOUNTERS;
      newEncounterBtn.textContent = encounters.length >= MAX_ENCOUNTERS ? "Maximum of 6 encounters reached" : "+ New Encounter (" + encounters.length + "/" + MAX_ENCOUNTERS + ")";
      wireUp();
      backdrop.remove();
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
      getBestLocation(statusEl, function(pos){
        encCoords = [pos.coords.latitude, pos.coords.longitude];
        input.value = "Lat " + pos.coords.latitude.toFixed(5) + ", Lon " + pos.coords.longitude.toFixed(5);
        statusEl.textContent = "Location captured (accuracy ±" + Math.round(pos.coords.accuracy) + "m).";
      });
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
        loggedBy: (auth.currentUser && auth.currentUser.email) || "unknown",
        createdAt: new Date().toISOString()
      };
      this.disabled = true;
      this.textContent = "Saving…";
      try{
        var ref = await addDoc(collection(db, "encounters"), newEnc);
        encounters.push(Object.assign({ id: ref.id }, newEnc));
        encounters.sort(function(a, b){ return (a.date || "").localeCompare(b.date || ""); });
        document.getElementById("encounterList").innerHTML = renderEncounters();
        var newEncounterBtn = document.getElementById("newEncounterBtn");
        newEncounterBtn.disabled = encounters.length >= MAX_ENCOUNTERS;
        newEncounterBtn.textContent = encounters.length >= MAX_ENCOUNTERS ? "Maximum of 6 encounters reached" : "+ New Encounter (" + encounters.length + "/" + MAX_ENCOUNTERS + ")";
        wireUp();
        backdrop.remove();
      }catch(e){
        document.getElementById("encError").textContent = "Could not save — check your connection.";
        this.disabled = false;
        this.textContent = "Save Encounter";
      }
    };
  }

  function openEditEncounterModal(existing, onSaved){
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
      getBestLocation(statusEl, function(pos){
        encCoords = [pos.coords.latitude, pos.coords.longitude];
        input.value = "Lat " + pos.coords.latitude.toFixed(5) + ", Lon " + pos.coords.longitude.toFixed(5);
        statusEl.textContent = "Location captured (accuracy ±" + Math.round(pos.coords.accuracy) + "m).";
      });
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
        var newEncounterBtn = document.getElementById("newEncounterBtn");
        newEncounterBtn.disabled = encounters.length >= MAX_ENCOUNTERS;
        newEncounterBtn.textContent = encounters.length >= MAX_ENCOUNTERS ? "Maximum of 6 encounters reached" : "+ New Encounter (" + encounters.length + "/" + MAX_ENCOUNTERS + ")";
        wireUp();
        if(onSaved) onSaved();
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