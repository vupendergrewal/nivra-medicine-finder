const tokenKey = "nivra-token";
const userKey = "nivra-user";
let overview = null;

function token() {
    return localStorage.getItem(tokenKey) || "";
}

function user() {
    try {
        return JSON.parse(localStorage.getItem(userKey) || "null");
    } catch {
        return null;
    }
}

async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
}

function showLogin(message = "") {
    document.querySelector("#adminLoginCard").hidden = false;
    document.querySelector("#adminApp").hidden = true;
    document.querySelector("#adminRefresh").hidden = true;
    document.querySelector("#adminLoginMessage").textContent = message;
}

function showApp() {
    document.querySelector("#adminLoginCard").hidden = true;
    document.querySelector("#adminApp").hidden = false;
    document.querySelector("#adminRefresh").hidden = false;
    const current = user();
    document.querySelector("#adminGreeting").textContent =
        `Signed in as ${current.name}. Verify pharmacies, confirm holds, and keep scarcity visible.`;
}

function renderStats(stats) {
    document.querySelector("#adminStats").innerHTML = [
        ["Pharmacies online", stats.pharmaciesOnline],
        ["Pending listings", stats.pendingListings],
        ["Open reservations", stats.reservationsOpen],
        ["Open urgent", stats.urgentOpen || 0],
        ["Live SKUs", stats.inventorySkus || 0],
        ["Users", stats.usersTotal || 0],
    ]
        .map(
            ([label, value]) =>
                `<div class="admin-stat"><strong>${value}</strong><span>${label}</span></div>`
        )
        .join("");
}

function statusChip(status) {
    return `<span class="admin-chip status-${status}">${status}</span>`;
}

function renderPharmacies(pharmacies) {
    const root = document.querySelector("#adminPharmacies");
    root.innerHTML =
        pharmacies
            .map(
                (pharmacy) => `
        <div class="admin-row">
            <div>
                <strong>${pharmacy.name}</strong><br>
                <small>${pharmacy.address} · ${pharmacy.pincode} · ${pharmacy.license_number}</small>
                ${pharmacy.notes ? `<br><small>Note: ${pharmacy.notes}</small>` : ""}
            </div>
            <div>${statusChip(pharmacy.status)}</div>
            <div class="admin-actions">
                <button class="filter" data-detail="${pharmacy.id}">Inventory</button>
                ${
                    pharmacy.status === "pending"
                        ? `<button class="filter" data-verify="${pharmacy.id}">Verify</button>
                           <button class="filter" data-reject="${pharmacy.id}">Reject</button>`
                        : `<button class="filter" data-reverify="${pharmacy.id}">Re-verify stock</button>`
                }
            </div>
        </div>`
            )
            .join("") || "<p>No pharmacies yet.</p>";
}

function renderReservations(reservations) {
    document.querySelector("#adminReservations").innerHTML =
        reservations
            .map(
                (item) => `
        <div class="admin-row">
            <div>
                <strong>${item.brand || item.medicine_name}</strong><br>
                <small>${item.customer_name} · ${item.phone} · hold until ${item.hold_until || "—"}</small>
            </div>
            <div>${item.pharmacy_name}<br>${statusChip(item.status)}</div>
            <div class="admin-actions">
                ${
                    item.status === "requested"
                        ? `<button class="filter" data-confirm-res="${item.id}">Confirm</button>`
                        : ""
                }
                ${
                    ["requested", "confirmed"].includes(item.status)
                        ? `<button class="filter" data-cancel-res="${item.id}">Cancel</button>`
                        : ""
                }
            </div>
        </div>`
            )
            .join("") || "<p>No reservations yet.</p>";
}

function renderUrgent(urgent) {
    document.querySelector("#adminUrgent").innerHTML =
        urgent
            .map(
                (item) => `
        <div class="admin-row">
            <div>
                <strong>${item.medicine}</strong><br>
                <small>${item.location} · ${item.pharmacies_notified} pharmacies notified</small>
            </div>
            <div>${item.radius_km} km<br>${statusChip(item.status)}</div>
            <div class="admin-actions">
                ${
                    item.status === "broadcast"
                        ? `<button class="filter" data-resolve-urgent="${item.id}">Mark resolved</button>`
                        : ""
                }
            </div>
        </div>`
            )
            .join("") || "<p>No urgent requests yet.</p>";
}

function renderLowStock(items) {
    document.querySelector("#adminLowStock").innerHTML =
        (items || [])
            .map(
                (item) => `
        <div class="admin-row">
            <div>
                <strong>${item.brand}</strong><br>
                <small>${item.pharmacy} · ${item.area}</small>
            </div>
            <div>${item.packs} pack${item.packs === 1 ? "" : "s"} left</div>
            <div>${item.price}</div>
        </div>`
            )
            .join("") || "<p>No low-stock alerts right now.</p>";
}

function renderActivity(activity) {
    document.querySelector("#adminActivity").innerHTML =
        (activity || [])
            .map(
                (item) => `
        <div class="admin-row admin-activity-row">
            <div>
                <strong>${item.action}</strong><br>
                <small>${item.detail}</small>
            </div>
            <div>${item.actor_name || "system"}</div>
            <div><small>${item.created_at}</small></div>
        </div>`
            )
            .join("") || "<p>No activity yet.</p>";
}

function renderUsers(users) {
    document.querySelector("#adminUsers").innerHTML =
        users
            .map(
                (item) => `
        <div class="admin-row">
            <div>
                <strong>${item.name}</strong><br>
                <small>${item.email}${item.phone ? ` · ${item.phone}` : ""}</small>
            </div>
            <div>${statusChip(item.role)}</div>
            <div><small>${item.created_at}</small></div>
        </div>`
            )
            .join("") || "<p>No users.</p>";
}

