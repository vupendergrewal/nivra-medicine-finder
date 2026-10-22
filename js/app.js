const API = {
    tokenKey: "nivra-token",
    userKey: "nivra-user",
    token() {
        return localStorage.getItem(this.tokenKey) || "";
    },
    user() {
        try {
            return JSON.parse(localStorage.getItem(this.userKey) || "null");
        } catch {
            return null;
        }
    },
    setSession(token, user) {
        localStorage.setItem(this.tokenKey, token);
        localStorage.setItem(this.userKey, JSON.stringify(user));
    },
    clear() {
        localStorage.removeItem(this.tokenKey);
        localStorage.removeItem(this.userKey);
    },
    async request(path, options = {}) {
        const headers = { ...(options.headers || {}) };
        if (options.body && !headers["Content-Type"]) {
            headers["Content-Type"] = "application/json";
        }
        const token = this.token();
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(path, { ...options, headers });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || "Request failed.");
        }
        return data;
    },
};

let inventory = [];
let activeReservationItem = null;
let authMode = "login";
let searchTimer;

const state = {
    filter: "all",
    query: "",
    activeCard: 1,
    radius: 50,
    sort: "distance",
    openNow: false,
};

const ownerDraftProducts = [];
let ownerCoordinates = null;

document.body.classList.add("loading");

const elements = {
    results: document.querySelector("#pharmacyResults"),
    finderInput: document.querySelector("#finderInput"),
    finderArea: document.querySelector("#finderArea"),
    heroMedicine: document.querySelector("#heroMedicine"),
    heroLocation: document.querySelector("#heroLocation"),
    heroSearch: document.querySelector("#heroSearch"),
    reservationDialog: document.querySelector("#reservationDialog"),
    emergencyDialog: document.querySelector("#emergencyDialog"),
    reservationSummary: document.querySelector("#reservationSummary"),
    reservationPharmacy: document.querySelector("#reservationPharmacy"),
    reservationTitle: document.querySelector("#reservationTitle"),
    reservationMessage: document.querySelector("#reservationMessage"),
    emergencyMessage: document.querySelector("#emergencyMessage"),
    toast: document.querySelector("#toast"),
    voiceButton: document.querySelector("#voiceSearchButton"),
    prescriptionInput: document.querySelector("#prescriptionInput"),
    uploadZone: document.querySelector("#uploadZone"),
    scanViewport: document.querySelector("#scanViewport"),
    prescriptionPreview: document.querySelector("#prescriptionPreview"),
    scanStatus: document.querySelector("#scanStatus"),
    scanState: document.querySelector("#scanState"),
    scanProgress: document.querySelector("#scanProgress"),
    rxEmpty: document.querySelector("#rxEmpty"),
    detectedResults: document.querySelector("#detectedResults"),
    medicineChips: document.querySelector("#medicineChips"),
    ocrConfidence: document.querySelector("#ocrConfidence"),
    ocrLines: document.querySelector("#ocrLines"),
    ownerDialog: document.querySelector("#ownerDialog"),
    ownerProductList: document.querySelector("#ownerProductList"),
    ownerMessage: document.querySelector("#ownerMessage"),
    ownerLocationStatus: document.querySelector("#ownerLocationStatus"),
    authDialog: document.querySelector("#authDialog"),
    authForm: document.querySelector("#authForm"),
    authMessage: document.querySelector("#authMessage"),
    authNavButton: document.querySelector("#authNavButton"),
    adminNavLink: document.querySelector("#adminNavLink"),
    ownerNavLink: document.querySelector("#ownerNavLink"),
};

function normalize(value) {
    return String(value || "").trim().toLowerCase();
}

function priceValue(item) {
    const value = Number(String(item.price || "").replace(/[^\d.]/g, ""));
    return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}

function toMinutes(hour, minute, meridiem) {
    let h = Number(hour) % 12;
    if (String(meridiem).toUpperCase() === "PM") h += 12;
    return h * 60 + Number(minute);
}

function isOpenNow(item) {
    const hours = String(item.hours || "");
    if (/24/.test(hours)) return true;
    const match = hours.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return true;
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const open = toMinutes(match[1], match[2], match[3]);
    const close = toMinutes(match[4], match[5], match[6]);
    return close > open ? current >= open && current <= close : current >= open || current <= close;
}

function currentResults() {
    let rows = inventory.slice();
    if (state.openNow) rows = rows.filter(isOpenNow);
    if (state.sort === "price") rows.sort((a, b) => priceValue(a) - priceValue(b) || a.distance - b.distance);
    else if (state.sort === "match") rows.sort((a, b) => (b.match || 0) - (a.match || 0) || a.distance - b.distance);
    else rows.sort((a, b) => a.distance - b.distance);
    return rows;
}

function radiusKm() {
    return state.radius || 50;
}

async function loadInventory() {
    const query = state.query || "";
    const location = elements.heroLocation?.value || "Rohtak 124001";
    const data = await API.request(
        `/api/search?q=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&filter=${encodeURIComponent(state.filter)}&radius=${radiusKm()}`
    );
    inventory = data.results || [];
    if (query.trim().length >= 3) rememberSearch(query.trim());
    if (!inventory.some((item) => item.id === state.activeCard)) {
        state.activeCard = inventory[0]?.id || null;
    }
    renderResults();
    updateSaltGuide(data.saltGuide);
    await syncLiveMap(query, location);
    return inventory;
}

function updateSaltGuide(guide) {
    if (!guide || !guide.prescribed) return;
    const prescribed = guide.prescribed;
    const alts = guide.alternatives || [];
    const brand = document.querySelector("#saltPrescribedBrand");
    const detail = document.querySelector("#saltPrescribedDetail");
    const altBrand = document.querySelector("#saltAltBrand");
    const altDetail = document.querySelector("#saltAltDetail");
    const saltChip = document.querySelector("#saltLabelChip");
    const altList = document.querySelector("#saltAltList");
    if (!brand) return;
    brand.textContent = prescribed.brand;
    detail.textContent = `${prescribed.name} · ${prescribed.strength}`;
    if (saltChip) {
        saltChip.textContent = `Salt: ${prescribed.saltLabel || prescribed.name}`;
    }
    if (alts.length) {
        altBrand.textContent = alts
            .slice(0, 3)
            .map((item) => item.brand)
            .join(" · ");
        altDetail.textContent = `${alts.length} same-salt brand${alts.length === 1 ? "" : "s"} in the Nivra catalog`;
        if (altList) {
            altList.innerHTML = alts
                .slice(0, 5)
                .map(
                    (item) =>
                        `<li><strong>${item.brand}</strong> · ${item.strength}${
                            item.shopsWithStock
                                ? ` · ${item.shopsWithStock} shop${item.shopsWithStock === 1 ? "" : "s"}`
                                : ""
                        }</li>`
                )
                .join("");
        }
    } else {
        altBrand.textContent = "No alternate brand listed";
        altDetail.textContent = "Same-salt options will appear when available";
        if (altList) altList.innerHTML = "";
    }
}

async function syncLiveMap(query, location) {
    if (!window.NivraMap) return;

    function markersFromInventory(items) {
        const byPharmacy = new Map();
        (items || []).forEach((item) => {
            const coords = item.coordinates || {};
            if (coords.latitude == null || coords.longitude == null) return;
            const pharmacyId = item.pharmacyId;
            const existing = byPharmacy.get(pharmacyId);
            if (!existing || (item.match || 0) > (existing.match || 0)) {
                byPharmacy.set(pharmacyId, {
                    pharmacyId,
                    inventoryId: item.id,
                    name: item.pharmacy,
                    area: item.area,
                    distance: item.distance,
                    medicine: item.medicine,
                    brand: item.brand,
                    strength: item.strength,
                    stock: item.stock,
                    packs: item.packs,
                    price: item.price,
                    coldChain: item.coldChain,
                    ownerListed: item.ownerListed,
                    match: item.match,
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                    hours: item.hours,
                });
            }
        });
        return Array.from(byPharmacy.values()).sort((a, b) => a.distance - b.distance);
    }

    try {
        if (!window.NivraMap.ready()) {
            await window.NivraMap.init("cityMap", {
                onSelect(marker) {
                    state.activeCard = marker.inventoryId;
                    renderResults();
                    const card = document.querySelector(`.pharmacy-card[data-id="${marker.inventoryId}"]`);
                    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    showToast(`${marker.name} · ${marker.distance} km`);
                },
            });
        }
        const mapData = await API.request(
            `/api/map?q=${encodeURIComponent(query || "")}&location=${encodeURIComponent(location || "Rohtak 124001")}&filter=${encodeURIComponent(state.filter)}&radius=${radiusKm()}`
        );
        // Prefer one pin per pharmacy from the same listings the cards use,
        // so the map count always matches the result list.
        const markersFromResults = markersFromInventory(inventory);
        const markers = markersFromResults.length ? markersFromResults : mapData.markers || [];
        window.NivraMap.queuePayload({
            origin: mapData.origin,
            radiusKm: radiusKm(),
            markers,
            activeId: state.activeCard,
        });

        const matchLabel = document.querySelector("#mapMatchCount");
        if (matchLabel) {
            matchLabel.textContent = `${markers.length} pharmacy pin${markers.length === 1 ? "" : "s"} within ${radiusKm()} km`;
        }
        const hint = document.querySelector("#mapHint");
        if (hint) {
            const origin = mapData.origin || {};
            hint.textContent = origin.resolved
                ? `Centered on ${origin.label} · pins match the list`
                : `Using Rohtak fallback · live map tiles`;
        }
    } catch (error) {
        const matchLabel = document.querySelector("#mapMatchCount");
        if (matchLabel) matchLabel.textContent = "Map unavailable";
        console.warn("Map sync failed:", error);
    }
}

