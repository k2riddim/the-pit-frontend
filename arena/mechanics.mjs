import { ITEMS, WEAPONS } from './content.mjs';

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const distance2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const active = (fighter, name) => Boolean(fighter.statuses?.[name]);

/** Shared physical stats: the renderer, studies and simulation see one contract. */
export function expandedCombatStats(f) {
  const weapon = WEAPONS[f.weapon ?? (f.equipment === 'mallet' ? 0 : -1)];
  const penalty = (active(f, 'stink') ? 2 : 0) + (active(f, 'devoted') ? 1 : 0)
    + (active(f, 'reach') ? f.reachPowerCost ?? 0 : 0) + (active(f, 'escort') ? f.escortPowerCost ?? 1 : 0);
  const power = active(f, 'feint') ? f.feintPower ?? 1 : 0;
  let speed = f.equipment === 'wheels' ? 76 : 65;
  if (active(f, 'magnet')) speed -= f.magnetSpeedCost ?? 0;
  if (active(f, 'perch')) speed -= f.perchSpeedCost ?? 0;
  if (active(f, 'brace')) speed -= f.braceSpeedCost ?? 0;
  if (active(f, 'anchor')) speed -= f.anchorSpeedCost ?? 0;
  if (active(f, 'parry') && f.parryCharges > 0) speed -= f.parrySpeedCost ?? 0;
  if (active(f, 'platform')) speed -= f.platformSpeedCost ?? 7;
  if (active(f, 'escort')) speed += f.escortSpeed ?? 9;
  if (active(f, 'slow')) speed = Math.floor(speed * .65);
  const extraWindup = (active(f, 'feint') ? f.feintWindup ?? 3 : 0)
    + (active(f, 'tempo') ? f.tempoWindup ?? 3 : 0) + (active(f, 'charge') ? f.chargeWindup ?? 3 : 0);
  return {
    minPower: clamp((weapon?.min ?? 4) - penalty + power, 1, 14), maxPower: clamp((weapon?.max ?? 7) - penalty + power, 1, 18),
    speed: clamp(speed, 28, 95), shield: f.shield ?? 0,
    reach: clamp((weapon?.reach ?? 690) + (active(f, 'reach') ? f.reachBonus ?? 0 : 0) + (active(f, 'perch') ? f.perchReach ?? 0 : 0), 400, 1250),
    windup: clamp((weapon?.windup ?? 7) + extraWindup, 4, 24),
    recovery: clamp((weapon?.recovery ?? 9) - (active(f, 'coffee') ? 4 : 0) - (active(f, 'tempo') ? f.tempoRecovery ?? 4 : 0), 4, 20),
    pickupRadius: active(f, 'magnet') ? clamp(f.magnetRadius ?? 610, 400, 800) : 400,
    push: clamp((weapon?.push ?? 0) + (active(f, 'charge') ? f.chargePush ?? 180 : 0), 0, 500),
  };
}

export function mechanicSnapshot(f) {
  return { x: f.x, y: f.y, hp: f.hp, stamina: f.stamina, ...expandedCombatStats(f), equipment: f.equipment ?? null,
    weapon: f.weapon ?? null, statuses: { ...f.statuses }, parryCharges: active(f, 'parry') ? f.parryCharges ?? 0 : 0,
    dustCharges: active(f, 'dustguard') ? f.dustCharges ?? 0 : 0, markTarget: active(f, 'mark') ? f.markTarget ?? null : null };
}

export function pushMultiplier(f) { return active(f, 'anchor') ? clamp(f.anchorFactor ?? 100, 20, 100) / 100 : 1; }

/** Called by resolveDamage; collapse deliberately bypasses every protection. */
export function expandedProtection(f, amount, cause, tick) {
  if (cause === 'collapse') return { reduction: 0, busy: 0 };
  let reduction = 0, busy = 0;
  if (active(f, 'brace') && f.pose === 'windup') reduction += f.braceReduction ?? 2;
  if (active(f, 'perch')) reduction += f.perchProtection ?? 0;
  if (active(f, 'platform')) reduction += f.platformReduction ?? 1;
  if (active(f, 'parry') && f.parryCharges > 0 && cause === 'attack' && amount <= (f.parryThreshold ?? 7)) {
    f.parryCharges--; reduction += f.parryReduction ?? 3; busy = f.parryBusy ?? 0;
    if (f.parryCharges === 0) delete f.statuses.parry;
  }
  if (active(f, 'dustguard') && f.dustCharges > 0 && ['dust', 'site'].includes(cause)) {
    f.dustCharges--; reduction += f.dustReduction ?? 4;
    if (f.dustCharges === 0) delete f.statuses.dustguard;
  }
  return { reduction: Math.min(10, reduction), busy };
}