function renderFeedback(items) {
    document.querySelector("#adminFeedback").innerHTML =
        (items || [])
            .map(
                (item) => `
        <div class="admin-row">
            <div>
                <strong>${item.name}</strong><br>
                <small>${item.message}</small>
            </div>
            <div>${item.email || "—"}</div>
            <div><small>${item.created_at}</small></div>
        </div>`
            )
            .join("") || "<p>No feedback yet.</p>";
}

async function showPharmacyDetail(id) {
    const data = await api(`/api/admin/pharmacies/${id}`);
    const panel = document.querySelector("#adminDetail");
    panel.hidden = false;
    document.querySelector("#detailTitle").textContent = data.pharmacy.name;
    document.querySelector("#detailBody").innerHTML =
        `<p><small>${data.pharmacy.address} · ${data.pharmacy.pincode} · ${data.pharmacy.status}</small></p>` +
        (data.inventory
            .map(
                (item) => `
            <div class="admin-row">
                <div><strong>${item.brand}</strong><br><small>${item.medicine} · ${item.strength}</small></div>
                <div>${item.packs} packs</div>
                <div>${item.price}</div>
            </div>`
            )
            .join("") || "<p>No inventory listed.</p>");
}

async function loadDesk() {
    overview = await api("/api/admin/overview");
    renderStats(overview.stats);
    renderPharmacies(overview.pharmacies);
    renderReservations(overview.reservations);
    renderUrgent(overview.urgent);
    renderLowStock(overview.lowStock);
    renderActivity(overview.activity);
    renderUsers(overview.users);
    renderFeedback(overview.feedback);
}

function setTab(name) {
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
        button.classList.toggle("active", button.dataset.adminTab === name);
    });
    document.querySelectorAll("[data-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.panel !== name;
    });
}

async function boot() {
    const current = user();
    if (!current || current.role !== "admin" || !token()) {
        showLogin(current && current.role !== "admin" ? "Sign in with the admin account to continue." : "");
        return;
    }
    try {
        await api("/api/auth/me");
        showApp();
        await loadDesk();
    } catch (error) {
        localStorage.removeItem(tokenKey);
        localStorage.removeItem(userKey);
        showLogin("Session expired. Sign in again with admin@nivra.local / admin123.");
    }
}

document.querySelector("#adminLogin").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#adminLoginMessage");
    message.textContent = "Checking credentials…";
    try {
        const data = await api("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
                email: document.querySelector("#adminEmail").value.trim(),
                password: document.querySelector("#adminPassword").value,
            }),
        });
        if (data.user.role !== "admin") {
            throw new Error("This account is not an admin. Use admin@nivra.local / admin123.");
        }
        localStorage.setItem(tokenKey, data.token);
        localStorage.setItem(userKey, JSON.stringify(data.user));
        message.textContent = "Signed in. Loading desk…";
        await boot();
    } catch (error) {
        message.textContent = error.message;
    }
});

document.querySelector("#adminSignOut").addEventListener("click", () => {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(userKey);
    showLogin("Signed out. Use admin@nivra.local / admin123 to return.");
});

document.querySelector("#adminRefresh").addEventListener("click", () => {
    loadDesk().catch((error) => alert(error.message));
});

document.querySelector("#expireHolds").addEventListener("click", async () => {
    try {
        const data = await api("/api/admin/expire-holds", { method: "POST" });
        alert(data.message);
        await loadDesk();
    } catch (error) {
        alert(error.message);
    }
});

document.querySelector("#closeDetail").addEventListener("click", () => {
    document.querySelector("#adminDetail").hidden = true;
});

document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.adminTab));
});

document.querySelector("#adminApp").addEventListener("click", async (event) => {
    const verify = event.target.closest("[data-verify]");
    const reject = event.target.closest("[data-reject]");
    const reverify = event.target.closest("[data-reverify]");
    const detail = event.target.closest("[data-detail]");
    const confirmRes = event.target.closest("[data-confirm-res]");
    const cancelRes = event.target.closest("[data-cancel-res]");
    const resolveUrgent = event.target.closest("[data-resolve-urgent]");

    try {
        if (detail) {
            await showPharmacyDetail(detail.dataset.detail);
            return;
        }
        if (verify) {
            await api(`/api/admin/pharmacies/${verify.dataset.verify}/verify`, {
                method: "POST",
                body: JSON.stringify({ notes: "Licence and stock checked." }),
            });
        }
        if (reject) {
            const notes = window.prompt("Rejection note", "Incomplete licence details.") || "";
            await api(`/api/admin/pharmacies/${reject.dataset.reject}/reject`, {
                method: "POST",
                body: JSON.stringify({ notes }),
            });
        }
        if (reverify) {
            await api(`/api/admin/pharmacies/${reverify.dataset.reverify}/reverify`, { method: "POST" });
        }
        if (confirmRes) {
            await api(`/api/reservations/${confirmRes.dataset.confirmRes}/confirm`, { method: "POST" });
        }
        if (cancelRes) {
            await api(`/api/reservations/${cancelRes.dataset.cancelRes}/cancel`, { method: "POST" });
        }
        if (resolveUrgent) {
            await api(`/api/urgent/${resolveUrgent.dataset.resolveUrgent}/resolve`, {
                method: "POST",
                body: JSON.stringify({ note: "Stock found or request closed by admin." }),
            });
        }
        if (verify || reject || reverify || confirmRes || cancelRes || resolveUrgent) {
            await loadDesk();
        }
    } catch (error) {
        alert(error.message);
    }
});

boot();
