// world.js — SOLSPIRE, a desert solar-thermal plant at golden hour, built from
// boxes and cylinders with canvas-painted textures (no external assets).
// Layout, Counter-Strike shaped: a west yard where the attackers start, a mid
// road split by the spire tower, two sites — A the Mirror Yard (north-east),
// B the Turbine Hall (south-east) — a lane and a connector to each, and the
// defenders' east gate between them. This module owns the meshes, the AABB
// colliders, the navigation graph and every physics query (movement, line of
// sight, bullet rays) so the rest of the game never touches raw geometry.

import * as THREE from 'three';
import { PAL } from './palette.js';

export const W = {
  colliders: [], // { x0, y0, z0, x1, y1, z1 }
  nodes: [],     // { x, z, name }
  adj: [],       // adjacency lists over nodes
  sites: {
    A: { x: 34, z: -23, r: 7, label: 'MIRROR YARD' },
    B: { x: 35, z: 25, r: 7, label: 'TURBINE HALL' },
  },
  spawns: {
    ATK: [[-42, -4], [-42, 0], [-42, 4], [-39, -7], [-39, 7]],
    DEF: [[43, -3], [43, 3], [40, -8], [40, 8], [44, 0]],
  },
  bounds: { x: 48, z: 36 },
  spireGlow: null,
};

function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(ctx, w, h, n, colors, s0, s1) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const s = s0 + Math.random() * (s1 - s0);
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

let scene;
const mats = {};

function buildMaterials() {
  const sandTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#d9a05b'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2600, ['#c98f45', '#e5b26c', '#bd8439', '#e8bc7c'], 1, 4);
    speckle(g, w, h, 60, ['#a8763a'], 8, 30);
  }, 10, 8);
  const asphaltTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#4c4a48'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2000, ['#5a5754', '#403e3c', '#655f58'], 1, 3);
    g.fillStyle = '#c8b98a'; g.fillRect(0, h / 2 - 3, w, 6); // faded centre line
  }, 8, 1);
  const concreteTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#b8ab98'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1500, ['#a89a83', '#c6bba6', '#978a74'], 1, 4);
    g.strokeStyle = 'rgba(70,60,45,.35)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); }
    for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * w / 2, 0); g.lineTo(i * w / 2, h); g.stroke(); }
  }, 2, 1);
  const crateTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#9a6b3f'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 500, ['#8a5c33', '#ab7a49'], 1, 3);
    g.strokeStyle = '#6e4a26'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
  });
  const oliveTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#707a52'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 500, ['#5f6a43', '#828c60'], 1, 3);
    g.strokeStyle = '#48512f'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = 'rgba(240,235,210,.5)'; g.font = 'bold 34px monospace';
    g.fillText('SOL-7', 78, 140);
  });
  mats.sand = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 });
  mats.asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.95 });
  mats.concrete = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 });
  mats.concreteDark = new THREE.MeshStandardMaterial({ color: PAL.concreteDark, roughness: 0.95 });
  mats.terracotta = new THREE.MeshStandardMaterial({ color: PAL.terracotta, roughness: 0.85 });
  mats.rust = new THREE.MeshStandardMaterial({ color: PAL.rust, roughness: 0.8, metalness: 0.3 });
  mats.steel = new THREE.MeshStandardMaterial({ color: PAL.steel, roughness: 0.45, metalness: 0.7, envMapIntensity: 1.15 });
  mats.steelDark = new THREE.MeshStandardMaterial({ color: PAL.steelDark, roughness: 0.5, metalness: 0.6 });
  mats.mirror = new THREE.MeshStandardMaterial({ color: 0xdceef8, roughness: 0.3, metalness: 0.6, envMapIntensity: 1.5 });
  mats.crate = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.9 });
  mats.olive = new THREE.MeshStandardMaterial({ map: oliveTex, roughness: 0.85 });
  mats.drum = new THREE.MeshStandardMaterial({ color: PAL.drum, roughness: 0.55, metalness: 0.5 });
  mats.glow = new THREE.MeshStandardMaterial({ color: 0x381d08, emissive: PAL.glow, emissiveIntensity: 2.6 });
  mats.lamp = new THREE.MeshStandardMaterial({ color: 0x2c2c20, emissive: 0xffca7a, emissiveIntensity: 1.6 });
  mats.dark = new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 1 });
}

