import { HZ, TICKS, FINAL_COLLAPSE_TICK, combatStats } from './core.mjs';

import { ITEMS, WEAPONS } from './content.mjs';
import { ITEM_EVENTS, classifyInteraction, interactionEvidence, interactionEvents } from './interaction-feedback.mjs';
import { describeUltimateEvent, ULTIMATES } from './ultimate-system.mjs';
export { ITEMS };

export { ITEM_EVENTS };
const FIGHTER_EVENTS = new Set(['khole','shelter-closed','last-stand']);
const ULTIMATE_CARDS = new Set(['ultimate-cast', 'ultimate-heal', 'ultimate-guard', 'ultimate-snare', 'ultimate-cancel']);
const ultimateEvent = event => event.type.startsWith('ultimate-');
const signed = n => `${n > 0 ? '+' : ''}${n}`;
const EXPANDED_TITLES = {
  magnet: 'COIN PULL', snare: 'SNARE SET', reach: 'EXTRA REACH', perch: 'HIGH GROUND', snip: 'SNIPPED FREE', alert: 'ALERT',
  focus: 'FOCUSED', brace: 'BRACED', read: 'READING THE FIGHT', mark: 'TARGET MARKED', taunt: 'TAUNT', feint: 'FEINT',
  parry: 'PARRY READY', tempo: 'TEMPO UP', anchor: 'ANCHORED', shove: 'SHOVE', projectile: 'RANGED SHOT', escort: 'ESCORT',
  platform: 'PLATFORM SET', rush: 'RUSH', 'coin-snare': 'COIN SNARE', 'pulse-zone': 'PULSE SET', fake: 'FALSE BAIT',
  barricade: 'BARRICADE SET', beacon: 'BEACON SET', door: 'DOOR PLAY', dustguard: 'DEBRIS COVER', charge: 'CHARGED',
};

function describeMechanic(event, replay) {
  const value = event.value ?? {}, before = value.before ?? {}, after = value.after ?? {};
  const item = ITEMS[value.propType] ?? ITEMS[replay.map?.props?.find(prop => prop.id === value.propId)?.type];
  const classification = classifyInteraction(event);
  const tone = classification.kind === 'positive' ? 'good' : classification.kind === 'negative' ? 'bad' : 'neutral';
  if (value.applied === false) return { title: 'NO CHANGE', detail: `${item?.name ?? 'The object'}: no effect applied in this situation.`, tone: 'neutral', priority: 3 };
  const details = [];
  for (const [key, label] of [['hp', 'health'], ['stamina', 'stamina'], ['shield', 'protection charges'], ['maxPower', 'maximum hit power'], ['speed', 'speed'], ['reach', 'reach'], ['windup', 'windup ticks'], ['recovery', 'recovery ticks'], ['pickupRadius', 'pickup radius'], ['push', 'push'], ['parryCharges', 'parry charges'], ['dustCharges', 'debris protection charges']]) {
    if (Number.isFinite(before[key]) && Number.isFinite(after[key]) && after[key] !== before[key]) details.push(`${signed(after[key] - before[key])} ${label}`);
  }
  const statuses = Object.entries(after.statuses ?? {}).filter(([key, expiry]) => expiry > (before.statuses?.[key] ?? 0) && expiry > event.tick);
  for (const [key, expiry] of statuses) {
    if (value.zoneStatus === 'platform' && key === 'platform') details.push('shared protection and slower footing while on the platform');
    else if (value.zoneStatus === 'beacon' && key === 'beacon') details.push('earlier warning reactions while in the light');
    else details.push(`${key.replaceAll('-', ' ')} for ${Math.round((expiry - event.tick) / (replay.hz ?? HZ) * 10) / 10}s`);
  }
  const removed = Object.keys(before.statuses ?? {}).filter(key => !after.statuses?.[key]);
  if (removed.length) details.push(`${removed.join(', ')} removed`);
  if (Number.isFinite(before.x) && Number.isFinite(after.x) && (before.x !== after.x || before.y !== after.y)) details.push('position changed');
  const affected = value.affected?.filter(target => target.id !== event.actor && target.applied !== false && target.outcome !== 'neutral') ?? [];
  if (affected.length) details.push(`${affected.length} other ${affected.length === 1 ? 'fighter affected' : 'fighters affected'}`);
  if (!details.length) details.push(event.type === 'mechanic-hit' ? 'the object effect reached this position' : item?.detail ?? 'the object was activated');
  const from = value.sourceActor != null ? `From fighter #${value.sourceActor + 1}. ` : '';
  const targetTitles = { snare: 'CAUGHT IN A SNARE', shove: 'PUSHED', door: 'DOOR IMPACT', projectile: 'PROJECTILE IMPACT', 'pulse-zone': 'CAUGHT BY THE PULSE', barricade: 'ROUGH CROSSING', platform: 'ON THE PLATFORM', beacon: 'IN THE LIGHT' };
  const title = value.sourceActor != null ? targetTitles[value.effect] ?? 'OBJECT EFFECT' : EXPANDED_TITLES[value.effect ?? item?.effect] ?? 'OBJECT USED';
  return { title, detail: `${item?.name ?? 'The object'}: ${from}${details.join('; ')}.`, tone, priority: 4 };
}