function scheduleInventoryLoad() {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
        loadInventory().catch((error) => showToast(error.message));
    }, 220);
}

function createBadge(text, className) {
    const badge = document.createElement("span");
    badge.className = className;
    badge.textContent = text;
    return badge;
}

function smartMatch(item) {
    const verifiedMinutes = Number.parseInt(item.verified, 10) || 15;
    const availabilityBonus = item.stock === "in-stock" ? 9 : 2;
    const score =
        100 -
        item.distance * 3.2 -
        verifiedMinutes * 0.55 +
        Math.min(item.packs, 10) * 0.55 +
        availabilityBonus -
        (item.ownerListed ? 12 : 0);
    return Math.max(72, Math.min(99, Math.round(score)));
}

function renderResults() {
    const matches = currentResults();
    elements.results.replaceChildren();

    if (matches.length === 0) {
        const empty = document.createElement("div");
        empty.className = "no-results";
        empty.innerHTML = "<strong>No exact match in this sample.</strong><br>Try another medicine or send an urgent network request.";
        elements.results.appendChild(empty);
        renderInsights([]);
        return;
    }

    const lowestPrice = Math.min(...matches.map(priceValue));
    matches.slice(0, 12).forEach((item, index) => {
        const cheapest = Number.isFinite(lowestPrice) && priceValue(item) === lowestPrice;
        const card = document.createElement("article");
        card.className = `pharmacy-card${item.id === state.activeCard ? " active" : ""}${cheapest ? " is-cheapest" : ""}`;
        card.dataset.id = String(item.id);

        const number = document.createElement("span");
        number.className = "pharmacy-index";
        number.textContent = String(index + 1).padStart(2, "0");

        const main = document.createElement("div");
        main.className = "pharmacy-main";

        const heading = document.createElement("h3");
        heading.textContent = item.pharmacy;

        const meta = document.createElement("p");
        meta.textContent = item.ownerListed
            ? `${item.area} · Owner listed · Pending verification`
            : `${item.area} · Verified ${item.verified}`;

        const medicineLine = document.createElement("div");
        medicineLine.className = "medicine-line";

        const medicine = document.createElement("strong");
        medicine.textContent = `${item.brand} · ${item.strength}`;
        medicineLine.appendChild(medicine);
        medicineLine.appendChild(
            createBadge(
                item.stock === "in-stock" ? `${item.packs} packs` : `Only ${item.packs} left`,
                `stock-badge ${item.stock === "in-stock" ? "stock-in" : "stock-low"}`
            )
        );
        if (item.coldChain) {
            medicineLine.appendChild(createBadge("2–8°C", "cold-badge"));
        }
        medicineLine.appendChild(createBadge(
            isOpenNow(item) ? "Open" : "Closed",
            isOpenNow(item) ? "stock-badge stock-in" : "pending-badge"
        ));
        if (cheapest && Number.isFinite(priceValue(item))) {
            medicineLine.appendChild(createBadge("Lowest price", "match-badge"));
        }
        if (item.ownerListed) {
            medicineLine.appendChild(createBadge("Pending verification", "pending-badge"));
        }
        medicineLine.appendChild(createBadge(`${item.match || smartMatch(item)}% smart match`, "match-badge"));

        main.append(heading, meta, medicineLine);

        const side = document.createElement("div");
        side.className = "pharmacy-side";

        const distance = document.createElement("span");
        distance.className = "distance";
        distance.textContent = `${item.distance.toFixed(1)} km · ${item.price}`;

        const actions = document.createElement("div");
        actions.className = "card-actions";

        if (item.phone) {
            const call = document.createElement("a");
            call.className = "ghost-button";
            call.href = `tel:${item.phone}`;
            call.textContent = "Call";
            call.addEventListener("click", (event) => event.stopPropagation());
            actions.appendChild(call);
        }

        const save = document.createElement("button");
        save.type = "button";
        save.className = "ghost-button";
        save.textContent = "Save";
        save.addEventListener("click", async (event) => {
            event.stopPropagation();
            if (!API.user()) {
                openAuthDialog("login");
                showToast("Sign in to save medicines.");
                return;
            }
            try {
                await API.request(`/api/favorites/${item.id}`, { method: "POST" });
                save.textContent = "Saved";
                showToast("Saved to your favorites.");
            } catch (error) {
                showToast(error.message);
            }
        });

        const reserve = document.createElement("button");
        reserve.type = "button";
        reserve.className = "reserve-button";
        reserve.textContent = item.ownerListed ? "View listing" : "Reserve";
        reserve.addEventListener("click", (event) => {
            event.stopPropagation();
            openReservation(item);
        });

        const coords = item.coordinates || {};
        if (coords.latitude != null && coords.longitude != null) {
            const directions = document.createElement("a");
            directions.className = "ghost-button";
            directions.href = `https://www.google.com/maps/dir/?api=1&destination=${coords.latitude},${coords.longitude}`;
            directions.target = "_blank";
            directions.rel = "noopener";
            directions.textContent = "Directions";
            directions.addEventListener("click", (event) => event.stopPropagation());
            actions.appendChild(directions);
        }

        actions.append(save, reserve);
        side.append(distance, actions);
        card.append(number, main, side);

        card.addEventListener("click", () => {
            state.activeCard = item.id;
            renderResults();
            if (window.NivraMap) window.NivraMap.highlight(item.id);
        });

        elements.results.appendChild(card);
        initSpotlight(card);
        initRipple(reserve);
        initRipple(save);
    });
    renderInsights(matches);

    const motionOn = !window.NivraMotion || window.NivraMotion.enabled();
    if (motionOn && typeof gsap !== "undefined") {
        gsap.fromTo(
            ".pharmacy-card",
            { opacity: 0, x: -18 },
            { opacity: 1, x: 0, duration: 0.55, stagger: 0.07, ease: "power3.out" }
        );
    }
}

function activateMapPin() {
    // Kept for compatibility; live map highlight is handled by NivraMap.
}

function setFilter(filter) {
    state.filter = filter;
    document.querySelectorAll(".filter").forEach((button) => {
        if (button.dataset.filter) {
            button.classList.toggle("active", button.dataset.filter === filter);
        }
    });
    loadInventory().catch((error) => showToast(error.message));
}

async function runHeroSearch() {
    const medicine = elements.heroMedicine.value.trim();
    const location = elements.heroLocation.value.trim();
    if (!medicine || !location) return;

    state.query = medicine;
    elements.finderInput.value = medicine;
    elements.finderArea.textContent = location.replace(/\d{6}/, "").replace(/[·,]/g, " ").trim() || "your area";
    state.filter = "all";
    document.querySelectorAll(".filter").forEach((button) => {
        if (button.dataset.filter) {
            button.classList.toggle("active", button.dataset.filter === "all");
        }
    });
    try {
        const matches = await loadInventory();
        document.querySelector("#finder").scrollIntoView({ behavior: "smooth" });
        showToast(`Showing ${matches.length || "nearby"} matches for ${medicine}.`);
        rememberSearch(medicine);
        if (window.NivraScene) window.NivraScene.pulse();
    } catch (error) {
        showToast(error.message);
    }
}

