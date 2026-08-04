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
    return '<div class="people-row" data-id="' + r.id + '">' +
      '<div class="people-row-name">' + escapeHtml(r.name || "Unnamed") + '</div>' +
      '<div class="people-row-meta">' + escapeHtml(r.dob || "") + '</div>' +
    '</div>';
  }).join("");

  Array.prototype.forEach.call(container.querySelectorAll(".people-row"), function(el){
    el.onclick = function(){ onSelect(el.getAttribute("data-id")); };
  });
}