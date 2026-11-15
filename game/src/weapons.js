// weapons.js — every gun and grenade, and the one firing path the player and
// the bots share, so a bot's rifle obeys exactly the rules the player's does:
// damage falls off with range, the head multiplies it, armour halves what it
// covers, spread grows while moving or airborne and shrinks to a point when
// stopped and crouched. Stopping to aim pays; spraying on the run does not.

import { S, CFG, award, emitNoise, pushKillfeed } from './state.js';
import { W, rayHit, losBlocked } from './world.js';
import { spawnTracer, spawnImpact, spawnMuzzle, smokesBlock, explosionFx } from './fx.js';
import { sfxShot, sfxDryFire, sfxReload, sfxHit, sfxThrow, sfxFlashPop, sfxSmokePop, sfxExplosion } from './audio.js';

export const WEAPONS = {
  p9:      { id: 'p9', name: 'P9 Sidearm', kind: 'pistol', slot: 'secondary', price: 0, damage: 26, headMult: 3.4, rpm: 380, mag: 12, reserve: 48, reload: 1.4, spread: 0.55, recoil: 0.011, auto: false, fallStart: 14, fallEnd: 42, pellets: 1 },
  kestrel: { id: 'kestrel', name: 'Kestrel SMG', kind: 'smg', slot: 'primary', price: 1200, damage: 21, headMult: 3.0, rpm: 780, mag: 30, reserve: 90, reload: 2.0, spread: 0.95, recoil: 0.008, auto: true, fallStart: 10, fallEnd: 34, pellets: 1 },
  mule:    { id: 'mule', name: 'Mule Scattergun', kind: 'shotgun', slot: 'primary', price: 1100, damage: 10, headMult: 2.2, rpm: 68, mag: 6, reserve: 24, reload: 2.8, spread: 3.4, recoil: 0.05, auto: false, fallStart: 5, fallEnd: 18, pellets: 8 },
  longbow: { id: 'longbow', name: 'Longbow Rifle', kind: 'rifle', slot: 'primary', price: 2700, damage: 34, headMult: 4.0, rpm: 600, mag: 30, reserve: 90, reload: 2.4, spread: 0.62, recoil: 0.013, auto: true, fallStart: 22, fallEnd: 70, pellets: 1 },
  apex:    { id: 'apex', name: 'Apex DMR', kind: 'dmr', slot: 'primary', price: 4300, damage: 74, headMult: 3.2, rpm: 210, mag: 10, reserve: 40, reload: 2.7, spread: 0.22, recoil: 0.035, auto: false, fallStart: 30, fallEnd: 95, pellets: 1, zoom: true },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Charge', price: 300 },
  smoke: { id: 'smoke', name: 'Smoke Canister', price: 300 },
  flash: { id: 'flash', name: 'Flash Charge', price: 250 },
};

export function makeWeapon(id) {
  const def = WEAPONS[id];
  return { def, mag: def.mag, reserve: def.reserve };
}

export function activeWeapon(agent) {
  if (agent.active === 'primary') return agent.primary;
  if (agent.active === 'secondary') return agent.secondary;
  return null;
}

export function eyeY(agent) {
  return agent.y + (agent.crouch ? CFG.crouchEye : CFG.eyeHeight);
}

const _dir = { x: 0, y: 0, z: 0 };
export function aimDir(agent) {
  const cp = Math.cos(agent.pitch);
  _dir.x = -Math.sin(agent.yaw) * cp;
  _dir.y = Math.sin(agent.pitch);
  _dir.z = -Math.cos(agent.yaw) * cp;
  return _dir;
}

// Current spread in radians for an agent holding def: bloom from recent shots,
// a heavy tax for moving or being airborne, a bonus for stopping crouched.
export function spreadFor(agent, def) {
  let deg = def.spread + agent.bloom * 2.6;
  const sp = Math.hypot(agent.vx, agent.vz);
  if (!agent.grounded) deg *= 2.4;
  else if (sp > 0.6) deg += sp * 0.55;
  if (agent.crouch && agent.grounded) deg *= 0.68;
  return deg * Math.PI / 180;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxDist) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  const t = tca - Math.sqrt(r * r - d2);
  return t > 0 && t < maxDist ? t : -1;
}