function box(x, z, w, d, h, mat, opts = {}) {
  const y0 = opts.y0 || 0;
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y0 + h / 2, z);
  m.castShadow = !!opts.cast;
  m.receiveShadow = true;
  if (opts.ry) m.rotation.y = opts.ry;
  scene.add(m);
  if (!opts.noCollide) {
    // rotated props keep an axis-aligned collider of their footprint (they are
    // placed axis-aligned or round in this map, so the approximation is honest)
    W.colliders.push({ x0: x - w / 2, y0, z0: z - d / 2, x1: x + w / 2, y1: y0 + h, z1: z + d / 2 });
  }
  return m;
}

function cyl(x, z, r, h, mat, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * (opts.taper || 1), h, opts.seg || 14), mat);
  m.position.set(x, h / 2, z);
  m.castShadow = !!opts.cast;
  m.receiveShadow = true;
  scene.add(m);
  if (!opts.noCollide) {
    const rr = r * 0.92;
    W.colliders.push({ x0: x - rr, y0: 0, z0: z - rr, x1: x + rr, y1: h, z1: z + rr });
  }
  return m;
}

function siteDecal(site, letter) {
  const tex = canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,214,150,.92)'; g.lineWidth = 10;
    g.beginPath(); g.arc(w / 2, h / 2, 104, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,214,150,.92)';
    g.font = 'bold 130px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, w / 2, h / 2 + 6);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(site.r * 0.92, 28),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(site.x, 0.03, site.z);
  scene.add(m);
}

function mirrorPanel(x, z, ry) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 8), mats.steelDark);
  post.position.y = 0.55;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.7, 0.08), mats.mirror);
  panel.position.y = 1.75;
  panel.rotation.x = -0.5;
  panel.castShadow = true;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.75, 1.85, 0.05), mats.steelDark);
  frame.position.set(0, 1.75, -0.045);
  frame.rotation.x = -0.5;
  g.add(post, frame, panel);
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
  W.colliders.push({ x0: x - 1.1, y0: 0, z0: z - 1.1, x1: x + 1.1, y1: 2.1, z1: z + 1.1 });
}

function lampPost(x, z) {
  cyl(x, z, 0.09, 4.6, mats.steelDark, { noCollide: false, seg: 8 });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.3), mats.lamp);
  head.position.set(x, 4.65, z);
  scene.add(head);
}

