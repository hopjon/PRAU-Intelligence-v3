import { db } from "../firebase.js";
import { collection, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { renderPeopleList } from "./people-list.js";
import { openPersonForm } from "./people-form.js";

var allPeople = [];
var unsub = null;

export function renderPeople(container){
  container.innerHTML =
    '<div class="people-header">' +
      '<h1>People Database</h1>' +
      '<button id="addPersonBtn" class="btn-primary"><i class="bi bi-plus-lg"></i> Add Person</button>' +
    '</div>' +
    '<div class="people-search">' +
      '<i class="bi bi-search"></i>' +
      '<input type="text" id="peopleSearchInput" placeholder="Search…">' +
    '</div>' +
    '<div id="peopleListArea"></div>';

  var listArea = document.getElementById("peopleListArea");

  document.getElementById("addPersonBtn").onclick = function(){
    openPersonForm(null, function(){});
  };

  document.getElementById("peopleSearchInput").oninput = function(){
    applyFilter(this.value, listArea);
  };

  if(unsub) unsub();
  unsub = onSnapshot(query(collection(db, "suspects"), orderBy("addedAt", "asc")), function(snap){
    allPeople = snap.docs.map(function(d){ var v = d.data(); v.id = d.id; return v; });
    applyFilter(document.getElementById("peopleSearchInput").value, listArea);
  });
}

function applyFilter(q, listArea){
  q = (q || "").trim().toLowerCase();
  var filtered = !q ? allPeople : allPeople.filter(function(r){
    return (r.name || "").toLowerCase().indexOf(q) !== -1;
  });
  renderPeopleList(listArea, filtered, function(id){
    var record = allPeople.find(function(r){ return r.id === id; });
    if(record) openPersonForm(record, function(){});
  });
}