export function warningReactionBonus(f, threat, floorThreat) {
  let bonus = active(f, 'read') ? f.readBonus ?? 12 : 0;
  if (active(f, 'alert') && (f.alertKind === 'both' || f.alertKind === 'attack' && threat || f.alertKind === 'hazard' && floorThreat)) bonus += f.alertBonus ?? 20;
  if (active(f, 'beacon')) bonus += f.beaconBonus ?? 20;
  return Math.min(45, bonus);
}

export function pursuitBonus(f, foe) {
  return (active(f, 'mark') && f.markTarget === foe.id ? f.markBonus ?? 100 : 0)
    + (active(foe, 'taunt') ? foe.tauntBonus ?? 80 : 0);
}

export function canBeFooled(f, decoy, preferences) {
  return !active(f, 'focus') && (decoy.fake ? preferences.greed > 60 : preferences.novelty > 60);
}
export function canCollectCoin(f, coin) {
  return f.hp > 0 && !['hiding', 'evade', 'channel'].includes(f.pose) && !active(f, 'roll')
    && coin.owner === null && distance2(f, coin) < expandedCombatStats(f).pickupRadius ** 2;
}

function status(f, name, tick, duration) {
  f.statuses ??= {}; f.statuses[name] = Math.max(f.statuses[name] ?? 0, tick + Math.max(1, duration));
}
function shove(ctx, f, origin, amount) {
  if (f.hp <= 0 || amount <= 0) return;
  const dx = f.x - origin.x || (f.id % 2 ? 1 : -1), dy = f.y - origin.y;
  const norm = Math.max(Math.abs(dx), Math.abs(dy), 1), step = Math.round(amount * pushMultiplier(f));
  if (step > 0) ctx.move(f, { x: f.x + Math.round(dx * step / norm), y: f.y + Math.round(dy * step / norm) }, ctx.map.props, step);
}
function targetFor(f, ctx, range) {
  return (ctx.fighters ?? []).filter(other => other.id !== f.id && other.hp > 0 && distance2(other, f) < range ** 2)
    .sort((a, b) => distance2(a, f) - distance2(b, f) || a.id - b.id)[0];
}
function addZone(f, prop, ctx, kind, params, point = prop) {
  const zone = { id: ctx.zones.length, kind, shape: 'circle', x: point.x, y: point.y, owner: f.id,
    radius: params.radius, start: ctx.tick, impact: ctx.tick + (params.delay ?? 0),
    until: ctx.tick + (kind === 'pulse' ? params.delay + 5 : params.duration), amount: params.damage ?? 0,
    push: params.push ?? 0, propId: prop.id, propType: prop.type, effect: ITEMS[prop.type].effect,
    ...(params.period ? { period: params.period, on: params.on } : {}),
    ...(params.slow ? { slow: params.slow } : {}), ...(params.bonus ? { bonus: params.bonus } : {}),
    ...(params.reduction ? { reduction: params.reduction, speedCost: params.speedCost } : {}),
  };
  ctx.zones.push(zone); return zone;
}

