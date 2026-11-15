// main.js — boot and the match loop. The simulation runs on a fixed 60 Hz
// step, kept apart from rendering: step() advances state.js's world by one
// tick (phase timers, bot brains, the player's body, weapons, the charge),
// then the renderer draws whatever the step left behind. This file also owns
// the round flow — buy, live, planted, round end, half-time swap, match end —
// and the deterministic ?shot= staging the screenshots are taken with.

import * as THREE from 'three';
import {
  S, CFG, PHASE, SQUAD, FOE, resetMatch, newAgent, freshBomb,
  aliveCount, teamRole, pushRadio,
} from './state.js';
import { buildWorld, updateWorld, W } from './world.js';
import { initFx, updateFx, clearRoundFx, explosionFx } from './fx.js';
import { initAudio, setListener, sfxBeep, sfxRoundWin, sfxExplosion } from './audio.js';
import { attachInput, Input, requestLock } from './input.js';
import { initPlayer, updatePlayer, handleAction, poseDemoViewmodel } from './player.js';
import {
  makeBotMesh, planRound, buyForBot, thinkBot, updateObjective,
  setBotHooks, resetBotRound, BOT_NAMES, completePlant,
} from './bots.js';
import { updateProjectiles, updateAgentWeapon, makeWeapon, eyeY } from './weapons.js';
import {
  initHud, updateHud, showBanner, setBuyVisible, buyItem,
  BUY_ITEMS, setScoreboardVisible,
} from './hud.js';

const DT = 1 / 60;
let renderer, scene, camera, canvas;
let lastBeepAt = 0;
let shake = 0;

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const SEED = parseInt(params.get('seed') || '7', 10) || 7;

// ------------------------------------------------------------------ setup
function createAgents() {
  const names = ['Rebahan'];
  const player = newAgent(0, SQUAD, names[0], true);
  player.secondary = makeWeapon('p9');
  player.brain = {};
  S.agents.push(player);
  S.player = player;
  let id = 1;
  for (let t = 0; t < 2; t++) {
    for (let i = 0; i < 4; i++) {
      const a = newAgent(id++, t, BOT_NAMES[t][i], false);
      a.secondary = makeWeapon('p9');
      a.brain = {};
      a.mesh = makeBotMesh(t);
      scene.add(a.mesh);
      S.agents.push(a);
    }
  }
  // the fifth foe
  const extra = newAgent(id++, FOE, 'Wraith', false);
  extra.secondary = makeWeapon('p9');
  extra.brain = {};
  extra.mesh = makeBotMesh(FOE);
  scene.add(extra.mesh);
  S.agents.push(extra);
}

function placeAtSpawns() {
  const byTeam = { [S.attackingTeam]: 0, [1 - S.attackingTeam]: 0 };
  for (const a of S.agents) {
    const role = teamRole(a.team);
    const list = role === 'ATK' ? W.spawns.ATK : W.spawns.DEF;
    const i = Math.min(byTeam[a.team]++, list.length - 1);
    a.x = list[i][0]; a.z = list[i][1];
    a.y = 0; a.vx = a.vy = a.vz = 0;
    a.yaw = role === 'ATK' ? -Math.PI / 2 : Math.PI / 2;
    a.pitch = 0;
    a.crouch = false;
  }
}

// ------------------------------------------------------------------ rounds
function startMatch(seed) {
  resetMatch(seed);
  for (const a of S.agents) {
    a.primary = null;
    a.secondary = makeWeapon('p9');
    a.active = 'secondary';
    a.armor = 0; a.helmet = false; a.hasKit = false;
    a.grenades = { frag: 0, smoke: 0, flash: 0 };
  }
  S.round = 0;
  startRound();
}

