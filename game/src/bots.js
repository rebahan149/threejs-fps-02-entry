// bots.js — the nine non-player agents. Each bot runs the same loop a player
// does (perceive, decide, move, shoot through weapons.js) on a staggered
// think tick. Teams play a plan, not a deathmatch: attackers pick a site,
// stage at its entry, throw utility and hit it together while a lurker works
// the far lane; defenders hold crossfires, call what they see on the radio
// and rotate. After a plant, attackers hold post-plant angles and defenders
// retake — one defuses, the rest clear the site first.

import * as THREE from 'three';
import { S, CFG, SQUAD, FOE, teamRole, aliveCount, pushRadio, award } from './state.js';
import { W, findPath, nearestNode, losBlocked, slideMove } from './world.js';
import { WEAPONS, GRENADES, makeWeapon, fireWeapon, startReload, activeWeapon, throwGrenade, eyeY } from './weapons.js';
import { smokesBlock } from './fx.js';
import { PAL, TEAM_COLORS } from './palette.js';
import { sfxRadio } from './audio.js';

export const BOT_NAMES = [
  ['Viper', 'Jolt', 'Mako', 'Rune'],
  ['Onyx', 'Brine', 'Kodiak', 'Sable'],
];

let hooks = { onRoundEnd: () => {}, onPlanted: () => {}, onDefused: () => {} };
export function setBotHooks(h) { hooks = h; }

const ROUTES = {
  A: {
    main: [2, 28, 14, 15, 16, 17],
    connector: [7, 8, 9, 15, 16, 17],
    rotate: [13, 19, 30, 17],
    stage: 15, site: 17,
  },
  B: {
    main: [3, 29, 20, 21, 23, 24],
    connector: [10, 11, 12, 20, 21, 22, 24],
    rotate: [13, 26, 25, 24],
    stage: 20, site: 24,
  },
};
const HOLD_SPOTS = {
  A: [
    { node: 17, x: 38, z: -27, yaw: 2.6 },
    { node: 30, x: 36, z: -14, yaw: -2.2 },
    { node: 19, x: 28, z: -10, yaw: -1.4 },
  ],
  B: [
    { node: 24, x: 39, z: 29, yaw: 2.9 },
    { node: 22, x: 26, z: 15, yaw: 0.4 },
    { node: 25, x: 40, z: 16, yaw: -2.6 },
  ],
  MID: [{ node: 13, x: 17, z: -2, yaw: -1.6 }],
};
const POST_PLANT = {
  A: [{ x: 28, z: -18, yaw: -0.6 }, { x: 40, z: -28, yaw: 2.4 }, { x: 36, z: -14, yaw: -2.4 }, { x: 30, z: -29, yaw: 0.8 }],
  B: [{ x: 24, z: 28, yaw: -0.4 }, { x: 40, z: 17, yaw: -2.8 }, { x: 33, z: 30, yaw: 3.0 }, { x: 22, z: 15, yaw: 0.2 }],
};

// ---------------------------------------------------------------- meshes
const legGeo = new THREE.BoxGeometry(0.17, 0.78, 0.19);
const torsoGeo = new THREE.BoxGeometry(0.54, 0.64, 0.3);
const armGeo = new THREE.BoxGeometry(0.13, 0.13, 0.52);
const headGeo = new THREE.SphereGeometry(0.165, 12, 10);
const helmGeo = new THREE.SphereGeometry(0.185, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
const gunGeo = new THREE.BoxGeometry(0.09, 0.16, 0.78);
const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a183, roughness: 0.8 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x35322e, roughness: 0.9 });

