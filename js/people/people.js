import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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

            

        <div id="peopleList" class="people-list">

            Loading...

        </div>
    `;

    const list = document.getElementById("peopleList");

    
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

            <label>Full Name</label>
            <input type="text" placeholder="Enter full name">

            <label>ID Number</label>
            <input type="text" placeholder="Enter ID Number">

            <div class="modal-actions">
                <button class="btn-ghost" id="cancelPerson">Cancel</button>
                <button class="btn-primary">Save</button>
            </div>

        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById("cancelPerson").onclick = function () {
        modal.remove();
    };

};

}