export function raycastAgents(ox, oy, oz, dx, dy, dz, maxDist, shooter) {
  let best = null;
  for (const a of S.agents) {
    if (!a.alive || a === shooter) continue;
    const crouch = a.crouch;
    const headY = a.y + (crouch ? 1.24 : 1.6);
    const chestY = a.y + (crouch ? 0.86 : 1.08);
    let t = raySphere(ox, oy, oz, dx, dy, dz, a.x, headY, a.z, 0.19, maxDist);
    let part = 'head';
    if (t < 0) { t = raySphere(ox, oy, oz, dx, dy, dz, a.x, chestY, a.z, 0.44, maxDist); part = 'chest'; }
    if (t < 0) { t = raySphere(ox, oy, oz, dx, dy, dz, a.x, a.y + 0.42, a.z, 0.38, maxDist); part = 'legs'; }
    if (t > 0 && (!best || t < best.dist)) {
      best = { agent: a, dist: t, part, x: ox + dx * t, y: oy + dy * t, z: oz + dz * t };
    }
  }
  return best;
}

// raw arrives with the weapon's head multiplier already applied by the caller;
// here the legs discount and armour are resolved. Armour halves what it
// covers (an unhelmeted head is not covered) and wears down as it absorbs.
export function damageAgent(target, raw, part, attacker, weaponName) {
  if (!target.alive || target.invulnerable) return;
  let d = part === 'legs' ? raw * 0.75 : raw;
  if (target.armor > 0) {
    const covered = part !== 'head' || target.helmet;
    if (covered) {
      const absorbed = d * 0.5;
      target.armor = Math.max(0, target.armor - absorbed * 0.6);
      d -= absorbed;
    }
  }
  target.hp -= d;
  target.lastDamageFrom = attacker ? attacker.id : -1;
  target.lastDamageAt = S.time;
  if (attacker && attacker.isPlayer) { S.hitmarkT = S.time; S.hitmarkKill = false; }
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths++;
    if (attacker && attacker !== target) {
      attacker.kills++;
      award(attacker, CFG.killReward);
    }
    pushKillfeed(
      `${attacker ? attacker.name : '—'} ▸ ${target.name}  ·  ${weaponName}${part === 'head' ? '  ·  HEADSHOT' : ''}`,
      attacker ? (attacker.team === S.player.team ? '#f0c060' : '#7ad4e8') : '#ccc',
    );
    if (attacker && attacker.isPlayer) { S.hitmarkKill = true; sfxHit(true); }
    if (target.hasCharge) dropCharge(target);
    if (!S.deaths) S.deaths = [];
    S.deaths.push({ victim: target, attacker });
  } else if (attacker && attacker.isPlayer) {
    sfxHit(false);
  }
}

function dropCharge(agent) {
  agent.hasCharge = false;
  if (S.bomb && S.bomb.state === 'carried') {
    S.bomb.state = 'dropped';
    S.bomb.carrier = null;
    S.bomb.x = agent.x; S.bomb.z = agent.z;
  }
}

