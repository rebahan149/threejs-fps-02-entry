// fx.js — transient visuals, all pooled: tracers, impact dust and sparks,
// muzzle flashes, smoke clouds, the explosion, and the charge prop itself.
// Nothing here decides anything about the game; it only draws what the
// simulation already decided. Smoke is the one exception the sim reads back:
// weapons.js and bots.js ask smokesBlock() whether a sight line is blind.

import * as THREE from 'three';
import { PAL } from './palette.js';
import { S } from './state.js';

let scene;
let tracerPool = [];
let particleGeo;
let particlePos;
let particles = []; // { x,y,z, vx,vy,vz, life, maxLife, size } written into one Points cloud
let particleMesh;
let flashLight;
let flashSprite;
let smokeMeshes = [];
let chargeMesh;
let chargeLight;
let boomLight;
let boomT = -1;
const MAX_PARTICLES = 900;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export function initFx(s) {
  scene = s;
  // tracers: stretched thin boxes, recycled
  const tGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  for (let i = 0; i < 48; i++) {
    const m = new THREE.Mesh(tGeo, tMat);
    m.visible = false;
    scene.add(m);
    tracerPool.push({ mesh: m, t: 0 });
  }
  // particles: one Points cloud, positions rewritten per frame
  particleGeo = new THREE.BufferGeometry();
  particlePos = new Float32Array(MAX_PARTICLES * 3);
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0xe8c890, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false });
  particleMesh = new THREE.Points(particleGeo, pMat);
  particleMesh.frustumCulled = false;
  scene.add(particleMesh);
  // shared lights/sprites for flashes and the explosion
  flashLight = new THREE.PointLight(0xffc37a, 0, 16, 2);
  scene.add(flashLight);
  const flashTex = makeGlowTexture('rgba(255,210,130,1)');
  flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false }));
  flashSprite.scale.set(0.55, 0.55, 1);
  flashSprite.visible = false;
  scene.add(flashSprite);
  boomLight = new THREE.PointLight(0xff9a4a, 0, 55, 1.6);
  scene.add(boomLight);
  // the charge: a slab with a keypad glow and a blinking beacon
  chargeMesh = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.16, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 0.5, metalness: 0.4 }),
  );
  body.position.y = 0.08;
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.03, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x101010, emissive: PAL.glow, emissiveIntensity: 1.4 }),
  );
  pad.position.set(0, 0.17, 0);
  chargeLight = new THREE.PointLight(0xff5a3a, 0, 7, 2);
  chargeLight.position.y = 0.5;
  chargeMesh.add(body, pad, chargeLight);
  chargeMesh.visible = false;
  scene.add(chargeMesh);
}

function makeGlowTexture(inner) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, 'rgba(255,180,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function spawnTracer(ax, ay, az, bx, by, bz) {
  for (const t of tracerPool) {
    if (t.t > 0) continue;
    t.t = 0.05;
    const m = t.mesh;
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    const len = _a.distanceTo(_b);
    m.position.copy(_a).add(_b).multiplyScalar(0.5);
    m.scale.set(1, 1, Math.max(0.1, len));
    m.lookAt(_b);
    m.visible = true;
    return;
  }
}

export function spawnImpact(x, y, z, nx, ny, nz, kind) {
  const n = kind === 'flesh' ? 5 : 8;
  for (let i = 0; i < n; i++) {
    if (particles.length >= MAX_PARTICLES) return;
    particles.push({
      x, y, z,
      vx: nx * 1.4 + (S.rng() - 0.5) * 2.4,
      vy: Math.abs(ny) * 1.6 + S.rng() * 1.8,
      vz: nz * 1.4 + (S.rng() - 0.5) * 2.4,
      life: 0, maxLife: 0.3 + S.rng() * 0.35,
    });
  }
}

export function spawnMuzzle(x, y, z) {
  flashSprite.position.set(x, y, z);
  flashSprite.visible = true;
  flashSprite.material.rotation = S.rng() * Math.PI;
  flashLight.position.set(x, y, z);
  flashLight.intensity = 26;
}

