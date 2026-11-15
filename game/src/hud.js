// hud.js — everything flat on the glass: health and armour, ammunition, money,
// the round clock and score, alive pips, killfeed, the radio log, the buy menu,
// the scoreboard and a live minimap. It only reads state.js and writes DOM;
// the one write back into the game is buyItem(), which the buy keys call.

import { S, CFG, PHASE, teamRole, aliveCount } from './state.js';
import { WEAPONS, GRENADES, makeWeapon, activeWeapon, spreadFor } from './weapons.js';
import { W } from './world.js';
import { sfxBuy } from './audio.js';

const el = {};
let bannerUntil = 0;
let buyVisible = false;

export const BUY_ITEMS = [
  { key: '1', id: 'longbow', label: 'Longbow Rifle', price: 2700 },
  { key: '2', id: 'kestrel', label: 'Kestrel SMG', price: 1200 },
  { key: '3', id: 'mule', label: 'Mule Scattergun', price: 1100 },
  { key: '4', id: 'apex', label: 'Apex DMR', price: 4300 },
  { key: '5', id: 'vest', label: 'Kevlar Vest', price: 650 },
  { key: '6', id: 'vesthelm', label: 'Vest + Helmet', price: 1000 },
  { key: '7', id: 'frag', label: 'Frag Charge', price: 300 },
  { key: '8', id: 'smoke', label: 'Smoke Canister', price: 300 },
  { key: '9', id: 'flash', label: 'Flash Charge', price: 250 },
  { key: '0', id: 'kit', label: 'Defuse Tools', price: 200 },
];

export function buyItem(agent, id) {
  const fail = () => false;
  if (WEAPONS[id]) {
    const def = WEAPONS[id];
    if (agent.money < def.price) return fail();
    agent.money -= def.price;
    agent[def.slot] = makeWeapon(id);
    agent.active = def.slot;
  } else if (id === 'vest' || id === 'vesthelm') {
    const price = id === 'vest' ? 650 : 1000;
    if (agent.money < price || (id === 'vest' && agent.armor >= 100) || (id === 'vesthelm' && agent.helmet)) return fail();
    agent.money -= price;
    agent.armor = 100;
    if (id === 'vesthelm') agent.helmet = true;
  } else if (GRENADES[id]) {
    const cap = id === 'flash' ? 2 : 1;
    if (agent.money < GRENADES[id].price || agent.grenades[id] >= cap) return fail();
    agent.money -= GRENADES[id].price;
    agent.grenades[id]++;
  } else if (id === 'kit') {
    if (agent.money < 200 || agent.hasKit || teamRole(agent.team) !== 'DEF') return fail();
    agent.money -= 200;
    agent.hasKit = true;
  } else return fail();
  sfxBuy();
  renderBuyMenu();
  return true;
}

export function initHud() {
  for (const id of [
    'crosshair', 'hitmarker', 'health-fill', 'health-num', 'armor-fill', 'armor-num',
    'ammo-mag', 'ammo-reserve', 'weapon-name', 'money', 'timer', 'score-line',
    'round-num', 'pips', 'killfeed', 'radio', 'banner', 'banner-title', 'banner-sub',
    'channel', 'channel-label', 'channel-fill', 'buymenu', 'buy-items', 'buy-money',
    'scoreboard', 'sb-body', 'minimap', 'flash', 'vignette', 'scope', 'spectate',
    'objective', 'nade-line', 'menu', 'pause', 'matchend', 'matchend-title', 'matchend-sub',
  ]) el[id] = document.getElementById(id);
  renderBuyMenu();
}

export function showBanner(title, sub, dur = 2.6) {
  el['banner-title'].textContent = title;
  el['banner-sub'].textContent = sub || '';
  el.banner.style.opacity = '1';
  bannerUntil = S.time + dur;
}

export function setBuyVisible(v) {
  buyVisible = v;
  el.buymenu.style.display = v ? 'block' : 'none';
  if (v) renderBuyMenu();
}
export function isBuyVisible() { return buyVisible; }

function renderBuyMenu() {
  const p = S.player;
  if (!p || !el['buy-items']) return;
  el['buy-money'].textContent = `$${p.money}`;
  el['buy-items'].innerHTML = BUY_ITEMS.map((it) => {
    const afford = p.money >= it.price;
    const owned = (WEAPONS[it.id] && p[WEAPONS[it.id].slot] && p[WEAPONS[it.id].slot].def.id === it.id)
      || (it.id === 'vest' && p.armor >= 100) || (it.id === 'vesthelm' && p.helmet)
      || (GRENADES[it.id] && p.grenades[it.id] > 0) || (it.id === 'kit' && p.hasKit);
    return `<div class="buy-item ${afford && !owned ? '' : 'off'}"><span class="buy-key">${it.key}</span><span class="buy-label">${it.label}${owned ? ' ✓' : ''}</span><span class="buy-price">$${it.price}</span></div>`;
  }).join('');
}