export function fireWeapon(agent) {
  const w = activeWeapon(agent);
  if (!w || S.time < agent.nextShotAt) return false;
  if (agent.reloadWeapon === w && S.time < agent.reloadingUntil) return false;
  const def = w.def;
  if (w.mag <= 0) {
    if (agent.isPlayer) sfxDryFire();
    agent.nextShotAt = S.time + 0.3;
    startReload(agent);
    return false;
  }
  w.mag--;
  agent.shotsFired++;
  agent.nextShotAt = S.time + 60 / def.rpm;
  agent.bloom = Math.min(1, agent.bloom + (def.auto ? 0.16 : 0.3));
  const spread = spreadFor(agent, def);
  const ox = agent.x, oy = eyeY(agent), oz = agent.z;
  const base = aimDir(agent);
  // muzzle point for tracers: a little ahead of the eye, low right for the player
  const mx = ox + base.x * 0.55, my = oy - 0.14 + base.y * 0.3, mz = oz + base.z * 0.55;
  for (let p = 0; p < def.pellets; p++) {
    const a1 = (S.rng() - 0.5) * 2 * spread;
    const a2 = (S.rng() - 0.5) * 2 * spread;
    // perturb the aim direction by two small angles (right and up vectors)
    const rx = Math.cos(agent.yaw), rz = -Math.sin(agent.yaw);
    let dx = base.x + rx * a1, dy = base.y + a2, dz = base.z + rz * a1;
    const il = 1 / Math.hypot(dx, dy, dz);
    dx *= il; dy *= il; dz *= il;
    const wall = rayHit(ox, oy, oz, dx, dy, dz, 120);
    const hitA = raycastAgents(ox, oy, oz, dx, dy, dz, wall.dist, agent);
    if (hitA) {
      const fall = hitA.dist <= def.fallStart ? 1
        : Math.max(0.34, 1 - (hitA.dist - def.fallStart) / (def.fallEnd - def.fallStart) * 0.66);
      let raw = def.damage * fall;
      if (hitA.part === 'head') raw *= def.headMult;
      damageAgent(hitA.agent, raw, hitA.part, agent, def.name);
      spawnImpact(hitA.x, hitA.y, hitA.z, -dx, -dy, -dz, 'flesh');
      spawnTracer(mx, my, mz, hitA.x, hitA.y, hitA.z);
    } else if (wall.dist < 120) {
      spawnImpact(wall.x, wall.y, wall.z, wall.nx, wall.ny, wall.nz, 'world');
      spawnTracer(mx, my, mz, wall.x, wall.y, wall.z);
    }
  }
  spawnMuzzle(mx, my, mz);
  agent.lastShotVisual = S.time;
  sfxShot(def.kind, agent.x, agent.z, agent.isPlayer);
  emitNoise(agent.x, agent.z, 42, 'shot', agent.team);
  // recoil: the camera (or the bot's aim) climbs; the player pulls it back down
  agent.pitch += def.recoil * (0.75 + S.rng() * 0.5);
  agent.yaw += (S.rng() - 0.5) * def.recoil * 0.5;
  if (w.mag === 0) startReload(agent);
  return true;
}

export function startReload(agent) {
  const w = activeWeapon(agent);
  if (!w || w.mag >= w.def.mag || w.reserve <= 0 || agent.reloadWeapon) return;
  agent.reloadingUntil = S.time + w.def.reload;
  agent.reloadWeapon = w;
  if (agent.isPlayer) sfxReload(0);
}

export function throwGrenade(agent, type) {
  if (agent.grenades[type] <= 0 || S.time < agent.nextShotAt) return false;
  agent.grenades[type]--;
  agent.nextShotAt = S.time + 0.55;
  const dir = aimDir(agent);
  const sp = 15.5;
  S.projectiles.push({
    type, team: agent.team, thrower: agent,
    x: agent.x + dir.x * 0.4, y: eyeY(agent) - 0.1, z: agent.z + dir.z * 0.4,
    vx: dir.x * sp + agent.vx * 0.4, vy: dir.y * sp + 3.2, vz: dir.z * sp + agent.vz * 0.4,
    t: 0, done: false,
  });
  sfxThrow();
  agent.active = agent.primary ? 'primary' : 'secondary';
  return true;
}

function explodeFrag(p) {
  explosionFx(p.x, p.z);
  sfxExplosion(p.x, p.z);
  emitNoise(p.x, p.z, 55, 'boom', p.team);
  for (const a of S.agents) {
    if (!a.alive) continue;
    const d = Math.hypot(a.x - p.x, a.z - p.z);
    if (d > 7) continue;
    let dmg = 94 * (1 - d / 7.5);
    const blocked = losBlocked(p.x, 1, p.z, a.x, a.y + 1, a.z);
    if (blocked) dmg *= 0.22;
    if (dmg > 2) damageAgent(a, dmg, 'chest', p.thrower, 'Frag Charge');
  }
}