function buildMap() {
  // ground + mid road
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 170), mats.sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(96, 9), mats.asphalt);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, 0);
  road.receiveShadow = true;
  scene.add(road);

  // perimeter
  box(0, -36.5, 98, 1, 5, mats.concrete, { cast: true });
  box(0, 36.5, 98, 1, 5, mats.concrete, { cast: true });
  box(-48.5, 0, 1, 74, 5, mats.concrete, { cast: true });
  box(48.5, 0, 1, 74, 5, mats.concrete, { cast: true });

  // ---- the spire (mid's centrepiece) ----
  const base = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 7, 1, 20), mats.concreteDark);
  base.position.set(0, 0.5, 0); base.receiveShadow = true; scene.add(base);
  W.colliders.push({ x0: -5.6, y0: 0, z0: -5.6, x1: 5.6, y1: 1, z1: 5.6 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 2.3, 33, 12), mats.steel);
  tower.position.set(0, 17.5, 0); tower.castShadow = true; scene.add(tower);
  W.colliders.push({ x0: -1.9, y0: 1, z0: -1.9, x1: 1.9, y1: 34, z1: 1.9 });
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 3.4), mats.glow);
  receiver.position.set(0, 35, 0); scene.add(receiver);
  W.spireGlow = receiver;
  const spireLight = new THREE.PointLight(PAL.glow, 900, 70, 1.8);
  spireLight.position.set(0, 34, 0);
  scene.add(spireLight);
  // support struts
  for (const [sx, sz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
    const strut = box(sx, sz, 0.7, 0.7, 6, mats.rust, { cast: true });
    strut.rotation.z = sx > 0 ? 0.38 : -0.38;
    strut.rotation.x = sz > 0 ? -0.38 : 0.38;
  }

  // ---- west yard (attacker spawn) cover ----
  box(-34, -3, 2.3, 2.3, 2.3, mats.crate, { cast: true });
  box(-34, -3, 1.15, 1.15, 3.45, mats.crate, {});
  box(-30, 6, 2.3, 1.15, 1.15, mats.olive, { cast: true });
  box(-24, -8, 3.6, 1.2, 1.6, mats.steelDark, { cast: true }); // container
  box(-24, 10, 1.15, 1.15, 1.15, mats.crate, {});
  cyl(-27, 2, 0.62, 1.25, mats.drum, { cast: true });
  cyl(-26.2, 2.8, 0.62, 1.25, mats.drum, {});

  // ---- mid cover ----
  box(-12, -2.5, 2.3, 1.15, 1.15, mats.crate, { cast: true });
  box(10, 3, 2.3, 2.3, 1.15, mats.olive, { cast: true });
  box(10, 3, 1.15, 1.15, 2.3, mats.crate, {});
  box(20, -3, 3.8, 1.6, 2.4, mats.steelDark, { cast: true }); // tanker block
  cyl(23.5, -3, 0.9, 2.2, mats.rust, { cast: true });
  box(-6, 8.5, 4.5, 0.6, 2.6, mats.concrete, { cast: true }); // mid-south wall
  box(14, -8.5, 4.5, 0.6, 2.6, mats.concrete, { cast: true }); // mid-north wall

  // ---- "Cables" connector mid -> A (a walled chicane at x ~ 6) ----
  box(3.4, -13, 0.6, 9, 3, mats.concrete, { cast: true });
  box(8.6, -16.5, 0.6, 8, 3, mats.concrete, { cast: true });
  box(6, -13.5, 1.15, 1.15, 1.15, mats.olive, {});
  // ---- "Cooling" connector mid -> B ----
  box(3.4, 13, 0.6, 9, 3, mats.concrete, { cast: true });
  box(8.6, 16.5, 0.6, 8, 3, mats.concrete, { cast: true });
  cyl(6, 13.5, 0.62, 1.25, mats.drum, {});

  // ---- Panel Row: the open north lane to A ----
  box(-16, -25, 2.3, 1.15, 1.15, mats.crate, { cast: true });
  box(-4, -29, 3.6, 1.2, 1.6, mats.steelDark, { cast: true });
  box(8, -21, 1.15, 1.15, 1.15, mats.olive, {});
  mirrorPanel(-10, -20, 0.7);
  mirrorPanel(2, -30, 2.4);
  mirrorPanel(14, -25, 1.2);

  // ---- A site: Mirror Yard ----
  siteDecal(W.sites.A, 'A');
  mirrorPanel(28, -18, 2.8);
  mirrorPanel(38, -28, 0.4);
  mirrorPanel(30, -29, 1.9);
  mirrorPanel(41, -19, 2.2);
  mirrorPanel(24, -25, 1.0);
  box(34, -16.5, 2.3, 1.15, 1.15, mats.crate, { cast: true });
  box(38, -24, 1.15, 2.3, 2.3, mats.olive, { cast: true });
  box(27, -21, 1.15, 1.15, 1.15, mats.crate, {});
  box(20.5, -14, 0.6, 10, 3.4, mats.concrete, { cast: true }); // A west screen
  box(30, -33.5, 14, 0.6, 3.4, mats.concrete, { cast: true }); // A back wall
  lampPost(24, -30);
  lampPost(42, -15);

  // ---- B approach: Cooling Yard (south lane) ----
  box(-14, 24, 2.3, 2.3, 1.15, mats.crate, { cast: true });
  box(-2, 28, 3.6, 1.2, 1.6, mats.steelDark, { cast: true });
  cyl(6, 24, 1.1, 2.6, mats.rust, { cast: true }); // storage tank
  cyl(9.5, 27, 0.62, 1.25, mats.drum, {});
  // pipe run along the lane
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 26, 10), mats.rust);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(2, 1.5, 31.5);
  pipe.castShadow = true;
  scene.add(pipe);
  W.colliders.push({ x0: -11, y0: 1.1, z0: 31.1, x1: 15, y1: 1.9, z1: 31.9 });

  // ---- B site: Turbine Hall ----
  siteDecal(W.sites.B, 'B');
  const wallH = 5.5, wt = 0.6;
  // west wall with two door gaps (z 15..17.5 and z 26..28.5)
  box(18, 20.6, wt, 5.2, wallH, mats.concrete, { cast: true });
  box(18, 30.8, wt, 2.4, wallH, mats.concrete, { cast: true });
  box(18, 24.2, wt, 3.6, wallH, mats.concrete, { cast: true });
  // north wall with one door gap (x 25..28)
  box(21.2, 12, 6.4, wt, wallH, mats.concrete, { cast: true });
  box(37.5, 12, 13, wt, wallH, mats.concrete, { cast: true });
  // east + south walls solid
  box(44, 22, wt, 20.6, wallH, mats.concrete, { cast: true });
  box(31, 32.3, 26.6, wt, wallH, mats.concrete, { cast: true });
  // roof slab (blocks rays from above, reads as a hall from outside)
  const roof = box(31, 22, 26.6, 20.6, 0.4, mats.terracotta, { y0: wallH, cast: true });
  roof.castShadow = true;
  // hall dressing: turbine, crates, glow strip
  cyl(31, 22, 3, 3.2, mats.steel, { cast: true, seg: 18 });
  cyl(31, 22, 1.1, 4.4, mats.steelDark, { seg: 12 });
  box(23, 27, 2.3, 1.15, 1.15, mats.crate, { cast: true });
  box(39, 17, 1.15, 1.15, 2.3, mats.olive, { cast: true });
  box(36, 29, 2.3, 1.15, 1.15, mats.crate, {});
  const strip = new THREE.Mesh(new THREE.BoxGeometry(20, 0.18, 0.5), mats.lamp);
  strip.position.set(31, 4.6, 12.6);
  scene.add(strip);
  lampPost(14, 18);

  // ---- east gate (defender spawn) + site screens ----
  box(44, -6, 1.2, 4.5, 2.6, mats.concrete, { cast: true });
  box(44, 6, 1.2, 4.5, 2.6, mats.concrete, { cast: true });
  box(28, -8, 4.5, 0.6, 2.6, mats.concrete, { cast: true }); // A rotate screen
  box(28, 8, 4.5, 0.6, 2.6, mats.concrete, { cast: true });  // B rotate screen

  // distant mesas for the horizon (no colliders, pure silhouette)
  for (const [x, z, w, h] of [[-120, -70, 90, 16], [110, -60, 120, 22], [90, 80, 100, 14], [-110, 70, 110, 18], [0, -120, 160, 20]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 24), mats.dark);
    m.position.set(x, h / 2 - 1, z);
    scene.add(m);
  }
}