/** Apply only the new declared families. No RNG, damage resolution or accounting. */
export function applyExpandedItem(f, prop, ctx) {
  const item = ITEMS[prop.type], p = item?.mechanic;
  if (!p || f.hp <= 0) return null;
  const effect = item.effect, before = mechanicSnapshot(f), stateBefore = JSON.stringify(f), affected = [];
  const result = { effect, applied: false, outcome: 'neutral', affected };
  const changedTarget = (target, mutate, outcome = 'negative') => {
    const old = mechanicSnapshot(target); mutate(target); const after = mechanicSnapshot(target);
    if (JSON.stringify(old) !== JSON.stringify(after)) affected.push({ id: target.id, before: old, after, outcome });
  };
  const timed = (name = effect) => status(f, name, ctx.tick, p.duration);
  if (effect === 'magnet') { timed(); f.magnetRadius = p.radius; f.magnetSpeedCost = p.speedCost; result.outcome = p.speedCost || p.radius < before.pickupRadius ? 'mixed' : 'positive'; }
  else if (effect === 'reach') { timed(); f.reachBonus = p.reach; f.reachPowerCost = p.powerCost; result.outcome = 'mixed'; }
  else if (effect === 'perch') { timed(); f.perchReach = p.reach; f.perchSpeedCost = p.speedCost; f.perchProtection = p.protection; result.outcome = 'mixed'; }
  else if (effect === 'snip') { if (f.statuses?.slow) { delete f.statuses.slow; f.immuneUntil = Math.max(f.immuneUntil ?? 0, ctx.tick + 40); result.outcome = 'positive'; } }
  else if (effect === 'alert') { const changingFocus = active(f, 'alert') && f.alertKind !== p.kind; timed(); f.alertBonus = p.bonus; f.alertKind = p.kind; result.outcome = changingFocus ? 'mixed' : 'positive'; }
  else if (effect === 'focus') { timed(); result.outcome = 'positive'; }
  else if (effect === 'read') { timed(); f.readBonus = p.bonus; f.readCounter = p.counter; result.outcome = 'positive'; }
  else if (effect === 'brace') { timed(); f.braceReduction = p.reduction; f.braceSpeedCost = p.speedCost; result.outcome = 'mixed'; }
  else if (effect === 'mark') {
    const target = targetFor(f, ctx, p.range);
    if (target) { timed(); f.markTarget = target.id; f.markBonus = p.bonus; result.target = target.id; }
  } else if (effect === 'taunt') { timed(); f.tauntBonus = p.bonus; f.shield = Math.max(f.shield ?? 0, p.shield); result.outcome = f.shield > before.shield ? 'mixed' : 'negative'; }
  else if (effect === 'feint') { timed(); f.feintPower = p.power; f.feintWindup = p.windup; result.outcome = 'mixed'; }
  else if (effect === 'tempo') { timed(); f.tempoWindup = p.windup; f.tempoRecovery = p.recovery; result.outcome = 'mixed'; }
  else if (effect === 'anchor') { timed(); f.anchorFactor = p.factor; f.anchorSpeedCost = p.speedCost; result.outcome = 'mixed'; }
  else if (effect === 'parry') {
    const replacesStrongerGuard = active(f, 'parry') && (p.threshold < (f.parryThreshold ?? 0) || p.reduction < (f.parryReduction ?? 0));
    timed(); f.parryCharges = Math.max(before.parryCharges, p.charges); f.parryThreshold = p.threshold;
    f.parryReduction = p.reduction; f.parrySpeedCost = p.speedCost; f.parryBusy = p.busy; result.outcome = p.speedCost || p.busy || replacesStrongerGuard ? 'mixed' : 'positive';
  } else if (effect === 'dustguard') { timed(); f.dustCharges = Math.max(before.dustCharges, p.charges); f.dustReduction = p.reduction; result.outcome = 'positive'; }
  else if (effect === 'charge') { timed(); f.chargePush = p.push; f.chargeWindup = p.windup; result.outcome = 'mixed'; }
  else if (effect === 'escort') { timed(); f.escortSpeed = p.speed; f.escortPowerCost = p.powerCost; f.shield = Math.max(f.shield ?? 0, p.shield); result.outcome = 'mixed'; }
  else if (effect === 'snare') {
    const target = targetFor(f, ctx, p.range);
    if (target) {
      changedTarget(target, other => status(other, 'slow', ctx.tick, p.slow));
      const previousSlow = f.statuses?.slow ?? 0; status(f, 'slow', ctx.tick, p.selfSlow);
      const selfCost = f.statuses.slow > previousSlow, targetChanged = affected.length > 0;
      result.outcome = targetChanged ? selfCost ? 'mixed' : 'positive' : selfCost ? 'negative' : 'neutral'; result.target = target.id;
    }
  } else if (effect === 'shove' || effect === 'door') {
    const target = targetFor(f, ctx, p.range);
    if (target) { const origin = { x: target.x, y: target.y }; changedTarget(target, other => shove(ctx, other, f, p.push)); if (p.recoil) shove(ctx, f, origin, p.recoil); result.target = target.id; }
    if (effect === 'door') { status(f, 'stink', ctx.tick, p.stink); result.outcome = 'repulsive'; }
  } else if (effect === 'projectile') {
    const target = targetFor(f, ctx, p.range); result.zone = { ...addZone(f, prop, ctx, 'pulse', p, target ?? prop) }; result.applied = true;
  } else if (['platform', 'beacon', 'pulse-zone', 'barricade'].includes(effect)) {
    result.zone = { ...addZone(f, prop, ctx, effect === 'pulse-zone' || effect === 'barricade' ? 'slow-pulse' : effect, p) }; result.applied = true;
    if (p.shield) { f.shield = Math.max(f.shield ?? 0, p.shield); result.outcome = 'mixed'; }
  } else if (effect === 'rush') {
    status(f, 'roll', ctx.tick, p.duration + 1); f.until = ctx.tick + 1; f.immuneUntil = ctx.tick + p.duration + 20;
    f.rollGoal = { x: clamp(f.x + (f.goal?.x - f.x || 500) * 5, 900, 9100), y: clamp(f.y + (f.goal?.y - f.y || 300) * 5, 900, 9100) };
    f.shield = Math.max(f.shield ?? 0, p.shield); result.outcome = 'mixed';
  } else if (effect === 'coin-snare') {
    result.movedCoins = [];
    for (const coin of ctx.map.coins.filter(coin => coin.owner === null && distance2(coin, prop) < p.range ** 2).slice(0, p.count)) {
      const from = { x: coin.x, y: coin.y }; coin.x = f.x; coin.y = f.y; result.movedCoins.push(coin.id);
      ctx.emit?.(ctx.tick, 'coin-moved', f.id, null, { coinId: coin.id, from, to: { x: coin.x, y: coin.y } });
    }
    if (result.movedCoins.length) { status(f, 'slow', ctx.tick, p.slow); result.applied = true; result.outcome = 'mixed'; }
  } else if (effect === 'fake') {
    const decoy = { id: ctx.decoys.length, x: f.x, y: f.y, owner: f.id, art: item.art, until: ctx.tick + p.duration, fake: true, propId: prop.id, propType: prop.type };
    ctx.decoys.push(decoy); result.decoy = { ...decoy }; result.applied = true;
  } else throw new RangeError(`Missing expanded mechanic: ${effect}`);
  result.applied ||= stateBefore !== JSON.stringify(f) || affected.length > 0;
  if (!result.applied) result.outcome = 'neutral';
  return result;
}

