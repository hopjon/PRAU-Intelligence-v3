// tags.js — shared intelligence/profile Tags feature, reused by Person,
// Unidentified Person, and Vehicle records. These are descriptive profile
// tags only — presence of a tag never implies the record's subject has
// been convicted of or committed an offence.

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}

export var PEOPLE_TAG_GROUPS = [
  { name: "Serious / Violent", colorKey: "red", tags: [
    "Violence","Murder / Homicide","Attempted Murder","Assault","Armed Robbery","Robbery",
    "Armed Threat","Threats / Intimidation","Kidnapping","Domestic Violence","Gang Activity",
    "Weapons","Firearm","Dangerous Behaviour"
  ]},
  { name: "Theft / Property", colorKey: "orange", tags: [
    "Theft","Burglary","Housebreaking","Vehicle Theft","Vehicle Break-in","Shoplifting",
    "Property Damage","Vandalism","Trespassing","Copper / Cable Theft"
  ]},
  { name: "Drugs", colorKey: "purple", tags: [
    "Drugs","Drug Possession","Drug Dealing","Drug Distribution","Drug Use","Drug-Related Activity"
  ]},
  { name: "Other Criminal Activity", colorKey: "blue", tags: [
    "Fraud","Scam","Identity Theft","Extortion","Human Trafficking","Prostitution / Sex Work",
    "Sexual Offence","Public Intoxication","Illegal Gambling","Loitering","Vagrancy"
  ]},
  { name: "Organised / Group", colorKey: "magenta", tags: [
    "Gang Member / Association","Organised Crime","Known Associate","Known Accomplice",
    "Suspicious Group","Gang Territory"
  ]},
  { name: "Intelligence / Operational", colorKey: "teal", tags: [
    "Person of Interest","Suspicious Activity","Wanted","Missing Person","Witness","Victim",
    "Informant","Frequently Observed","Recurring Presence","Vehicle Linked","Location Linked",
    "Under Investigation","High Priority","Unverified / Intelligence Only"
  ]}
];

export var VEHICLE_TAG_GROUPS = [
  { name: "Vehicle / Crime", colorKey: "red", tags: [
    "Stolen Vehicle","Suspected Stolen","Vehicle Theft","Vehicle Break-in","Used in Robbery",
    "Used in Theft","Used in Assault","Used in Murder / Homicide","Used in Drug Activity",
    "Suspicious Vehicle","Wanted Vehicle"
  ]},
  { name: "Associations", colorKey: "magenta", tags: [
    "Linked to Person","Linked to Incident","Linked to Location","Known Associate Vehicle",
    "Gang-Linked","Organised Crime","Frequently Observed","Recurring Presence"
  ]},
  { name: "Intelligence", colorKey: "teal", tags: [
    "Vehicle of Interest","High Priority","Under Investigation","Unverified / Intelligence Only",
    "Witness Vehicle","Victim Vehicle"
  ]},
  { name: "Status", colorKey: "grey", tags: [
    "Abandoned","Suspicious Activity","Damaged","Recovered","Missing"
  ]}
];

function getTagColorKey(tag, groups){
  for(var i = 0; i < groups.length; i++){
    if(groups[i].tags.indexOf(tag) !== -1) return groups[i].colorKey;
  }
  return "grey";
}

function pillHTML(tag, colorKey, removable){
  return '<span class="tag-pill tag-pill-' + colorKey + '" data-tag="' + escapeHtml(tag) + '">' +
    escapeHtml(tag) +
    (removable ? '<button type="button" class="tag-pill-remove" data-tag="' + escapeHtml(tag) + '">✕</button>' : '') +
    '</span>';
}

// ---------- read-only display (profile view) ----------
export function tagsViewHTML(idPrefix, tags, groups){
  if(!tags || !tags.length) return "";
  return (
    '<h3><i class="bi bi-tags-fill"></i> Tags</h3>' +
    '<div class="tags-selected" id="' + idPrefix + 'TagsView">' +
      tags.map(function(t){ return pillHTML(t, getTagColorKey(t, groups), false); }).join("") +
    '</div>'
  );
}

var CUSTOM_TAG_MAX_LEN = 40;

// ---------- interactive editor (add/edit forms) ----------
export function tagsEditHTML(idPrefix, tags, groups){
  return (
    '<label><i class="bi bi-tags-fill"></i> Tags</label>' +
    '<div class="tags-selected" id="' + idPrefix + 'TagsSelected"></div>' +
    '<div class="tags-picker-wrap" id="' + idPrefix + 'TagsWrap">' +
      '<div style="display:flex;gap:8px;">' +
        '<input type="text" id="' + idPrefix + 'TagSearch" style="flex:1;" placeholder="Search tags to add…" autocomplete="off">' +
        '<button type="button" class="btn-ghost" id="' + idPrefix + 'CustomTagBtn" style="flex-shrink:0;">+ Add Custom Tag</button>' +
      '</div>' +
      '<div class="tags-picker-list" id="' + idPrefix + 'TagList" style="display:none;"></div>' +
      '<div class="tags-custom-form" id="' + idPrefix + 'CustomForm" style="display:none;">' +
        '<input type="text" id="' + idPrefix + 'CustomInput" placeholder="Custom tag name…" maxlength="' + CUSTOM_TAG_MAX_LEN + '">' +
        '<div class="tags-custom-actions">' +
          '<button type="button" class="btn-ghost" id="' + idPrefix + 'CustomCancel">Cancel</button>' +
          '<button type="button" class="btn-primary" id="' + idPrefix + 'CustomAdd">Add</button>' +
        '</div>' +
        '<div class="tags-custom-error" id="' + idPrefix + 'CustomError"></div>' +
      '</div>' +
    '</div>'
  );
}

