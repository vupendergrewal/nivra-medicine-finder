window.NivraMotion = (function createMotionPref() {
    const KEY = "nivra-motion-v2";

    function systemPrefersReduce() {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function stored() {
        return localStorage.getItem(KEY);
    }

    function enabled() {
        const value = stored();
        if (value === "on") return true;
        if (value === "off") return false;
        // Demo default: keep motion on so the site feels alive.
        return true;
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

    return { enabled, set, toggle, apply, systemPrefersReduce, stored };
})();
