/**
 * Visual QA for the Tamashi: `?gallery=1` lays out all 100 head to toe on a 20×5 wall with id
 * labels, lit like the game at night (`&heads`: 10×10 bleachers framing the TVs); `?gallery=<id>` shows one up close in a 3/4 front view
 * next to its artwork. Not part of the game.
 *
 * Params: `&anim=idle|carrywalk|stroll|walk|run|carry|swing|cheer|wave|nod|sit|crouch`, `&yaw=<rad>`
 * (fixed turn; default slowly turning), `&t=<s>` (simulate to that time, then freeze),
 * `&one` (with `?gallery=1`: token #1 alone), `&focus=head`, `&lod=far` (force the low-detail mesh), `&dist=<m>` (single view camera distance).
 * Sets `document.documentElement.dataset.gallery = "ready"` once every screen texture and
 * the artwork have loaded, for screenshot scripts.
 *
 * Tamashi characters and artwork © Studio Mirai, LLC. All rights reserved. See NOTICE.md.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createTamashi, tamashiStats, type TamashiCharacter } from "./character";
import { screensReady } from "./screen";
import { TAMASHI_COUNT } from "./traits";

type Anim = "idle" | "carrywalk" | "stroll" | "walk" | "run" | "carry" | "swing" | "cheer" | "wave" | "nod" | "sit" | "crouch";

export function runGallery(host: HTMLElement, param: string): void {
  const q = new URLSearchParams(location.search);
  const anim = (q.get("anim") ?? "idle") as Anim;
  const freezeAt = q.has("t") ? Number(q.get("t")) : null;
  const yawParam = q.has("yaw") ? Number(q.get("yaw")) : null;
  const forceFar = q.get("lod") === "far";
  // `?gallery=1` is the grid; token #1 alone is `?gallery=1&one`.
  const single = q.has("one") || (param !== "1" && param !== "all") ? Number(param) : null;

  document.body.style.margin = "0";
  document.body.style.background = "#3a4f62";
  host.style.cssText = "position:fixed;inset:0;display:flex;font:13px/1.3 'DM Sans',system-ui,sans-serif;color:#eef3f8";
  const view = document.createElement("div");
  view.style.cssText = `position:relative;flex:${single ? "0 0 58%" : "1 1 auto"};height:100%;overflow:hidden`;
  host.append(view);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  view.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#3a4f62");
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  scene.add(new THREE.HemisphereLight("#a9c3dc", "#5a4a3c", 1.25));
  const moon = new THREE.DirectionalLight("#bcd2f0", 1.25);
  moon.position.set(-6, 12, 8);
  moon.castShadow = !!single;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = moon.shadow.camera.bottom = -3;
  moon.shadow.camera.right = moon.shadow.camera.top = 3;
  scene.add(moon);
  const fill = new THREE.DirectionalLight("#ffcf9e", 0.55);
  fill.position.set(5, 4, 9);
  scene.add(fill);

  const persp = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = single ? persp : ortho;
  let orthoW = 10;
  let orthoH = 6;
  const chars: TamashiCharacter[] = [];
  const labels: { el: HTMLElement; at: THREE.Vector3 }[] = [];
  let artReady: Promise<void> = Promise.resolve();
  let record: THREE.Mesh | null = null;

  if (single) {
    const id = THREE.MathUtils.clamp(Math.round(single), 1, TAMASHI_COUNT);
    const c = createTamashi(id, { role: "player", castShadow: true });
    scene.add(c.root);
    chars.push(c);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#46586a", roughness: 0.95 }));
    ground.receiveShadow = true;
    scene.add(ground);
    const dist = Number(q.get("dist") ?? 4.3);
    if (q.get("focus") === "head") {
      persp.position.set(0, 1.62, Number(q.get("dist") ?? 1.7));
      persp.lookAt(0, 1.52, 0);
    } else {
      persp.position.set(0, 1.45, dist);
      persp.lookAt(0, anim === "sit" || anim === "crouch" ? 0.8 : 1.02, 0);
    }
    if (anim === "carry" || anim === "carrywalk" || anim === "swing") {
      record = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.31, 0.008), new THREE.MeshStandardMaterial({ color: "#d4a24a", roughness: 0.7 }));
      record.matrixAutoUpdate = false;
      scene.add(record);
    }
    const side = document.createElement("div");
    side.style.cssText = "flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#24303c;padding:16px;box-sizing:border-box";
    const img = document.createElement("img");
    img.alt = `Tamashi #${id} artwork`;
    img.style.cssText = "width:min(100%,78vh);aspect-ratio:1;object-fit:contain;border-radius:8px;box-shadow:0 8px 30px #0008";
    artReady = new Promise((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => {
        img.replaceWith(Object.assign(document.createElement("div"), { textContent: "(artwork not in public/tamashi/portraits yet)" }));
        resolve();
      };
    });
    img.src = `${import.meta.env.BASE_URL}tamashi/portraits/${id}.webp`;
    const st = tamashiStats(id);
    const info = document.createElement("div");
    info.style.cssText = "opacity:.85;text-align:center";
    info.textContent = `#${id} · ${c.traits.vibe} · body ${st.hiTriangles} tris (far ${st.loTriangles}) + screen ${st.screenTriangles} · ${st.drawCalls} draw calls · built in ${st.buildMs.toFixed(1)} ms`;
    side.append(img, info);
    host.append(side);
  } else {
    const LABEL = "position:absolute;transform:translate(-50%,0);padding:0 4px;border-radius:3px;background:#0009;font-weight:700;font-size:11px;pointer-events:none";
    if (q.has("heads")) {
      // Bleachers: rows step back and up so every TV and upper body is visible.
      const cols = 10;
      const dx = 1.05;
      const dz = 1.25;
      const dy = 0.36;
      const stepMat = new THREE.MeshStandardMaterial({ color: "#2e3e4e", roughness: 0.9 });
      for (let r = 0; r < 10; r++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(cols * dx + 0.6, 0.12, dz), stepMat);
        step.position.set(0, r * dy - 0.06, -r * dz);
        scene.add(step);
        for (let col = 0; col < cols; col++) {
          const id = r * cols + col + 1;
          const c = createTamashi(id);
          c.root.position.set((col - (cols - 1) / 2) * dx, r * dy, -r * dz);
          scene.add(c.root);
          chars.push(c);
          const el = document.createElement("div");
          el.textContent = `${id}`;
          el.style.cssText = LABEL;
          view.append(el);
          el.style.transform = "translate(-100%,-50%)";
          labels.push({ el, at: c.root.position.clone().add(new THREE.Vector3(-0.39, 1.56, 0.2)) });
        }
      }
      // Orthographic, pitched down ~10°: every row the same size, each a TV-and-shoulders bust.
      const pitch = THREE.MathUtils.degToRad(10);
      const centre = new THREE.Vector3(0, 1.25 + 4.5 * dy, -4.5 * dz);
      const dir = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));
      camera.position.copy(centre).addScaledVector(dir, -40);
      camera.lookAt(centre);
      camera.updateMatrixWorld();
      // Vertical extent in view space: front row from mid-thigh, back row up to its antenna tips.
      const lo = new THREE.Vector3(0, 0.75, 0).applyMatrix4(camera.matrixWorldInverse).y;
      const hiY = new THREE.Vector3(0, 2.08 + 9 * dy, -9 * dz).applyMatrix4(camera.matrixWorldInverse).y;
      orthoH = hiY - lo;
      orthoW = cols * dx + 0.2;
      camera.position.addScaledVector(new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch)), (hiY + lo) / 2);
    } else {
      // Full-body wall: 20 columns × 5 shelves, every character head to toe with its id below.
      const cols = 20;
      const rows = 5;
      const dx = 0.78;
      const rowH = 2.22;
      const shelfMat = new THREE.MeshStandardMaterial({ color: "#2e3e4e", roughness: 0.9 });
      for (let r = 0; r < rows; r++) {
        const y = (rows - 1 - r) * rowH;
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(cols * dx + 0.4, 0.06, 0.7), shelfMat);
        shelf.position.set(0, y - 0.03, 0);
        scene.add(shelf);
        for (let col = 0; col < cols; col++) {
          const id = r * cols + col + 1;
          const c = createTamashi(id);
          c.root.position.set((col - (cols - 1) / 2) * dx, y, 0);
          scene.add(c.root);
          chars.push(c);
            const el = document.createElement("div");
            el.textContent = `${id}`;
            el.style.cssText = LABEL;
            view.append(el);
          labels.push({ el, at: c.root.position.clone().add(new THREE.Vector3(0, -0.04, 0.4)) });
        }
      }
      const pitch = THREE.MathUtils.degToRad(4);
      const centre = new THREE.Vector3(0, ((rows - 1) * rowH) / 2 + 0.88, 0);
      camera.position.copy(centre).add(new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(40));
      camera.lookAt(centre);
      orthoH = rows * rowH + 0.35;
      orthoW = cols * dx + 0.2;
    }
  }
  if (forceFar)
    for (const c of chars) {
      c.bodyHi.visible = false;
      c.bodyLo.visible = true;
    }

  const resize = () => {
    const w = view.clientWidth;
    const h = view.clientHeight;
    renderer.setSize(w, h);
    if (camera instanceof THREE.PerspectiveCamera) camera.aspect = w / h;
    else {
      // Fit the grid in both directions.
      const halfH = Math.max(orthoH, orthoW / (w / h)) / 2;
      const halfW = halfH * (w / h);
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    for (const l of labels) {
      const p = l.at.clone().project(camera);
      l.el.style.left = `${((p.x + 1) / 2) * w}px`;
      l.el.style.top = `${((1 - p.y) / 2) * h}px`;
    }
  };
  addEventListener("resize", resize);
  resize();

  let time = 0;
  let lastCheer = -10;
  const M = new THREE.Matrix4();
  const step = (dt: number) => {
    time += dt;
    for (const c of chars) {
      c.speed = anim === "stroll" || anim === "carrywalk" ? 1.3 : anim === "walk" ? 3.2 : anim === "run" ? 6 : 0;
      c.carry = anim === "carry" || anim === "carrywalk" ? 1 : 0;
      c.waving = anim === "wave";
      c.nod = anim === "nod" ? 0.22 : 0;
      c.pose = anim === "sit" ? "sit" : anim === "crouch" ? "crouch" : "stand";
      if (anim === "swing") {
        const u = time % 1.8;
        if (u < 0.7) {
          const k = THREE.MathUtils.smoothstep(u, 0, 0.7);
          c.swingArm = -3.25 * k;
          c.swingLean = -0.2 * k;
        } else if (u < 0.85) {
          const k = (u - 0.7) / 0.15;
          c.swingArm = -3.25 + 4.15 * k;
          c.swingLean = -0.2 + 0.55 * k;
        } else {
          const k = THREE.MathUtils.smoothstep(u, 0.85, 1.8);
          c.swingArm = 0.9 * (1 - k);
          c.swingLean = 0.35 * (1 - k);
        }
      }
      if (single && yawParam == null) c.root.rotation.y = 0.55 + 0.5 * Math.sin(time * 0.35);
      else if (single) c.root.rotation.y = yawParam!;
      c.update(dt);
    }
    if (anim === "cheer" && time - lastCheer > 1.8) {
      lastCheer = time;
      for (const c of chars) c.cheer();
    }
    if (record && chars[0]) {
      chars[0].recordMatrix(M);
      record.matrix.copy(M);
      record.matrixWorldNeedsUpdate = true;
    }
  };

  if (freezeAt != null) {
    // Fixed steps up to the requested time, then hold.
    while (time < freezeAt - 1e-6) step(Math.min(1 / 60, freezeAt - time));
  }
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (freezeAt == null) step(dt);
    renderer.render(scene, camera);
  });

  void Promise.all([screensReady(), artReady]).then(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document.documentElement.dataset.gallery = "ready";
      }),
    );
  });

  (window as unknown as { tamashi?: unknown }).tamashi = { createTamashi, tamashiStats, scene, camera, chars };
  void persp;
}