export function makeBotMesh(team) {
  const g = new THREE.Group();
  const vest = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], roughness: 0.75 });
  const cloth = new THREE.MeshStandardMaterial({ color: team === SQUAD ? 0x5a5148 : 0x44545c, roughness: 0.95 });
  const legL = new THREE.Mesh(legGeo, cloth); legL.position.set(-0.13, 0.39, 0);
  const legR = new THREE.Mesh(legGeo, cloth); legR.position.set(0.13, 0.39, 0);
  const upper = new THREE.Group();
  const torso = new THREE.Mesh(torsoGeo, vest); torso.position.y = 1.12;
  const head = new THREE.Mesh(headGeo, skinMat); head.position.y = 1.62;
  const helm = new THREE.Mesh(helmGeo, cloth); helm.position.y = 1.65;
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(gunGeo, darkMat); gunBody.position.z = -0.3;
  const armR = new THREE.Mesh(armGeo, cloth); armR.position.set(0.24, 1.28, -0.28);
  const armL = new THREE.Mesh(armGeo, cloth); armL.position.set(-0.2, 1.24, -0.34);
  gun.add(gunBody);
  gun.position.set(0.16, 1.34, -0.1);
  upper.add(torso, head, helm, gun, armR, armL);
  for (const m of [legL, legR, torso, head]) m.castShadow = true;
  g.add(legL, legR, upper);
  g.userData = { legL, legR, upper, gun, head };
  return g;
}

// ---------------------------------------------------------------- buying
export function buyForBot(a) {
  if (!a.primary && a.money >= 2700 && S.rng() < 0.8) { a.primary = makeWeapon('longbow'); a.money -= 2700; }
  else if (!a.primary && a.money >= 4300) { a.primary = makeWeapon('apex'); a.money -= 4300; }
  else if (!a.primary && a.money >= 1200) { a.primary = makeWeapon(S.rng() < 0.35 ? 'mule' : 'kestrel'); a.money -= WEAPONS[a.primary.def.id].price; }
  if (a.money >= 1000 && !a.helmet) { a.armor = 100; a.helmet = true; a.money -= 1000; }
  else if (a.money >= 650 && a.armor < 60) { a.armor = 100; a.money -= 650; }
  const role = teamRole(a.team);
  if (a.grenades.smoke === 0 && a.money >= 300 && S.rng() < 0.55) { a.grenades.smoke++; a.money -= 300; }
  if (a.grenades.flash === 0 && a.money >= 250 && S.rng() < 0.6) { a.grenades.flash++; a.money -= 250; }
  if (a.grenades.frag === 0 && a.money >= 300 && S.rng() < 0.4) { a.grenades.frag++; a.money -= 300; }
  if (role === 'DEF' && !a.hasKit && a.money >= 200 && S.rng() < 0.5) { a.hasKit = true; a.money -= 200; }
  if (a.primary) a.active = 'primary';
}