function popFlash(p) {
  sfxFlashPop(p.x, p.z);
  explosionFx(p.x, p.z); // small spark burst reads as the pop
  for (const a of S.agents) {
    if (!a.alive) continue;
    const dx = a.x - p.x, dy = (a.y + 1.5) - p.y, dz = a.z - p.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 26) continue;
    if (losBlocked(p.x, p.y, p.z, a.x, a.y + 1.5, a.z)) continue;
    if (smokesBlock(p.x, p.y, p.z, a.x, a.y + 1.5, a.z)) continue;
    // how directly is the agent looking at the pop?
    const dir = aimDir(a);
    const dot = (dir.x * dx + dir.y * dy + dir.z * dz) / (dist || 1);
    const facing = Math.max(0, -dot); // dir points from agent toward view; pop is opposite
    const look = Math.max(0, ( (-dx) * dir.x + (-dz) * dir.z ) / (Math.hypot(dx, dz) || 1));
    const strength = Math.max(facing, look) * (1 - dist / 30);
    if (strength <= 0.12) continue;
    const dur = 0.6 + strength * 2.8;
    a.blindUntil = Math.max(a.blindUntil, S.time + dur);
    if (a.isPlayer) S.playerFlash = Math.min(1, strength + 0.25);
  }
}

function popSmoke(p) {
  sfxSmokePop(p.x, p.z);
  S.smokes.push({ x: p.x, z: p.z, r: 3.5, t: 0, life: 15 });
}

export function updateProjectiles(dt) {
  for (const p of S.projectiles) {
    if (p.done) continue;
    p.t += dt;
    p.vy -= 10.5 * dt;
    // axis-separated point collision against the colliders
    let nx = p.x + p.vx * dt;
    if (pointInSolid(nx, p.y, p.z)) { p.vx *= -0.38; nx = p.x; }
    p.x = nx;
    let nz = p.z + p.vz * dt;
    if (pointInSolid(p.x, p.y, nz)) { p.vz *= -0.38; nz = p.z; }
    p.z = nz;
    p.y += p.vy * dt;
    if (p.y < 0.12) {
      p.y = 0.12;
      p.vy = Math.abs(p.vy) > 1.2 ? -p.vy * 0.36 : 0;
      p.vx *= 0.7; p.vz *= 0.7;
    }
    const resting = p.y <= 0.13 && Math.abs(p.vy) < 0.1;
    if (p.type === 'frag' && p.t >= 1.6) { explodeFrag(p); p.done = true; }
    else if (p.type === 'flash' && (p.t >= 1.35 || (p.t > 0.25 && resting))) { popFlash(p); p.done = true; }
    else if (p.type === 'smoke' && p.t >= 1.1 && resting) { popSmoke(p); p.done = true; }
    else if (p.t > 4) { p.done = true; if (p.type === 'frag') explodeFrag(p); }
  }
  S.projectiles = S.projectiles.filter((p) => !p.done);
  for (const sm of S.smokes) sm.t += dt;
  S.smokes = S.smokes.filter((sm) => sm.t < sm.life);
}

function pointInSolid(x, y, z) {
  for (const c of W.colliders) {
    if (x > c.x0 - 0.04 && x < c.x1 + 0.04 && y > c.y0 - 0.04 && y < c.y1 + 0.04 && z > c.z0 - 0.04 && z < c.z1 + 0.04) return true;
  }
  return false;
}

export function updateAgentWeapon(agent, dt) {
  agent.bloom = Math.max(0, agent.bloom - dt * 2.6);
  const w = agent.reloadWeapon;
  if (w && S.time >= agent.reloadingUntil) {
    const take = Math.min(w.def.mag - w.mag, w.reserve);
    w.mag += take; w.reserve -= take;
    agent.reloadWeapon = null;
    agent.reloadingUntil = 0;
    if (agent.isPlayer) sfxReload(1);
  }
}