function startRound() {
  S.round++;
  S.winner = -1;
  S.winReason = '';
  S.bomb = freshBomb();
  S.smokes = [];
  S.projectiles = [];
  S.noises = [];
  S.deaths = [];
  S.playerFlash = 0;
  S.playerDefusing = false;
  clearRoundFx();
  for (const a of S.agents) {
    const survived = a.alive;
    a.alive = true;
    a.hp = 100;
    if (!survived) {
      a.primary = null;
      a.secondary = makeWeapon('p9');
      a.active = 'secondary';
      a.armor = 0; a.helmet = false;
      a.grenades = { frag: 0, smoke: 0, flash: 0 };
    }
    a.hasCharge = false;
    a.reloadingUntil = 0;
    a.reloadWeapon = null;
    a.blindUntil = 0;
    a.bloom = 0;
    resetBotRound(a);
  }
  placeAtSpawns();
  planRound();
  for (const a of S.agents) if (!a.isPlayer) buyForBot(a);
  S.phase = PHASE.BUY;
  S.phaseT = CFG.buyTime;
  const role = teamRole(S.player.team);
  showBanner(
    `ROUND ${S.round} — ${role === 'ATK' ? 'ATTACK' : 'DEFEND'}`,
    role === 'ATK' ? `Plant the charge at ${S.sitePicked} — or clear the Sentinels` : 'Hold both sites',
    2.8,
  );
  if (!S.demo) setBuyVisible(true);
}

function endRound(winnerTeam, reason, byDefuse = false) {
  if (S.phase !== PHASE.LIVE) return;
  S.phase = PHASE.END;
  S.phaseT = CFG.endTime;
  S.winner = winnerTeam;
  S.winReason = reason;
  S.score[winnerTeam]++;
  const loser = 1 - winnerTeam;
  S.lossStreak[winnerTeam] = 0;
  S.lossStreak[loser]++;
  for (const a of S.agents) {
    if (a.team === winnerTeam) {
      const base = byDefuse && teamRole(a.team) === 'DEF' ? CFG.winByDefuseReward : CFG.winReward;
      a.money = Math.min(CFG.maxMoney, a.money + base);
    } else {
      const bonus = Math.min(1400, (S.lossStreak[loser] - 1) * CFG.lossStreakBonus);
      a.money = Math.min(CFG.maxMoney, a.money + CFG.lossReward + bonus);
    }
  }
  const won = winnerTeam === S.player.team;
  showBanner(won ? 'ROUND WON' : 'ROUND LOST', reason, 3.4);
  sfxRoundWin(won);
  setBuyVisible(false);
}

function matchDecided() {
  if (S.score[0] >= CFG.roundsToWin || S.score[1] >= CFG.roundsToWin) return true;
  return S.round >= CFG.roundsPerHalf * 2;
}

function endMatch() {
  S.phase = PHASE.MATCH;
  S.matchWinner = S.score[0] === S.score[1] ? -2 : (S.score[0] > S.score[1] ? 0 : 1);
  const t = document.getElementById('matchend-title');
  const s = document.getElementById('matchend-sub');
  if (t) t.textContent = S.matchWinner === -2 ? 'MATCH DRAWN' : S.matchWinner === S.player.team ? 'MATCH WON' : 'MATCH LOST';
  if (s) s.textContent = `Final score ${S.score[S.player.team]} — ${S.score[1 - S.player.team]} over ${S.round} rounds at SOLSPIRE.`;
  document.getElementById('matchend').style.display = 'grid';
  document.exitPointerLock && document.exitPointerLock();
}

