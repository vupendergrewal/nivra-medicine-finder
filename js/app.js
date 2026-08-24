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

function currentResults() {
    return inventory;
}

async function loadInventory() {
    const query = state.query || "";
    const location = elements.heroLocation?.value || "Rohtak 124001";
    const data = await API.request(
        `/api/search?q=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&filter=${encodeURIComponent(state.filter)}`
    );
    inventory = data.results || [];
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
            `/api/map?q=${encodeURIComponent(query || "")}&location=${encodeURIComponent(location || "Rohtak 124001")}&filter=${encodeURIComponent(state.filter)}&radius=25`
        );
        window.NivraMap.queuePayload({
            origin: mapData.origin,
            radiusKm: mapData.radiusKm || 25,
            markers: mapData.markers || [],
            activeId: state.activeCard,
        });

        const matchLabel = document.querySelector("#mapMatchCount");
        if (matchLabel) {
            matchLabel.textContent = `${mapData.count} pharmacy pin${mapData.count === 1 ? "" : "s"} nearby`;
        }
        const hint = document.querySelector("#mapHint");
        if (hint) {
            const origin = mapData.origin || {};
            hint.textContent = origin.resolved
                ? `Centered on ${origin.label} · live map tiles`
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
        return;
    }

    matches.slice(0, 12).forEach((item, index) => {
        const card = document.createElement("article");
        card.className = `pharmacy-card${item.id === state.activeCard ? " active" : ""}`;
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

    if (typeof gsap !== "undefined") {
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

function initFinder() {
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
}

function initDialogs() {
    document.querySelectorAll("[data-open-emergency]").forEach((button) => {
        button.addEventListener("click", openEmergency);
    });

    document.querySelectorAll("[data-close-dialog]").forEach((button) => {
        button.addEventListener("click", () => closeDialog(button.closest("dialog")));
    });

    [elements.reservationDialog, elements.emergencyDialog, elements.ownerDialog, elements.authDialog]
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
            caption.textContent = step.dataset.process;
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
                    caption.textContent = step.dataset.process;
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
        if (on) {
            // Re-run entrance motion after enabling.
            window.location.reload();
        }
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

    // Lenis smooth-scroll removed — it lagged on institute laptops.

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
        { y: 28, opacity: 0 },
        {
            y: 0,
            opacity: 1,
            duration: 0.65,
            stagger: 0.07,
            ease: "power2.out",
            delay: 0.05,
        }
    );

    gsap.utils.toArray(".reveal").forEach((element) => {
        gsap.fromTo(
            element,
            { y: 22, opacity: 0 },
            {
                y: 0,
                opacity: 1,
                duration: 0.5,
                ease: "power2.out",
                scrollTrigger: {
                    trigger: element,
                    start: "top 90%",
                    once: true,
                },
            }
        );
    });
}

function initCursor() {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.NivraMotion && !window.NivraMotion.enabled()) return;
    const cursor = document.querySelector(".cursor-dot");
    const aura = document.querySelector(".cursor-aura");
    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let auraX = mouseX;
    let auraY = mouseY;

    window.addEventListener("pointermove", (event) => {
        mouseX = event.clientX;
        mouseY = event.clientY;
        cursor.style.left = `${event.clientX}px`;
        cursor.style.top = `${event.clientY}px`;
    }, { passive: true });

    function followAura() {
        auraX += (mouseX - auraX) * 0.11;
        auraY += (mouseY - auraY) * 0.11;
        aura.style.left = `${auraX}px`;
        aura.style.top = `${auraY}px`;
        requestAnimationFrame(followAura);
    }
    followAura();

    document.querySelectorAll("a, button, input, select, textarea, .pharmacy-card").forEach((element) => {
        element.addEventListener("mouseenter", () => cursor.classList.add("active"));
        element.addEventListener("mouseleave", () => cursor.classList.remove("active"));
    });
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
    document.querySelectorAll(".guide-card").forEach((card) => {
        card.addEventListener("pointermove", (event) => {
            const rect = card.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width - 0.5;
            const y = (event.clientY - rect.top) / rect.height - 0.5;
            card.style.transform =
                `perspective(900px) rotateX(${-y * 5}deg) rotateY(${x * 6}deg) translateY(-4px)`;
        });
        card.addEventListener("pointerleave", () => {
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
    let value = 0;

    const timer = window.setInterval(() => {
        const remaining = 100 - value;
        value += Math.max(1, Math.ceil(remaining * 0.12));
        value = Math.min(value, 100);
        bar.style.width = `${value}%`;
        percent.textContent = `${value}%`;

        if (value < 100) return;
        window.clearInterval(timer);
        window.setTimeout(() => {
            document.body.classList.remove("loading");
            if (typeof gsap !== "undefined") {
                gsap.to(loader, {
                    yPercent: -100,
                    duration: 0.9,
                    ease: "power4.inOut",
                    onComplete: () => {
                        loader.remove();
                        if (window.NivraMap) window.NivraMap.invalidate();
                    },
                });
            } else {
                loader.style.animation = "loaderOut .8s ease forwards";
                loader.addEventListener("animationend", () => {
                    loader.remove();
                    if (window.NivraMap) window.NivraMap.invalidate();
                });
            }
        }, 180);
    }, 22);
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

document.addEventListener("DOMContentLoaded", () => {
    initPageLoader();
    initMotionControls();
    initNavigation();
    initAuth();
    initFinder();
    initRxLens();
    initVoiceSearch();
    initOwnerPortal();
    initDialogs();
    initCounters();
    initActivityFeed();
    initFeedback();
    initMotion();
    initProcess();
    initCursor();
    initSurfaceEffects();
    initScrollProgress();
    initMagneticButtons();
});