export function describeEvent(event, replay) {
  const v = event.value ?? {};
  if (ultimateEvent(event)) {
    const name = ULTIMATES.find(ability => ability.id === v.ability)?.name ?? 'Ultimate';
    const title = {
      'ultimate-cast': v.fallback ? 'SHIELD FALLBACK' : name.toUpperCase(),
      'ultimate-heal': `+${v.amount} HEALTH`, 'ultimate-guard': `+${v.amount} SHIELD`,
      'ultimate-snare': 'SNARE LANDED', 'ultimate-hit': 'SPELL CONTACT',
      'ultimate-block': `${v.amount} BLOCKED`, 'ultimate-miss': 'SPELL MISSED',
      'ultimate-ready': 'ULTIMATE READY', 'ultimate-dodge': 'WARNING REACTION',
      'ultimate-resist': 'SNARE RESISTED', 'ultimate-cancel': 'CAST CANCELLED',
      'ultimate-expire': 'SHIELD EXPIRED', 'ultimate-release': 'SNARE ENDED',
    }[event.type] ?? 'ULTIMATE';
    const target = Number.isInteger(event.target) && event.target !== event.actor ? ` Fighter #${event.target + 1}.` : '';
    return { title, detail: describeUltimateEvent(event) + target,
      tone: ['ultimate-heal', 'ultimate-guard', 'ultimate-block'].includes(event.type) ? 'good' : 'neutral',
      priority: event.type === 'ultimate-cast' ? 5 : 4 };
  }
  if (event.type === 'damage') return { title: `−${v.amount} HEALTH`, detail: v.causes.includes('collapse') ? 'The final collapse hit everyone left.' : v.causes.every(c => c === 'bleed') ? 'Sudden death drains everyone still standing.' : v.causes.some(c => c.startsWith('ultimate:')) ? 'Ultimate impact. This is the actual health lost after protection.' : v.causes.includes('attack') ? 'A hit landed.' : v.causes.includes('border') ? 'Outside the safe ground.' : v.causes.includes('dust') ? 'Caught in the falling debris.' : 'The object hit back.', tone: 'bad', priority: 2 };
  if (event.type === 'emote') return { title: v.text, detail: 'Just a little noise.', tone: 'neutral', priority: 1 };
  if (event.type === 'coin') return { title: '+1 PICKUP', detail: 'Banked, even after K-hole.', tone: 'coin', priority: 1 };
  if (event.type === 'khole') return { title: 'K-HOLE', detail: 'Out until the next match.', tone: 'bad', priority: 5 };
  if (event.type === 'final-collapse') return { title: 'FINAL COLLAPSE', detail: 'The Shed is closed. One fighter will remain by 60 seconds.', tone: 'bad', priority: 6 };
  if (event.type === 'shelter-closed') return { title: 'SHED CLOSED', detail: 'No more hiding. Get to the middle.', tone: 'bad', priority: 5 };
  if (event.type === 'second-wind') return { title: event.value?.healed ? `+${event.value.healed} SECOND WIND` : 'SECOND WIND', detail: 'Finishing blow: health and stamina came back.', tone: 'good', priority: 5 };
  if (event.type === 'last-stand') return { title: 'LAST ONE STANDING', detail: 'The committed tie order kept this fighter at 1 health.', tone: 'good', priority: 6 };
  if (event.type === 'fooled') return { title: 'FOOLED!', detail: 'A decoy distracted this fighter. No damage from the decoy itself.', tone: 'bad', priority: 4 };
  if (event.type === 'mechanic' || event.type === 'mechanic-hit') return describeMechanic(event, replay);
  if (!ITEM_EVENTS.has(event.type)) return null;
  const before = v.before ?? {}, after = v.after ?? {};
  const power = (after.maxPower ?? 0) - (before.maxPower ?? 0);
  const speed = (after.speed ?? 0) - (before.speed ?? 0);
  const item = ITEMS[v.propType]?.name ?? ITEMS[replay.map?.props?.find(prop => prop.id === v.propId)?.type]?.name ?? 'The object';
  const evidence = interactionEvidence(event, replay), classification = classifyInteraction(event, evidence);
  const outcomeTone = classification.kind === 'positive' ? 'good' : classification.kind === 'negative' ? 'bad' : 'neutral';
  if (event.type === 'tool') return { title: power ? `${signed(power)} POWER` : (WEAPONS[v.after.weapon ?? 0].name.toUpperCase() + ' EQUIPPED'), detail: `${item} → ${v.after.minPower}–${v.after.maxPower} hit power${speed < 0 ? '; wheels replaced' : ''}`, tone: 'power', priority: 4 };
  if (event.type === 'wheels') return { title: speed > 0 ? 'SPEED UP' : 'WHEELS EQUIPPED', detail: `Wheels on${power < 0 ? `; ${signed(power)} power, mallet replaced` : speed > 0 ? '; quicker movement' : '; no extra speed gained'}.`, tone: outcomeTone, priority: 4 };
  if (event.type === 'cover') { const gain = after.shield - before.shield; return { title: gain ? `+${gain} PROTECTION` : 'PROTECTION FULL', detail: `${item} → ${after.shield} hit charges`, tone: gain > 0 ? 'cover' : outcomeTone, priority: 4 }; }
  if (event.type === 'lucky') { const gain = after.hp - before.hp; return { title: gain ? `+${gain} HEALTH` : 'ALREADY FULL', detail: `${item}: good find${gain ? '.' : ', no health needed.'}`, tone: outcomeTone, priority: 4 }; }
  if (event.type === 'oops' || event.type === 'trip') {
    const hit = replay.events.find(e => e.type === 'damage' && e.actor === event.actor && e.tick === event.tick);
    const singleCause = hit && new Set(hit.value.causes).size === 1;
    return { title: event.type === 'oops' ? 'BAD FIND!' : 'TRIPPED!', detail: `${item}${singleCause ? ` → −${hit.value.amount} health` : ': damage shown on the health bar'}`, tone: 'bad', priority: 4 };
  }
  const extra = {
    food: [after.stamina > before.stamina ? '+' + (after.stamina-before.stamina) + ' STAMINA' : 'STAMINA FULL', after.stamina > before.stamina ? 'Energy restored; health is unchanged.' : 'No stamina needed.', outcomeTone],
    coffee: ['QUICK RECOVERY', 'Six seconds; hit power stays the same.', 'good'],
    stink: ['STINK ON', 'Keep away. Two less hit power for six seconds.', 'neutral'],
    devotion: ['QUIET POWER', 'Six seconds: softer hits taken, one less hit power.', 'cover'],
    slow: ['SLOW FEET', 'One second. It cannot stack.', 'bad'],
    slide: ['SLIDING!', 'No attacking or collecting until it stops.', 'bad'],
    skate: ['WHEELS AWAY', 'A short committed roll; attacking and collecting wait until it ends.', 'neutral'],
    trail: ['BLUE FOOTPRINTS', 'Only paint. No stat change.', 'neutral'],
    wash: [classification.kind === 'positive' ? 'CLEAN AGAIN' : 'ALREADY CLEAN', [before.statuses?.stink && !after.statuses?.stink ? 'Stink removed.' : '', before.statuses?.slow && !after.statuses?.slow ? 'Slow removed.' : '', evidence.clearedSlowZones > 0 ? `${evidence.clearedSlowZones} sticky ${evidence.clearedSlowZones === 1 ? 'patch cleared' : 'patches cleared'}.` : ''].filter(Boolean).join(' ') || 'No status or nearby sticky patch changed.', outcomeTone],
    decoy: ['DECOY DOWN', 'Four seconds of very obvious bait.', 'neutral'],
    trap: ['SITE TRAP ARMED', 'One second to leave the marked circle.', 'bad'],
    'coin-route': ['COINS MOVED', 'Unclaimed coins only. No extra PIT.', 'coin'],
  }[event.type];
  if (extra) return {title:extra[0],detail:item + ': ' + extra[1],tone:extra[2],priority:4};
  if (event.type === 'shed') return { title: 'TAKING SHELTER', detail: 'Less damage while hiding. A hit ends it.', tone: 'cover', priority: 4 };
  return { title: 'DANCE BREAK', detail: 'Just music. No stat boost.', tone: 'neutral', priority: 3 };
}

