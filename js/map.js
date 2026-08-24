window.NivraMap = (function createNivraMap() {
    const DEFAULT_CENTER = [30.7333, 76.7794];
    let map = null;
    let userMarker = null;
    let radiusCircle = null;
    let markerLayer = null;
    let markersByInventory = new Map();
    let onSelect = null;
    let pendingRender = null;

    function pinIcon(label, pending) {
        return L.divIcon({
            className: "nivra-map-pin",
            html: `<button class="leaflet-pin${pending ? " pending" : ""}" type="button"><span>${label}</span></button>`,
            iconSize: [42, 42],
            iconAnchor: [21, 40],
            popupAnchor: [0, -34],
        });
    }

    function userIcon() {
        return L.divIcon({
            className: "nivra-user-pin",
            html: '<span class="leaflet-user-dot"></span>',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
        });
    }

    function waitForLeaflet(timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            if (typeof L !== "undefined") {
                resolve(L);
                return;
            }
            const started = Date.now();
            const timer = window.setInterval(() => {
                if (typeof L !== "undefined") {
                    window.clearInterval(timer);
                    resolve(L);
                } else if (Date.now() - started > timeoutMs) {
                    window.clearInterval(timer);
                    reject(new Error("Leaflet failed to load."));
                }
            }, 50);
        });
    }

    async function init(containerId, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return null;
        if (map) {
            window.setTimeout(() => map.invalidateSize(), 150);
            return map;
        }

        try {
            await waitForLeaflet();
        } catch (error) {
            console.warn(error.message);
            return null;
        }

        onSelect = options.onSelect || null;
        map = L.map(container, {
            zoomControl: true,
            attributionControl: true,
            scrollWheelZoom: false,
        }).setView(DEFAULT_CENTER, 12);

        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
            maxZoom: 18,
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        }).addTo(map);

        markerLayer = L.layerGroup().addTo(map);
        userMarker = L.marker(DEFAULT_CENTER, { icon: userIcon(), zIndexOffset: 1000 }).addTo(map);
        userMarker.bindPopup("<strong>Your search location</strong>");
        radiusCircle = L.circle(DEFAULT_CENTER, {
            radius: 10000,
            color: "#8655ee",
            weight: 1.5,
            fillColor: "#8655ee",
            fillOpacity: 0.12,
        }).addTo(map);

        window.setTimeout(() => map.invalidateSize(), 250);
        if (pendingRender) {
            const payload = pendingRender;
            pendingRender = null;
            applyPayload(payload);
        }
        return map;
    }

    function setUserLocation(lat, lng, label) {
        if (!map || lat == null || lng == null) return;
        const point = [lat, lng];
        userMarker.setLatLng(point);
        userMarker.bindPopup(`<strong>You</strong><br>${label || "Search location"}`);
        radiusCircle.setLatLng(point);
    }

    function setRadius(km) {
        if (!radiusCircle) return;
        radiusCircle.setRadius(Math.max(1, Number(km) || 10) * 1000);
    }

    function clearMarkers() {
        if (markerLayer) markerLayer.clearLayers();
        markersByInventory.clear();
    }

    function renderMarkers(markers) {
        if (!map || !markerLayer) {
            pendingRender = { ...(pendingRender || {}), markers };
            return;
        }
        clearMarkers();
        const bounds = [];

        markers.forEach((marker, index) => {
            if (marker.latitude == null || marker.longitude == null) return;
            // Spread pins that share nearly the same spot so none hide under another.
            const angle = (index / Math.max(markers.length, 1)) * Math.PI * 2;
            const jitter = index === 0 ? 0 : 0.00035 + (index % 3) * 0.00012;
            const point = [
                marker.latitude + Math.sin(angle) * jitter,
                marker.longitude + Math.cos(angle) * jitter,
            ];
            bounds.push(point);
            const pin = L.marker(point, {
                icon: pinIcon(String(index + 1).padStart(2, "0"), marker.ownerListed),
                title: marker.name,
                zIndexOffset: index === 0 ? 400 : index * 10,
            });
            pin.bindPopup(
                `<strong>${marker.name}</strong><br>` +
                    `${marker.brand} · ${marker.strength}<br>` +
                    `${marker.distance} km · ${marker.price}<br>` +
                    `<small>${marker.area}</small>`
            );
            pin.on("click", () => {
                if (typeof onSelect === "function") onSelect(marker);
            });
            pin.addTo(markerLayer);
            markersByInventory.set(marker.inventoryId, pin);
        });

        if (userMarker) bounds.push(userMarker.getLatLng());
        if (bounds.length > 1) {
            map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14 });
        } else if (bounds.length === 1) {
            map.setView(bounds[0], 13);
        }
        window.setTimeout(() => map.invalidateSize(), 120);
    }

    function applyPayload(payload) {
        if (!payload) return;
        if (payload.origin) {
            setUserLocation(payload.origin.latitude, payload.origin.longitude, payload.origin.label);
        }
        if (payload.radiusKm != null) setRadius(payload.radiusKm);
        if (payload.markers) renderMarkers(payload.markers);
        if (payload.activeId) highlight(payload.activeId);
    }

    function queuePayload(payload) {
        if (!map) {
            pendingRender = { ...(pendingRender || {}), ...payload };
            return;
        }
        applyPayload(payload);
    }

    function highlight(inventoryId) {
        markersByInventory.forEach((marker, id) => {
            const el = marker.getElement();
            if (!el) return;
            el.classList.toggle("is-active", Number(id) === Number(inventoryId));
        });
        const active = markersByInventory.get(Number(inventoryId));
        if (active) {
            active.openPopup();
            map.panTo(active.getLatLng(), { animate: true });
        }
    }

    function recenter() {
        if (!map || !userMarker) return;
        map.setView(userMarker.getLatLng(), 13, { animate: true });
        window.setTimeout(() => map.invalidateSize(), 100);
    }

    function invalidate() {
        if (map) map.invalidateSize();
    }

    function ready() {
        return Boolean(map);
    }

    return {
        init,
        setUserLocation,
        setRadius,
        renderMarkers,
        queuePayload,
        highlight,
        recenter,
        invalidate,
        ready,
    };
})();
