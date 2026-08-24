window.NivraMotion = (function createMotionPref() {
    const KEY = "nivra-motion";

    function systemPrefersReduce() {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function weakDevice() {
        try {
            if (navigator.connection && navigator.connection.saveData) return true;
            if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) return true;
            if (navigator.deviceMemory && navigator.deviceMemory <= 4) return true;
        } catch {
            /* ignore */
        }
        return false;
    }

    function stored() {
        return localStorage.getItem(KEY);
    }

    function enabled() {
        const value = stored();
        if (value === "on") return true;
        if (value === "off") return false;
        // Prefer a smooth classroom demo. Users can turn Motion on from the nav.
        if (systemPrefersReduce() || weakDevice()) return false;
        return false;
    }

    function apply() {
        const on = enabled();
        document.documentElement.classList.toggle("force-motion", on);
        document.documentElement.classList.toggle("reduce-motion", !on);
        document.body?.classList.toggle("force-motion", on);
        document.body?.classList.toggle("reduce-motion", !on);
        window.dispatchEvent(new CustomEvent("nivra:motion", { detail: { enabled: on } }));
        return on;
    }

    function set(value) {
        localStorage.setItem(KEY, value ? "on" : "off");
        return apply();
    }

    function toggle() {
        return set(!enabled());
    }

    if (document.documentElement) apply();

    return { enabled, set, toggle, apply, systemPrefersReduce, stored, weakDevice };
})();
