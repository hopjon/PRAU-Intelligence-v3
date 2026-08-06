import {
    collection,
    getDocs,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "../firebase.js";

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

    

    list.innerHTML += `
    <div class="person-row">

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
document.getElementById("addPersonBtn").onclick = function () {

    const modal = document.createElement("div");

    modal.className = "modal-backdrop-custom";

    modal.innerHTML = `
<div class="modal-card">

<h2>Add Person</h2>

<label>Name</label>
<input id="personName" type="text">

<label>Surname</label>
<input id="personSurname" type="text">

<label>Date of Birth</label>
<input id="personDOB" type="date">

<label>ID Number</label>
<input id="personID" type="text">

<label>Known Aliases</label>
<input id="personAlias" type="text" placeholder="Comma separated">

<hr>

<label>Originally From / Place of Birth</label>
<input id="personOrigin" type="text">

<label>Current Residence</label>
<input id="personResidence" type="text">

<hr>

<label>Previous Arrests / Convictions</label>
<textarea id="personArrests"></textarea>

<label>Profiling Location</label>
<input id="personLocation" type="text">

<label>Items Found in Possession</label>
<textarea id="personItems"></textarea>

<hr>

<label>Main Photograph</label>
<input id="personPhoto" type="file" accept="image/*">

<label>Additional Photographs</label>
<input id="personPhotos" type="file" multiple accept="image/*">

<div class="modal-actions">

<button class="btn-ghost" id="cancelPerson">
Cancel
</button>

<button class="btn-primary" id="savePerson">
Save Person
</button>

</div>

<div class="modal-error" id="personError"></div>

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

    await addDoc(collection(db, "people"), person);

    modal.remove();

    showPeople();

};






    

}}