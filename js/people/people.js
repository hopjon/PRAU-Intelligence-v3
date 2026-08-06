
import { db } from "../firebase.js";
import {
    collection,
    getDocs,
    addDoc,
    serverTimestamp,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export async function showPeople() {

    const content = document.getElementById("contentArea");
console.log("showPeople() was called");
    content.innerHTML = `
        <div class="people-header">

    <h1>
        <i class="bi bi-person-fill"></i>
        People Database
    </h1>

    <button class="btn-primary" id="addPersonBtn">
        <i class="bi bi-plus-circle-fill"></i>
        Add
    </button>

</div>

        <div class="search-bar">


    <input
        type="text"
        id="peopleSearch"
        placeholder="Search people..."
    >
</div>

<div id="peopleList" class="people-list">
    Loading...
</div>
    `;

    const list = document.getElementById("peopleList");
const snapshot = await getDocs(collection(db, "people"));
    
    const people = [];

snapshot.forEach(doc => {
    people.push({
        id: doc.id,
        ...doc.data()
    });
});

people.sort((a, b) => {
    const aName = `${a.name ?? ""} ${a.surname ?? ""}`.toLowerCase();
    const bName = `${b.name ?? ""} ${b.surname ?? ""}`.toLowerCase();
    return aName.localeCompare(bName);
});

    if(snapshot.empty){

        list.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-person-x-fill"></i>
                <p>No people found.</p>
            </div>
        `;

        return;

    }

    list.innerHTML = "";

people.forEach(person => {
    

    console.log(person);


    

    list.innerHTML += `
    <div class="person-row" data-id="${person.id}">

        <div class="person-avatar">
            <i class="bi bi-person-fill"></i>
        </div>

        <div class="person-details">

            <div class="people-row-name">
                ${person.name ?? "Unnamed Person"}
            </div>

            <div class="people-row-meta">
                ID: ${person.idNumber ?? "Unknown"} • ${person.category ?? "Person"}
            </div>

        </div>

    </div>
    `;

});
console.log(document.querySelectorAll(".person-row").length);
document.querySelectorAll(".person-row").forEach(row => {

    row.onclick = function () {

        openPersonProfile(this.dataset.id);

    };

});
document.getElementById("addPersonBtn").onclick = function () {

    const modal = document.createElement("div");

    modal.className = "modal-backdrop-custom";

    modal.innerHTML = `
<div class="modal-card" style="max-width:900px;">

<h2>${p.name ?? ""} ${p.surname ?? ""}</h2>

<div class="people-profile-grid">

<div>

<label>Date of Birth</label>
<input value="${p.dob ?? ""}" readonly>

<label>ID Number</label>
<input value="${p.idNumber ?? ""}" readonly>

<label>Known Aliases</label>
<input value="${p.aliases ?? ""}" readonly>

<label>Originally From</label>
<input value="${p.origin ?? ""}" readonly>

<label>Current Residence</label>
<input value="${p.residence ?? ""}" readonly>

</div>

<div>

<label>Previous Arrests</label>
<textarea readonly>${p.previousArrests ?? ""}</textarea>

<label>Items Found in Possession</label>
<textarea readonly>${p.itemsFound ?? ""}</textarea>

<label>Profiling Location</label>
<input value="${p.profilingLocation ?? ""}" readonly>

</div>

</div>

<hr>

<h3>Encounters</h3>

<div class="people-empty">

No encounters recorded yet.

</div>

<hr>

<h3>Linked Vehicles</h3>

<div class="people-empty">

No vehicles linked.

</div>

<hr>

<div class="modal-actions">

<button class="btn-ghost" id="editPerson">

Edit

</button>

<button class="btn-primary" id="closeProfile">

Close

</button>

</div>

</div>
`;

    document.body.appendChild(modal);

// Cancel
document.getElementById("cancelPerson").onclick = function () {
    modal.remove();
};

// Save
document.getElementById("savePerson").onclick = async function () {

    console.log("Save button clicked");

    const person = {

        name: document.getElementById("personName").value.trim(),

        surname: document.getElementById("personSurname").value.trim(),

        dob: document.getElementById("personDOB").value,

        idNumber: document.getElementById("personID").value.trim(),

        aliases: document.getElementById("personAlias").value.trim(),

        origin: document.getElementById("personOrigin").value.trim(),

        residence: document.getElementById("personResidence").value.trim(),

        previousArrests: document.getElementById("personArrests").value.trim(),

        profilingLocation: document.getElementById("personLocation").value.trim(),

        itemsFound: document.getElementById("personItems").value.trim(),

        created: serverTimestamp()

    };

    if (!person.name || !person.surname) {

        document.getElementById("personError").textContent =
            "Name and Surname are required.";

        return;

    }

    const existing = await getDocs(collection(db, "people"));

let duplicate = false;

existing.forEach(doc => {
    const data = doc.data();

    if (
        person.idNumber &&
        data.idNumber &&
        data.idNumber === person.idNumber
    ) {
        duplicate = true;
    }
});

if (duplicate) {

    document.getElementById("personError").textContent =
        "A person with this ID Number already exists.";

    return;
}
        await addDoc(collection(db, "people"), person);

    modal.remove();

    showPeople();

}; // end savePerson

}; // end addPersonBtn.onclick
async function openPersonProfile(id) {

    const snap = await getDoc(doc(db, "people", id));

    if (!snap.exists()) return;

    const p = snap.data();

    const modal = document.createElement("div");

    modal.className = "modal-backdrop-custom";

    modal.innerHTML = `
<div class="modal-card">

<h2>${p.name ?? ""} ${p.surname ?? ""}</h2>

<label>ID Number</label>
<input value="${p.idNumber ?? ""}" readonly>

<label>Date of Birth</label>
<input value="${p.dob ?? ""}" readonly>

<label>Known Aliases</label>
<input value="${p.aliases ?? ""}" readonly>

<label>Originally From</label>
<input value="${p.origin ?? ""}" readonly>

<label>Current Residence</label>
<input value="${p.residence ?? ""}" readonly>

<label>Previous Arrests</label>
<textarea readonly>${p.previousArrests ?? ""}</textarea>

<label>Profiling Location</label>
<input value="${p.profilingLocation ?? ""}" readonly>

<label>Items Found</label>
<textarea readonly>${p.itemsFound ?? ""}</textarea>

<div class="modal-actions">
    <button class="btn-primary" id="closeProfile">Close</button>
</div>

</div>
`;

    document.body.appendChild(modal);

    document.getElementById("closeProfile").onclick = function () {
        modal.remove();
    };

}


}