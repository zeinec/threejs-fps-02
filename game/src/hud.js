// Fifth fix pass: populate the existing shop card grid and hint.
// Second integration fix pass: leave buy-menu key ownership with main input.
// Integration fix: align HUD visibility and labels with shared game state.
// hud.js — DOM HUD, overlays, and buy menu for GLASSHOUSE.
import { SHOP } from './economy.js';

const byId = (id) => typeof document !== 'undefined' ? document.getElementById(id) : null;
const cache = new WeakMap();
const write = (el, key, value, setter) => {
  if (!el) return;
  let values = cache.get(el);
  if (!values) { values = Object.create(null); cache.set(el, values); }
  if (values[key] === value) return;
  values[key] = value;
  setter();
};
const setText = (el, value) => write(el, 'text', String(value ?? ''), () => { el.textContent = String(value ?? ''); });
const setClass = (el, name, on) => write(el, `class:${name}`, Boolean(on), () => el.classList.toggle(name, Boolean(on)));
const setStyle = (el, name, value) => write(el, `style:${name}`, String(value), () => el.style.setProperty(name, String(value)));
const show = (el, visible) => { if (el) el.classList.toggle('hidden', !visible); };

const elements = () => ({
  game: byId('game'), hud: byId('hud'), crosshair: byId('crosshair'), hitmarker: byId('hitmarker'),
  ammoMag: byId('ammo-mag'), ammoReserve: byId('ammo-reserve'), weaponName: byId('weapon-name'),
  healthNum: byId('health-num'), healthBar: byId('health-bar'), armorPips: byId('armor-pips'),
  money: byId('money'), timer: byId('timer'), scorePruners: byId('score-pruners'), scoreKeepers: byId('score-keepers'),
  alivePruners: byId('alive-pruners'), aliveKeepers: byId('alive-keepers'), killfeed: byId('killfeed'),
  bombStatus: byId('bomb-status'), damageDir: byId('damage-dir'), lowhp: byId('lowhp'),
  overlayStart: byId('overlay-start'), play: byId('play'), overlayRound: byId('overlay-round'),
  roundTitle: byId('round-title'), roundSub: byId('round-sub'), overlayMatch: byId('overlay-match'),
  matchTitle: byId('match-title'), rematch: byId('rematch'), buyMenu: byId('buy-menu'),
});

function itemId(item) { return item.id ?? item.itemId ?? item.key ?? ''; }
function itemName(item) { return item.name ?? item.label ?? item.id ?? 'Item'; }
function itemPrice(item) { return Number(item.price ?? item.cost ?? 0); }
function itemHint(item) { return item.hint ?? item.keyHint ?? item.key ?? ''; }

export function createHud(callbacks = {}) {
  const els = elements();
  if (els.play) els.play.addEventListener('click', () => callbacks.onPlay?.());
  if (els.rematch) els.rematch.addEventListener('click', () => callbacks.onRematch?.());
  if (els.buyMenu) {
    const list = els.buyMenu.querySelector('#shop-grid');
    list.replaceChildren();
    for (const item of SHOP) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.itemId = itemId(item);
      button.className = 'shop-item';
      const label = document.createElement('strong'); label.textContent = itemName(item);
      const price = document.createElement('span'); price.textContent = `${itemPrice(item)} CR`;
      const hint = document.createElement('span'); hint.textContent = itemHint(item);
      button.append(label, price, hint);
      button.addEventListener('click', () => callbacks.onBuy?.(itemId(item)));
      list.appendChild(button);
    }
    const close = els.buyMenu.querySelector('[data-close-buy]');
    if (close) close.addEventListener('click', () => callbacks.onCloseBuy?.());
  }
  return { elements: els };
}

