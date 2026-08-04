import { logout } from "./auth.js";
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
function getCards(){

    return `

        <div class="cards">

            <div class="card">
                <h3>People Database</h3>
                <p>Coming Soon</p>
            </div>

            <div class="card">
                <h3>Vehicle Database</h3>
                <p>Coming Soon</p>
            </div>

            <div class="card">
                <h3>Face Recognition</h3>
                <p>Coming Soon</p>
            </div>

            <div class="card">
                <h3>Plate Recognition</h3>
                <p>Coming Soon</p>
            </div>

        </div>

    `;

}
function getMenu(){

    return `

        <aside class="sidebar">

            <div class="logo">

                <img src="images/prau-logo.png" alt="PRAU">

                <h2>PRAU Intelligence</h2>

            </div>

            <nav>

                <button class="menu-item active">
                    <i class="bi bi-house-door-fill"></i>
                    Dashboard
                </button>

             <button class="menu-item" id="peopleMenu">
    <i class="bi bi-person-fill"></i>
    People
</button>

                <button class="menu-item">
                    <i class="bi bi-car-front-fill"></i>
                    Vehicles
                </button>

                <button class="menu-item">
                    <i class="bi bi-camera-fill"></i>
                    Face Search
                </button>

                <button class="menu-item">
                    <i class="bi bi-search"></i>
                    Plate Search
                </button>

                <button class="menu-item">
                    <i class="bi bi-upload"></i>
                    Bulk Import
                </button>

                <button class="menu-item">
                    <i class="bi bi-gear-fill"></i>
                    Settings
                </button>

            </nav>

        </aside>

    `;

}
function getDateTime() {

    const now = new Date();

    return now.toLocaleString("en-ZA", {

        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"

    });

}
function getGreeting() {

    const hour = new Date().getHours();

    if (hour < 12) {
        return "☀️ Good Morning";
    }

    if (hour < 18) {
        return "🌤 Good Afternoon";
    }

    return "🌙 Good Evening";

}
export async function showDashboard(user) {

    const app = document.getElementById("app");

    var displayName = user.email.split("@")[0];
    displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);

    try{
      var snap = await getDoc(doc(db, "teamMembers", user.email));
      if(snap.exists() && snap.data().name){
        displayName = snap.data().name;
      }
    }catch(e){ console.error("name lookup failed", e); }

    app.innerHTML = `
    <div class="dashboard">
  ${getMenu()}

        <main class="content">

            <div class="topbar">

               
    

    <div class="welcome-text">
        <h1>${getGreeting()}, ${displayName}</h1>
        <div class="date-time">${getDateTime()}</div>
        <div class="user-role">Administrator</div>
    </div>





                <button id="logoutBtn" class="logout-btn">
                    <i class="bi bi-box-arrow-right"></i>
                    Logout
                </button>

            </div>
${getCards()}


        </main>

    </div>
    `;

    document
        .getElementById("logoutBtn")
        .onclick = logout;
alert("People Module coming next!");
}