export function setScoreboardVisible(v) {
  el.scoreboard.style.display = v ? 'block' : 'none';
  if (v) renderScoreboard();
}

function renderScoreboard() {
  const rows = [...S.agents].sort((a, b) => b.kills - a.kills);
  const teamName = (t) => (S.attackingTeam === t ? 'STRIKERS (ATK)' : 'SENTINELS (DEF)');
  el['sb-body'].innerHTML = rows.map((a) => `
    <tr class="${a.team === S.player.team ? 'mine' : ''} ${a.alive ? '' : 'dead'}">
      <td>${a.isPlayer ? '★ ' : ''}${a.name}</td><td>${teamName(a.team)}</td>
      <td>${a.kills}</td><td>${a.deaths}</td><td>$${a.money}</td><td>${a.alive ? a.hp : '—'}</td>
    </tr>`).join('');
}

const fmtTime = (t) => {
  t = Math.max(0, Math.ceil(t));
  return `${(t / 60) | 0}:${String(t % 60).padStart(2, '0')}`;
};

export function updateHud(dt) {
  const p = S.player;
  if (!p) return;
  const inGame = S.phase !== PHASE.MENU;
  document.getElementById('hud').style.opacity = inGame ? '1' : '0';
  // health / armour
  el['health-fill'].style.width = `${Math.max(0, p.hp)}%`;
  el['health-num'].textContent = p.alive ? Math.ceil(p.hp) : 0;
  el['armor-fill'].style.width = `${p.armor}%`;
  el['armor-num'].textContent = Math.round(p.armor);
  el['health-fill'].style.background = p.hp <= 30 ? '#e5484d' : '#f3ead9';
  // weapon / ammo
  const w = activeWeapon(p);
  const isNade = p.active === 'frag' || p.active === 'smoke' || p.active === 'flash';
  el['weapon-name'].textContent = isNade ? GRENADES[p.active].name : w ? w.def.name : '';
  el['ammo-mag'].textContent = isNade ? p.grenades[p.active] : w ? w.mag : '—';
  el['ammo-reserve'].textContent = isNade ? '' : w ? `/ ${w.reserve}` : '';
  el['ammo-mag'].style.color = w && w.mag === 0 ? '#e5484d' : '';
  el.money.textContent = `$${p.money}`;
  el['nade-line'].textContent =
    `FRAG ${p.grenades.frag} · SMOKE ${p.grenades.smoke} · FLASH ${p.grenades.flash}${p.hasCharge ? ' · ⦿ CHARGE' : ''}${p.hasKit ? ' · ✂ KIT' : ''}`;
  // clock + score
  const planted = S.bomb && (S.bomb.state === 'planted' || S.bomb.state === 'defusing');
  el.timer.textContent = planted ? fmtTime(S.bomb.timer) : fmtTime(S.phaseT);
  el.timer.style.color = planted ? '#e5484d' : '';
  const myRole = teamRole(p.team);
  el['score-line'].textContent = `${S.score[p.team]} — ${S.score[1 - p.team]}`;
  el['round-num'].textContent = `ROUND ${Math.max(1, S.round)} · YOU ${myRole === 'ATK' ? 'ATTACK' : 'DEFEND'}`;
  el.pips.textContent =
    `${'●'.repeat(aliveCount(p.team))}${'○'.repeat(5 - aliveCount(p.team))}  vs  ${'●'.repeat(aliveCount(1 - p.team))}${'○'.repeat(5 - aliveCount(1 - p.team))}`;
  // crosshair + hitmarker
  if (w && !isNade) {
    const gap = 5 + spreadFor(p, w.def) * 640;
    el.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    el.crosshair.style.opacity = S.scoped ? '0' : '1';
  } else el.crosshair.style.opacity = isNade ? '1' : '0';
  const hm = S.time - (S.hitmarkT || -9) < 0.16;
  el.hitmarker.style.opacity = hm ? '1' : '0';
  el.hitmarker.style.filter = S.hitmarkKill && hm ? 'hue-rotate(-50deg) brightness(1.6)' : '';
  // killfeed + radio (expire by sim time)
  el.killfeed.innerHTML = S.killfeed.filter((k) => S.time - k.t < 6)
    .map((k) => `<div style="color:${k.color}">${k.text}</div>`).join('');
  el.radio.innerHTML = S.radioLog.filter((r) => S.time - r.t < 7)
    .map((r) => `<div class="${r.team === p.team ? 'own' : 'foe'}">⌁ ${r.text}</div>`).join('');
  // banner fade
  if (S.time > bannerUntil) el.banner.style.opacity = '0';
  // channel bar (plant / defuse)
  const ch = S.playerChannel;
  if (ch) {
    el.channel.style.display = 'block';
    el['channel-label'].textContent = ch.kind === 'plant' ? 'PLANTING THE CHARGE…' : 'DEFUSING…';
    const frac = ch.kind === 'defuse' && S.bomb ? S.bomb.defuseT / (S.player.hasKit ? CFG.defuseKitTime : CFG.defuseTime) : ch.frac;
    el['channel-fill'].style.width = `${Math.min(100, frac * 100)}%`;
  } else if (planted || (S.bomb && S.bomb.state === 'defusing')) {
    el.channel.style.display = 'none';
  } else el.channel.style.display = 'none';
  // objective line
  el.objective.textContent = objectiveText(p, planted);
  // scope / spectate / flashes
  el.scope.style.display = S.scoped ? 'block' : 'none';
  el.spectate.style.display = !p.alive && inGame ? 'block' : 'none';
  if (!p.alive && S.spectating) el.spectate.textContent = `SPECTATING ${S.spectating}`;
  el.flash.style.opacity = String(Math.min(1, S.playerFlash || 0));
  const hurt = S.time - (p.lastDamageAt || -9) < 0.35;
  el.vignette.style.opacity = String(!p.alive ? 0.55 : p.hp <= 30 ? 0.4 : hurt ? 0.45 : 0);
  drawMinimap();
}