function buildGraph() {
  const N = (x, z, name) => W.nodes.push({ x, z, name }) - 1;
  N(-40, 0, 'west yard');       // 0
  N(-28, -2, 'west mid');       // 1
  N(-28, -24, 'panel west');    // 2
  N(-28, 24, 'cooling west');   // 3
  N(-14, 0, 'mid west');        // 4
  N(-2, -10, 'mid north');      // 5
  N(-2, 10, 'mid south');       // 6
  N(6, -7, 'cables mouth');     // 7
  N(6, -14, 'cables');          // 8
  N(7, -21, 'cables top');      // 9
  N(6, 7, 'cooling mouth');     // 10
  N(6, 14, 'cooling');          // 11
  N(7, 21, 'cooling top');      // 12
  N(16, 0, 'mid east');         // 13
  N(2, -26, 'panel row');       // 14
  N(16, -22, 'A main');         // 15
  N(25, -22, 'A entry');        // 16
  N(34, -23, 'A site');         // 17
  N(40, -28, 'A back');         // 18
  N(28, -10, 'A rotate');       // 19
  N(14, 21, 'B main');          // 20
  N(16, 17, 'B door yard');     // 21
  N(26, 14.5, 'B hall north');  // 22
  N(21, 27, 'B hall west');     // 23
  N(35, 25, 'B site');          // 24
  N(40, 16, 'B back');          // 25
  N(28, 10, 'B rotate');        // 26
  N(42, 0, 'east gate');        // 27
  N(-12, -24, 'panel mid');     // 28
  N(-12, 24, 'cooling mid');    // 29
  N(36, -14, 'A heaven');       // 30
  N(20, 27, 'B yard south');    // 31

  const clear = (a, b) => {
    // a ground path is clear when no collider taller than a step crosses it
    for (const c of W.colliders) {
      if (c.y1 < 0.95 || c.y0 > 0.95) continue;
      if (segHitsBox(a.x, a.z, b.x, b.z, c.x0 - 0.5, c.z0 - 0.5, c.x1 + 0.5, c.z1 + 0.5)) return false;
    }
    return true;
  };
  W.adj = W.nodes.map(() => []);
  for (let i = 0; i < W.nodes.length; i++) {
    for (let j = i + 1; j < W.nodes.length; j++) {
      const a = W.nodes[i], b = W.nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 30 && clear(a, b)) { W.adj[i].push(j); W.adj[j].push(i); }
    }
  }
}

