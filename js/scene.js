(function () {
    const canvas = document.querySelector("#medicineScene");
    const hero = document.querySelector(".hero");
    if (!canvas || !hero || typeof THREE === "undefined") return;

    const reduceMotion = !(window.NivraMotion ? window.NivraMotion.enabled() : true);
    if (reduceMotion) {
        canvas.style.opacity = "0.55";
    }

    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0, 11);

    const world = new THREE.Group();
    world.position.set(3.15, 0.45, 0);
    scene.add(world);

    const ambient = new THREE.AmbientLight(0xffffff, 1.3);
    const purpleLight = new THREE.PointLight(0x9c72ff, 55, 24);
    purpleLight.position.set(3, 4, 6);
    const acidLight = new THREE.PointLight(0xd8ff6b, 42, 18);
    acidLight.position.set(-3, -2, 4);
    const rimLight = new THREE.PointLight(0xffffff, 25, 20);
    rimLight.position.set(0, 1, -4);
    scene.add(ambient, purpleLight, acidLight, rimLight);

    function capsuleHalf(color, x, rotationZ) {
        const group = new THREE.Group();
        const material = new THREE.MeshPhysicalMaterial({
            color,
            roughness: 0.2,
            metalness: 0.05,
            clearcoat: 1,
            clearcoatRoughness: 0.08,
            transmission: 0.08,
        });

        const cylinder = new THREE.Mesh(
            new THREE.CylinderGeometry(0.72, 0.72, 1.65, 64, 1, false),
            material
        );
        cylinder.rotation.z = Math.PI / 2;

        const cap = new THREE.Mesh(
            new THREE.SphereGeometry(0.72, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2),
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

    const seam = new THREE.Mesh(
        new THREE.TorusGeometry(0.73, 0.025, 16, 80),
        new THREE.MeshStandardMaterial({
            color: 0xf8f2e9,
            roughness: 0.25,
            metalness: 0.2,
        })
    );
    seam.rotation.y = Math.PI / 2;
    capsule.add(seam);

    const innerGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.92, 40, 40),
        new THREE.MeshBasicMaterial({
            color: 0xbfa1ff,
            transparent: true,
            opacity: 0.08,
            side: THREE.BackSide,
        })
    );
    innerGlow.scale.set(2.8, 1.7, 1.7);
    world.add(innerGlow);

    const orbitGroup = new THREE.Group();
    world.add(orbitGroup);

    [
        { radius: 2.2, tube: 0.012, color: 0xc7b0ff, x: 0.6, y: 0.2 },
        { radius: 2.85, tube: 0.009, color: 0xd8ff6b, x: -0.5, y: 0.8 },
        { radius: 3.4, tube: 0.007, color: 0xffffff, x: 0.95, y: -0.3 },
    ].forEach((ring) => {
        const mesh = new THREE.Mesh(
            new THREE.TorusGeometry(ring.radius, ring.tube, 12, 180),
            new THREE.MeshBasicMaterial({
                color: ring.color,
                transparent: true,
                opacity: 0.35,
            })
        );
        mesh.rotation.x = ring.x;
        mesh.rotation.y = ring.y;
        orbitGroup.add(mesh);
    });

    const satellites = [];
    const pillGeometry =
        typeof THREE.CapsuleGeometry === "function"
            ? new THREE.CapsuleGeometry(0.12, 0.25, 6, 12)
            : new THREE.SphereGeometry(0.16, 16, 16);

    for (let index = 0; index < 10; index += 1) {
        const angle = (index / 10) * Math.PI * 2;
        const radius = 2.3 + (index % 3) * 0.5;
        const material = new THREE.MeshPhysicalMaterial({
            color: index % 2 === 0 ? 0xc7b0ff : 0xd8ff6b,
            roughness: 0.25,
            clearcoat: 0.8,
        });
        const pill = new THREE.Mesh(pillGeometry, material);
        pill.position.set(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius * 0.65,
            Math.sin(angle * 1.7) * 1.4
        );
        pill.rotation.set(angle, angle * 0.4, angle * 0.2);
        pill.scale.setScalar(index % 4 === 0 ? 1.25 : 0.8);
        satellites.push({
            mesh: pill,
            base: pill.position.clone(),
            phase: angle,
            speed: 0.25 + (index % 4) * 0.06,
        });
        world.add(pill);
    }

    const particleCount = 550;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);
    const purple = new THREE.Color(0x8655ee);
    const acid = new THREE.Color(0xd8ff6b);

    for (let index = 0; index < particleCount; index += 1) {
        const radius = 2.5 + Math.random() * 5.8;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        particlePositions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
        particlePositions[index * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
        particlePositions[index * 3 + 2] = radius * Math.cos(phi);

        const color = Math.random() > 0.82 ? acid : purple;
        particleColors[index * 3] = color.r;
        particleColors[index * 3 + 1] = color.g;
        particleColors[index * 3 + 2] = color.b;
    }

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    particleGeometry.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));
    const particles = new THREE.Points(
        particleGeometry,
        new THREE.PointsMaterial({
            size: 0.035,
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            sizeAttenuation: true,
        })
    );
    world.add(particles);

    let pointerX = 0;
    let pointerY = 0;
    let scrollProgress = 0;

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
    let motionOn = !reduceMotion;

    window.addEventListener("nivra:motion", (event) => {
        motionOn = Boolean(event.detail?.enabled);
        canvas.style.opacity = motionOn ? "1" : "0.55";
    });

    function render() {
        requestAnimationFrame(render);
        const elapsed = clock.getElapsedTime();

        if (motionOn) {
            capsule.rotation.y = -0.5 + elapsed * 0.22 + pointerX * 0.18;
            capsule.rotation.x = 0.35 + Math.sin(elapsed * 0.5) * 0.08 - pointerY * 0.1;
            capsule.position.y = Math.sin(elapsed * 0.8) * 0.18;
            capsule.position.z = Math.cos(elapsed * 0.55) * 0.12;

            orbitGroup.rotation.y = elapsed * 0.07;
            orbitGroup.rotation.z = elapsed * -0.035;
            particles.rotation.y = elapsed * -0.015;
            particles.rotation.x = elapsed * 0.008;

            satellites.forEach((satellite) => {
                const pulse = 1 + Math.sin(elapsed * 1.4 + satellite.phase) * 0.12;
                satellite.mesh.scale.setScalar(pulse);
                satellite.mesh.position.y =
                    satellite.base.y + Math.sin(elapsed * satellite.speed + satellite.phase) * 0.18;
                satellite.mesh.rotation.x += 0.004;
                satellite.mesh.rotation.y += 0.006;
            });

            world.rotation.y += (pointerX * 0.1 - world.rotation.y) * 0.025;
            world.rotation.x += (-pointerY * 0.06 - world.rotation.x) * 0.025;
            world.position.y = 0.45 - scrollProgress * 1.2;
        }

        renderer.render(scene, camera);
    }

    resize();
    window.addEventListener("resize", resize);
    render();

    window.NivraScene = {
        pulse() {
            if (typeof gsap !== "undefined") {
                gsap.fromTo(
                    capsule.scale,
                    { x: 1.25, y: 1.25, z: 1.25 },
                    { x: 1.48, y: 1.48, z: 1.48, duration: 0.35, yoyo: true, repeat: 1, ease: "power2.out" }
                );
            }
        },
    };
})();
