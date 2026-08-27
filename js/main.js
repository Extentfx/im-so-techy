import * as THREE from 'three';

/* ============================================================
   THE ALOTION GOLF CLUB
   A scroll-driven three.js estate: the camera walks the
   fairway from the first tee to the clubhouse as you scroll.
   ============================================================ */

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const body = document.body;

/* ------------------------------------------------------------
   UI — preloader
------------------------------------------------------------ */
const preloader = $('#preloader');
let loadDone = false;
function finishLoad() {
  if (loadDone) return;
  loadDone = true;
  body.classList.add('loaded');
  setTimeout(() => { if (preloader) preloader.style.display = 'none'; }, 2700);
}
if (document.readyState === 'complete') setTimeout(finishLoad, 400);
else {
  window.addEventListener('load', () => setTimeout(finishLoad, 400), { once: true });
  setTimeout(finishLoad, 3800); // safety net
}

/* ------------------------------------------------------------
   UI — marquee (duplicate for seamless loop)
------------------------------------------------------------ */
const marqueeTrack = $('#marqueeTrack');
if (marqueeTrack) marqueeTrack.innerHTML += marqueeTrack.innerHTML;

/* ------------------------------------------------------------
   UI — nav, progress, hero parallax, image parallax
------------------------------------------------------------ */
const nav = $('#nav');
const progressBar = $('#progressBar');
const heroInner = $('#heroInner');

let targetT = 0;
let smoothT = 0;

const parallaxItems = $$('img[data-parallax]').map((el) => ({
  el,
  frame: el.parentElement,
  speed: parseFloat(el.dataset.parallax) || 0.1,
}));

function uiTick() {
  const y = window.scrollY;
  const vh = window.innerHeight;
  progressBar.style.width = (targetT * 100).toFixed(2) + '%';
  nav.classList.toggle('scrolled', y > 24);

  if (y < vh * 1.25) {
    heroInner.style.transform = `translate3d(0, ${(y * 0.26).toFixed(1)}px, 0)`;
    heroInner.style.opacity = String(1 - smoothstep(vh * 0.3, vh * 0.9, y) * 0.85);
  }

  if (!reduced) {
    for (const it of parallaxItems) {
      const r = it.frame.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) continue;
      const p = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
      it.el.style.setProperty('--py', `${(-p * it.speed * 320).toFixed(1)}px`);
    }
  }
}

function onScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  targetT = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
  if (reduced) {
    smoothT = targetT;
    uiTick();
    renderFrame();
  }
}
window.addEventListener('scroll', onScroll, { passive: true });

/* ------------------------------------------------------------
   UI — scroll reveals + counters
------------------------------------------------------------ */
function runCounters(scope) {
  $$('.stat-num', scope).forEach((el) => {
    const end = parseInt(el.dataset.count, 10) || 0;
    const fmt = (n) => (el.dataset.format === 'comma' ? n.toLocaleString('en-US') : String(n));
    if (reduced) { el.textContent = fmt(end); return; }
    const t0 = performance.now();
    const dur = 1700;
    (function tick(now) {
      const p = clamp((now - t0) / dur, 0, 1);
      el.textContent = fmt(Math.round(end * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  });
}

const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      if (e.target.querySelector('.stat-num')) runCounters(e.target);
      io.unobserve(e.target);
    }
  },
  { threshold: 0.15, rootMargin: '0px 0px -6% 0px' }
);
$$('[data-reveal]').forEach((el) => io.observe(el));

/* ------------------------------------------------------------
   UI — signature holes
------------------------------------------------------------ */
const HOLE_DATA = [
  {
    no: 'No. IV', name: 'The Cypress', meta: 'Par 5 · 588 yards',
    desc: 'A riverbend reach shadowed by century-old cypress. The carry is honest; the view is the penalty.',
  },
  {
    no: 'No. IX', name: 'White River', meta: 'Par 3 · 214 yards',
    desc: 'A firm green split by the river itself. The ball may cross. Your nerves may not.',
  },
  {
    no: 'No. XVI', name: 'Ozark Ridge', meta: 'Par 4 · 471 yards',
    desc: 'A blind dogleg over the north ridge, where the wind keeps the score and the pines keep the secrets.',
  },
  {
    no: 'No. XVIII', name: 'The Alotion', meta: 'Par 5 · 612 yards',
    desc: 'Two carries past the stone terrace to the clubhouse green. Every member’s final test, and the reason for the long walk home.',
  },
];
const holeBtns = $$('.hole');
const holeImgs = $$('.hole-img');
const holeBody = $('#holeCardBody');
let holeTimer = null;
function setHole(i) {
  const d = HOLE_DATA[i];
  if (!d || !holeBody) return;
  holeBtns.forEach((b, bi) => b.classList.toggle('is-active', bi === i));
  holeImgs.forEach((im, ii) => im.classList.toggle('is-active', ii === i));
  clearTimeout(holeTimer);
  holeBody.classList.add('swap');
  holeTimer = setTimeout(() => {
    $('#holeNo').textContent = d.no;
    $('#holeName').textContent = d.name;
    $('#holeMeta').textContent = d.meta;
    $('#holeDesc').textContent = d.desc;
    holeBody.classList.remove('swap');
  }, 220);
}
holeBtns.forEach((b, i) => {
  b.addEventListener('click', () => setHole(i));
  b.addEventListener('mouseenter', () => setHole(i));
});

/* ------------------------------------------------------------
   UI — mobile menu + form
------------------------------------------------------------ */
const burger = $('#burger');
if (burger) {
  burger.addEventListener('click', () => {
    const open = body.classList.toggle('menu-open');
    burger.setAttribute('aria-expanded', String(open));
  });
}
$$('.menu-links a').forEach((a) =>
  a.addEventListener('click', () => body.classList.remove('menu-open'))
);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') body.classList.remove('menu-open');
});