function segHitsBox(x0, z0, x1, z1, bx0, bz0, bx1, bz1) {
  // slab test in 2D
  const dx = x1 - x0, dz = z1 - z0;
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) { if (x0 < bx0 || x0 > bx1) return false; }
  else {
    let ta = (bx0 - x0) / dx, tb = (bx1 - x0) / dx;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (z0 < bz0 || z0 > bz1) return false; }
  else {
    let ta = (bz0 - z0) / dz, tb = (bz1 - z0) / dz;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export function findPath(fromIdx, toIdx) {
  if (fromIdx === toIdx) return [toIdx];
  const dist = new Array(W.nodes.length).fill(Infinity);
  const prev = new Array(W.nodes.length).fill(-1);
  dist[fromIdx] = 0;
  const open = new Set([fromIdx]);
  while (open.size) {
    let u = -1, best = Infinity;
    for (const i of open) if (dist[i] < best) { best = dist[i]; u = i; }
    open.delete(u);
    if (u === toIdx) break;
    for (const v of W.adj[u]) {
      const a = W.nodes[u], b = W.nodes[v];
      const nd = dist[u] + Math.hypot(a.x - b.x, a.z - b.z);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; open.add(v); }
    }
  }
  if (prev[toIdx] === -1 && toIdx !== fromIdx) return [toIdx];
  const path = [];
  for (let u = toIdx; u !== -1; u = prev[u]) path.push(u);
  return path.reverse();
}

export function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < W.nodes.length; i++) {
    const n = W.nodes[i];
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Segment vs the collider set in 3D (slab method). Used for sight lines.
export function losBlocked(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  for (const c of W.colliders) {
    let t0 = 0, t1 = 1, ok = true;
    const axes = [
      [ax, dx, c.x0, c.x1], [ay, dy, c.y0, c.y1], [az, dz, c.z0, c.z1],
    ];
    for (const [o, d, mn, mx] of axes) {
      if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { ok = false; break; } }
      else {
        let ta = (mn - o) / d, tb = (mx - o) / d;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t1 > 0.001 && t0 < 0.999) return true;
  }
  return false;
}

// Bullet ray vs world: nearest hit among colliders and the ground plane.
const _hit = { dist: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
export function rayHit(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist, bnx = 0, bny = 0, bnz = 0;
  for (const c of W.colliders) {
    let t0 = 0, t1 = best, axis = -1, ok = true;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    const mn = [c.x0, c.y0, c.z0], mx = [c.x1, c.y1, c.z1];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) { ok = false; break; } }
      else {
        let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i];
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > t0) { t0 = ta; axis = i; }
        t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && axis >= 0 && t0 > 0.0005 && t0 < best) {
      best = t0;
      bnx = bny = bnz = 0;
      if (axis === 0) bnx = dx > 0 ? -1 : 1;
      if (axis === 1) bny = dy > 0 ? -1 : 1;
      if (axis === 2) bnz = dz > 0 ? -1 : 1;
    }
  }
  if (dy < -1e-6) {
    const t = -oy / dy;
    if (t > 0.0005 && t < best) { best = t; bnx = 0; bny = 1; bnz = 0; }
  }
  _hit.dist = best;
  _hit.x = ox + dx * best; _hit.y = oy + dy * best; _hit.z = oz + dz * best;
  _hit.nx = bnx; _hit.ny = bny; _hit.nz = bnz;
  return _hit;
}

