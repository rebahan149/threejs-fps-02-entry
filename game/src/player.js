// player.js — the human: pointer-lock mouse look, acceleration movement with
// crouch and a quiet walk, jumping, collision through world.slideMove, the
// first-person weapon viewmodel, and the E-key plant/defuse channel. Camera
// state lives on the agent itself (yaw/pitch), so recoil from weapons.js —
// which nudges those same fields — is felt immediately.

import * as THREE from 'three';
import { S, CFG, teamRole } from './state.js';
import { Input, held } from './input.js';
import { slideMove, W } from './world.js';
import { WEAPONS, activeWeapon, fireWeapon, startReload, throwGrenade } from './weapons.js';
import { sfxStep, sfxPlant } from './audio.js';
import { completePlant } from './bots.js';

const RUN = 4.9, WALK = 2.3, CROUCH_SPEED = 2.4, ACCEL = 42, FRICTION = 11;
let camera;
let viewmodel;
let vmParts = {};
let lastStepAt = 0;
let bobPhase = 0;
let landDip = 0;
let wasGrounded = true;

const gunMats = {
  body: null, accent: null, dark: null,
};

export function initPlayer(cam) {
  camera = cam;
  gunMats.body = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.45, metalness: 0.65, envMapIntensity: 1.3 });
  gunMats.accent = new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.5, metalness: 0.3 });
  gunMats.dark = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.6, metalness: 0.5, envMapIntensity: 1.2 });
  viewmodel = new THREE.Group();
  buildViewmodels();
  camera.add(viewmodel);
  viewmodel.position.set(0.24, -0.2, -0.45);
}

function gunMesh(kind) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  if (kind === 'pistol') {
    add(B(0.05, 0.09, 0.2), gunMats.body, 0, 0, -0.05);
    add(B(0.045, 0.12, 0.05), gunMats.dark, 0, -0.09, 0.03);
  } else if (kind === 'shotgun') {
    add(B(0.06, 0.08, 0.62), gunMats.body, 0, 0, -0.2);
    add(B(0.05, 0.05, 0.2), gunMats.accent, 0, -0.05, -0.28);
    add(B(0.055, 0.1, 0.14), gunMats.dark, 0, -0.08, 0.12);
  } else if (kind === 'dmr') {
    add(B(0.05, 0.07, 0.78), gunMats.body, 0, 0, -0.28);
    add(B(0.04, 0.04, 0.16), gunMats.dark, 0, -0.07, -0.05);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 10), gunMats.dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.07, -0.12);
    g.add(scope);
  } else if (kind === 'smg') {
    add(B(0.055, 0.08, 0.44), gunMats.body, 0, 0, -0.14);
    add(B(0.04, 0.14, 0.05), gunMats.dark, 0, -0.1, -0.08);
    add(B(0.05, 0.05, 0.12), gunMats.accent, 0, 0.02, 0.1);
  } else { // rifle
    add(B(0.055, 0.08, 0.58), gunMats.body, 0, 0, -0.2);
    add(B(0.04, 0.15, 0.05), gunMats.dark, 0, -0.1, -0.02);
    add(B(0.045, 0.045, 0.2), gunMats.accent, 0, -0.03, -0.34);
    add(B(0.03, 0.06, 0.03), gunMats.dark, 0, 0.07, -0.1);
  }
  g.visible = false;
  viewmodel.add(g);
  return g;
}

function buildViewmodels() {
  vmParts = {
    pistol: gunMesh('pistol'),
    smg: gunMesh('smg'),
    shotgun: gunMesh('shotgun'),
    rifle: gunMesh('rifle'),
    dmr: gunMesh('dmr'),
    grenade: (() => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), gunMats.accent);
      g.add(m);
      g.visible = false;
      viewmodel.add(g);
      return g;
    })(),
  };
}

export function handleAction(code, down) {
  const p = S.player;
  if (!p || !p.alive || S.demo) return;
  if (!down) return;
  if (code === 'KeyR') startReload(p);
  if (code === 'Digit1' && p.primary) p.active = 'primary';
  if (code === 'Digit2') p.active = 'secondary';
  if (code === 'Digit3' && p.grenades.frag > 0) p.active = 'frag';
  if (code === 'Digit4' && p.grenades.smoke > 0) p.active = 'smoke';
  if (code === 'Digit5' && p.grenades.flash > 0) p.active = 'flash';
}