function openReservation(item) {
    activeReservationItem = item;
    elements.reservationTitle.textContent = `Reserve ${item.brand}`;
    elements.reservationPharmacy.textContent = item.ownerListed
        ? `${item.pharmacy} is newly listed. Licence and stock verification are still pending.`
        : `${item.pharmacy} will confirm stock and prescription requirements before the hold begins.`;
    elements.reservationSummary.replaceChildren();

    [
        item.strength,
        `${item.packs} pack${item.packs === 1 ? "" : "s"} listed`,
        `${item.distance.toFixed(1)} km away`,
        `Verified ${item.verified}`,
        item.price,
    ].forEach((text) => {
        const line = document.createElement("span");
        line.textContent = text;
        elements.reservationSummary.appendChild(line);
    });

    elements.reservationMessage.textContent = "";
    elements.reservationDialog.showModal();
    document.body.classList.add("dialog-open");
}

function openEmergency() {
    elements.emergencyMessage.textContent = "";
    elements.emergencyDialog.showModal();
    document.body.classList.add("dialog-open");
}

function closeDialog(dialog) {
    dialog.close();
    document.body.classList.remove("dialog-open");
}

let toastTimer;
function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 3200);
}

function setScanProgress(value, label) {
    const percent = Math.max(0, Math.min(100, Math.round(value)));
    elements.scanProgress.style.width = `${percent}%`;
    elements.scanStatus.textContent = label || `Reading prescription · ${percent}%`;
    elements.scanState.classList.toggle("active", percent > 0 && percent < 100);
    elements.scanState.innerHTML =
        percent >= 100 ? "<i></i> Complete" : percent > 0 ? "<i></i> Scanning" : "<i></i> Idle";
}

function demoPrescriptionImage() {
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1120">
            <rect width="900" height="1120" fill="#fffdf8"/>
            <rect x="55" y="55" width="790" height="1010" rx="14" fill="none" stroke="#d9d0c4" stroke-width="3"/>
            <text x="90" y="130" font-family="Arial" font-size="34" font-weight="700" fill="#18151e">CITY CARE CLINIC</text>
            <text x="90" y="175" font-family="Arial" font-size="18" fill="#746d78">Dr. A. Mehta · Internal Medicine</text>
            <line x1="90" y1="215" x2="810" y2="215" stroke="#d9d0c4" stroke-width="2"/>
            <text x="90" y="285" font-family="Arial" font-size="21" fill="#18151e">Patient: Sample Prescription</text>
            <text x="90" y="325" font-family="Arial" font-size="21" fill="#18151e">Date: 23 Aug 2026</text>
            <text x="90" y="420" font-family="Georgia" font-size="52" font-style="italic" fill="#8655ee">Rx</text>
            <text x="170" y="430" font-family="Arial" font-size="30" font-weight="700" fill="#18151e">Insulin Glargine 100 IU/ml</text>
            <text x="170" y="475" font-family="Arial" font-size="21" fill="#746d78">Use only as directed by physician</text>
            <text x="170" y="565" font-family="Arial" font-size="30" font-weight="700" fill="#18151e">Levetiracetam 500 mg</text>
            <text x="170" y="610" font-family="Arial" font-size="21" fill="#746d78">Continue prescribed schedule</text>
            <line x1="90" y1="730" x2="810" y2="730" stroke="#d9d0c4" stroke-width="2"/>
            <text x="90" y="795" font-family="Arial" font-size="18" fill="#746d78">Medicine substitution requires professional confirmation.</text>
            <path d="M580 910 C650 850 710 1000 790 900" fill="none" stroke="#18151e" stroke-width="4"/>
            <text x="650" y="1015" font-family="Arial" font-size="17" fill="#746d78">Doctor signature</text>
        </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const medicineDictionary = [
    { terms: ["insulin glargine", "lantus", "basaglar"], name: "Insulin Glargine", detail: "100 IU/ml" },
    { terms: ["levetiracetam", "keppra"], name: "Levetiracetam", detail: "500 mg" },
    { terms: ["adrenaline", "epinephrine"], name: "Adrenaline", detail: "1 mg/ml" },
    { terms: ["osimertinib", "tagrisso"], name: "Osimertinib", detail: "80 mg" },
    { terms: ["human albumin", "alburel"], name: "Human Albumin", detail: "20%" },
    { terms: ["metformin"], name: "Metformin", detail: "500 mg" },
    { terms: ["amoxicillin"], name: "Amoxicillin", detail: "500 mg" },
    { terms: ["atorvastatin"], name: "Atorvastatin", detail: "10 mg" },
];

function detectMedicines(text) {
    const normalized = normalize(text);
    return medicineDictionary.filter((medicine) =>
        medicine.terms.some((term) => normalized.includes(term))
    );
}

function showDetectedMedicines(medicines, confidence, lineCount) {
    elements.rxEmpty.hidden = true;
    elements.detectedResults.hidden = false;
    elements.medicineChips.replaceChildren();

    if (medicines.length === 0) {
        const message = document.createElement("p");
        message.className = "scan-caution";
        message.textContent =
            "No supported medicine name was detected confidently. Try a clearer, well-lit image.";
        elements.medicineChips.appendChild(message);
    } else {
        medicines.forEach((medicine, index) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "medicine-chip";

            const chipIndex = document.createElement("span");
            chipIndex.className = "medicine-chip-index";
            chipIndex.textContent = String(index + 1).padStart(2, "0");

            const copy = document.createElement("span");
            const name = document.createElement("strong");
            name.textContent = medicine.name;
            const detail = document.createElement("small");
            detail.textContent = medicine.detail;
            copy.append(name, detail);

            const arrow = document.createElement("span");
            arrow.className = "medicine-chip-arrow";
            arrow.textContent = "→";

            chip.append(chipIndex, copy, arrow);
            chip.addEventListener("click", () => {
                elements.finderInput.value = medicine.name;
                elements.heroMedicine.value = medicine.name;
                state.query = medicine.name;
                setFilter("all");
                document.querySelector("#finder").scrollIntoView({ behavior: "smooth" });
                showToast(`Searching verified stock for ${medicine.name}.`);
            });

            elements.medicineChips.appendChild(chip);
            initRipple(chip);
        });
    }

    elements.ocrConfidence.textContent = `${Math.round(confidence)}%`;
    elements.ocrLines.textContent = String(lineCount);

    if (typeof gsap !== "undefined") {
        gsap.fromTo(
            ".medicine-chip",
            { opacity: 0, x: 24 },
            { opacity: 1, x: 0, duration: 0.6, stagger: 0.1, ease: "power3.out" }
        );
    }
}

function beginScanVisual(source) {
    elements.uploadZone.hidden = true;
    elements.scanViewport.hidden = false;
    elements.prescriptionPreview.src = source;
    elements.scanViewport.classList.add("scanning");
    elements.detectedResults.hidden = true;
    elements.rxEmpty.hidden = false;
    setScanProgress(3, "Preparing image");
}

function finishScan(medicines, confidence, lines) {
    elements.scanViewport.classList.remove("scanning");
    setScanProgress(100, "Prescription read");
    showDetectedMedicines(medicines, confidence, lines);
    showToast(`${medicines.length} medicine${medicines.length === 1 ? "" : "s"} detected.`);
}

async function scanPrescription(file) {
    const source = URL.createObjectURL(file);
    beginScanVisual(source);

    try {
        if (typeof window.NivraLoadOcr === "function") {
            setScanProgress(3, "Loading OCR…");
            await window.NivraLoadOcr();
        }
    } catch {
        setScanProgress(0, "OCR unavailable");
        elements.scanViewport.classList.remove("scanning");
        showToast("OCR library could not load. Try the demo scan.");
        URL.revokeObjectURL(source);
        return;
    }

    if (typeof Tesseract === "undefined") {
        setScanProgress(0, "OCR unavailable");
        elements.scanViewport.classList.remove("scanning");
        showToast("OCR library could not load. Try the demo scan.");
        URL.revokeObjectURL(source);
        return;
    }

    try {
        const result = await Tesseract.recognize(file, "eng", {
            logger: (event) => {
                if (event.status !== "recognizing text") return;
                setScanProgress(event.progress * 94 + 5);
            },
        });
        const text = result.data.text || "";
        const medicines = detectMedicines(text);
        const lines = text.split(/\r?\n/).filter((line) => line.trim()).length;
        finishScan(medicines, result.data.confidence || 0, lines);
    } catch (error) {
        console.error("Prescription scan failed:", error);
        elements.scanViewport.classList.remove("scanning");
        setScanProgress(0, "Could not read image");
        showToast("The image could not be read. Try a clearer image or the demo scan.");
    } finally {
        URL.revokeObjectURL(source);
    }
}