// ------------------------------------------------------------------ phase machine
function stepPhase(dt) {
  if (S.phase === PHASE.BUY) {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      S.phase = PHASE.LIVE;
      S.phaseT = CFG.roundTime;
      setBuyVisible(false);
      showBanner('ROUND LIVE', '', 1.1);
    }
  } else if (S.phase === PHASE.LIVE) {
    const planted = S.bomb && (S.bomb.state === 'planted' || S.bomb.state === 'defusing');
    if (!planted) {
      S.phaseT -= dt;
      if (S.phaseT <= 0) {
        endRound(1 - S.attackingTeam, 'Time expired — the sites held');
        return;
      }
    } else {
      // the charge beeps faster as it runs down
      const interval = S.bomb.timer > 10 ? 1 : S.bomb.timer > 5 ? 0.5 : 0.22;
      if (S.time - lastBeepAt > interval) { lastBeepAt = S.time; sfxBeep(false); }
    }
    const atkAlive = aliveCount(S.attackingTeam);
    const defAlive = aliveCount(1 - S.attackingTeam);
    if (defAlive === 0) endRound(S.attackingTeam, 'Defenders eliminated');
    else if (atkAlive === 0 && !planted) endRound(1 - S.attackingTeam, 'Attackers eliminated');
  } else if (S.phase === PHASE.END) {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      if (matchDecided()) { endMatch(); return; }
      if (S.round === CFG.roundsPerHalf) {
        // half-time: sides swap, economy resets, scores stay
        S.half = 2;
        S.attackingTeam = 1 - S.attackingTeam;
        for (const a of S.agents) {
          a.money = CFG.startMoney;
          a.primary = null;
          a.secondary = makeWeapon('p9');
          a.active = 'secondary';
          a.armor = 0; a.helmet = false; a.hasKit = false;
          a.grenades = { frag: 0, smoke: 0, flash: 0 };
          a.alive = true;
        }
        showBanner('HALF TIME', 'Sides swap — economy reset', 3);
      }
      startRound();
    }
  }
}

function step(dt) {
  S.time += dt;
  stepPhase(dt);
  const playing = S.phase === PHASE.LIVE || S.phase === PHASE.END;
  const buying = S.phase === PHASE.BUY;
  if (playing || buying) {
    if (playing) {
      if (S.demo) thinkBot(S.player, dt);
      else updatePlayer(dt);
      for (const a of S.agents) if (!a.isPlayer) thinkBot(a, dt);
      updateObjective(dt);
      updateProjectiles(dt);
    } else if (!S.demo) {
      updatePlayer(dt); // look around during the buy freeze
    }
    for (const a of S.agents) updateAgentWeapon(a, dt);
  }
  // deaths announced on the radio by the victim's own team, now and then
  if (S.deaths && S.deaths.length) {
    for (const d of S.deaths) {
      if (S.rng() < 0.55) pushRadio(d.victim.team, `${d.victim.name} is down.`);
    }
    S.deaths = [];
  }
  S.playerFlash = Math.max(0, (S.playerFlash || 0) - dt * 0.4);
  shake = Math.max(0, shake - dt * 2.2);
  setListener(S.player.x, S.player.z, S.player.yaw);
  updateWorld(dt);
  updateFx(dt);
  updateHud(dt);
}

// ------------------------------------------------------------------ hooks from bots.js
setBotHooks({
  onPlanted: () => { showBanner('CHARGE PLANTED', `${Math.round(CFG.bombTime)} seconds to detonation`, 2.4); },
  onDefused: (defuser) => { endRound(1 - S.attackingTeam, `Charge defused by ${defuser.name}`, true); },
  onDetonated: () => {
    explosionFx(S.bomb.x, S.bomb.z);
    sfxExplosion(S.bomb.x, S.bomb.z);
    sfxBeep(true);
    const d = Math.hypot(S.player.x - S.bomb.x, S.player.z - S.bomb.z);
    shake = Math.max(0, 1 - d / 30);
    endRound(S.attackingTeam, 'Charge detonated');
  },
  onRoundEnd: () => {},
});