const form = $('#tourForm');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    form.innerHTML = `
      <div class="form-success">
        <p class="form-success-mark">✦</p>
        <p class="form-success-title">Received, with thanks.</p>
        <p>The membership secretary will write to you within a day or two, and never in a hurry.</p>
      </div>`;
  });
}

/* ============================================================
   THE SCENE
============================================================ */
const canvas = $('#scene');
let renderer, scene, camera;
let flagGeo = null, flagBase = null, ball = null, ballShadow = null, water = null;
let birds = [], clouds = [];
let camPath, lookStart, lookEnd, lookCur;
let mouseX = 0, mouseY = 0, smX = 0, smY = 0;
let prevBz = 100;
let sunCore = null, sunHalo = null;
const clock = new THREE.Clock();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const greenZ = -242;
let greenX = 0, clubX = 0;

/* ----- course geometry (shared by terrain, trees, ball) ----- */
function fairwayX(z) {
  return 18 * Math.sin(z * 0.0065) + 8 * Math.sin(z * 0.017 + 1.3);
}
const riverCurve = new THREE.CatmullRomCurve3(
  [[85, 340], [70, 210], [58, 100], [52, -20], [40, -140], [14, -260], [55, -350]]
    .map(([x, z]) => new THREE.Vector3(x, 0, z))
);
const RIVER = riverCurve.getSpacedPoints(240);
function distToRiver(x, z) {
  let d = Infinity;
  for (let i = 0; i < RIVER.length; i++) {
    const dx = x - RIVER[i].x;
    const dz = z - RIVER[i].z;
    const dd = dx * dx + dz * dz;
    if (dd < d) d = dd;
  }
  return Math.sqrt(d);
}
greenX = fairwayX(greenZ);
clubX = fairwayX(-258) + 6;

function greenMask(x, z) {
  const gd = Math.hypot(x - greenX, z - greenZ);
  return 1 - smoothstep(16, 42, gd);
}
function terrainH(x, z) {
  const fx = fairwayX(z);
  const d = Math.abs(x - fx);
  let h =
    Math.sin(x * 0.016 + 1.2) * 1.7 +
    Math.cos(z * 0.011 + 0.5) * 1.9 +
    Math.sin((x * 0.6 + z) * 0.03) * 0.8;
  const rise = smoothstep(15, 80, d);
  h += rise * (7.5 + 4.5 * Math.sin(z * 0.016 + x * 0.01) + 2.5 * Math.cos(z * 0.005 - x * 0.008));
  h += -z * 0.01;
  const gm = greenMask(x, z);
  if (gm > 0) h = lerp(h, 2.6, gm);
  const rd = distToRiver(x, z);
  if (rd < 20) h = lerp(h, -2.8, 1 - smoothstep(6, 20, rd));
  return h;
}

