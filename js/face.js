var humanInstance = null;
var modelsReady = false;
var loadPromise = null;

export function ensureModelsLoaded(){
  if(loadPromise) return loadPromise;
  loadPromise = (async function(){
    try{
      if(typeof Human === "undefined") return;
      var config = {
        modelBasePath: "https://cdn.jsdelivr.net/npm/@vladmandic/human/models/",
        face: { enabled: true, detector: { rotation: false }, mesh: { enabled: true },
                description: { enabled: true }, iris: { enabled: false }, emotion: { enabled: false } },
        body: { enabled: false }, hand: { enabled: false }, gesture: { enabled: false }
      };
      humanInstance = new Human.Human(config);
      await humanInstance.load();
      modelsReady = true;
    }catch(e){ console.error("face engine failed to load", e); }
  })();
  return loadPromise;
}

export async function computeDescriptor(canvasOrImg){
  if(!modelsReady || !humanInstance) return null;
  try{
    var result = await humanInstance.detect(canvasOrImg);
    if(result && result.face && result.face.length && result.face[0].embedding){
      return Array.from(result.face[0].embedding);
    }
    return null;
  }catch(e){ return null; }
}

export function euclidean(a, b){
  if(!a || !b || a.length !== b.length) return Infinity;
  var sum = 0;
  for(var i = 0; i < a.length; i++){ sum += (a[i]-b[i]) * (a[i]-b[i]); }
  return Math.sqrt(sum);
}

export function photoUrl(p){
  return typeof p === "string" ? p : p.dataUrl;
}

export function photoDescriptor(p){
  return typeof p === "string" ? null : p.descriptor;
}

// ---------- Face Search screen ----------
import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}

function fileToCanvas(file, maxDim){
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
        resolve(canvas);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function renderFaceSearch(container){
  container.innerHTML =
    '<div class="people-header"><h1>Face Search</h1></div>' +
    '<div class="modal-error" id="faceStatus" style="text-align:left;color:#888;margin-bottom:16px;">Loading matching engine…</div>' +
    '<button id="faceTakeBtn" class="btn-primary"><i class="bi bi-camera"></i> Take / choose photo</button>' +
    '<input type="file" id="faceFile" accept="image/*" capture="environment" style="display:none;">' +
    '<div id="faceResults" style="margin-top:20px;"></div>';

  var statusEl = document.getElementById("faceStatus");

  ensureModelsLoaded().then(function(){
    statusEl.textContent = modelsReady
      ? "Matching engine ready. Take or choose a photo to compare against your People records."
      : "Matching engine unavailable in this environment — try again later.";
  });

  document.getElementById("faceTakeBtn").onclick = function(){
    document.getElementById("faceFile").value = "";
    document.getElementById("faceFile").click();
  };

  document.getElementById("faceFile").onchange = async function(){
    var file = this.files[0];
    if(!file) return;
    var resultsEl = document.getElementById("faceResults");
    resultsEl.innerHTML = '<div class="people-empty">Analyzing…</div>';

    var canvas = await fileToCanvas(file, 480);
    var descriptor = await computeDescriptor(canvas);
    if(!descriptor){
      resultsEl.innerHTML = '<div class="people-empty">Could not analyze this photo — no clear face found, or the engine isn\'t available.</div>';
      return;
    }

    var snap = await getDocs(collection(db, "suspects"));
    var scored = [];
    snap.docs.forEach(function(d){
      var r = d.data(); r.id = d.id;
      (r.photos || []).forEach(function(p){
        var desc = photoDescriptor(p);
        if(desc){ scored.push({ record: r, photoUrl: photoUrl(p), dist: euclidean(descriptor, desc) }); }
      });
    });
    scored.sort(function(a, b){ return a.dist - b.dist; });
    var top = scored.slice(0, 5);

    if(!top.length){
      resultsEl.innerHTML = '<div class="people-empty">No stored photos have matchable face data yet — photos added before face-matching was enabled won\'t have this.</div>';
      return;
    }

    resultsEl.innerHTML = top.map(function(t){
      var pct = Math.max(0, Math.round((1 - t.dist / 1.0) * 100));
      return '<div class="people-row" style="cursor:default;">' +
        '<img class="people-row-thumb" src="' + t.photoUrl + '">' +
        '<div><div class="people-row-name">' + escapeHtml(t.record.name) + '</div>' +
        '<div class="people-row-meta">' + (t.dist < 0.6 ? "Likely match" : "Possible match") + ' · ' + pct + '% similarity</div></div>' +
      '</div>';
    }).join("");
  };
}