// ---------------------------------------------------------------- plans
export function planRound() {
  const atk = S.attackingTeam, def = 1 - atk;
  // site pick: lean away from repeating the last planted site
  let site = S.rng() < 0.52 ? 'A' : 'B';
  if (S.lastPlantSite && site === S.lastPlantSite && S.rng() < 0.65) site = site === 'A' ? 'B' : 'A';
  S.sitePicked = site;
  const routes = ROUTES[site];
  const otherSite = site === 'A' ? 'B' : 'A';

  // in demo (screenshot) mode the player agent is driven by a brain too and
  // takes a plan slot like any bot — but the charge always goes to a true bot
  const attackers = S.agents.filter((a) => a.team === atk && (!a.isPlayer || S.demo));
  const defenders = S.agents.filter((a) => a.team === def && (!a.isPlayer || S.demo));
  const botsOnly = attackers.filter((a) => !a.isPlayer);
  const carrier = botsOnly[(S.rng() * botsOnly.length) | 0];
  for (const a of S.agents) a.hasCharge = false;
  if (carrier) { carrier.hasCharge = true; if (S.bomb) { S.bomb.carrier = carrier; S.bomb.state = 'carried'; } }

  attackers.forEach((a, i) => {
    const b = a.brain;
    b.state = 'route'; b.path = []; b.pathI = 0; b.seen = null; b.lastSeenAt = -9; b.planDone = false;
    if (a === carrier) { b.role = 'carrier'; b.route = routes.main; }
    else if (i % 3 === 0) { b.role = 'entry'; b.route = routes.main; }
    else if (i % 3 === 1) { b.role = 'support'; b.route = routes.connector; }
    else { b.role = 'lurk'; b.route = ROUTES[otherSite].main.slice(0, 3).concat([13]); }
    b.stageNode = routes.stage;
    b.siteNode = routes.site;
    b.executeAt = 14 + S.rng() * 16;
    setPath(a, b.route);
  });
  defenders.forEach((a, i) => {
    const b = a.brain;
    b.state = 'hold'; b.seen = null; b.lastSeenAt = -9; b.planDone = false;
    const spots = i % 2 === 0 ? HOLD_SPOTS[site] : HOLD_SPOTS[otherSite];
    const spot = spots[(i / 2 | 0) % spots.length] || HOLD_SPOTS.MID[0];
    if (i === defenders.length - 1 && defenders.length > 3) {
      b.role = 'flex'; b.hold = HOLD_SPOTS.MID[0];
    } else {
      b.role = 'hold'; b.hold = spot;
    }
    b.holdSite = i % 2 === 0 ? site : otherSite;
    setPath(a, [nearestNode(a.x, a.z), b.hold.node]);
    b.holdPos = { x: b.hold.x, z: b.hold.z };
    b.holdYaw = b.hold.yaw;
  });
  // in live play the human gets no orders; in demo mode the loops above
  // already assigned the player agent a role and a route
  const p = S.player;
  if (p && p.brain && !S.demo) { p.brain.state = 'idle'; }
}

function setPath(a, nodeList) {
  const b = a.brain;
  const full = [];
  let cur = nearestNode(a.x, a.z);
  for (const target of nodeList) {
    const seg = findPath(cur, target);
    for (const n of seg) if (full[full.length - 1] !== n) full.push(n);
    cur = target;
  }
  b.path = full;
  b.pathI = 0;
}

function radio(team, name, text) {
  pushRadio(team, `${name}: ${text}`);
  if (team === S.player.team) sfxRadio();
}

const laneName = (x, z) => {
  const n = W.nodes[nearestNode(x, z)];
  return n ? n.name : 'mid';
};