function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xede4cc, 90, 430);

  camera = new THREE.PerspectiveCamera(
    45, window.innerWidth / window.innerHeight, 0.1, 900
  );

  /* ----- lights ----- */
  const sun = new THREE.DirectionalLight(0xffd9a4, 2.1);
  sun.position.set(35, 34, -340);
  sun.target.position.set(0, 0, -90);
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xe9dfc6, 0x46543f, 1.1));
  const rim = new THREE.DirectionalLight(0xaebfb4, 0.45);
  rim.position.set(-80, 40, 120);
  scene.add(rim);

  /* ----- terrain ----- */
  const W = 440, L = 700, SX = 140, SZ = 200;
  const geo = new THREE.PlaneGeometry(W, L, SX, SZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cA = new THREE.Color(0x66855b);
  const cB = new THREE.Color(0x5b7a51);
  const cRough1 = new THREE.Color(0x44593f);
  const cRough2 = new THREE.Color(0x3a4f38);
  const cGreen = new THREE.Color(0x7e9c6b);
  const cSand = new THREE.Color(0xd8c695);
  const cBerm = new THREE.Color(0xb7a678);
  const cTmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainH(x, z);
    pos.setY(i, h);

    const fx = fairwayX(z);
    const d = Math.abs(x - fx);
    const stripe = 0.5 + 0.5 * Math.sin(z * 1.1 + Math.sin(x * 0.05) * 0.4);
    cTmp.copy(cA).lerp(cB, stripe * 0.75);
    const n = (Math.sin(x * 0.35) + Math.cos(z * 0.4) + Math.sin((x + z) * 0.21)) * 0.33;
    const rough = clamp((d - 15) * 0.022 + (n - 0.2) * 0.14 + Math.max(0, h - 8) * 0.035, 0, 1);
    cTmp.lerp(rough > 0.5 ? cRough2 : cRough1, rough);
    const gm = greenMask(x, z);
    if (gm > 0) cTmp.lerp(cGreen, gm * 0.85);
    const b1 = Math.hypot(x - (greenX + 9), z - (greenZ + 6));
    const b2 = Math.hypot(x - (greenX - 11), z - (greenZ - 8));
    if (b1 < 4.5) cTmp.lerp(cSand, (1 - b1 / 4.5) * 0.95);
    if (b2 < 5) cTmp.lerp(cSand, (1 - b2 / 5) * 0.95);
    const rd = distToRiver(x, z);
    if (rd < 10) cTmp.lerp(cBerm, (1 - rd / 10) * 0.65);
    colors[i * 3] = cTmp.r;
    colors[i * 3 + 1] = cTmp.g;
    colors[i * 3 + 2] = cTmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
  );
  scene.add(terrain);

  /* ----- river ----- */
  const waterGeo = new THREE.BufferGeometry();
  {
    const pts = [];
    for (let i = 0; i < RIVER.length - 1; i += 2) pts.push(RIVER[i]);
    const n = pts.length;
    const arr = new Float32Array(n * 6);
    const idx = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[Math.min(i + 1, n - 1)];
      const tx = q.x - p.x;
      const tz = q.z - p.z;
      const len = Math.hypot(tx, tz) || 1;
      const nx = (-tz / len) * 20;
      const nz = (tx / len) * 20;
      arr[i * 6] = p.x + nx; arr[i * 6 + 1] = 0.55; arr[i * 6 + 2] = p.z + nz;
      arr[i * 6 + 3] = p.x - nx; arr[i * 6 + 4] = 0.55; arr[i * 6 + 5] = p.z - nz;
      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    waterGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    waterGeo.setIndex(idx);
    waterGeo.computeVertexNormals();
  }
  water = new THREE.Mesh(
    waterGeo,
    new THREE.MeshPhongMaterial({
      color: 0x3e615a,
      specular: 0xd8e8dc,
      shininess: 170,
      emissive: 0x0d1a15,
      transparent: true,
      opacity: 0.94,
    })
  );
  scene.add(water);

  /* ----- trees (instanced) ----- */
  function scatter(count) {
    const out = [];
    let tries = 0;
    while (out.length < count && tries < count * 60) {
      tries++;
      const x = (Math.random() * 2 - 1) * 200;
      const z = (Math.random() * 2 - 1) * 330;
      if (Math.abs(x - fairwayX(z)) < 14) continue;
      if (distToRiver(x, z) < 11) continue;
      if (Math.hypot(x - greenX, z - greenZ) < 30) continue;
      if (Math.hypot(x - clubX, z + 258) < 24) continue;
      out.push([x, z]);
    }
    return out;
  }
  const cypressPts = scatter(130);
  const oakPts = scatter(70);
  const cMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const oMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const tMat = new THREE.MeshStandardMaterial({ color: 0x57432f, roughness: 1 });
  const cypress = new THREE.InstancedMesh(new THREE.ConeGeometry(1.5, 7.5, 7), cMat, Math.max(1, cypressPts.length));
  const cypressTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.3, 2.2, 6), tMat, Math.max(1, cypressPts.length));
  const oaks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.6, 0), oMat, Math.max(1, oakPts.length));
  const oakTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.36, 1.8, 6), tMat, Math.max(1, oakPts.length));
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const s4 = new THREE.Vector3();
  const p4 = new THREE.Vector3();
  const col = new THREE.Color();
  cypressPts.forEach(([x, z], i) => {
    const s = 0.7 + Math.random() * 0.9;
    const h = terrainH(x, z);
    q4.setFromAxisAngle(Y_AXIS, Math.random() * Math.PI * 2);
    s4.set(s, s * (0.9 + Math.random() * 0.5), s);
    p4.set(x, h + 3.75 * s + 0.4 * s, z);
    m4.compose(p4, q4, s4);
    cypress.setMatrixAt(i, m4);
    p4.set(x, h + 1.0 * s, z);
    m4.compose(p4, q4, s4);
    cypressTrunks.setMatrixAt(i, m4);
    col.setHSL(0.34, 0.3, 0.16 + Math.random() * 0.09);
    cypress.setColorAt(i, col);
    cypressTrunks.setColorAt(i, col.setScalar(0.85 + Math.random() * 0.3));
  });
  oakPts.forEach(([x, z], i) => {
    const s = 0.8 + Math.random() * 0.6;
    const h = terrainH(x, z);
    q4.setFromAxisAngle(Y_AXIS, Math.random() * Math.PI * 2);
    s4.set(s, s * (0.75 + Math.random() * 0.4), s);
    p4.set(x, h + 2.1 * s, z);
    m4.compose(p4, q4, s4);
    oaks.setMatrixAt(i, m4);
    p4.set(x, h + 0.8 * s, z);
    m4.compose(p4, q4, s4);
    oakTrunks.setMatrixAt(i, m4);
    col.setHSL(0.27, 0.32, 0.22 + Math.random() * 0.1);
    oaks.setColorAt(i, col);
    oakTrunks.setColorAt(i, col.setScalar(0.85 + Math.random() * 0.3));
  });
  [cypress, cypressTrunks, oaks, oakTrunks].forEach((im) => {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = false;
    scene.add(im);
  });

  /* ----- clubhouse ----- */
  const cb = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xcfc2a3, roughness: 0.95 });
  const slate = new THREE.MeshStandardMaterial({ color: 0x4d4842, roughness: 0.9 });
  const hall = new THREE.Mesh(new THREE.BoxGeometry(26, 8.5, 13), stone);
  hall.position.y = 4.25;
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(9, 6.5, 11), stone);
  wingL.position.set(-17.5, 3.25, 1.5);
  const wingR = new THREE.Mesh(new THREE.BoxGeometry(9, 6.5, 11), stone);
  wingR.position.set(17.5, 3.25, 1.5);
  function gable(w, hgt, d) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2 - 0.7, 0);
    s.lineTo(w / 2 + 0.7, 0);
    s.lineTo(0, hgt);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return new THREE.Mesh(g, slate);
  }
  const roof = gable(13, 4.6, 27);
  roof.rotation.y = Math.PI / 2;
  roof.position.y = 8.5;
  const roofL = gable(9, 3.4, 11);
  roofL.position.set(-17.5, 6.5, 1.5);
  const roofR = gable(9, 3.4, 11);
  roofR.position.set(17.5, 6.5, 1.5);
  const cup = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 2.6), stone);
  cup.position.set(0, 13.9, 0);
  const cupR = new THREE.Mesh(new THREE.ConeGeometry(2.3, 2.2, 4), slate);
  cupR.position.set(0, 16.1, 0);
  cupR.rotation.y = Math.PI / 4;
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffbe72 });
  for (let i = -2; i <= 2; i++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.6, 0.25), winMat);
    w.position.set(i * 5, 5.2, 6.6);
    cb.add(w);
  }
  for (const sx of [-17.5, 17.5]) {
    for (const dx of [-2.4, 2.4]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.2, 0.25), winMat);
      w.position.set(sx + dx, 4.2, 7.1);
      cb.add(w);
    }
  }
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(3, 4.6, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x46362a, roughness: 0.9 })
  );
  door.position.set(0, 2.3, 6.6);
  const terrace = new THREE.Mesh(
    new THREE.BoxGeometry(15, 0.5, 7),
    new THREE.MeshStandardMaterial({ color: 0xb9ab8d, roughness: 1 })
  );
  terrace.position.set(0, 0.25, 9.8);
  cb.add(hall, wingL, wingR, roof, roofL, roofR, cup, cupR, door, terrace);
  cb.position.set(clubX, terrainH(clubX, -258) - 0.3, -258);
  cb.rotation.y = -0.35;
  scene.add(cb);

  /* ----- 18th flag ----- */
  const flagGroup = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xece7d8, roughness: 0.4, metalness: 0.3 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 7.2, 10), poleMat);
  pole.position.y = 3.6;
  const cup18 = new THREE.Mesh(
    new THREE.CircleGeometry(0.22, 16),
    new THREE.MeshBasicMaterial({ color: 0x141c14 })
  );
  cup18.rotation.x = -Math.PI / 2;
  cup18.position.set(1.2, 0.04, 0.6);
  flagGroup.add(pole, cup18);
  flagGeo = new THREE.PlaneGeometry(2.9, 1.6, 12, 6);
  flagGeo.translate(1.45, 0, 0);
  flagBase = flagGeo.attributes.position.array.slice();
  const flag = new THREE.Mesh(
    flagGeo,
    new THREE.MeshStandardMaterial({ color: 0x7c2f2a, roughness: 0.85, side: THREE.DoubleSide })
  );
  flag.position.y = 6.3;
  flagGroup.add(flag);
  const gh = terrainH(greenX + 2, greenZ);
  flagGroup.position.set(greenX + 2, gh, greenZ);
  scene.add(flagGroup);

  /* ----- the ball ----- */
  ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0xf7f4e9, roughness: 0.28, metalness: 0.05 })
  );
  ballShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 20),
    new THREE.MeshBasicMaterial({ color: 0x1a241c, transparent: true, opacity: 0.22, depthWrite: false })
  );
  ballShadow.rotation.x = -Math.PI / 2;
  scene.add(ball, ballShadow);

  /* ----- birds ----- */
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x4c463c, side: THREE.DoubleSide });
  const wingGeo = new THREE.PlaneGeometry(1.15, 0.34);
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const wl = new THREE.Mesh(wingGeo, birdMat);
    wl.position.x = -0.55;
    const wr = new THREE.Mesh(wingGeo, birdMat);
    wr.position.x = 0.55;
    g.add(wl, wr);
    g.scale.setScalar(0.8 + i * 0.12);
    birds.push({
      g, wl, wr,
      r: 55 + i * 16,
      h: 30 + (i % 3) * 5,
      speed: 0.05 + i * 0.008,
      phase: i * 1.9,
      cz: 30 - i * 14,
    });
    scene.add(g);
  }

  /* ----- clouds + sun ----- */
  function glowTexture(stops) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 6, 128, 128, 128);
    stops.forEach(([o, col]) => g.addColorStop(o, col));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }
  const cloudTex = glowTexture([
    [0, 'rgba(255,250,238,0.85)'],
    [0.5, 'rgba(255,250,238,0.35)'],
    [1, 'rgba(255,250,238,0)'],
  ]);
  for (let i = 0; i < 6; i++) {
    const s = 70 + Math.random() * 60;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(s, s * 0.42),
      new THREE.MeshBasicMaterial({
        map: cloudTex, transparent: true,
        opacity: 0.22 + Math.random() * 0.14, depthWrite: false,
      })
    );
    m.position.set((Math.random() * 2 - 1) * 260, 38 + Math.random() * 24, -320 + Math.random() * 420);
    m.lookAt(camera.position);
    clouds.push({ m, speed: 1.1 + Math.random() * 1.4 });
    scene.add(m);
  }
  const sunCore = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture([
        [0, 'rgba(255,246,224,1)'],
        [0.35, 'rgba(255,226,170,0.55)'],
        [1, 'rgba(255,240,210,0)'],
      ]),
      transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, fog: false,
    })
  );
  sunCore.scale.setScalar(46);
  sunCore.position.set(30, 26, -360);
  sunCore.material.opacity = 0.12;
  const sunHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture([
        [0, 'rgba(255,238,204,0.8)'],
        [0.4, 'rgba(255,220,160,0.28)'],
        [1, 'rgba(255,240,210,0)'],
      ]),
      transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, fog: false,
    })
  );
  sunHalo.scale.setScalar(160);
  sunHalo.position.set(30, 30, -380);
  sunHalo.material.opacity = 0.1;
  scene.add(sunCore, sunHalo);

  /* ----- camera path ----- */
  camPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(fairwayX(160) + 16, 30, 175),
    new THREE.Vector3(fairwayX(-30) - 12, 17, -15),
    new THREE.Vector3(fairwayX(-236) + 6, 10.5, -202),
  ]);
  lookStart = new THREE.Vector3(fairwayX(80), 3, 50);
  lookEnd = new THREE.Vector3(clubX, 7, -254);
  lookCur = lookStart.clone();
  camera.position.copy(camPath.getPoint(0));
  camera.lookAt(lookStart);
  clouds.forEach((c) => c.m.lookAt(camera.position));
}