// ------------------------------------------------------------------ input wiring
function wireInput() {
  Input.onAction = (code, down) => {
    if (code === 'Tab') { setScoreboardVisible(down); return; }
    if (!down) return;
    if (S.phase === PHASE.BUY && !S.demo) {
      const item = BUY_ITEMS.find((i) => `Digit${i.key}` === code);
      if (item) { buyItem(S.player, item.id); return; }
      if (code === 'KeyB') { setBuyVisible(false); return; }
    } else if (code === 'KeyB' && S.phase === PHASE.LIVE) {
      // buy menu stays shut once the round is live
      return;
    }
    handleAction(code, down);
  };
  Input.onLockChange = (locked) => {
    const pauseEl = document.getElementById('pause');
    if (!locked && (S.phase === PHASE.LIVE || S.phase === PHASE.BUY) && !SHOT) {
      S.paused = true;
      pauseEl.style.display = 'grid';
    } else if (locked) {
      S.paused = false;
      pauseEl.style.display = 'none';
    }
  };
  document.getElementById('play').addEventListener('click', () => {
    initAudio();
    document.getElementById('menu').style.display = 'none';
    requestLock(canvas);
    if (S.phase === PHASE.MENU) startMatch((Math.random() * 1e9) | 0);
  });
  document.getElementById('pause').addEventListener('click', () => {
    initAudio();
    requestLock(canvas);
  });
  document.getElementById('again').addEventListener('click', () => {
    document.getElementById('matchend').style.display = 'none';
    initAudio();
    requestLock(canvas);
    startMatch((Math.random() * 1e9) | 0);
  });
}

// ------------------------------------------------------------------ shot staging
function simulate(seconds) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) step(DT);
}

function giveRifle(a, mag) {
  a.primary = makeWeapon('longbow');
  a.primary.mag = mag;
  a.active = 'primary';
}

function faceToward(a, x, z) {
  a.yaw = Math.atan2(-(x - a.x), -(z - a.z));
  a.pitch = -0.02;
}

function setupShot(name) {
  S.demo = true;
  document.getElementById('menu').style.display = 'none';
  if (name === 'cover') {
    placeAtSpawns();
    for (const a of S.agents) if (a.mesh) { a.mesh.position.set(a.x, 0, a.z); a.mesh.rotation.y = a.yaw; }
    S.camOverride = { x: 38, y: 11, z: -31, lx: -22, ly: 4, lz: 6 };
    document.getElementById('menu').style.display = 'grid';
    S.frozen = true;
    return;
  }
  startMatch(SEED);
  S.phase = PHASE.LIVE;
  S.phaseT = CFG.roundTime;
  setBuyVisible(false);
  // the camera agent is a director's stand-in during staging: it cannot die
  S.player.invulnerable = true;
  if (name === 'play') {
    simulate(16);
    // director's placement for the frozen frame: the player holds the A
    // approach with a rifle, two Sentinels hold the site in plain view
    const p = S.player;
    const mate = S.agents.find((a) => a.alive && a.team === SQUAD && !a.isPlayer);
    if (p.hasCharge && mate) {
      // the frame reads cleaner with a teammate carrying the charge
      p.hasCharge = false;
      mate.hasCharge = true;
      if (S.bomb && S.bomb.carrier === p) S.bomb.carrier = mate;
    }
    p.x = 23; p.z = -11; p.y = 0; p.hp = 82;
    giveRifle(p, 26);
    faceToward(p, 34, -23);
    const foes = S.agents.filter((a) => a.alive && a.team === FOE);
    if (foes[0]) { foes[0].x = 32; foes[0].z = -21; foes[0].y = 0; faceToward(foes[0], p.x, p.z); if (foes[0].mesh) { foes[0].mesh.position.set(32, 0, -21); foes[0].mesh.rotation.y = foes[0].yaw; } }
    if (foes[1]) { foes[1].x = 36.5; foes[1].z = -17.5; foes[1].y = 0; faceToward(foes[1], p.x, p.z); if (foes[1].mesh) { foes[1].mesh.position.set(36.5, 0, -17.5); foes[1].mesh.rotation.y = foes[1].yaw; } }
    if (mate) { mate.x = 21; mate.z = -7; mate.y = 0; faceToward(mate, 34, -23); if (mate.mesh) { mate.mesh.position.set(21, 0, -7); mate.mesh.rotation.y = mate.yaw; } }
  } else if (name === 'plant') {
    simulate(20);
    const b = S.bomb;
    if (b && b.state !== 'planted' && b.state !== 'defusing') {
      const carrier = S.agents.find((a) => a.alive && a.hasCharge) || S.agents.find((a) => a.alive && a.team === S.attackingTeam);
      if (carrier) {
        const site = W.sites[S.sitePicked];
        carrier.x = site.x + 2; carrier.z = site.z + 1;
        completePlant(carrier);
      }
    }
    simulate(1.1);
    // post-plant frame: the player holds the site from its edge, a Sentinel
    // is mid-retake at the entry (placed last, so no brain walks them off)
    const p = S.player;
    const site = W.sites[S.sitePicked];
    p.x = site.x - 11; p.z = site.z + 3; p.y = 0; p.hp = 64;
    giveRifle(p, 19);
    faceToward(p, site.x, site.z);
    const foe = S.agents.find((a) => a.alive && a.team === FOE);
    if (foe) {
      foe.x = site.x - 2; foe.z = site.z + 1.5; foe.y = 0;
      faceToward(foe, site.x, site.z);
      if (foe.mesh) { foe.mesh.position.set(foe.x, 0, foe.z); foe.mesh.rotation.y = foe.yaw; }
    }
    if (S.bomb && (S.bomb.state === 'planted' || S.bomb.state === 'defusing')) S.bomb.timer = 33;
  } else if (name === 'end') {
    // a finished round: charge went off at A, scoreboard up
    const site = W.sites.A;
    const carrier = S.agents.find((a) => a.alive && a.team === S.attackingTeam);
    if (carrier) { carrier.x = site.x; carrier.z = site.z; completePlant(carrier); }
    explosionFx(site.x, site.z);
    S.score[S.attackingTeam] = 5;
    S.score[1 - S.attackingTeam] = 4;
    S.round = 10;
    // a played match's numbers, so the board reads like round 10, not round 1
    const kd = [[9, 4], [7, 6], [6, 5], [5, 7], [4, 6], [8, 5], [6, 6], [5, 7], [4, 8], [3, 6]];
    S.agents.forEach((a, i) => { a.kills = kd[i][0]; a.deaths = kd[i][1]; });
    endRound(S.attackingTeam, 'Charge detonated');
    setScoreboardVisible(true);
    const p = S.player;
    p.x = site.x - 9; p.z = site.z + 6; p.yaw = Math.atan2(-(site.x - p.x), -(site.z - p.z)); p.pitch = -0.05;
  }
  // one last paint of the glass and the props so the frozen frame shows the
  // staged state, not the state from before the director's placements
  updateFx(0);
  updateHud(0);
  S.frozen = true;
  window.__shotReady = true;
}