function objectiveText(p, planted) {
  if (!p.alive) return '';
  if (S.phase === PHASE.END) return '';
  if (S.phase === PHASE.BUY) return 'BUY PHASE — press the number keys to equip';
  if (planted) return teamRole(p.team) === 'DEF' ? 'CHARGE PLANTED — defuse it (hold E)' : 'CHARGE PLANTED — hold the site';
  if (p.hasCharge) return 'You carry the CHARGE — hold E inside site A or B to plant';
  if (S.bomb && S.bomb.state === 'dropped') return 'The CHARGE is down — recover it';
  return teamRole(p.team) === 'ATK' ? 'Plant the charge at A or B — or eliminate the Sentinels' : 'Hold the sites — stop the plant';
}

const mm = { ctx: null };
function drawMinimap() {
  const cvs = el.minimap;
  if (!cvs) return;
  if (!mm.ctx) mm.ctx = cvs.getContext('2d');
  const g = mm.ctx;
  const SX = cvs.width / 96, SZ = cvs.height / 72;
  const px = (x) => (x + 48) * SX, pz = (z) => (z + 36) * SZ;
  g.fillStyle = 'rgba(16,20,22,0.82)';
  g.fillRect(0, 0, cvs.width, cvs.height);
  g.fillStyle = 'rgba(220,200,160,0.20)';
  for (const c of W.colliders) {
    if (c.y1 < 1.6) continue;
    g.fillRect(px(c.x0), pz(c.z0), (c.x1 - c.x0) * SX, (c.z1 - c.z0) * SZ);
  }
  for (const key of ['A', 'B']) {
    const s = W.sites[key];
    g.strokeStyle = '#f0a830'; g.lineWidth = 1.4;
    g.beginPath(); g.arc(px(s.x), pz(s.z), s.r * SX, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f0a830'; g.font = 'bold 10px monospace';
    g.fillText(key, px(s.x) - 3, pz(s.z) + 3);
  }
  const p = S.player;
  // spotted enemies: seen by a teammate now, or heard firing in the last 3 s
  for (const e of S.agents) {
    if (!e.alive || e.team === p.team) continue;
    let show = null;
    for (const mate of S.agents) {
      if (mate.alive && mate.team === p.team && mate.brain && mate.brain.seen === e) { show = e; break; }
    }
    if (!show) {
      for (const n of S.noises) {
        if (n.team === e.team && n.type === 'shot' && S.time - n.t < 3 && Math.hypot(n.x - e.x, n.z - e.z) < 3) { show = e; break; }
      }
    }
    if (show) {
      g.fillStyle = '#e5484d';
      g.beginPath(); g.arc(px(e.x), pz(e.z), 3, 0, Math.PI * 2); g.fill();
    }
  }
  for (const a of S.agents) {
    if (!a.alive || a.team !== p.team || a.isPlayer) continue;
    g.fillStyle = '#35c4d8';
    g.beginPath(); g.arc(px(a.x), pz(a.z), 2.6, 0, Math.PI * 2); g.fill();
  }
  if (S.bomb && (S.bomb.state === 'dropped' || S.bomb.state === 'planted' || S.bomb.state === 'defusing')) {
    g.fillStyle = '#ff5a3a';
    g.fillRect(px(S.bomb.x) - 3, pz(S.bomb.z) - 3, 6, 6);
  }
  // the player as a dot with a facing tick (forward is -sin yaw, -cos yaw)
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(px(p.x), pz(p.z), 3.4, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(px(p.x), pz(p.z));
  g.lineTo(px(p.x) - Math.sin(p.yaw) * 8, pz(p.z) - Math.cos(p.yaw) * 8);
  g.stroke();
  g.lineWidth = 1;
}
