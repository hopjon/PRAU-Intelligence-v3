function photoUrl(p){ return typeof p === "string" ? p : p.dataUrl; }

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}

export function renderPeopleList(container, records, onSelect){
  if(!records.length){
    container.innerHTML = '<div class="people-empty">No records found.</div>';
    return;
  }

  var sorted = records.slice().sort(function(a, b){
    return (a.name || "").localeCompare(b.name || "");
  });

  container.innerHTML = '<div class="people-grid">' + sorted.map(function(r){
    var thumb = r.photos && r.photos[0] ? photoUrl(r.photos[0]) : null;
    return '<div class="people-card" data-id="' + r.id + '">' +
      (thumb
        ? '<img class="people-card-thumb" src="' + thumb + '">'
        : '<div class="people-card-thumb-empty"><i class="bi bi-person"></i></div>') +
      '<div class="people-card-info">' +
        '<div class="people-card-name">' + escapeHtml(r.name || "Unnamed") + '</div>' +
        '<div class="people-card-meta">' + escapeHtml(r.dob || "") + '</div>' +
      '</div>' +
    '</div>';
  }).join("") + '</div>';

  Array.prototype.forEach.call(container.querySelectorAll(".people-card"), function(el){
    el.onclick = function(){ onSelect(el.getAttribute("data-id")); };
  });
}