// Build readable cards once. Each fighter gets a stable 2.2-second reading slot;
// a new event cannot replace a card immediately. Labels carry their event time.
// Presentation delay never delays actual bars, impacts or the simulation.
export function buildReadability(replay) {
  const freeAt = Array(6).fill(0), cards = [];
  const subjectEvents = interactionEvents(replay);
  for (const event of subjectEvents) {
    if (!ITEM_EVENTS.has(event.type) && !FIGHTER_EVENTS.has(event.type) && !ULTIMATE_CARDS.has(event.type)) continue;
    const description = describeEvent(event, replay), at = event.tick / HZ;
    const start = Math.max(at, freeAt[event.actor]);
    // Avoid narrating obsolete interactions long after the character left them.
    if (start - at > 2.5) continue;
    cards.push({ ...description, actor: event.actor, event, start, end: start + 2.2 });
    freeAt[event.actor] = start + 2.2;
  }
  // Optional chatter only fills true gaps; never postpones a mechanical cue.
  for (const event of replay.events.filter(e => e.type === 'emote')) {
    const start=event.tick/HZ,end=start+2.2;
    if(cards.some(c=>c.actor===event.actor&&c.start<end&&c.end>start))continue;
    cards.push({...describeEvent(event,replay),actor:event.actor,event,start,end});
  }
  const announcements = replay.events.filter(event => event.type === 'final-collapse')
    .map(event => ({ ...describeEvent(event, replay), event, start: event.tick / HZ, end: event.tick / HZ + 3 }));
  return { cards, announcements, subjectEvents };
}