function runDemoScan() {
    beginScanVisual(demoPrescriptionImage());
    let progress = 4;
    const timer = window.setInterval(() => {
        progress += Math.max(2, Math.round((100 - progress) * 0.13));
        progress = Math.min(progress, 96);
        setScanProgress(progress);
    }, 110);

    window.setTimeout(() => {
        window.clearInterval(timer);
        finishScan(
            [
                { name: "Insulin Glargine", detail: "100 IU/ml" },
                { name: "Levetiracetam", detail: "500 mg" },
            ],
            96,
            8
        );
    }, 2200);
}

function initRxLens() {
    const demoButton = document.querySelector("#demoScanButton");

    elements.uploadZone.addEventListener("click", () => elements.prescriptionInput.click());
    elements.scanViewport.addEventListener("click", () => elements.prescriptionInput.click());
    elements.prescriptionInput.addEventListener("change", () => {
        const [file] = elements.prescriptionInput.files;
        if (file) scanPrescription(file);
    });

    ["dragenter", "dragover"].forEach((eventName) => {
        elements.uploadZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            elements.uploadZone.classList.add("dragging");
        });
    });
    ["dragleave", "drop"].forEach((eventName) => {
        elements.uploadZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            elements.uploadZone.classList.remove("dragging");
        });
    });
    elements.uploadZone.addEventListener("drop", (event) => {
        const [file] = event.dataTransfer.files;
        if (file?.type.startsWith("image/")) scanPrescription(file);
    });

    demoButton.addEventListener("click", runDemoScan);
}

function initVoiceSearch() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const button = elements.voiceButton;

    button.addEventListener("click", () => {
        if (!SpeechRecognition) {
            button.classList.add("listening");
            showToast("Voice preview listening…");
            window.setTimeout(() => {
                elements.heroMedicine.value = "Insulin Glargine";
                button.classList.remove("listening");
                showToast("Heard: Insulin Glargine");
            }, 1500);
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = "en-IN";
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.addEventListener("start", () => {
            button.classList.add("listening");
            showToast("Listening for a medicine name…");
        });
        recognition.addEventListener("result", (event) => {
            const transcript = event.results[0][0].transcript;
            elements.heroMedicine.value = transcript;
            showToast(`Heard: ${transcript}`);
        });
        recognition.addEventListener("error", () => {
            showToast("Voice search could not hear clearly. Please try again.");
        });
        recognition.addEventListener("end", () => button.classList.remove("listening"));
        recognition.start();
    });
}

function renderOwnerProducts() {
    elements.ownerProductList.replaceChildren();

    if (ownerDraftProducts.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "No medicines added yet.";
        elements.ownerProductList.appendChild(empty);
        return;
    }

    ownerDraftProducts.forEach((product, index) => {
        const item = document.createElement("div");
        item.className = "owner-product";

        const copy = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = `${product.brand} · ${product.strength}`;
        const details = document.createElement("small");
        details.textContent =
            `${product.medicine} · ${product.packs} pack${product.packs === 1 ? "" : "s"}` +
            `${product.coldChain ? " · Cold chain" : ""}`;
        copy.append(name, details);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove-product";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `Remove ${product.brand}`);
        remove.addEventListener("click", () => {
            ownerDraftProducts.splice(index, 1);
            renderOwnerProducts();
        });

        item.append(copy, remove);
        elements.ownerProductList.appendChild(item);
    });
}

function addOwnerProduct() {
    const medicine = document.querySelector("#ownerMedicine").value.trim();
    const brand = document.querySelector("#ownerBrand").value.trim();
    const strength = document.querySelector("#ownerStrength").value.trim();
    const packs = Number(document.querySelector("#ownerStock").value);
    const price = Number(document.querySelector("#ownerPrice").value);
    const coldChain = document.querySelector("#ownerColdChain").checked;
    const prescription = document.querySelector("#ownerPrescription").checked;

    if (!medicine || !brand || !strength || !Number.isFinite(packs) || packs < 0) {
        elements.ownerMessage.textContent =
            "Add medicine, brand, strength, and a valid stock quantity.";
        return;
    }

    ownerDraftProducts.push({
        medicine,
        brand,
        strength,
        packs,
        price: Number.isFinite(price) && price > 0 ? price : null,
        coldChain,
        prescription,
    });

    ["#ownerMedicine", "#ownerBrand", "#ownerStrength", "#ownerPrice"].forEach((selector) => {
        document.querySelector(selector).value = "";
    });
    document.querySelector("#ownerStock").value = "1";
    document.querySelector("#ownerColdChain").checked = false;
    elements.ownerMessage.textContent = "";
    document.querySelector(".owner-progress span:nth-child(3)").classList.add("active");
    renderOwnerProducts();
}

function captureOwnerLocation() {
    const button = document.querySelector("#captureOwnerLocation");
    button.disabled = true;
    elements.ownerLocationStatus.textContent = "Requesting precise shop location…";

    if (!navigator.geolocation) {
        elements.ownerLocationStatus.textContent =
            "Location is unavailable in this browser. Enter the full address manually.";
        button.disabled = false;
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            ownerCoordinates = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
            };
            elements.ownerLocationStatus.textContent =
                `Location captured · ${ownerCoordinates.latitude.toFixed(4)}, ` +
                `${ownerCoordinates.longitude.toFixed(4)}`;
            elements.ownerLocationStatus.classList.add("captured");
            document.querySelector(".owner-progress span:nth-child(2)").classList.add("active");
            button.textContent = "✓ Location captured";
            button.disabled = false;
        },
        () => {
            elements.ownerLocationStatus.textContent =
                "Location permission was not granted. Your entered address will be used.";
            button.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
}

async function publishOwnerListing(event) {
    event.preventDefault();
    const form = document.querySelector("#ownerForm");
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const phone = document.querySelector("#ownerPhone").value.replace(/\D/g, "");
    const pincode = document.querySelector("#ownerPincode").value.replace(/\D/g, "");
    if (phone.length !== 10 || pincode.length !== 6) {
        elements.ownerMessage.textContent =
            "Enter a valid 10-digit contact number and 6-digit PIN code.";
        return;
    }
    if (ownerDraftProducts.length === 0) {
        elements.ownerMessage.textContent = "Add at least one medicine before publishing.";
        return;
    }

    const pharmacy = document.querySelector("#ownerPharmacyName").value.trim();
    const payload = {
        pharmacy,
        license: document.querySelector("#ownerLicense").value.trim(),
        phone,
        hours: document.querySelector("#ownerHours").value,
        address: document.querySelector("#ownerAddress").value.trim(),
        pincode,
        latitude: ownerCoordinates?.latitude,
        longitude: ownerCoordinates?.longitude,
        products: ownerDraftProducts,
    };

    try {
        const data = await API.request("/api/pharmacies/listings", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        const firstMedicine = ownerDraftProducts[0].medicine;
        state.query = firstMedicine;
        elements.finderInput.value = firstMedicine;
        elements.heroMedicine.value = firstMedicine;
        state.filter = "all";
        await loadInventory();
        elements.ownerMessage.textContent = data.message;
        showToast(`${pharmacy} has been added to the Nivra map.`);
        window.setTimeout(() => {
            closeDialog(elements.ownerDialog);
            document.querySelector("#finder").scrollIntoView({ behavior: "smooth" });
        }, 900);
    } catch (error) {
        elements.ownerMessage.textContent = error.message;
    }
}

function initOwnerPortal() {
    document.querySelectorAll("[data-open-owner]").forEach((button) => {
        button.addEventListener("click", () => {
            elements.ownerMessage.textContent = "";
            elements.ownerDialog.showModal();
            document.body.classList.add("dialog-open");
        });
    });

    document.querySelector("#addOwnerProduct").addEventListener("click", addOwnerProduct);
    document.querySelector("#captureOwnerLocation").addEventListener("click", captureOwnerLocation);
    document.querySelector("#ownerForm").addEventListener("submit", publishOwnerListing);
    renderOwnerProducts();
}

function initNavigation() {
    const header = document.querySelector(".site-header");
    const menuToggle = document.querySelector(".menu-toggle");
    const menu = document.querySelector(".nav-menu");

    function updateHeader() {
        header.classList.toggle("scrolled", window.scrollY > 28);
    }

    window.addEventListener("scroll", updateHeader, { passive: true });
    updateHeader();

    menuToggle.addEventListener("click", () => {
        const open = menu.classList.toggle("open");
        menuToggle.classList.toggle("open", open);
        menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    menu.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
            menu.classList.remove("open");
            menuToggle.classList.remove("open");
            menuToggle.setAttribute("aria-expanded", "false");
        });
    });
}

