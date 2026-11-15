// state.js — the whole match in one object. Every module reads and writes the
// single exported S; nothing keeps a private copy of game state elsewhere.
// A round is Counter-Strike shaped: buy phase, live play, a charge that can be
// planted at site A or B, and a defuse that can still save the defenders.

export const SQUAD = 0; // the player's team (Strikers in half 1)
export const FOE = 1;   // the opposing team (Sentinels in half 1)

export const PHASE = { MENU: 0, BUY: 1, LIVE: 2, END: 3, MATCH: 4 };

export const CFG = {
  buyTime: 12,
  roundTime: 100,
  endTime: 4.5,
  plantTime: 3.2,
  defuseTime: 5,
  defuseKitTime: 2.5,
  bombTime: 35,
  roundsPerHalf: 6,
  roundsToWin: 7,
  startMoney: 800,
  maxMoney: 16000,
  killReward: 300,
  plantReward: 300,
  winReward: 3250,
  winByDefuseReward: 3500,
  lossReward: 1900,
  lossStreakBonus: 500,
  eyeHeight: 1.62,
  crouchEye: 1.12,
  bodyHeight: 1.8,
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const S = {
  seed: 1,
  rng: mulberry32(1),
  time: 0,
  phase: PHASE.MENU,
  phaseT: 0,
  round: 0,
  half: 1,
  attackingTeam: SQUAD,
  score: [0, 0],
  lossStreak: [0, 0],
  agents: [],
  player: null,
  bomb: null,
  smokes: [],       // { x, z, r, t, life } vision-blocking clouds (fx mirrors the visuals)
  projectiles: [],  // grenades in flight
  noises: [],       // { x, z, r, type, team, t } hearing events for the bots
  killfeed: [],     // { text, t, color }
  radioLog: [],     // { text, t, team }
  winner: -1,       // team that won the round, -1 while undecided
  winReason: '',
  matchWinner: -1,
  demo: false,      // shot mode: the player agent is driven by a bot brain
  frozen: false,    // shot mode: staging finished, hold the frame
  paused: false,
  sitePicked: 'A',  // attacking plan for this round (bots refine it)
  lastPlantSite: null,
};

export function teamRole(team) {
  return team === S.attackingTeam ? 'ATK' : 'DEF';
}

export function resetMatch(seed) {
  S.seed = seed;
  S.rng = mulberry32(seed);
  S.time = 0;
  S.round = 0;
  S.half = 1;
  S.attackingTeam = SQUAD;
  S.score = [0, 0];
  S.lossStreak = [0, 0];
  S.winner = -1;
  S.matchWinner = -1;
  S.lastPlantSite = null;
  for (const a of S.agents) {
    a.money = CFG.startMoney;
    a.kills = 0; a.deaths = 0; a.assists = 0;
  }
}

export function newAgent(id, team, name, isPlayer) {
  return {
    id, team, name, isPlayer: !!isPlayer,
    alive: true, hp: 100, armor: 0, helmet: false,
    money: CFG.startMoney, kills: 0, deaths: 0, assists: 0,
    // body: feet position + facing. pitch only matters for the player and aim.
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
    crouch: false, grounded: true, speedNow: 0,
    // weapons: instances are { def, mag, reserve } or null
    primary: null, secondary: null, active: 'secondary',
    grenades: { frag: 0, smoke: 0, flash: 0 },
    hasCharge: false, hasKit: false,
    reloadingUntil: 0, reloadWeapon: null, nextShotAt: 0, shotsFired: 0, bloom: 0,
    blindUntil: 0, deafAt: 0,
    lastDamageFrom: -1, lastDamageAt: -9,
    // bot brain (unused for the human)
    brain: null, mesh: null, walkPhase: 0,
  };
}

export function aliveCount(team) {
  let n = 0;
  for (const a of S.agents) if (a.team === team && a.alive) n++;
  return n;
}

export function award(agent, amount) {
  agent.money = Math.max(0, Math.min(CFG.maxMoney, agent.money + amount));
}

export function emitNoise(x, z, r, type, team) {
  S.noises.push({ x, z, r, type, team, t: S.time });
  if (S.noises.length > 24) S.noises.shift();
}

export function pushKillfeed(text, color) {
  S.killfeed.unshift({ text, t: S.time, color });
  if (S.killfeed.length > 6) S.killfeed.pop();
}

export function pushRadio(team, text) {
  S.radioLog.push({ text, t: S.time, team });
  if (S.radioLog.length > 5) S.radioLog.shift();
}

export function freshBomb() {
  return {
    state: 'carried', // carried | dropped | planting | planted | defusing | done
    carrier: null, x: 0, z: 0, site: null,
    plantT: 0, defuseT: 0, timer: 0, planter: null, defuser: null,
  };
}