/** One deterministic tick for expanded zones; studies invoke this same helper. */
export function updateExpandedStatuses(ctx) {
  const { tick, fighters, zones } = ctx;
  for (const f of fighters) if (f.hp > 0) for (const [name, expiry] of Object.entries(f.statuses ?? {})) if (expiry <= tick) delete f.statuses[name];
  const orderedZones = [...zones].sort((a, b) => a.id - b.id);
  // Freeze every simultaneous landing before any of them moves a fighter.
  const landings = orderedZones.filter(zone => zone.kind === 'pulse' && tick === zone.impact && !zone.impacted).map(zone => ({ zone,
    targets: fighters.filter(f => f.hp > 0 && distance2(f, zone) < zone.radius ** 2).sort((a, b) => a.id - b.id).map(f => ({ f, before: mechanicSnapshot(f) })),
  }));
  const pushes = new Map();
  for (const { zone, targets } of landings) {
    zone.impacted = true;
    for (const { f, before } of targets) {
      const dx = before.x - zone.x || (f.id % 2 ? 1 : -1), dy = before.y - zone.y, norm = Math.max(Math.abs(dx), Math.abs(dy), 1);
      const prior = pushes.get(f.id) ?? { x: 0, y: 0 };
      prior.x += Math.round(dx * zone.push / norm); prior.y += Math.round(dy * zone.push / norm); pushes.set(f.id, prior);
      ctx.damage(f.id, zone.amount, zone.owner, 'site');
    }
  }
  for (const f of fighters) {
    const push = pushes.get(f.id);
    if (push && (push.x || push.y)) ctx.move(f, { x: f.x + push.x, y: f.y + push.y }, ctx.map.props,
      Math.round(Math.min(400, Math.max(Math.abs(push.x), Math.abs(push.y))) * pushMultiplier(f)));
  }
  for (const { zone, targets } of landings) {
    const affected = targets.map(({ f, before }) => ({ id: f.id, before, after: mechanicSnapshot(f), outcome: 'negative' }));
    ctx.emit?.(tick, 'mechanic-hit', zone.owner, null, { propId: zone.propId, propType: zone.propType, x: zone.x, y: zone.y,
      effect: zone.effect, applied: affected.length > 0, outcome: 'neutral', affected, zone: { ...zone } });
  }
  for (const zone of orderedZones) {
    if (!(zone.until > tick) || !['slow-pulse', 'platform', 'beacon'].includes(zone.kind)) continue;
    for (const f of fighters) {
      if (f.hp <= 0 || distance2(f, zone) >= zone.radius ** 2) continue;
      if (zone.kind === 'slow-pulse') {
        const on = !zone.period || (tick - zone.start) % zone.period < zone.on;
        if (on && tick >= (f.until ?? 0) && f.pose !== 'hiding' && (f.immuneUntil ?? 0) <= tick) { status(f, 'slow', tick, zone.slow ?? 12); f.immuneUntil = tick + 40; }
      } else if (zone.kind === 'platform') {
        status(f, 'platform', tick, 2); f.platformReduction = zone.reduction; f.platformSpeedCost = zone.speedCost;
      } else { status(f, 'beacon', tick, 2); f.beaconBonus = zone.bonus; }
    }
  }
}
