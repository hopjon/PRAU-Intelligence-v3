import { logout } from "./auth.js";

export function showDashboard(user) {

    const app = document.getElementById("app");

    app.innerHTML = `
    <div class="dashboard">

        <aside class="sidebar">

            <div class="logo">
                <img src="images/PRAU logo.png" alt="PRAU">
                <h2>PRAU Intelligence</h2>
            </div>

            <nav>

                <button class="menu-item active">
                    <i class="bi bi-house-door-fill"></i>
                    Dashboard
                </button>

                <button class="menu-item">
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

        <main class="content">

            <div class="topbar">

                <div>
                    <h1>Welcome Back</h1>
                    <small>${user.email}</small>
                </div>

                <button id="logoutBtn" class="login-btn">
                    <i class="bi bi-box-arrow-right"></i>
                    Logout
                </button>

            </div>

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

        </main>

    </div>
    `;

    document
        .getElementById("logoutBtn")
        .onclick = logout;

}