// Move a capsule (feet at a.y, radius 0.34, height by crouch) with axis-separated
// AABB resolution; low boxes stop mattering once the feet are above them, which
// is what lets the player jump onto a single crate and bots stay grounded.
export function slideMove(a, dt) {
  const R = 0.34;
  const height = a.crouch ? 1.3 : 1.8;
  // X axis
  a.x += a.vx * dt;
  for (const c of W.colliders) {
    if (c.y1 <= a.y + 0.32 || c.y0 >= a.y + height) continue;
    if (a.x + R > c.x0 && a.x - R < c.x1 && a.z + R > c.z0 && a.z - R < c.z1) {
      a.x = a.vx > 0 ? c.x0 - R : c.x1 + R;
      a.vx = 0;
    }
  }
  // Z axis
  a.z += a.vz * dt;
  for (const c of W.colliders) {
    if (c.y1 <= a.y + 0.32 || c.y0 >= a.y + height) continue;
    if (a.x + R > c.x0 && a.x - R < c.x1 && a.z + R > c.z0 && a.z - R < c.z1) {
      a.z = a.vz > 0 ? c.z0 - R : c.z1 + R;
      a.vz = 0;
    }
  }
  // Y axis: gravity, then land on the highest support under the feet
  a.vy -= 13.5 * dt;
  a.y += a.vy * dt;
  let support = 0;
  for (const c of W.colliders) {
    if (c.y1 > a.y + 0.4) continue;
    if (a.x + R * 0.7 > c.x0 && a.x - R * 0.7 < c.x1 && a.z + R * 0.7 > c.z0 && a.z - R * 0.7 < c.z1) {
      if (c.y1 > support) support = c.y1;
    }
  }
  if (a.y <= support) { a.y = support; a.vy = 0; a.grounded = true; }
  else a.grounded = a.y <= 0.001;
  a.x = Math.max(-W.bounds.x + 0.6, Math.min(W.bounds.x - 0.6, a.x));
  a.z = Math.max(-W.bounds.z + 0.6, Math.min(W.bounds.z - 0.6, a.z));
}

// A tiny procedural environment (dusk sky dome, warm horizon, one bright sun
// card) baked through PMREM so the metalwork — mirrors, tower, drums — has a
// sunset to reflect. Without it, high-metalness surfaces render black.
function buildEnvironment(renderer) {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 16, 12),
    new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: PAL.sky }),
  );
  dome.position.y = 12;
  env.add(dome);
  const horizon = new THREE.Mesh(
    new THREE.CylinderGeometry(48, 48, 13, 16, 1, true),
    new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: PAL.horizon }),
  );
  horizon.position.y = 4;
  env.add(horizon);
  const sunCard = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 15),
    new THREE.MeshBasicMaterial({ color: 0xffe3b0 }),
  );
  sunCard.position.set(-44, 13, -8);
  sunCard.lookAt(0, 8, 0);
  env.add(sunCard);
  const groundCard = new THREE.Mesh(
    new THREE.CircleGeometry(48, 16),
    new THREE.MeshBasicMaterial({ color: PAL.sandDark }),
  );
  groundCard.rotation.x = -Math.PI / 2;
  groundCard.position.y = -1;
  env.add(groundCard);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.05).texture;
  pmrem.dispose();
  return tex;
}

export function buildWorld(s, renderer) {
  scene = s;
  scene.background = new THREE.Color(PAL.sky);
  scene.fog = new THREE.Fog(PAL.fog, 55, 190);
  if (renderer) scene.environment = buildEnvironment(renderer);
  const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PAL.sun, 2.6);
  sun.position.set(-55, 42, -26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -62; sun.shadow.camera.right = 62;
  sun.shadow.camera.top = 48; sun.shadow.camera.bottom = -48;
  sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  // sunset glow card on the western horizon
  const glowTex = canvasTex(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,190,110,0.95)');
    grad.addColorStop(0.4, 'rgba(242,166,90,0.45)');
    grad.addColorStop(1, 'rgba(242,166,90,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  glowTex.wrapS = glowTex.wrapT = THREE.ClampToEdgeWrapping;
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 60),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false }),
  );
  glow.position.set(-135, 16, -10);
  glow.rotation.y = Math.PI / 2;
  scene.add(glow);

  buildMaterials();
  buildMap();
  buildGraph();
  return W;
}

export function updateWorld(dt) {
  if (W.spireGlow) W.spireGlow.material.emissiveIntensity = 2.4 + Math.sin(performance.now() * 0.0016) * 0.5;
}