/* ------------------------------------------------------------
   animation
------------------------------------------------------------ */
function updateScene(t) {
  const camT = easeInOut(clamp(smoothT / 0.88, 0, 1));
  const p = camPath.getPoint(camT);
  if (!reduced) {
    smX += (mouseX - smX) * 0.04;
    smY += (mouseY - smY) * 0.04;
  }
  camera.position.set(
    p.x + smX * 2.6,
    p.y - smY * 1.6 + (reduced ? 0 : Math.sin(t * 0.55) * 0.4),
    p.z
  );
  lookCur.lerpVectors(lookStart, lookEnd, camT);
  camera.lookAt(lookCur.x + smX * 3, lookCur.y - smY * 1.2, lookCur.z);

  /* the sun settles in as you reach the river */
  if (sunCore) {
    const s = camT * camT;
    sunCore.material.opacity = 0.12 + 0.83 * s;
    sunHalo.material.opacity = 0.1 + 0.6 * s;
  }

  /* the ball rolls down the fairway as the estate is walked */
  const bz = lerp(100, -236, camT);
  const bx = fairwayX(bz) + 1;
  const bh = terrainH(bx, bz);
  ball.position.set(bx, bh + 0.45, bz);
  ball.rotation.x += (bz - prevBz) / 0.42;
  prevBz = bz;
  ballShadow.position.set(bx, bh + 0.05, bz);

  /* flag flutters */
  if (flagGeo) {
    const fp = flagGeo.attributes.position;
    const anim = reduced ? 0 : 1;
    for (let i = 0; i < fp.count; i++) {
      const bxi = flagBase[i * 3];
      const byi = flagBase[i * 3 + 1];
      const amp = bxi / 2.9;
      fp.setZ(i, (Math.sin(bxi * 2.4 - t * 7 + byi * 1.2) * 0.3 + Math.sin(t * 2.2) * 0.06) * amp * anim);
    }
    fp.needsUpdate = true;
    flagGeo.computeVertexNormals();
  }

  /* water breathes */
  if (water) water.position.y = reduced ? 0 : Math.sin(t * 0.7) * 0.05;

  /* birds wheel */
  for (const b of birds) {
    const a = (reduced ? 0.6 : t) * b.speed * (reduced ? 10 : 1) + b.phase;
    b.g.position.set(Math.cos(a) * b.r, b.h + Math.sin(a * 0.7) * 1.5, b.cz + Math.sin(a) * b.r);
    b.g.rotation.y = Math.PI / 2 - a;
    const f = reduced ? 0.2 : Math.sin(t * 5 + b.phase) * 0.55;
    b.wl.rotation.z = f * 0.6;
    b.wr.rotation.z = -f * 0.6;
  }

  /* clouds drift */
  if (!reduced) {
    for (const c of clouds) {
      c.m.position.x += c.speed * 0.016;
      if (c.m.position.x > 300) c.m.position.x = -300;
      c.m.lookAt(camera.position);
    }
  }
}

function renderFrame() {
  if (!renderer) return;
  updateScene(clock.getElapsedTime());
  renderer.render(scene, camera);
}

function onResize() {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (reduced) renderFrame();
}
window.addEventListener('resize', onResize);

try {
  initScene();
} catch (err) {
  console.warn('three.js scene unavailable:', err);
  if (canvas) canvas.style.display = 'none';
}

onScroll();
uiTick();
if (reduced) {
  smoothT = targetT;
  renderFrame();
} else {
  window.addEventListener('pointermove', (e) => {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = (e.clientY / window.innerHeight) * 2 - 1;
  });
  (function tick() {
    requestAnimationFrame(tick);
    smoothT += (targetT - smoothT) * 0.06;
    uiTick();
    renderFrame();
  })();
}
