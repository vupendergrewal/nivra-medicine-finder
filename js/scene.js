(function () {
    const canvas = document.querySelector("#medicineScene");
    const hero = document.querySelector(".hero");
    if (!canvas || !hero || typeof THREE === "undefined") return;

    // Institute laptops: keep the hero 3D light, pause off-screen, and skip when motion is off.
    const motionOn = () => (window.NivraMotion ? window.NivraMotion.enabled() : true);
    if (!motionOn()) {
        canvas.style.display = "none";
        return;
    }

    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 40);
    camera.position.set(0, 0, 11);

    const world = new THREE.Group();
    world.position.set(3.15, 0.45, 0);
    scene.add(world);

    scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 6, 8);
    scene.add(key);

    function capsuleHalf(color, x, rotationZ) {
        const group = new THREE.Group();
        const material = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.35,
            metalness: 0.08,
        });
        const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 1.65, 20, 1, false), material);
        cylinder.rotation.z = Math.PI / 2;
        const cap = new THREE.Mesh(
            new THREE.SphereGeometry(0.72, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2),
            material
        );
        cap.rotation.z = rotationZ;
        cap.position.x = x;
        group.add(cylinder, cap);
        return group;
    }

    const capsule = new THREE.Group();
    const leftHalf = capsuleHalf(0x8b5cf6, -0.82, -Math.PI / 2);
    leftHalf.position.x = -0.82;
    const rightHalf = capsuleHalf(0xd8ff6b, 0.82, Math.PI / 2);
    rightHalf.position.x = 0.82;
    capsule.add(leftHalf, rightHalf);
    capsule.rotation.set(0.35, -0.5, -0.28);
    capsule.scale.setScalar(1.25);
    world.add(capsule);

    const satellites = [];
    const pillGeometry =
        typeof THREE.CapsuleGeometry === "function"
            ? new THREE.CapsuleGeometry(0.12, 0.25, 4, 8)
            : new THREE.SphereGeometry(0.16, 10, 10);

    for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2;
        const radius = 2.5;
        const pill = new THREE.Mesh(
            pillGeometry,
            new THREE.MeshStandardMaterial({
                color: index % 2 === 0 ? 0xc7b0ff : 0xd8ff6b,
                roughness: 0.4,
            })
        );
        pill.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.55, Math.sin(angle) * 0.8);
        satellites.push({ mesh: pill, baseY: pill.position.y, phase: angle });
        world.add(pill);
    }

    const particleCount = 90;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
        particlePositions[index * 3] = (Math.random() - 0.5) * 10;
        particlePositions[index * 3 + 1] = (Math.random() - 0.5) * 7;
        particlePositions[index * 3 + 2] = (Math.random() - 0.5) * 6;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particles = new THREE.Points(
        particleGeometry,
        new THREE.PointsMaterial({ color: 0x8655ee, size: 0.04, transparent: true, opacity: 0.55 })
    );
    world.add(particles);

    let pointerX = 0;
    let pointerY = 0;
    let scrollProgress = 0;
    let visible = true;
    let running = true;
    let frame = 0;

    window.addEventListener(
        "pointermove",
        (event) => {
            pointerX = (event.clientX / window.innerWidth) * 2 - 1;
            pointerY = (event.clientY / window.innerHeight) * 2 - 1;
        },
        { passive: true }
    );

    window.addEventListener(
        "scroll",
        () => {
            scrollProgress = Math.min(window.scrollY / Math.max(hero.offsetHeight, 1), 1);
        },
        { passive: true }
    );

    document.addEventListener("visibilitychange", () => {
        running = !document.hidden;
    });

    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
            (entries) => {
                visible = entries.some((entry) => entry.isIntersecting);
            },
            { threshold: 0.08 }
        );
        observer.observe(hero);
    }

    function resize() {
        const width = hero.clientWidth;
        const height = hero.clientHeight;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        world.position.x = width < 1080 ? 1.8 : 3.15;
        world.scale.setScalar(width < 760 ? 0.72 : width < 1080 ? 0.9 : 1);
    }

    const clock = new THREE.Clock();
    let animateOn = motionOn();
    window.addEventListener("nivra:motion", (event) => {
        animateOn = Boolean(event.detail?.enabled);
        canvas.style.display = animateOn ? "" : "none";
    });

    function render() {
        requestAnimationFrame(render);
        if (!animateOn || !running || !visible) return;

        // Throttle to ~30fps on busy pages.
        frame += 1;
        if (frame % 2 === 1) return;

        const elapsed = clock.getElapsedTime();
        capsule.rotation.y = -0.5 + elapsed * 0.18 + pointerX * 0.12;
        capsule.rotation.x = 0.35 + Math.sin(elapsed * 0.45) * 0.06 - pointerY * 0.08;
        capsule.position.y = Math.sin(elapsed * 0.7) * 0.12;
        particles.rotation.y = elapsed * -0.012;
        satellites.forEach((satellite) => {
            satellite.mesh.position.y = satellite.baseY + Math.sin(elapsed * 0.8 + satellite.phase) * 0.12;
        });
        world.rotation.y += (pointerX * 0.08 - world.rotation.y) * 0.03;
        world.position.y = 0.45 - scrollProgress * 1.1;
        renderer.render(scene, camera);
    }

    resize();
    window.addEventListener("resize", resize);
    render();

    window.NivraScene = {
        pulse() {
            if (typeof gsap === "undefined") return;
            gsap.fromTo(
                capsule.scale,
                { x: 1.25, y: 1.25, z: 1.25 },
                { x: 1.4, y: 1.4, z: 1.4, duration: 0.28, yoyo: true, repeat: 1, ease: "power2.out" }
            );
        },
    };
})();