export function updatePlayer(dt) {
  const p = S.player;
  if (!p) return;
  if (!p.alive) { updateSpectateCamera(dt); return; }
  // look
  const sens = Input.aiming && activeWeapon(p) && activeWeapon(p).def.zoom ? 0.0011 : 0.0021;
  p.yaw -= Input.dx * sens;
  p.pitch -= Input.dy * sens;
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
  Input.dx = 0; Input.dy = 0;

  const frozen = S.phase === 0 || (S.phase === 1 && !S.demo); // menu or buy: look, don't move
  const crouchKey = held('ControlLeft') || held('ControlRight') || held('KeyC');
  p.crouch = crouchKey && p.grounded;
  const walk = held('ShiftLeft') || held('ShiftRight');
  let ix = 0, iz = 0;
  if (!frozen) {
    if (held('KeyW')) iz -= 1;
    if (held('KeyS')) iz += 1;
    if (held('KeyA')) ix -= 1;
    if (held('KeyD')) ix += 1;
  }
  const maxSpeed = p.crouch ? CROUCH_SPEED : walk ? WALK : RUN;
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let wx = (ix * cos - iz * sin);
  let wz = (ix * sin + iz * cos);
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx = wx / wl * maxSpeed; wz = wz / wl * maxSpeed; }
  if (p.grounded) {
    const f = Math.max(0, 1 - FRICTION * dt);
    if (wl === 0) { p.vx *= f; p.vz *= f; }
    else {
      p.vx += (wx - p.vx) * Math.min(1, ACCEL * dt / maxSpeed * 2.2);
      p.vz += (wz - p.vz) * Math.min(1, ACCEL * dt / maxSpeed * 2.2);
    }
    if (held('Space') && !frozen) { p.vy = 4.7; p.grounded = false; }
  } else {
    p.vx += wx * dt * 1.6;
    p.vz += wz * dt * 1.6;
  }
  const prevY = p.y;
  slideMove(p, dt);
  if (!wasGrounded && p.grounded) landDip = Math.min(0.09, Math.abs(p.vy) * 0.01 + 0.03);
  wasGrounded = p.grounded;
  p.speedNow = Math.hypot(p.vx, p.vz);
  // footsteps: quieter (and no noise event) while walking or crouched
  if (p.grounded && p.speedNow > 0.8) {
    const stride = p.crouch || walk ? 2.6 : 2.0;
    if (S.time - lastStepAt > stride / p.speedNow * 1.9) {
      lastStepAt = S.time;
      sfxStep(!walk && !p.crouch);
    }
  }
  // fire / interact
  const active = p.active;
  if (Input.firing && !frozen) {
    if (active === 'frag' || active === 'smoke' || active === 'flash') {
      throwGrenade(p, active);
      Input.firing = false;
    } else {
      const w = activeWeapon(p);
      if (w && (w.def.auto || !p.triggerHeld)) fireWeapon(p);
    }
  }
  p.triggerHeld = Input.firing;
  updateInteract(p, dt);
  updateCamera(p, dt);
}

function updateInteract(p, dt) {
  const b = S.bomb;
  S.playerChannel = null;
  if (!b || !held('KeyE')) { S.playerDefusing = false; return; }
  const role = teamRole(p.team);
  if (role === 'ATK' && p.hasCharge && (b.state === 'carried')) {
    const inSite = (site) => Math.hypot(p.x - site.x, p.z - site.z) < site.r;
    if (inSite(W.sites.A) || inSite(W.sites.B)) {
      b.state = 'planting';
      b.planter = p;
      b.plantT = (b.plantT || 0) + dt;
      S.playerChannel = { kind: 'plant', frac: b.plantT / CFG.plantTime };
      p.crouch = true;
      if (b.plantT >= CFG.plantTime) { sfxPlant(); completePlant(p); }
      return;
    }
  }
  if (role === 'DEF' && (b.state === 'planted' || b.state === 'defusing')) {
    if (Math.hypot(p.x - b.x, p.z - b.z) < 1.8) {
      S.playerDefusing = true;
      S.playerChannel = { kind: 'defuse', frac: 0 }; // updateObjective fills progress
      return;
    }
  }
  S.playerDefusing = false;
}

function updateCamera(p, dt) {
  const eye = p.y + (p.crouch ? CFG.crouchEye : CFG.eyeHeight);
  bobPhase += dt * p.speedNow * 1.6;
  const bob = p.grounded ? Math.sin(bobPhase) * 0.018 * Math.min(1, p.speedNow / 4) : 0;
  landDip = Math.max(0, landDip - dt * 0.35);
  camera.position.set(p.x, eye + bob - landDip, p.z);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  // scope: the Apex DMR zooms on right mouse
  const w = activeWeapon(p);
  const scoped = Input.aiming && w && w.def.zoom && p.active !== 'frag';
  const targetFov = scoped ? 26 : 74;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 11);
  camera.updateProjectionMatrix();
  S.scoped = !!scoped;
  updateViewmodel(p, dt, scoped);
}

function updateViewmodel(p, dt, scoped) {
  const w = activeWeapon(p);
  for (const k of Object.keys(vmParts)) vmParts[k].visible = false;
  let part = null;
  if (p.active === 'frag' || p.active === 'smoke' || p.active === 'flash') part = vmParts.grenade;
  else if (w) part = vmParts[w.def.kind];
  if (!part) { viewmodel.visible = false; return; }
  viewmodel.visible = !scoped;
  part.visible = true;
  const reloading = S.time < p.reloadingUntil;
  const kick = Math.max(0, 1 - (S.time - (p.lastShotVisual || 0)) * 9);
  part.position.z = kick * 0.06;
  part.position.y = reloading ? -0.13 : 0;
  part.rotation.x = (reloading ? 0.7 : 0) + kick * 0.1;
  const sway = Math.sin(bobPhase * 0.5) * 0.006 * Math.min(1, p.speedNow / 4);
  part.position.x = sway;
}

// Shot staging only: in demo mode no human drives updatePlayer, so the
// viewmodel is posed neutrally here — the active weapon, held still.
export function poseDemoViewmodel(p) {
  const w = activeWeapon(p);
  for (const k of Object.keys(vmParts)) vmParts[k].visible = false;
  let part = null;
  if (p.active === 'frag' || p.active === 'smoke' || p.active === 'flash') part = vmParts.grenade;
  else if (w) part = vmParts[w.def.kind];
  viewmodel.visible = !!part;
  if (part) {
    part.visible = true;
    part.position.set(0, 0, 0);
    part.rotation.x = 0;
  }
}

function updateSpectateCamera(dt) {
  // ride on the first living teammate's shoulder
  const mate = S.agents.find((a) => a.alive && a.team === S.player.team && !a.isPlayer)
    || S.agents.find((a) => a.alive);
  if (!mate) return;
  camera.position.set(mate.x, mate.y + CFG.eyeHeight, mate.z);
  camera.rotation.set(mate.pitch || 0, mate.yaw, 0, 'YXZ');
  if (camera.fov !== 74) { camera.fov = 74; camera.updateProjectionMatrix(); }
  viewmodel.visible = false;
  S.spectating = mate.name;
}
