// economy.js — player money, round rewards, and the buy shop.
import { WEAPONS } from './weapons.js';

export const SHOP = [
  { id: 'dibber', name: 'Dibber Pistol', price: 0, kind: 'weapon' },
  { id: 'aphid', name: 'Aphid SMG', price: 1500, kind: 'weapon' },
  { id: 'secateur', name: 'Secateur Rifle', price: 2700, kind: 'weapon' },
  { id: 'kevlar', name: 'Kevlar Vest', price: 650, kind: 'armor' },
  { id: 'kit', name: 'Defuse Kit', price: 400, kind: 'kit' },
  { id: 'flash', name: 'Flash Grenade', price: 200, kind: 'grenade' },
  { id: 'smoke', name: 'Smoke Grenade', price: 300, kind: 'grenade' },
];

function weaponAmmo(weaponId) {
  const weapon = WEAPONS[weaponId];
  if (!weapon) return { magAmmo: 0, reserveAmmo: 0 };
  return {
    magAmmo: weapon.magSize ?? weapon.mag ?? 0,
    reserveAmmo: weapon.reserveAmmo ?? weapon.reserve ?? 0,
  };
}

export function buyItem(state, actor, itemId) {
  const item = SHOP.find((entry) => entry.id === itemId);
  if (!item || !actor?.isHuman || state.playerMoney < item.price) return false;

  state.playerMoney -= item.price;
  if (item.kind === 'weapon') {
    actor.weaponId = item.id;
    const ammo = weaponAmmo(item.id);
    actor.magAmmo = ammo.magAmmo;
    actor.reserveAmmo = ammo.reserveAmmo;
    actor.reloading = false;
  } else if (item.kind === 'armor') {
    actor.armor = 100;
  } else if (item.kind === 'kit') {
    actor.hasKit = true;
  } else if (item.kind === 'grenade') {
    actor.grenades[item.id] = 1;
  }
  return true;
}

export function awardKill(state, killerId) {
  if (killerId === 'human') state.playerMoney += 300;
}

export function awardRound(state, winnerTeam) {
  if (winnerTeam === 'pruners') {
    state.playerMoney += 3250;
    state.lossStreak = 0;
    return;
  }
  state.playerMoney += 1900 + Math.min(500 * state.lossStreak, 1500);
  state.lossStreak += 1;
}

export function canAfford(state, itemId) {
  const item = SHOP.find((entry) => entry.id === itemId);
  return Boolean(item && state.playerMoney >= item.price);
}