export function explosionFx(x, z) {
  boomT = 0;
  boomLight.position.set(x, 2.2, z);
  for (let i = 0; i < 90; i++) {
    if (particles.length >= MAX_PARTICLES) break;
    const a = S.rng() * Math.PI * 2, r = S.rng() * 7;
    particles.push({
      x: x + Math.cos(a) * r * 0.3, y: 0.4 + S.rng() * 2.4, z: z + Math.sin(a) * r * 0.3,
      vx: Math.cos(a) * r * 1.6, vy: 2.5 + S.rng() * 5, vz: Math.sin(a) * r * 1.6,
      life: 0, maxLife: 0.6 + S.rng() * 0.8,
    });
  }
}

// Smoke: the sim keeps the data in S.smokes; fx keeps one growing sphere each.
export function syncSmokeVisuals() {
  while (smokeMeshes.length < S.smokes.length) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xcfd4d6, transparent: true, opacity: 0.34, roughness: 1, depthWrite: false }),
    );
    scene.add(m);
    smokeMeshes.push(m);
  }
  for (let i = 0; i < smokeMeshes.length; i++) {
    const m = smokeMeshes[i];
    const sm = S.smokes[i];
    if (!sm) { m.visible = false; continue; }
    m.visible = true;
    const grow = Math.min(1, sm.t / 1.6);
    const fade = sm.life - sm.t < 2 ? (sm.life - sm.t) / 2 : 1;
    m.position.set(sm.x, 1.5 * grow + 0.3, sm.z);
    m.scale.set(sm.r * grow, 1.9 * grow, sm.r * grow);
    m.material.opacity = 0.36 * fade * (0.4 + 0.6 * grow);
  }
}

export function smokesBlock(ax, ay, az, bx, by, bz) {
  // a sight line is blind when it passes through a grown smoke sphere
  for (const sm of S.smokes) {
    if (sm.t < 0.9) continue;
    const cx = sm.x, cy = 1.6, cz = sm.z, r = sm.r * 0.95;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-6) continue;
    let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
    if (px * px + py * py + pz * pz < r * r) return true;
  }
  return false;
}

export function updateChargeVisual() {
  const b = S.bomb;
  if (!b || b.state === 'carried' || b.state === 'done') { chargeMesh.visible = false; return; }
  chargeMesh.visible = true;
  if (b.state === 'dropped' || b.state === 'planted' || b.state === 'defusing') {
    chargeMesh.position.set(b.x, 0, b.z);
  } else if (b.carrier) {
    chargeMesh.position.set(b.carrier.x, 0, b.carrier.z);
  }
  const planted = b.state === 'planted' || b.state === 'defusing';
  const urgency = planted ? Math.max(0, 1 - b.timer / 35) : 0;
  const blink = planted
    ? (S.time * (2 + urgency * 9)) % 1 < 0.4
    : (S.time * 1.4) % 1 < 0.5;
  chargeLight.intensity = blink ? (planted ? 14 : 5) : 0;
}

export function updateFx(dt) {
  for (const t of tracerPool) {
    if (t.t > 0) { t.t -= dt; if (t.t <= 0) t.mesh.visible = false; }
  }
  if (flashLight.intensity > 0) flashLight.intensity = Math.max(0, flashLight.intensity - dt * 320);
  if (flashSprite.visible && flashLight.intensity <= 1) flashSprite.visible = false;
  if (boomT >= 0) {
    boomT += dt;
    boomLight.intensity = boomT < 0.12 ? 900 : Math.max(0, 900 - boomT * 1400);
    if (boomT > 0.9) { boomT = -1; boomLight.intensity = 0; }
  }
  // particles
  let w = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.life += dt;
    if (p.life >= p.maxLife) continue;
    p.vy -= 6.5 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y < 0.03) { p.y = 0.03; p.vy = 0; }
    particles[w++] = p;
    particlePos[(w - 1) * 3] = p.x;
    particlePos[(w - 1) * 3 + 1] = p.y;
    particlePos[(w - 1) * 3 + 2] = p.z;
  }
  particles.length = w;
  for (let i = w; i < MAX_PARTICLES; i++) particlePos[i * 3 + 1] = -50;
  particleGeo.attributes.position.needsUpdate = true;
  syncSmokeVisuals();
  updateChargeVisual();
}

export function clearRoundFx() {
  particles.length = 0;
  for (const t of tracerPool) { t.t = 0; t.mesh.visible = false; }
}
