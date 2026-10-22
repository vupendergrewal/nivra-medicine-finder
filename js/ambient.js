(function initAmbient() {
    function motionOn() {
        if (window.NivraMotion) return window.NivraMotion.enabled();
        return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function syncVideos() {
        const play = motionOn();
        document.querySelectorAll("video[data-ambient]").forEach((video) => {
            video.muted = true;
            if (play) {
                const attempt = video.play();
                if (attempt && typeof attempt.catch === "function") attempt.catch(() => {});
            } else {
                video.pause();
            }
        });
    }

    function initHeroCanvas() {
        const canvas = document.querySelector("#heroCanvas");
        const hero = document.querySelector(".hero");
        if (!canvas || !hero) return;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        const orbs = [
            { x: 0.18, y: 0.28, r: 0.42, sx: 0.23, sy: 0.17, p: 0.4, color: [36, 110, 78, 0.22] },
            { x: 0.78, y: 0.18, r: 0.3, sx: 0.15, sy: 0.21, p: 1.7, color: [176, 146, 86, 0.16] },
            { x: 0.62, y: 0.78, r: 0.46, sx: 0.11, sy: 0.14, p: 3.1, color: [20, 56, 45, 0.14] },
            { x: 0.4, y: 0.5, r: 0.22, sx: 0.28, sy: 0.19, p: 4.4, color: [255, 252, 246, 0.28] },
        ];
        let pointerX = 0.35;
        let pointerY = 0.4;
        let frame = 0;

        function resize() {
            const rect = hero.getBoundingClientRect();
            const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
            canvas.width = Math.max(1, Math.floor(rect.width * ratio));
            canvas.height = Math.max(1, Math.floor(rect.height * ratio));
        }

        function paint(time) {
            const width = canvas.width;
            const height = canvas.height;
            const seconds = (time || 0) / 1000;
            context.fillStyle = "#f3f1eb";
            context.fillRect(0, 0, width, height);
            orbs.forEach((orb) => {
                const x = (orb.x + Math.sin(seconds * orb.sx + orb.p) * 0.07 + (pointerX - 0.5) * 0.05) * width;
                const y = (orb.y + Math.cos(seconds * orb.sy + orb.p) * 0.07 + (pointerY - 0.5) * 0.05) * height;
                const radius = orb.r * Math.max(width, height);
                const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
                const [red, green, blue, alpha] = orb.color;
                gradient.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${alpha})`);
                gradient.addColorStop(1, "rgba(243, 241, 235, 0)");
                context.fillStyle = gradient;
                context.beginPath();
                context.arc(x, y, radius, 0, Math.PI * 2);
                context.fill();
            });
            context.lineWidth = Math.max(1, width / 900);
            for (let line = 0; line < 4; line += 1) {
                context.beginPath();
                context.strokeStyle = `rgba(20, 56, 45, ${0.045 + line * 0.01})`;
                const baseline = height * (0.18 + line * 0.2);
                for (let x = 0; x <= width; x += 16) {
                    const y = baseline
                        + Math.sin(x * 0.006 + seconds * 0.55 + line) * (height * 0.035)
                        + Math.cos(seconds * 0.2 + line) * 8;
                    if (x === 0) context.moveTo(x, y);
                    else context.lineTo(x, y);
                }
                context.stroke();
            }
        }

        function loop(time) {
            paint(time);
            if (motionOn()) frame = window.requestAnimationFrame(loop);
        }

        resize();
        window.addEventListener("resize", resize);
        if (window.matchMedia("(pointer: fine)").matches) {
            hero.addEventListener("pointermove", (event) => {
                const rect = hero.getBoundingClientRect();
                pointerX = (event.clientX - rect.left) / rect.width;
                pointerY = (event.clientY - rect.top) / rect.height;
            });
        }
        window.addEventListener("nivra:motion", () => {
            window.cancelAnimationFrame(frame);
            if (motionOn()) frame = window.requestAnimationFrame(loop);
            else paint(0);
        });
        if (motionOn()) frame = window.requestAnimationFrame(loop);
        else paint(0);
    }

    function boot() {
        syncVideos();
        initHeroCanvas();
        window.addEventListener("nivra:motion", syncVideos);
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                document.querySelectorAll("video[data-ambient]").forEach((video) => video.pause());
            } else {
                syncVideos();
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot);
    } else {
        boot();
    }
})();
