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
  container.innerHTML = records.slice().reverse().map(function(r){
    var thumb = r.photos && r.photos[0] ? photoUrl(r.photos[0]) : null;
    return '<div class="people-row" data-id="' + r.id + '">' +
      (thumb ? '<img class="people-row-thumb" src="' + thumb + '">' : '<div class="people-row-thumb"></div>') +
      '<div>' +
        '<div class="people-row-name">' + escapeHtml(r.name || "Unnamed") + '</div>' +
        '<div class="people-row-meta">' + escapeHtml(r.dob || "") + '</div>' +
      '</div>' +
    '</div>';
  }).join("");

  Array.prototype.forEach.call(container.querySelectorAll(".people-row"), function(el){
    el.onclick = function(){ onSelect(el.getAttribute("data-id")); };
  });
}