/** Replay-clock-only HUD phase, including explicit final-collapse and finish. */
export function phaseAt(replay, seconds) {
  if (!Number.isFinite(seconds)) throw new RangeError('Finite replay time required');
  const tick = Math.max(0, Math.min(replay.ticks, Math.floor(seconds * HZ)));
  const remainingSeconds = Math.max(0, Math.ceil((TICKS - tick) / HZ));
  if (tick >= replay.ticks) return { phase: 'finished', label: 'LAST ONE STANDING', remainingSeconds };
  if (tick >= FINAL_COLLAPSE_TICK) return { phase: 'final-collapse', label: 'FINAL COLLAPSE', remainingSeconds };
  if (tick > 800) return { phase: 'closing', label: 'THE YARD IS CLOSING', remainingSeconds };
  return { phase: 'arena', label: 'TROUBLE IN PROGRESS', remainingSeconds };
}

export function feedbackAt(replay, track, seconds, selected) {
  const tick = Math.min(replay.ticks, Math.max(0, Math.floor(seconds * HZ)));
  const recent = replay.events.filter(e => e.tick <= tick && e.tick > tick - 24);
  const cards = track.cards.filter(c => c.start <= seconds && seconds < c.end)
    .sort((a, b) => Number(b.actor === selected) - Number(a.actor === selected) || b.priority - a.priority || b.start - a.start)
    .slice(0, 2);
  const totals = new Map();
  for (const event of recent.filter(e => e.type === 'damage' && tick - e.tick < 16)) {
    const prev = totals.get(event.actor) || { actor: event.actor, amount: 0, tick: event.tick, hpBefore: event.value.hpBefore };
    prev.amount += event.value.amount; prev.tick = Math.max(prev.tick, event.tick); totals.set(event.actor, prev);
  }
  const damage = [...totals.values()].sort((a, b) => Number(b.actor === selected) - Number(a.actor === selected) || b.tick - a.tick).slice(0, 3);
  const history = (track.subjectEvents ?? replay.events).filter(e => e.tick <= tick &&
    (e.actor === selected || ultimateEvent(e) && e.target === selected) &&
    (ITEM_EVENTS.has(e.type) || FIGHTER_EVENTS.has(e.type) || ultimateEvent(e))).slice(-4).reverse();
  const announcements = (track.announcements ?? []).filter(card => card.start <= seconds && seconds < card.end);
  return { recent, cards, damage, history, announcements };
}