// ------------------------------------------------------------------ boot + loop
function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  document.getElementById('game').appendChild(renderer.domElement);
  canvas = renderer.domElement;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 500);
  scene.add(camera);
  buildWorld(scene, renderer);
  initFx(scene);
  createAgents();
  initPlayer(camera);
  initHud();
  attachInput(canvas);
  wireInput();
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  if (SHOT) setupShot(SHOT);
  let last = performance.now();
  let acc = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    const elapsed = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!S.frozen && !S.paused) {
      acc += elapsed;
      let n = 0;
      while (acc >= DT && n < 5) { step(DT); acc -= DT; n++; }
      if (n === 5) acc = 0;
    }
    // camera: override (cover shot), demo eye, or the player's own eye is set
    // by player.js; here we only handle the override and demo cases
    if (S.camOverride) {
      const c = S.camOverride;
      camera.position.set(c.x, c.y, c.z);
      camera.lookAt(c.lx, c.ly, c.lz);
    } else if (S.demo && S.player) {
      const p = S.player;
      if (p.alive) {
        camera.position.set(p.x, p.y + eyeY(p), p.z);
        camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
        poseDemoViewmodel(p);
      }
    }
    if (shake > 0) {
      camera.position.x += Math.sin(now * 0.09) * 0.05 * shake;
      camera.position.y += Math.cos(now * 0.113) * 0.05 * shake;
    }
    renderer.render(scene, camera);
  };
  requestAnimationFrame(frame);
}

try {
  boot();
} catch (err) {
  document.title = `BOOT ERROR: ${err && err.message}`;
  throw err;
}