// ---------------------------------------------------------------- perception
function canSee(a, e) {
  const dx = e.x - a.x, dz = e.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 68) return false;
  if (S.time < a.blindUntil) return false;
  // facing: full circle at arm's length, a 150° cone beyond it
  if (dist > 5) {
    const ang = Math.atan2(-dx, -dz);
    let diff = Math.abs(((ang - a.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    if (diff > 1.35) return false;
  }
  const ay = eyeY(a);
  const cy = e.y + (e.crouch ? 0.95 : 1.15);
  if (losBlocked(a.x, ay, a.z, e.x, cy, e.z)) return false;
  if (smokesBlock(a.x, ay, a.z, e.x, cy, e.z)) return false;
  return true;
}

function perceive(a, dt) {
  const b = a.brain;
  b.thinkT -= dt;
  // hearing is checked every step: shots are loud and recent
  for (let i = S.noises.length - 1; i >= 0; i--) {
    const n = S.noises[i];
    if (n.team === a.team || S.time - n.t > 1.2) continue;
    const d = Math.hypot(n.x - a.x, n.z - a.z);
    if (d < n.r && n.t > b.heardAt) {
      b.heardAt = n.t;
      b.heardPos = { x: n.x, z: n.z };
      b.heardType = n.type;
    }
  }
  if (b.thinkT > 0) return;
  b.thinkT = 0.1 + (a.id % 5) * 0.013;
  let best = null, bd = Infinity;
  for (const e of S.agents) {
    if (!e.alive || e.team === a.team) continue;
    if (canSee(a, e)) {
      const d = Math.hypot(e.x - a.x, e.z - a.z);
      if (d < bd) { bd = d; best = e; }
    }
  }
  if (best) {
    if (!b.seen || b.seen !== best) {
      b.reactAt = S.time + 0.28 + S.rng() * 0.3 + bd * 0.004;
      if (S.time - b.lastCallAt > 5) {
        b.lastCallAt = S.time;
        radio(a.team, a.name, `Contact — ${laneName(best.x, best.z)}!`);
      }
    }
    b.seen = best;
    b.lastSeenAt = S.time;
    b.lastSeenPos = { x: best.x, z: best.z };
  } else if (S.time - b.lastSeenAt > 4.5) {
    b.seen = null;
  }
}

// ---------------------------------------------------------------- movement
function steer(a, tx, tz, speed, dt, faceYaw) {
  const b = a.brain;
  const dx = tx - a.x, dz = tz - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.25) { a.vx *= 0.7; a.vz *= 0.7; return true; }
  const want = Math.atan2(-dx, -dz);
  a.vx = -Math.sin(want) * speed;
  a.vz = -Math.cos(want) * speed;
  const targetYaw = faceYaw !== undefined ? faceYaw : want;
  turnToward(a, targetYaw, 7, dt);
  return false;
}

function turnToward(a, target, rate, dt) {
  let diff = ((target - a.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  const step = Math.max(-rate * dt, Math.min(rate * dt, diff));
  a.yaw += step;
}

function followPath(a, speed, dt) {
  const b = a.brain;
  while (b.pathI < b.path.length) {
    const n = W.nodes[b.path[b.pathI]];
    if (Math.hypot(n.x - a.x, n.z - a.z) < 1.1) b.pathI++;
    else break;
  }
  if (b.pathI >= b.path.length) return true;
  const n = W.nodes[b.path[b.pathI]];
  steer(a, n.x, n.z, speed, dt);
  return false;
}

function separation(a) {
  for (const o of S.agents) {
    if (o === a || !o.alive) continue;
    const dx = a.x - o.x, dz = a.z - o.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.64 && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      a.x += (dx / d) * (0.8 - d) * 0.12;
      a.z += (dz / d) * (0.8 - d) * 0.12;
    }
  }
}

// ---------------------------------------------------------------- combat
function combat(a, dt) {
  const b = a.brain;
  const e = b.seen;
  const tx = e ? e.x : b.lastSeenPos.x;
  const tz = e ? e.z : b.lastSeenPos.z;
  const dx = tx - a.x, dz = tz - a.z;
  const dist = Math.hypot(dx, dz);
  const wantYaw = Math.atan2(-dx, -dz);
  turnToward(a, wantYaw, 11, dt);
  // aim at the chest, leading a moving target a touch
  const lead = Math.min(0.35, dist * 0.012);
  const aimX = tx + (e ? e.vx * lead : 0), aimZ = tz + (e ? e.vz * lead : 0);
  const adx = aimX - a.x, adz = aimZ - a.z;
  const adist = Math.hypot(adx, adz);
  a.pitch = Math.atan2((e ? e.y + 1.12 : 1.1) - eyeY(a), adist);
  a.crouch = adist > 24 && S.rng() < 0.01 ? true : (adist < 18 ? false : a.crouch);

  const w = activeWeapon(a);
  if (w && w.mag === 0) startReload(a);
  const fresh = e && S.time - b.lastSeenAt < 0.4;
  if (!fresh) {
    // lost sight: push the last known position
    steer(a, tx, tz, 3.4, dt, wantYaw);
    b.burstLeft = 0;
    return;
  }
  // burst discipline: fire a burst standing still, then strafe during the pause
  if (b.burstPauseUntil > S.time) {
    const side = b.strafeDir || 1;
    const px = Math.cos(a.yaw) * side, pz = -Math.sin(a.yaw) * side;
    a.vx = px * 2.4; a.vz = pz * 2.4;
    return;
  }
  a.vx *= 0.6; a.vz *= 0.6; // stop to shoot: accuracy pays
  if (S.time < b.reactAt) return;
  if (Math.abs(((wantYaw - a.yaw) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI) > 0.09) return;
  if (fireWeapon(a)) {
    b.burstLeft--;
    if (b.burstLeft <= 0) {
      b.burstLeft = 3 + (S.rng() * 4) | 0;
      b.burstPauseUntil = S.time + 0.32 + S.rng() * 0.4;
      b.strafeDir = S.rng() < 0.5 ? -1 : 1;
    }
  }
}

// ---------------------------------------------------------------- main think
export function thinkBot(a, dt) {
  const b = a.brain;
  if (!b) return;
  if (!a.alive) return;
  b.lastCallAt = b.lastCallAt || -9;
  b.thinkT = b.thinkT || 0;
  perceive(a, dt);
  const role = teamRole(a.team);
  const planted = S.bomb && (S.bomb.state === 'planted' || S.bomb.state === 'defusing');
  const blind = S.time < a.blindUntil;

  if (blind) { a.vx *= 0.8; a.vz *= 0.8; a.yaw += Math.sin(S.time * 2 + a.id) * 0.4 * dt; return; }

  if (b.seen && S.time - b.lastSeenAt < 0.4) { combat(a, dt); separation(a); slideMove(a, dt); animate(a, dt); return; }

  // objective states first
  if (planted && S.bomb) {
    if (role === 'DEF') {
      const distB = Math.hypot(S.bomb.x - a.x, S.bomb.z - a.z);
      const defuser = nearestDefuser();
      if (a === defuser && distB < 1.6) {
        a.vx = 0; a.vz = 0;
        a.yaw = Math.atan2(-(S.bomb.x - a.x), -(S.bomb.z - a.z));
        // channel handled in updateObjective
        b.state = 'defuse';
        separation(a); slideMove(a, dt); animate(a, dt);
        return;
      }
      b.state = 'retake';
      setPathIfNeeded(a, [nearestNode(a.x, a.z), nearestNode(S.bomb.x, S.bomb.z)]);
      followPath(a, 4.4, dt);
      separation(a); slideMove(a, dt); animate(a, dt);
      return;
    }
    // attackers hold post-plant angles near the charge
    if (!b.postPlant) {
      const spots = POST_PLANT[S.bomb.site] || POST_PLANT.A;
      b.postPlant = spots[a.id % spots.length];
      setPath(a, [nearestNode(a.x, a.z), nearestNode(b.postPlant.x, b.postPlant.z)]);
    }
    if (!followPath(a, 4.2, dt)) { separation(a); slideMove(a, dt); animate(a, dt); return; }
    steer(a, b.postPlant.x, b.postPlant.z, 2, dt);
    a.yaw += Math.sin(S.time * 0.6 + a.id * 2) * 0.25 * dt;
    separation(a); slideMove(a, dt); animate(a, dt);
    return;
  }

  if (role === 'ATK') {
    const carrier = a.hasCharge;
    if (carrier && b.siteNode !== undefined) {
      const site = W.nodes[b.siteNode];
      const dSite = Math.hypot(site.x - a.x, site.z - a.z);
      if (dSite < 3.2) {
        a.vx = 0; a.vz = 0;
        b.state = 'plant'; // channel handled in updateObjective
        separation(a); slideMove(a, dt); animate(a, dt);
        return;
      }
    }
    const arrived = followPath(a, b.state === 'route' && S.time < (b.executeAt || 0) ? 4.4 : 3.1, dt);
    if (arrived && !carrier) {
      // hold the entry angle, scanning toward the site
      const site = W.nodes[b.siteNode || 17];
      const want = Math.atan2(-(site.x - a.x), -(site.z - a.z));
      turnToward(a, want + Math.sin(S.time * 0.7 + a.id) * 0.4, 3, dt);
      a.vx *= 0.7; a.vz *= 0.7;
    }
    // utility on the execute: support smokes the entry, entry flashes in
    if (b.role === 'support' && !b.usedUtil && S.time > (b.executeAt || 0)) {
      b.usedUtil = true;
      if (a.grenades.smoke > 0) {
        const site = W.nodes[b.siteNode];
        aimAt(a, site.x, 1.2, site.z);
        a.active = 'smoke';
        throwGrenade(a, 'smoke');
      }
    }
    if (b.role === 'entry' && !b.usedUtil && b.pathI >= b.path.length - 1) {
      b.usedUtil = true;
      if (a.grenades.flash > 0) {
        const site = W.nodes[b.siteNode];
        aimAt(a, site.x, 1.6, site.z);
        a.active = 'flash';
        throwGrenade(a, 'flash');
      }
    }
  } else {
    // DEF
    if (b.state === 'hold' || b.state === 'route') {
      const arrived = followPath(a, 4.3, dt);
      if (arrived) {
        b.state = 'hold';
        const want = (b.holdYaw || 0) + Math.sin(S.time * 0.5 + a.id * 1.7) * 0.45;
        turnToward(a, want, 2.4, dt);
        a.vx *= 0.7; a.vz *= 0.7;
        // rotate on strong information: shots heard at the other site
        if (b.heardPos && b.heardType === 'shot' && S.time - b.heardAt < 2.5) {
          const heardSite = Math.abs(b.heardPos.z) > 10 ? (b.heardPos.z < 0 ? 'A' : 'B') : null;
          if (heardSite && heardSite !== b.holdSite && b.role === 'flex') {
            b.holdSite = heardSite;
            const spot = HOLD_SPOTS[heardSite][0];
            b.hold = spot; b.holdPos = { x: spot.x, z: spot.z }; b.holdYaw = spot.yaw;
            setPath(a, [nearestNode(a.x, a.z), spot.node]);
            b.state = 'route';
            radio(a.team, a.name, `Rotating ${heardSite}.`);
            b.heardAt = -9;
          }
        }
      }
    }
  }
  separation(a);
  slideMove(a, dt);
  animate(a, dt);
}

function aimAt(a, x, y, z) {
  const dx = x - a.x, dz = z - a.z;
  a.yaw = Math.atan2(-dx, -dz);
  a.pitch = Math.atan2(y - eyeY(a), Math.hypot(dx, dz));
}

function setPathIfNeeded(a, nodes) {
  const b = a.brain;
  const key = nodes.join(',');
  if (b.pathKey !== key) { b.pathKey = key; setPath(a, nodes); }
}

function nearestDefuser() {
  let best = null, bd = Infinity;
  for (const a of S.agents) {
    if (!a.alive || teamRole(a.team) !== 'DEF' || a.isPlayer) continue;
    const d = Math.hypot(S.bomb.x - a.x, S.bomb.z - a.z);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

// ---------------------------------------------------------------- objective channels
export function updateObjective(dt) {
  const b = S.bomb;
  if (!b) return;
  // dropped charge pickup by any attacker walking over it
  if (b.state === 'dropped') {
    for (const a of S.agents) {
      if (a.alive && a.team === S.attackingTeam && Math.hypot(a.x - b.x, a.z - b.z) < 1.4) {
        a.hasCharge = true;
        b.state = 'carried'; b.carrier = a;
        if (a.brain) { a.brain.role = 'carrier'; }
        break;
      }
    }
  }
  if (b.state === 'carried' && b.carrier) { b.x = b.carrier.x; b.z = b.carrier.z; }
  // bot planting
  if (b.state === 'carried' || b.state === 'planting') {
    const planter = S.agents.find((a) => a.alive && a.hasCharge && a.brain && a.brain.state === 'plant');
    if (planter) {
      if (b.state !== 'planting') { b.state = 'planting'; b.planter = planter; b.plantT = 0; }
      b.plantT += dt;
      planter.crouch = true;
      if (b.plantT >= CFG.plantTime) completePlant(planter);
    } else if (b.state === 'planting') {
      b.state = 'carried'; b.plantT = 0;
    }
  }
  // the player's plant channel is driven by player.js; if the player lets go
  // of E mid-plant the channel collapses back to a carried charge
  if (b.state === 'planting' && b.planter && b.planter.isPlayer && !S.playerChannel) {
    b.state = 'carried';
    b.plantT = 0;
    b.planter = null;
  }
  if (b.state === 'planted' || b.state === 'defusing') {
    b.timer -= dt;
    // defuse channel: a bot in 'defuse' state at the charge, or the player
    let defuser = null;
    for (const a of S.agents) {
      if (a.alive && teamRole(a.team) === 'DEF' && Math.hypot(a.x - b.x, a.z - b.z) < 1.7) {
        if (a.isPlayer ? S.playerDefusing : (a.brain && a.brain.state === 'defuse')) { defuser = a; break; }
      }
    }
    if (defuser) {
      if (b.state !== 'defusing') { b.state = 'defusing'; b.defuseT = 0; radio(defuser.team, defuser.name, 'Defusing — cover me!'); }
      b.defuser = defuser;
      b.defuseT += dt;
      const need = defuser.hasKit ? CFG.defuseKitTime : CFG.defuseTime;
      if (b.defuseT >= need) {
        b.state = 'done';
        hooks.onDefused(defuser);
        return;
      }
    } else if (b.state === 'defusing') {
      b.state = 'planted'; b.defuseT = 0; b.defuser = null;
    }
    if (b.timer <= 0) {
      b.state = 'done';
      hooks.onDetonated && hooks.onDetonated();
    }
  }
}

export function completePlant(planter) {
  const b = S.bomb;
  b.state = 'planted';
  b.timer = CFG.bombTime;
  b.x = planter.x; b.z = planter.z;
  b.site = Math.abs(planter.z) > 10 ? (planter.z < 0 ? 'A' : 'B') : S.sitePicked;
  S.lastPlantSite = b.site;
  planter.hasCharge = false;
  planter.crouch = false;
  award(planter, CFG.plantReward);
  for (const a of S.agents) if (a.brain) a.brain.postPlant = null;
  radio(planter.team, planter.name, `Charge planted at ${b.site}.`);
  radio(1 - planter.team, 'ALERT', `Charge planted at ${b.site}!`);
  hooks.onPlanted(b.site);
}

// ---------------------------------------------------------------- animation
function animate(a, dt) {
  const m = a.mesh;
  if (!m) return;
  m.position.set(a.x, a.y, a.z);
  m.rotation.y = a.yaw;
  const u = m.userData;
  const speed = Math.hypot(a.vx, a.vz);
  a.walkPhase += dt * (2 + speed * 2.2);
  const swing = Math.min(1, speed / 3) * 0.55;
  u.legL.rotation.x = Math.sin(a.walkPhase) * swing;
  u.legR.rotation.x = -Math.sin(a.walkPhase) * swing;
  u.upper.position.y = a.crouch ? -0.34 : Math.abs(Math.sin(a.walkPhase)) * 0.04 * Math.min(1, speed / 3);
  u.upper.rotation.x = a.crouch ? 0.16 : 0;
  u.gun.rotation.x = a.pitch;
  if (!a.alive) {
    a.fallT = Math.min(1, (a.fallT || 0) + dt * 2.4);
    m.rotation.x = -Math.PI / 2 * a.fallT * 0.92;
    m.position.y = a.y + 0.12 * (1 - a.fallT);
  } else {
    a.fallT = 0;
    m.rotation.x = 0;
  }
}

export function resetBotRound(a) {
  if (!a.brain) a.brain = {};
  const b = a.brain;
  b.state = 'route'; b.path = []; b.pathI = 0; b.seen = null;
  b.lastSeenAt = -9; b.lastSeenPos = { x: a.x, z: a.z };
  b.heardAt = -9; b.heardPos = null; b.thinkT = S.rng() * 0.1;
  b.burstLeft = 3; b.burstPauseUntil = 0; b.reactAt = 0;
  b.usedUtil = false; b.postPlant = null; b.pathKey = '';
  a.fallT = 0;
  if (a.mesh) { a.mesh.rotation.x = 0; a.mesh.visible = true; }
}