function actorAlive(a) { return a?.alive !== false; }
function teamDots(el, actors, team, color) {
  if (!el) return;
  const alive = (actors ?? []).filter((a) => a.team === team && actorAlive(a));
  const signature = `${alive.length}:${alive.map((a) => a.id).join(',')}:${color}`;
  write(el, 'dots', signature, () => {
    el.replaceChildren();
    for (const actor of alive) {
      const dot = document.createElement('i'); dot.className = 'alive-dot'; dot.style.backgroundColor = color;
      dot.setAttribute('aria-label', actor.name ?? team); el.appendChild(dot);
    }
  });
}
function timerString(seconds) {
  const safe = Math.max(0, Math.ceil(Number(seconds) || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
function eventAge(event, state) {
  const now = Number(state.time ?? 0);
  const at = Number(event.time ?? event.at ?? event.timestamp ?? now);
  return Math.max(0, now - at);
}
function humanActor(state) { return (state.actors ?? []).find((actor) => actor.isHuman); }

export function updateHud(state, ctx = {}) {
  const els = elements();
  if (state._hudBannerUntil != null && Number(state.time ?? 0) >= state._hudBannerUntil) {
    show(els.overlayRound, false);
    state._hudBannerUntil = null;
  }
  const human = humanActor(state);
  if (!human) return;
  const weapon = human.weaponId ?? '';
  const ammo = `${human.magAmmo ?? 0}`;
  setText(els.ammoMag, ammo); setText(els.ammoReserve, human.reserveAmmo ?? 0); setText(els.weaponName, weapon);
  const hp = Math.max(0, Number(human.hp) || 0);
  setText(els.healthNum, Math.ceil(hp));
  setStyle(els.healthBar, 'width', `${Math.max(0, Math.min(100, hp / (human.maxHp || 100) * 100))}%`);
  setClass(els.healthBar, 'low-health', hp < 30); setClass(els.lowhp, 'active', hp < 30);
  if (els.lowhp) setStyle(els.lowhp, 'opacity', hp < 30 ? String(0.2 + 0.16 * (0.5 + 0.5 * Math.sin((Number(state.time) || 0) * 7))) : '0');
  const pipCount = Math.max(0, Math.ceil((Number(human.armor) || 0) / 25));
  if (els.armorPips) write(els.armorPips, 'pips', pipCount, () => {
    els.armorPips.replaceChildren();
    for (let i = 0; i < pipCount; i += 1) { const pip = document.createElement('i'); pip.className = 'armor-pip'; els.armorPips.appendChild(pip); }
  });
  setText(els.money, `$${state.playerMoney ?? 0}`);
  const remaining = state.phase === 'freeze' ? state.freezeTimer : state.roundTimer;
  setText(els.timer, timerString(remaining)); setClass(els.timer, 'urgent', Number(remaining) < 10);
  setText(els.scorePruners, state.scores?.pruners ?? 0); setText(els.scoreKeepers, state.scores?.keepers ?? 0);
  teamDots(els.alivePruners, state.actors, 'pruners', '#e2543e');
  teamDots(els.aliveKeepers, state.actors, 'keepers', '#3fa796');

  const bloom = Number(human.bloom ?? human.spreadBloom ?? 0);
  const movement = Number(human.movementSpread ?? human.moveSpread ?? (human.vel ? Math.hypot(human.vel.x ?? 0, human.vel.z ?? 0) * 0.18 : 0));
  setStyle(els.crosshair, '--gap', `${6 + bloom + movement}px`);
  const hit = (state.events ?? []).filter((e) => e.type === 'hit' && (e.actorId === human.id || e.targetId === human.id || e.humanId === human.id) && eventAge(e, state) <= 0.09).at(-1);
  show(els.hitmarker, Boolean(hit));
  if (els.hitmarker) setClass(els.hitmarker, 'visible', Boolean(hit));

  if (els.killfeed) {
    const recent = (state.killfeed ?? []).filter((entry) => eventAge(entry, state) <= 5).slice(-4).reverse();
    const signature = recent.map((entry) => `${entry.time ?? entry.at}:${entry.killer ?? entry.killerName}:${entry.victim ?? entry.victimName}:${entry.weapon}`).join('|');
    write(els.killfeed, 'entries', signature, () => {
      els.killfeed.replaceChildren();
      for (const entry of recent) {
        const row = document.createElement('div'); row.className = 'killfeed-entry';
        row.textContent = `${entry.killerName ?? entry.killer ?? '—'}  ›  ${entry.victimName ?? entry.victim ?? '—'}${entry.weapon ? `  ${entry.weapon}` : ''}`;
        row.style.opacity = String(Math.max(0.1, 1 - eventAge(entry, state) / 5)); els.killfeed.appendChild(row);
      }
    });
  }
  const spike = state.spike ?? {};
  if (els.bombStatus) {
    if (spike.status === 'planted') {
      const fraction = Math.max(0, Math.min(1, (Number(spike.fuse) || 0) / 40));
      setText(els.bombStatus, `CANISTER PLANTED · ${Math.ceil(spike.fuse ?? 0)}s`);
      setStyle(els.bombStatus, '--fuse', `${fraction * 100}%`); show(els.bombStatus, true);
    } else if (Number(spike.plantProgress) > 0 && Number(spike.plantProgress) < 1) {
      setText(els.bombStatus, `Planting · ${Math.round(spike.plantProgress * 100)}%`); setStyle(els.bombStatus, '--progress', `${spike.plantProgress * 100}%`); show(els.bombStatus, true);
    } else if (Number(spike.defuseProgress) > 0 && Number(spike.defuseProgress) < 1) {
      setText(els.bombStatus, `Defusing · ${Math.round(spike.defuseProgress * 100)}%`); setStyle(els.bombStatus, '--progress', `${spike.defuseProgress * 100}%`); show(els.bombStatus, true);
    } else if (spike.carrierId === human.id) { setText(els.bombStatus, 'CANISTER CARRIER'); show(els.bombStatus, true); }
    else show(els.bombStatus, false);
  }
  const damage = (state.events ?? []).filter((e) => e.type === 'damaged' && (e.actorId === human.id || e.victimId === human.id) && e.direction != null && eventAge(e, state) <= 0.8).at(-1);
  if (els.damageDir) {
    show(els.damageDir, Boolean(damage));
    if (damage) { const angle = Number(typeof damage.direction === 'number' ? damage.direction : Math.atan2(damage.direction.x ?? 0, damage.direction.z ?? 1) * 180 / Math.PI); setStyle(els.damageDir, 'transform', `rotate(${angle}deg)`); setStyle(els.damageDir, 'opacity', String(Math.max(0, 1 - eventAge(damage, state) / 0.8))); }
  }
  if (els.buyMenu && state.phase === 'freeze') setText(els.buyMenu.querySelector('#buy-hint'), 'Press B to buy — freeze time');
  if (els.buyMenu && !els.buyMenu.hidden) refreshBuyButtons(state, human, els.buyMenu);
}

function refreshBuyButtons(state, human, menu) {
  for (const item of SHOP) {
    const button = menu.querySelector(`[data-item-id="${itemId(item)}"]`);
    if (!button) continue;
    const owned = itemId(item) === human.weaponId || itemId(item) === 'pistol' && human.weaponId === 'dibber';
    const affordable = Number(state.playerMoney ?? 0) >= itemPrice(item);
    button.disabled = !owned && !affordable;
    button.classList.toggle('owned', owned);
    button.classList.toggle('unaffordable', !owned && !affordable);
  }
}

export function openBuyMenu(state) {
  const menu = byId('buy-menu');
  show(menu, true);
  const human = humanActor(state);
  if (menu && human) refreshBuyButtons(state, human, menu);
}

export function closeBuyMenu() { show(byId('buy-menu'), false); }

export function showBanner(state, title, sub) {
  const els = elements();
  setText(els.roundTitle, title); setText(els.roundSub, sub);
  show(els.overlayRound, true);
  state._hudBannerUntil = Number(state.time ?? 0) + 4;
}

export function showMatchEnd(state, winnerTeam) {
  const els = elements();
  const winner = winnerTeam === 'pruners' ? 'PRUNERS' : 'KEEPERS';
  setText(els.matchTitle, `${winner} WIN · ${state.scores?.pruners ?? 0}–${state.scores?.keepers ?? 0}`);
  show(els.overlayMatch, true);
}