function initLiveMap() {
    if (!window.NivraMap) return;
    window.NivraMap.init("cityMap", {
        onSelect(marker) {
            state.activeCard = marker.inventoryId;
            renderResults();
            const card = document.querySelector(`.pharmacy-card[data-id="${marker.inventoryId}"]`);
            if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
            showToast(`${marker.name} · ${marker.distance} km`);
        },
    }).then(() => {
        window.NivraMap.invalidate();
    });
}

function captureLiveLocation(targetInput, { searchAfter = false } = {}) {
    if (!navigator.geolocation) {
        if (targetInput) targetInput.value = "Rohtak 124001";
        showToast("Geolocation unavailable. Using Rohtak.");
        if (searchAfter) loadInventory().catch((error) => showToast(error.message));
        return;
    }
    showToast("Requesting live location…");
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const value = `${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`;
            if (targetInput) targetInput.value = value;
            if (window.NivraMap) {
                window.NivraMap.setUserLocation(
                    position.coords.latitude,
                    position.coords.longitude,
                    "Live GPS location"
                );
            }
            showToast("Live location captured.");
            if (searchAfter) {
                loadInventory().catch((error) => showToast(error.message));
            }
        },
        () => {
            if (targetInput) targetInput.value = "Rohtak 124001";
            showToast("Location permission was not granted. Using Rohtak.");
            if (searchAfter) loadInventory().catch((error) => showToast(error.message));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function renderInsights(matches) {
    const row = document.querySelector("#insightRow");
    if (!row) return;
    if (!matches.length) {
        row.innerHTML = "<p>No pharmacies match this filter. Widen the radius or send an urgent request.</p>";
        return;
    }
    const nearest = matches.slice().sort((a, b) => a.distance - b.distance)[0];
    const priced = matches.filter((item) => Number.isFinite(priceValue(item)));
    const cheapest = priced.slice().sort((a, b) => priceValue(a) - priceValue(b))[0];
    const openCount = matches.filter(isOpenNow).length;
    row.innerHTML = `
        <article><small>Nearest</small><strong>${nearest.pharmacy}</strong><span>${nearest.distance.toFixed(1)} km · ${nearest.brand}</span></article>
        <article><small>Lowest price</small><strong>${cheapest ? cheapest.price : "—"}</strong><span>${cheapest ? cheapest.pharmacy : "Price not listed"}</span></article>
        <article><small>Open now</small><strong>${openCount}</strong><span>of ${matches.length} listed shops</span></article>
    `;
}

function readRecentSearches() {
    try {
        const items = JSON.parse(localStorage.getItem("nivra-recent") || "[]");
        return Array.isArray(items) ? items.filter((item) => typeof item === "string") : [];
    } catch {
        return [];
    }
}

function rememberSearch(query) {
    const cleaned = String(query || "").trim();
    if (cleaned.length < 3) return;
    const previous = readRecentSearches().filter((item) => item.toLowerCase() !== cleaned.toLowerCase());
    previous.unshift(cleaned);
    localStorage.setItem("nivra-recent", JSON.stringify(previous.slice(0, 4)));
    renderRecentSearches();
}

function renderRecentSearches() {
    const wrap = document.querySelector("#recentSearches");
    if (!wrap) return;
    const items = readRecentSearches();
    wrap.replaceChildren();
    if (!items.length) {
        wrap.hidden = true;
        return;
    }
    wrap.hidden = false;
    const label = document.createElement("span");
    label.textContent = "Recent";
    wrap.appendChild(label);
    items.forEach((query) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = query;
        button.addEventListener("click", () => {
            elements.heroMedicine.value = query;
            elements.finderInput.value = query;
            state.query = query;
            runHeroSearch();
        });
        wrap.appendChild(button);
    });
}

let medicineCatalog = [];

function suggestionMatches(query) {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const seen = new Set();
    const hits = [];
    medicineCatalog.forEach((item) => {
        const hay = `${item.brand} ${item.name} ${item.saltGroup || ""} ${item.strength}`.toLowerCase();
        const key = `${item.brand}|${item.strength}`;
        if (!hay.includes(needle) || seen.has(key)) return;
        seen.add(key);
        hits.push(item);
    });
    return hits.slice(0, 6);
}

function bindSuggestions(input, list, onPick) {
    if (!input || !list) return;
    input.addEventListener("input", () => {
        const hits = suggestionMatches(input.value);
        list.replaceChildren();
        if (!hits.length) {
            list.hidden = true;
            return;
        }
        hits.forEach((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.innerHTML = `<strong>${item.brand}</strong><small>${item.name} · ${item.strength}</small>`;
            button.addEventListener("click", () => {
                input.value = item.brand;
                list.hidden = true;
                onPick(item);
            });
            list.appendChild(button);
        });
        list.hidden = false;
    });
    document.addEventListener("click", (event) => {
        if (!list.contains(event.target) && event.target !== input) list.hidden = true;
    });
}

async function loadMedicineCatalog() {
    try {
        medicineCatalog = await API.request("/api/medicines");
    } catch {
        medicineCatalog = [];
    }
}

function copySearchLink() {
    const params = new URLSearchParams();
    const query = elements.finderInput.value.trim() || elements.heroMedicine.value.trim();
    const location = elements.heroLocation.value.trim();
    if (query) params.set("q", query);
    if (location) params.set("location", location);
    params.set("radius", String(radiusKm()));
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    navigator.clipboard?.writeText(url).then(
        () => showToast("Search link copied."),
        () => showToast(url)
    );
}

function applySearchFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("q");
    const location = params.get("location");
    const radius = Number(params.get("radius"));
    if (location && elements.heroLocation) elements.heroLocation.value = location;
    if (query) {
        state.query = query;
        if (elements.heroMedicine) elements.heroMedicine.value = query;
        if (elements.finderInput) elements.finderInput.value = query;
    }
    if ([5, 10, 25, 50].includes(radius)) {
        state.radius = radius;
        const select = document.querySelector("#radiusSelect");
        if (select) select.value = String(radius);
    }
}
function initFinder() {
    applySearchFromUrl();
    renderRecentSearches();
    loadMedicineCatalog();
    bindSuggestions(elements.heroMedicine, document.querySelector("#heroSuggest"), (item) => {
        elements.finderInput.value = item.brand;
        state.query = item.brand;
        runHeroSearch();
    });
    bindSuggestions(elements.finderInput, document.querySelector("#finderSuggest"), (item) => {
        elements.heroMedicine.value = item.brand;
        state.query = item.brand;
        loadInventory().catch((error) => showToast(error.message));
    });
    initLiveMap();
    loadInventory().catch((error) => showToast(error.message));

    elements.heroSearch.addEventListener("submit", (event) => {
        event.preventDefault();
        runHeroSearch();
    });

    document.querySelectorAll("[data-quick-search]").forEach((button) => {
        button.addEventListener("click", () => {
            elements.heroMedicine.value = button.dataset.quickSearch;
            if (!elements.heroLocation.value) {
                elements.heroLocation.value = "Rohtak 124001";
            }
            runHeroSearch();
        });
    });

    document.querySelector("#locateButton").addEventListener("click", () => {
        captureLiveLocation(elements.heroLocation, { searchAfter: true });
    });

    const locateOnMap = document.querySelector("#locateOnMap");
    if (locateOnMap) {
        locateOnMap.addEventListener("click", () => {
            captureLiveLocation(elements.heroLocation, { searchAfter: true });
        });
    }

    elements.finderInput.addEventListener("input", () => {
        state.query = elements.finderInput.value;
        scheduleInventoryLoad();
    });

    document.querySelectorAll(".filter").forEach((button) => {
        if (!button.dataset.filter) return;
        button.addEventListener("click", () => setFilter(button.dataset.filter));
    });

    document.querySelector("#recenterMap").addEventListener("click", () => {
        if (window.NivraMap) {
            window.NivraMap.recenter();
            showToast("Map centered on your search location.");
        }
    });

    document.querySelector("#radiusSelect")?.addEventListener("change", (event) => {
        state.radius = Number(event.target.value) || 50;
        loadInventory().catch((error) => showToast(error.message));
    });
    document.querySelector("#sortSelect")?.addEventListener("change", (event) => {
        state.sort = event.target.value;
        renderResults();
    });
    document.querySelector("#openNowButton")?.addEventListener("click", (event) => {
        state.openNow = !state.openNow;
        event.currentTarget.classList.toggle("active", state.openNow);
        event.currentTarget.setAttribute("aria-pressed", state.openNow ? "true" : "false");
        renderResults();
    });
    document.querySelector("#copySearchButton")?.addEventListener("click", copySearchLink);

    document.addEventListener("keydown", (event) => {
        const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
        if (event.key === "/" && !event.metaKey && !event.ctrlKey && !typing) {
            event.preventDefault();
            document.querySelector("#finder")?.scrollIntoView({ behavior: "smooth", block: "start" });
            elements.finderInput?.focus();
        }
    });
}