// A display budget, not an event filter: the complete history/trace stays intact.
// One short followed-fighter caption; spells tell their own story in the arena.
export function spectatorFeedback(feedback, selected, { ultimateActive = false } = {}) {
  return { ...feedback,
    cards: ultimateActive ? [] : feedback.cards.filter(card => card.actor === selected &&
      card.priority >= 4 && !ultimateEvent(card.event)).slice(0, 1),
    damage: feedback.damage.filter(hit => hit.actor === selected || hit.amount >= 4).slice(0, 2),
  };
}

export function cameraAt(replay, seconds, selected, follow = false) {
  if (!follow) return { x: 512, y: 512, zoom: 1 };
  const tick = Math.min(replay.ticks, Math.max(0, Math.floor(seconds * HZ)));
  const samples = replay.frames.slice(Math.max(0, tick - 10), tick + 1);
  const zoom = 1.4, half = 512 / zoom;
  const avg = axis => samples.reduce((n, frame) => n + frame.fighters[selected][axis], 0) / samples.length * .1024;
  return { x: Math.max(half, Math.min(1024 - half, avg('x'))), y: Math.max(half, Math.min(1024 - half, avg('y'))), zoom };
}

export function project(point, camera) { return { x: (point.x * .1024 - camera.x) * camera.zoom + 512, y: (point.y * .1024 - camera.y) * camera.zoom + 512 }; }
export function unproject(point, camera) { return { x: ((point.x - 512) / camera.zoom + camera.x) / .1024, y: ((point.y - 512) / camera.zoom + camera.y) / .1024 }; }

// Resolve complete HUD rectangles, including the seat badge, selected HP and
// protection pips. Alternate above/below so top-edge clamping cannot stack bars.
export function healthLabelLayout(fighters, camera, selected, ui = 1) {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n)), placed = [];
  const overlap = (a, b) => a.left < b.right + 6 * ui && a.right + 6 * ui > b.left && a.top < b.bottom + 6 * ui && a.bottom + 6 * ui > b.top;
  const ordered = [...fighters].sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || b.hp - a.hp || a.id - b.id);
  for (const f of ordered) {
    const p = project(f, camera), focus = f.id === selected;
    if (p.x < 30 || p.x > 994 || p.y < 35 || p.y > 1010) continue;
    const w = (focus ? 91 : 64) * ui, left = w / 2 + 22 * ui, right = w / 2 + 4 * ui;
    const top = (focus ? 28 : 5) * ui, bottom = 29 * ui;
    const desired = p.y - (f.equipment === 'mallet' ? 108 : 96) * camera.zoom;
    const candidates = [], ys = [desired];
    for (let i = 1; i <= Math.ceil(1024 / (60 * ui)); i++) ys.push(desired - i * 60 * ui, desired + i * 60 * ui);
    for (const dx of [0, -140 * ui, 140 * ui, -280 * ui, 280 * ui]) for (const py of ys) {
      const x = clamp(p.x + dx, 12 + left, 1012 - right), y = clamp(py, 12 + top, 1012 - bottom);
      candidates.push({ x, y, left: x - left, right: x + right, top: y - top, bottom: y + bottom });
    }
    const chosen = candidates.find(c => placed.every(o => !overlap(c, o)));
    // Six labels fit in this viewport at supported sizes. Keep a deterministic
    // bounded fallback for callers supplying a larger, unsupported HUD scale.
    const slot = chosen || candidates[0];
    placed.push({ ...slot, id: f.id, w, focus, p });
  }
  return placed;
}
export { combatStats };
