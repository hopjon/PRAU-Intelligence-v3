import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "../firebase.js";

export async function showPeople() {

    const content = document.getElementById("contentArea");
console.log("showPeople() was called");
    content.innerHTML = `
        <div class="page-header">
            <h1><i class="bi bi-person-fill"></i> People Database</h1>
        </div>

        <div class="search-bar">
            <input
                type="text"
                id="peopleSearch"
                placeholder="Search people..."
            >

            <button class="gold-btn" id="addPersonBtn">
                <i class="bi bi-plus-circle-fill"></i>
                Add Person
            </button>
        </div>

        <div id="peopleList" class="people-list">

            Loading...

        </div>
    `;

    const list = document.getElementById("peopleList");

    const snapshot = await getDocs(collection(db, "people"));

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

    snapshot.forEach(doc=>{

        const person = doc.data();

        list.innerHTML += `
            <div class="person-row">

                <div class="person-avatar">
                    <i class="bi bi-person-fill"></i>
                </div>

                <div class="person-details">

                    <strong>${person.name ?? "Unnamed Person"}</strong>

                    <small>${doc.id}</small>

                </div>

            </div>
        `;

    });

}