// Wires the interactive tag picker rendered by tagsEditHTML.
// Returns { getState() } — call getState() at save time to read the latest tags.
export function wireTagsEditor(idPrefix, initialTags, groups){
  var state = { tags: (initialTags || []).slice() };
  var selectedEl = document.getElementById(idPrefix + "TagsSelected");
  var searchEl = document.getElementById(idPrefix + "TagSearch");
  var listEl = document.getElementById(idPrefix + "TagList");
  var wrapEl = document.getElementById(idPrefix + "TagsWrap");
  var customBtn = document.getElementById(idPrefix + "CustomTagBtn");
  var customForm = document.getElementById(idPrefix + "CustomForm");
  var customInput = document.getElementById(idPrefix + "CustomInput");
  var customCancel = document.getElementById(idPrefix + "CustomCancel");
  var customAdd = document.getElementById(idPrefix + "CustomAdd");
  var customError = document.getElementById(idPrefix + "CustomError");
  if(!selectedEl || !searchEl || !listEl || !wrapEl) return { getState: function(){ return state.tags.slice(); } };

  // Finds a predefined or already-selected tag matching `name` case-insensitively
  // (after trimming), so "drugs" resolves to the existing "Drugs" instead of duplicating.
  function findExistingTag(name){
    var key = name.trim().toLowerCase();
    for(var i = 0; i < state.tags.length; i++){
      if(state.tags[i].toLowerCase() === key) return state.tags[i];
    }
    for(var g = 0; g < groups.length; g++){
      var t = groups[g].tags;
      for(var j = 0; j < t.length; j++){
        if(t[j].toLowerCase() === key) return t[j];
      }
    }
    return null;
  }

  function renderSelected(){
    selectedEl.innerHTML = state.tags.length
      ? state.tags.map(function(t){ return pillHTML(t, getTagColorKey(t, groups), true); }).join("")
      : '<span style="color:var(--text-gray-dark);font-size:12px;">No tags selected</span>';
    Array.prototype.forEach.call(selectedEl.querySelectorAll(".tag-pill-remove"), function(btn){
      btn.onclick = function(){
        var tag = btn.getAttribute("data-tag");
        state.tags = state.tags.filter(function(t){ return t !== tag; });
        renderSelected();
        renderList(searchEl.value);
      };
    });
  }

  function renderList(filterText){
    var q = (filterText || "").trim().toLowerCase();
    var html = "";
    groups.forEach(function(group){
      var available = group.tags.filter(function(t){
        return state.tags.indexOf(t) === -1 && (!q || t.toLowerCase().indexOf(q) !== -1);
      });
      if(!available.length) return;
      html += '<div class="tags-picker-group">' + escapeHtml(group.name) + '</div>';
      html += available.map(function(t){
        return '<div class="tags-picker-row" data-tag="' + escapeHtml(t) + '">' +
          '<span class="tag-pill tag-pill-' + group.colorKey + '">' + escapeHtml(t) + '</span></div>';
      }).join("");
    });
    listEl.innerHTML = html || '<div class="tags-picker-empty">No matching tags</div>';
    Array.prototype.forEach.call(listEl.querySelectorAll(".tags-picker-row"), function(row){
      row.onclick = function(){
        var tag = row.getAttribute("data-tag");
        if(state.tags.indexOf(tag) === -1) state.tags.push(tag);
        renderSelected();
        renderList(searchEl.value);
      };
    });
  }

  searchEl.oninput = function(){ listEl.style.display = "block"; renderList(searchEl.value); };
  searchEl.onfocus = function(){ listEl.style.display = "block"; renderList(searchEl.value); };
  document.addEventListener("click", function(e){
    if(!wrapEl.contains(e.target)) listEl.style.display = "none";
  });

  if(customBtn && customForm && customInput && customCancel && customAdd && customError){
    customBtn.onclick = function(){
      listEl.style.display = "none";
      customForm.style.display = "block";
      customError.textContent = "";
      customInput.value = "";
      customInput.focus();
    };
    customCancel.onclick = function(){
      customForm.style.display = "none";
      customError.textContent = "";
    };
    customAdd.onclick = function(){
      var name = customInput.value.trim();
      if(!name){ customError.textContent = "Enter a tag name."; return; }
      if(name.length > CUSTOM_TAG_MAX_LEN){ customError.textContent = "Tag name is too long (max " + CUSTOM_TAG_MAX_LEN + " characters)."; return; }
      var existing = findExistingTag(name);
      if(existing){
        if(state.tags.indexOf(existing) === -1) state.tags.push(existing);
        customForm.style.display = "none";
        customError.textContent = "";
        renderSelected();
        renderList(searchEl.value);
        return;
      }
      state.tags.push(name);
      customForm.style.display = "none";
      customError.textContent = "";
      renderSelected();
      renderList(searchEl.value);
    };
  }

  renderSelected();
  return { getState: function(){ return state.tags.slice(); } };
}

// Builds the Firestore field patch for saved tags — deduped, array of strings.
export function tagsPatch(tags){
  var seen = {};
  var out = [];
  (tags || []).forEach(function(t){
    if(!t || seen[t]) return;
    seen[t] = true;
    out.push(t);
  });
  return { tags: out };
}
