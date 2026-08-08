// face.js — Face Search module using @vladmandic/face-api
// PATH B: Stores new face-api descriptors in descriptorV2 field

var modelsReady = false;
var loadPromise = null;
var MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

export function ensureModelsLoaded(){
  if(loadPromise) return loadPromise;
  loadPromise = (async function(){
    try{
      const faceapi = await import("https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js");
      window.faceapi = faceapi;
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
      modelsReady = true;
      console.log("face-api models loaded successfully");
    }catch(e){ console.error("face engine failed to load", e); }
  })();
  return loadPromise;
}

export async function computeDescriptor(canvasOrImg){
  if(!modelsReady || !window.faceapi) return null;
  try{
    var faceapi = window.faceapi;
    var detection = await faceapi
      .detectSingleFace(canvasOrImg, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    if(detection && detection.descriptor){
      return Array.from(detection.descriptor);
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
  if(typeof p === "string") return null;
  if(p.descriptorV2) return p.descriptorV2;
  if(p.descriptor) return p.descriptor;
  return null;
}

export function matchThreshold(p){
  if(!p) return 0.6;
  if(p.descriptorV2) return 0.6;
  if(p.descriptor) return 1.0;
  return 0.6;
}

import { db } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;","<":"&gt;","'":"&quot;","'":"&#39;"}[c];
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
    '<div style="display:flex;gap:10px;">' +
      '<button id="faceTakeBtn" class="btn-primary" style="flex:1;justify-content:center;"><i class="bi bi-camera"></i> Take photo</button>' +
      '<button id="faceGalleryBtn" class="btn-ghost" style="flex:1;"><i class="bi bi-images"></i> From gallery</button>' +
    '</div>' +
    '<input type="file" id="faceFile" accept="image/*" capture="environment" style="display:none;">' +
    '<input type="file" id="faceGalleryFile" accept="image/*" style="display:none;">' +
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
  document.getElementById("faceGalleryBtn").onclick = function(){
    document.getElementById("faceGalleryFile").value = "";
    document.getElementById("faceGalleryFile").click();
  };

  async function runFaceSearch(file){
    var resultsEl = document.getElementById("faceResults");
    resultsEl.innerHTML = '<div class="people-empty">Analyzing…</div>';

    var canvas = await fileToCanvas(file, 480);
    var descriptor = await computeDescriptor(canvas);
    if(!descriptor){
      resultsEl.innerHTML = '<div class="people-empty">Could not analyze this photo — no clear face found, or the engine is not available.</div>';
      return;
    }

    var snap = await getDocs(collection(db, "suspects"));
    var scored = [];
    snap.docs.forEach(function(d){
      var r = d.data(); r.id = d.id;
      (r.photos || []).forEach(function(p){
        var desc = photoDescriptor(p);
        if(desc){
          var threshold = matchThreshold(p);
          var dist = euclidean(descriptor, desc);
          scored.push({ record: r, photoUrl: photoUrl(p), dist: dist, threshold: threshold });
        }
      });
    });
    scored.sort(function(a, b){ return a.dist - b.dist; });
    var top = scored.slice(0, 5);

    if(!top.length){
      resultsEl.innerHTML = '<div class="people-empty">No stored photos have matchable face data yet — photos added before face-matching was enabled will not have this.</div>';
      return;
    }

    resultsEl.innerHTML = top.map(function(t){
      var pct = Math.max(0, Math.round((1 - t.dist / t.threshold) * 100));
      return '<div class="people-row" style="cursor:default;">' +
        '<img class="people-row-thumb" src="' + t.photoUrl + '">' +
        '<div><div class="people-row-name">' + escapeHtml(t.record.name) + '</div>' +
        '<div class="people-row-meta">' + (t.dist < t.threshold ? "Likely match" : "Possible match") + ' · ' + pct + '% similarity</div></div>' +
      '</div>';
    }).join("");
  }

  document.getElementById("faceFile").onchange = function(){ if(this.files[0]) runFaceSearch(this.files[0]); };
  document.getElementById("faceGalleryFile").onchange = function(){ if(this.files[0]) runFaceSearch(this.files[0]); };
}