function initDesk() {
    const dialog = document.querySelector("#deskDialog");
    const body = document.querySelector("#deskBody");
    const button = document.querySelector("#deskNavButton");
    if (!dialog || !body || !button) return;
    let tab = "holds";

    async function render() {
        if (!API.user()) {
            openAuthDialog("login");
            return;
        }
        body.innerHTML = "<p>Loading…</p>";
        try {
            if (tab === "holds") {
                const rows = await API.request("/api/reservations");
                body.innerHTML = rows.length
                    ? rows.slice(0, 8).map((item) => `
                        <article class="desk-item">
                            <div>
                                <strong>${item.brand || item.medicine_name}</strong>
                                <small>${item.pharmacy_name} · ${item.status}</small>
                            </div>
                            ${["requested", "confirmed"].includes(item.status) ? `<button class="filter" type="button" data-cancel-hold="${item.id}">Cancel</button>` : ""}
                        </article>`).join("")
                    : "<p>No holds yet. Reserve a medicine and it will appear here.</p>";
            } else {
                const data = await API.request(`/api/favorites?location=${encodeURIComponent(elements.heroLocation.value || "Rohtak 124001")}`);
                const rows = data.results || [];
                body.innerHTML = rows.length
                    ? rows.map((item) => `
                        <article class="desk-item">
                            <div>
                                <strong>${item.brand}</strong>
                                <small>${item.pharmacy} · ${item.price} · ${item.distance.toFixed(1)} km</small>
                            </div>
                            <button class="filter" type="button" data-drop-save="${item.id}">Remove</button>
                        </article>`).join("")
                    : "<p>Nothing saved yet. Use Save on a pharmacy card.</p>";
            }
        } catch (error) {
            body.innerHTML = `<p>${error.message}</p>`;
        }
    }

    button.addEventListener("click", () => {
        if (!API.user()) {
            openAuthDialog("login");
            return;
        }
        dialog.showModal();
        document.body.classList.add("dialog-open");
        render();
    });
    dialog.querySelectorAll("[data-desk-tab]").forEach((tabButton) => {
        tabButton.addEventListener("click", () => {
            tab = tabButton.dataset.deskTab;
            dialog.querySelectorAll("[data-desk-tab]").forEach((item) => {
                item.classList.toggle("active", item === tabButton);
            });
            render();
        });
    });
    body.addEventListener("click", async (event) => {
        const cancel = event.target.closest("[data-cancel-hold]");
        const drop = event.target.closest("[data-drop-save]");
        try {
            if (cancel) {
                await API.request(`/api/reservations/${cancel.dataset.cancelHold}/cancel`, { method: "POST" });
                showToast("Hold cancelled.");
                render();
            }
            if (drop) {
                await API.request(`/api/favorites/${drop.dataset.dropSave}`, { method: "DELETE" });
                showToast("Removed from saved medicines.");
                render();
            }
        } catch (error) {
            showToast(error.message);
        }
    });
}

function initMouseField() {
    const glow = document.querySelector("#heroGlow");
    const hero = document.querySelector(".hero");
    const card = document.querySelector(".status-card-main");
    if (!glow || !hero || !window.matchMedia("(pointer: fine)").matches) return;
    hero.addEventListener("pointermove", (event) => {
        const rect = hero.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        glow.style.left = `${event.clientX - rect.left}px`;
        glow.style.top = `${event.clientY - rect.top}px`;
        glow.style.opacity = "1";
        if (card && (!window.NivraMotion || window.NivraMotion.enabled())) {
            card.style.transform = `translate(${x * 14}px, ${y * 10}px)`;
        }
    });
    hero.addEventListener("pointerleave", () => {
        glow.style.opacity = "0.35";
        if (card) card.style.transform = "";
    });
}

function initDialogs() {
    document.querySelectorAll("[data-open-emergency]").forEach((button) => {
        button.addEventListener("click", openEmergency);
    });

    document.querySelectorAll("[data-close-dialog]").forEach((button) => {
        button.addEventListener("click", () => closeDialog(button.closest("dialog")));
    });

    [elements.reservationDialog, elements.emergencyDialog, elements.ownerDialog, elements.authDialog, document.querySelector("#deskDialog")]
        .filter(Boolean)
        .forEach((dialog) => {
            dialog.addEventListener("click", (event) => {
                if (event.target === dialog) closeDialog(dialog);
            });
            dialog.addEventListener("close", () => document.body.classList.remove("dialog-open"));
        });

    document.querySelector("#reservationForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = document.querySelector("#reserveName").value.trim();
        const phone = document.querySelector("#reservePhone").value.replace(/\D/g, "");
        const consent = document.querySelector("#reserveConsent").checked;

        if (!name || phone.length !== 10 || !consent) {
            elements.reservationMessage.textContent = "Enter your name, a 10-digit number, and confirm the safety note.";
            return;
        }
        if (!activeReservationItem) {
            elements.reservationMessage.textContent = "Choose a listing first.";
            return;
        }

        try {
            const data = await API.request("/api/reservations", {
                method: "POST",
                body: JSON.stringify({
                    inventoryId: activeReservationItem.id,
                    name,
                    phone,
                    consent: true,
                    location: elements.heroLocation.value,
                }),
            });
            elements.reservationMessage.textContent = data.message;
            showToast("Reservation request sent to the pharmacy.");
            loadInventory().catch(() => {});
        } catch (error) {
            elements.reservationMessage.textContent = error.message;
        }
    });

    document.querySelector("#emergencyForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const medicine = document.querySelector("#emergencyMedicine").value.trim();
        const location = document.querySelector("#emergencyLocation").value.trim();
        const radius = document.querySelector("#emergencyRadius").value;

        if (!medicine || !location) {
            elements.emergencyMessage.textContent = "Add both medicine details and your search area.";
            return;
        }

        try {
            const data = await API.request("/api/urgent", {
                method: "POST",
                body: JSON.stringify({ medicine, location, radius }),
            });
            elements.emergencyMessage.textContent = data.message;
            showToast(`${data.pharmaciesNotified} pharmacies were notified.`);
        } catch (error) {
            elements.emergencyMessage.textContent = error.message;
        }
    });
}

function updateAuthNav() {
    const user = API.user();
    const createButton = document.querySelector("#createAccountNav");
    if (!elements.authNavButton) return;
    if (user) {
        elements.authNavButton.textContent =
            user.role === "admin" ? "Sign out · Admin" : `Sign out · ${user.name.split(" ")[0]}`;
        if (createButton) createButton.hidden = true;
        if (elements.adminNavLink) elements.adminNavLink.hidden = user.role !== "admin";
        if (elements.ownerNavLink) {
            elements.ownerNavLink.hidden = !["owner", "admin"].includes(user.role);
        }
    } else {
        elements.authNavButton.textContent = "Sign in";
        if (createButton) createButton.hidden = false;
        if (elements.adminNavLink) elements.adminNavLink.hidden = true;
        if (elements.ownerNavLink) elements.ownerNavLink.hidden = true;
    }
    const deskButton = document.querySelector("#deskNavButton");
    if (deskButton) deskButton.hidden = !user;
}

function setAuthMode(mode) {
    authMode = mode;
    const isRegister = mode === "register";
    const registerFields = document.querySelector("#authRegisterFields");
    const nameInput = document.querySelector("#authName");
    const phoneInput = document.querySelector("#authPhone");
    const roleInput = document.querySelector("#authRole");
    const passwordInput = document.querySelector("#authPassword");
    const switchCopy = document.querySelector("#authSwitch");

    document.querySelectorAll("[data-auth-mode]").forEach((button) => {
        const active = button.dataset.authMode === mode;
        button.classList.toggle("active", active);
        if (button.getAttribute("role") === "tab") {
            button.setAttribute("aria-selected", active ? "true" : "false");
        }
    });

    document.querySelector("#authTitle").textContent = isRegister ? "Create account" : "Sign in";
    document.querySelector("#authCopy").textContent = isRegister
        ? "Create a free customer or pharmacy-owner account in under a minute."
        : "Use your Nivra account to reserve medicines or manage a pharmacy.";
    if (registerFields) registerFields.hidden = !isRegister;
    if (nameInput) {
        nameInput.required = isRegister;
        nameInput.autocomplete = "name";
    }
    if (phoneInput) phoneInput.required = false;
    if (roleInput) roleInput.required = isRegister;
    if (passwordInput) {
        passwordInput.autocomplete = isRegister ? "new-password" : "current-password";
        passwordInput.placeholder = isRegister ? "Create a password (6+ characters)" : "At least 6 characters";
    }
    document.querySelector("#authSubmit").textContent = isRegister ? "Create account" : "Sign in";
    if (switchCopy) {
        switchCopy.innerHTML = isRegister
            ? 'Already have an account? <button type="button" data-auth-mode="login">Sign in instead</button>'
            : 'New here? <button type="button" data-auth-mode="register">Create a free account</button>';
        switchCopy.querySelector("[data-auth-mode]")?.addEventListener("click", (event) => {
            setAuthMode(event.currentTarget.dataset.authMode);
        });
    }
    if (elements.authMessage) elements.authMessage.textContent = "";
}

function openAuthDialog(mode = "login") {
    setAuthMode(mode);
    elements.authMessage.textContent = "";
    elements.authDialog.showModal();
    document.body.classList.add("dialog-open");
    const focusId = mode === "register" ? "#authName" : "#authEmail";
    window.setTimeout(() => document.querySelector(focusId)?.focus(), 40);
}

function initAuth() {
    if (!elements.authDialog) return;
    updateAuthNav();

    document.querySelectorAll("[data-open-auth]").forEach((button) => {
        button.addEventListener("click", () => {
            if (button.id === "authNavButton" && API.user()) {
                API.clear();
                updateAuthNav();
                showToast("Signed out.");
                return;
            }
            openAuthDialog(button.dataset.openAuth || "login");
        });
    });

    document.querySelectorAll("[data-auth-mode]").forEach((button) => {
        button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
    });

    elements.authForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = {
            email: document.querySelector("#authEmail").value.trim(),
            password: document.querySelector("#authPassword").value,
        };
        if (authMode === "register") {
            payload.name = document.querySelector("#authName").value.trim();
            payload.phone = document.querySelector("#authPhone").value.replace(/\D/g, "");
            payload.role = document.querySelector("#authRole").value;
            if (!payload.name) {
                elements.authMessage.textContent = "Enter your full name to create an account.";
                return;
            }
            if (payload.phone && payload.phone.length !== 10) {
                elements.authMessage.textContent = "Enter a valid 10-digit mobile number, or leave it blank.";
                return;
            }
        }
        try {
            const data = await API.request(
                authMode === "register" ? "/api/auth/register" : "/api/auth/login",
                { method: "POST", body: JSON.stringify(payload) }
            );
            API.setSession(data.token, data.user);
            updateAuthNav();
            elements.authMessage.textContent =
                authMode === "register"
                    ? `Account created. Welcome, ${data.user.name}.`
                    : `Signed in as ${data.user.name}.`;
            showToast(
                authMode === "register"
                    ? `Welcome to Nivra, ${data.user.name}.`
                    : `Welcome back, ${data.user.name}.`
            );
            window.setTimeout(() => closeDialog(elements.authDialog), 700);
            if (data.user.role === "owner") {
                window.setTimeout(() => showToast("Open Owner desk anytime from the menu."), 1200);
            }
        } catch (error) {
            elements.authMessage.textContent = error.message;
        }
    });
}

function initProcess() {
    const steps = document.querySelectorAll(".process-step");
    const caption = document.querySelector("#processCaption");

    steps.forEach((step) => {
        step.addEventListener("mouseenter", () => {
            steps.forEach((item) => item.classList.remove("active"));
            step.classList.add("active");
            if (caption) caption.textContent = step.dataset.process;
        });

        if (typeof ScrollTrigger !== "undefined") {
            ScrollTrigger.create({
                trigger: step,
                start: "top 62%",
                end: "bottom 38%",
                onToggle: (self) => {
                    if (!self.isActive) return;
                    steps.forEach((item) => item.classList.remove("active"));
                    step.classList.add("active");
                    if (caption) caption.textContent = step.dataset.process;
                },
            });
        }
    });
}

function initFeedback() {
    const form = document.querySelector("#feedbackForm");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const status = document.querySelector("#feedbackMessageStatus");
        try {
            const data = await API.request("/api/feedback", {
                method: "POST",
                body: JSON.stringify({
                    name: document.querySelector("#feedbackName").value.trim(),
                    email: document.querySelector("#feedbackEmail").value.trim(),
                    message: document.querySelector("#feedbackMessage").value.trim(),
                }),
            });
            status.textContent = data.message;
            form.reset();
            showToast("Feedback sent.");
            initActivityFeed();
        } catch (error) {
            status.textContent = error.message;
        }
    });
}

function initActivityFeed() {
    const feed = document.querySelector("#activityFeed");
    if (!feed) return;
    API.request("/api/activity")
        .then((data) => {
            const items = data.activity || [];
            if (!items.length) {
                feed.innerHTML = "<p class='activity-item'><strong>Network ready</strong><small>Activity will appear as pharmacies and reservations move.</small></p>";
                return;
            }
            feed.innerHTML = items
                .slice(0, 5)
                .map(
                    (item) =>
                        `<article class="activity-item"><strong>${item.detail}</strong><small>${item.actor_name || "system"} · ${item.created_at}</small></article>`
                )
                .join("");
        })
        .catch(() => {
            feed.innerHTML = "";
        });
}

function initCounters() {
    API.request("/api/stats")
        .then((stats) => {
            const counters = document.querySelectorAll("[data-counter]");
            if (counters[0]) counters[0].dataset.counter = String(stats.pharmaciesOnline);
            if (counters[1]) counters[1].dataset.counter = String(stats.stockVerifiedToday);
        })
        .catch(() => {})
        .finally(() => {
            const counters = document.querySelectorAll("[data-counter]");
            const observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    const element = entry.target;
                    const target = Number(element.dataset.counter);
                    const duration = 1400;
                    const start = performance.now();

                    function update(now) {
                        const progress = Math.min((now - start) / duration, 1);
                        const eased = 1 - Math.pow(1 - progress, 3);
                        const value = Math.round(target * eased);
                        element.textContent =
                            element.dataset.format === "percent"
                                ? `${value}%`
                                : value.toLocaleString("en-IN");
                        if (progress < 1) requestAnimationFrame(update);
                    }

                    requestAnimationFrame(update);
                    observer.unobserve(element);
                });
            }, { threshold: 0.5 });

            counters.forEach((counter) => observer.observe(counter));
        });
}

function syncMotionToggle() {
    const button = document.querySelector("#motionToggle");
    if (!button || !window.NivraMotion) return;
    const on = window.NivraMotion.enabled();
    button.textContent = on ? "Motion on" : "Motion off";
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.classList.toggle("is-off", !on);
}

function initMotionControls() {
    if (window.NivraMotion) window.NivraMotion.apply();
    syncMotionToggle();
    const button = document.querySelector("#motionToggle");
    if (!button) return;
    button.addEventListener("click", () => {
        const on = window.NivraMotion.toggle();
        syncMotionToggle();
        showToast(on ? "Animations enabled." : "Animations paused.");
        window.setTimeout(() => window.location.reload(), 180);
    });
}

function initMotion() {
    if (window.NivraMotion) window.NivraMotion.apply();
    const motionOn = window.NivraMotion ? window.NivraMotion.enabled() : true;

    if (!motionOn) {
        document.querySelectorAll(".reveal, .hero-reveal").forEach((element) => {
            element.style.opacity = "1";
            element.style.transform = "none";
        });
        return;
    }

    if (typeof Lenis !== "undefined") {
        const lenis = new Lenis({
            duration: 1.05,
            smoothWheel: true,
            wheelMultiplier: 0.9,
        });
        function raf(time) {
            lenis.raf(time);
            requestAnimationFrame(raf);
        }
        requestAnimationFrame(raf);
        if (typeof ScrollTrigger !== "undefined" && typeof lenis.on === "function") {
            lenis.on("scroll", ScrollTrigger.update);
        }
    }

    if (typeof gsap === "undefined") {
        document.querySelectorAll(".reveal, .hero-reveal").forEach((element) => {
            element.style.opacity = "1";
            element.style.transform = "none";
        });
        return;
    }

    gsap.registerPlugin(ScrollTrigger);

    gsap.fromTo(
        ".hero-reveal",
        { y: 56, opacity: 0 },
        {
            y: 0,
            opacity: 1,
            duration: 1.05,
            stagger: 0.11,
            ease: "power3.out",
            delay: 0.2,
        }
    );

    gsap.utils.toArray(".reveal").forEach((element) => {
        gsap.fromTo(
            element,
            { y: 44, opacity: 0 },
            {
                y: 0,
                opacity: 1,
                duration: 0.95,
                ease: "power3.out",
                scrollTrigger: {
                    trigger: element,
                    start: "top 88%",
                    once: true,
                },
            }
        );
    });

    gsap.utils.toArray(".section-heading h2, .statement-copy h2, .urgent-copy h2").forEach((heading) => {
        gsap.fromTo(
            heading,
            { clipPath: "inset(0 0 100% 0)", y: 55 },
            {
                clipPath: "inset(0 0 0% 0)",
                y: 0,
                duration: 1.1,
                ease: "power4.out",
                scrollTrigger: {
                    trigger: heading,
                    start: "top 84%",
                    once: true,
                },
            }
        );
    });

    [
        ".statement-numbers > div",
        ".process-step",
        ".guide-card",
        ".trust-line > span",
    ].forEach((selector) => {
        const items = gsap.utils.toArray(selector);
        if (!items.length) return;
        gsap.fromTo(
            items,
            { y: 34, opacity: 0 },
            {
                y: 0,
                opacity: 1,
                duration: 0.75,
                stagger: 0.1,
                ease: "power3.out",
                scrollTrigger: {
                    trigger: items[0].parentElement,
                    start: "top 82%",
                    once: true,
                },
            }
        );
    });

    gsap.to(".hero-copy", {
        y: 36,
        ease: "none",
        scrollTrigger: {
            trigger: ".hero",
            start: "top top",
            end: "bottom top",
            scrub: true,
        },
    });
}

function initCursor() {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.NivraMotion && !window.NivraMotion.enabled()) return;
    const cursor = document.querySelector(".cursor-dot");
    const aura = document.querySelector(".cursor-aura");
    if (!cursor || !aura) return;
    document.body.classList.add("cursor-on");
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let auraX = mouseX;
    let auraY = mouseY;
    const trails = Array.from({ length: 5 }, () => {
        const dot = document.createElement("span");
        dot.className = "cursor-trail";
        document.body.appendChild(dot);
        return { el: dot, x: mouseX, y: mouseY };
    });

    window.addEventListener("pointermove", (event) => {
        mouseX = event.clientX;
        mouseY = event.clientY;
        cursor.style.left = `${event.clientX}px`;
        cursor.style.top = `${event.clientY}px`;
        const hit = event.target.closest?.("a, button, input, select, textarea, .pharmacy-card, .guide-card");
        cursor.classList.toggle("active", Boolean(hit));
        aura.classList.toggle("active", Boolean(hit));
    }, { passive: true });

    function followAura() {
        auraX += (mouseX - auraX) * 0.14;
        auraY += (mouseY - auraY) * 0.14;
        aura.style.left = `${auraX}px`;
        aura.style.top = `${auraY}px`;
        let leadX = mouseX;
        let leadY = mouseY;
        trails.forEach((trail, index) => {
            const ease = 0.28 - index * 0.03;
            trail.x += (leadX - trail.x) * ease;
            trail.y += (leadY - trail.y) * ease;
            trail.el.style.left = `${trail.x}px`;
            trail.el.style.top = `${trail.y}px`;
            leadX = trail.x;
            leadY = trail.y;
        });
        requestAnimationFrame(followAura);
    }
    followAura();
}

const spotlightElements = new WeakSet();
function initSpotlight(element) {
    if (!element || spotlightElements.has(element)) return;
    spotlightElements.add(element);
    element.addEventListener("pointermove", (event) => {
        const rect = element.getBoundingClientRect();
        element.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
        element.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
    });
}

function initTiltCards() {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.NivraMotion && !window.NivraMotion.enabled()) return;
    document.querySelectorAll(".guide-card").forEach((card) => {
        card.addEventListener("pointermove", (event) => {
            const rect = card.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width - 0.5;
            const y = (event.clientY - rect.top) / rect.height - 0.5;
            card.style.transition = "none";
            card.style.transform =
                `perspective(900px) rotateX(${-y * 5}deg) rotateY(${x * 6}deg) translateY(-4px)`;
        });
        card.addEventListener("pointerleave", () => {
            card.style.transition = "transform 0.45s var(--ease)";
            card.style.transform = "";
        });
    });
}

const rippleElements = new WeakSet();
function initRipple(element) {
    if (!element || rippleElements.has(element)) return;
    rippleElements.add(element);
    element.style.position ||= "relative";
    element.style.overflow = "hidden";
    element.addEventListener("click", (event) => {
        const rect = element.getBoundingClientRect();
        const ripple = document.createElement("span");
        const size = Math.max(rect.width, rect.height) * 1.8;
        ripple.className = "ripple";
        ripple.style.width = `${size}px`;
        ripple.style.height = `${size}px`;
        ripple.style.left = `${event.clientX - rect.left}px`;
        ripple.style.top = `${event.clientY - rect.top}px`;
        element.appendChild(ripple);
        ripple.addEventListener("animationend", () => ripple.remove());
    });
}

function initSurfaceEffects() {
    document.querySelectorAll(".status-card, .guide-card, .rx-scanner, .rx-output").forEach(initSpotlight);
    document.querySelectorAll(
        ".search-submit, .filter, .urgent-orb, .nav-urgent, .nav-owner, .quick-search button, .scan-demo-button, .voice-button, .add-product-button, .location-capture-button"
    ).forEach(initRipple);
    initTiltCards();
}

function initScrollProgress() {
    const progress = document.querySelector("#scrollProgress");
    if (!progress) return;
    function update() {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
        progress.style.transform = `scaleX(${ratio})`;
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
}

function initPageLoader() {
    const loader = document.querySelector("#pageLoader");
    const bar = document.querySelector("#loaderProgress");
    const percent = document.querySelector("#loaderPercent");
    if (!loader || !bar || !percent) {
        document.body.classList.remove("loading");
        return;
    }

    let value = 0;
    let finished = false;

    function finish() {
        if (finished) return;
        finished = true;
        window.clearInterval(timer);
        value = 100;
        bar.style.width = "100%";
        percent.textContent = "100%";
        window.setTimeout(() => {
            document.body.classList.remove("loading");
            if (typeof gsap !== "undefined") {
                gsap.to(loader, {
                    yPercent: -100,
                    duration: 0.55,
                    ease: "power3.inOut",
                    onComplete: () => {
                        loader.remove();
                        if (window.NivraMap) window.NivraMap.invalidate();
                    },
                });
            } else {
                loader.remove();
                if (window.NivraMap) window.NivraMap.invalidate();
            }
        }, 120);
    }

    const timer = window.setInterval(() => {
        const remaining = 100 - value;
        value += Math.max(2, Math.ceil(remaining * 0.18));
        value = Math.min(value, 100);
        bar.style.width = `${value}%`;
        percent.textContent = `${value}%`;
        if (value >= 100) finish();
    }, 18);

    // Absolute failsafe if something else blocks the interval.
    window.setTimeout(finish, 2800);
}

function initMagneticButtons() {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    document.querySelectorAll(".magnetic").forEach((button) => {
        button.addEventListener("pointermove", (event) => {
            const rect = button.getBoundingClientRect();
            const x = event.clientX - rect.left - rect.width / 2;
            const y = event.clientY - rect.top - rect.height / 2;
            button.style.transform = `translate(${x * 0.08}px, ${y * 0.08}px)`;
        });
        button.addEventListener("pointerleave", () => {
            button.style.transform = "";
        });
    });
}

function boot() {
    initPageLoader();
    initMotionControls();
    initNavigation();
    initAuth();
    initFinder();
    initRxLens();
    initVoiceSearch();
    initOwnerPortal();
    initDialogs();
    initDesk();
    initMouseField();
    initCounters();
    initActivityFeed();
    initFeedback();
    initMotion();
    initProcess();
    initCursor();
    initSurfaceEffects();
    initScrollProgress();
    initMagneticButtons();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
} else {
    boot();
}
