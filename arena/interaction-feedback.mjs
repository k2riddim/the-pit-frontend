import { ITEMS, WEAPONS } from './content.mjs';

/** Semantic colors are independent of an item's illustration or HUD card color. */
export const INTERACTION_PALETTE = Object.freeze({
  positive: Object.freeze({ color: '#39ef83', accent: '#dcffe8', ink: '#167141' }),
  negative: Object.freeze({ color: '#ff465c', accent: '#ffe4dd', ink: '#b1263e' }),
  neutral: Object.freeze({ color: '#56d9f5', accent: '#e2fbff', ink: '#116d86' }),
  repulsive: Object.freeze({ color: '#b578ed', accent: '#d6cf47', ink: '#7845a0' }),
});

export const ITEM_EVENTS = new Set(['shed', 'tool', 'cover', 'lucky', 'oops', 'wheels', 'trip', 'music', 'food', 'coffee', 'stink', 'devotion', 'slow', 'slide', 'skate', 'trail', 'wash', 'decoy', 'fooled', 'trap', 'coin-route', 'mechanic', 'mechanic-hit']);
const STATUS_EVENTS = { coffee: 'coffee', stink: 'stink', devoted: 'devotion', slow: 'slow', roll: 'slide', trail: 'trail', shield: 'cover', hiding: 'shed' };
export const MECHANIC_STATUSES = new Set(ITEMS.filter(item => item.mechanic).map(item => item.effect));
const RANK = { negative: 4, repulsive: 3, positive: 2, neutral: 1 };
const HZ = 20;
const finite = value => Number.isFinite(value);
const effect = (kind, secondaryKinds = []) => ({ kind, secondaryKinds });
const delta = (before, after, key) => finite(before?.[key]) && finite(after?.[key]) ? after[key] - before[key] : 0;
const mixed = values => {
  const positive = values.some(value => value > 0), negative = values.some(value => value < 0);
  return positive && negative ? effect('neutral', ['positive', 'negative']) : effect(negative ? 'negative' : positive ? 'positive' : 'neutral');
};

/** Classify applied mechanics, including no-ops and the cost of equipment swaps. */
export function classifyInteraction(event, evidence = {}) {
  const value = event.value ?? {}, before = value.before ?? {}, after = value.after ?? {};
  switch (event.type) {
    case 'mechanic': case 'mechanic-hit': {
      if (value.applied === false) return effect('neutral');
      if (value.outcome === 'mixed') return effect('neutral', ['positive', 'negative']);
      if (['positive', 'negative', 'neutral', 'repulsive'].includes(value.outcome)) return effect(value.outcome);
      return effect('neutral');
    }
    case 'coin': return effect(value.amount > 0 ? 'positive' : 'neutral');
    case 'damage': return effect(value.amount > 0 ? 'negative' : 'neutral');
    case 'oops': case 'trip': case 'slow': case 'slide': case 'fooled': return effect('negative');
    case 'lucky': return mixed([delta(before, after, 'hp')]);
    case 'food': return mixed([delta(before, after, 'stamina')]);
    case 'cover': return mixed([delta(before, after, 'shield')]);
    case 'tool': case 'wheels': {
      const oldTool = WEAPONS[before.weapon], newTool = WEAPONS[after.weapon];
      return mixed([
        delta(before, after, 'minPower'), delta(before, after, 'maxPower'), delta(before, after, 'speed'),
        (newTool?.reach ?? 690) - (oldTool?.reach ?? 690),
        (oldTool?.windup ?? 7) - (newTool?.windup ?? 7),
        (oldTool?.recovery ?? 9) - (newTool?.recovery ?? 9),
      ]);
    }
    case 'coffee': return effect(after.statuses?.coffee > (before.statuses?.coffee ?? 0) ? 'positive' : 'neutral');
    case 'shed': return effect('positive');
    // These are useful deterrence/protection but also reduce the owner's attack.
    case 'stink': return effect('repulsive', ['positive', 'negative']);
    case 'devotion': case 'skate': return effect('neutral', ['positive', 'negative']);
    case 'wash': return effect(before.statuses?.stink || before.statuses?.slow || evidence.clearedSlowZones > 0 ? 'positive' : 'neutral');
    // Arming a trap does not itself damage its operator. The prop signals danger.
    case 'trap': return { ...effect('neutral'), itemKind: 'negative' };
    default: return effect('neutral');
  }
}

/** Separate the operator's outcome from each actually affected fighter. */
export function interactionSubjects(event) {
  if (!['mechanic', 'mechanic-hit'].includes(event.type) || !Array.isArray(event.value?.affected)) return [event];
  const own = event.value.affected.find(subject => subject.id === event.actor);
  const operator = own ? { ...event, value: { ...event.value, before: own.before, after: own.after,
    outcome: own.outcome, applied: own.applied ?? own.outcome !== 'neutral', sourceActor: event.actor } } : event;
  return [operator, ...event.value.affected.filter(subject => subject.id !== event.actor).map(subject => ({
    ...event, id: `${event.id}:target:${subject.id}`, actor: subject.id, target: null,
    value: { ...event.value, before: subject.before, after: subject.after, outcome: subject.outcome, applied: subject.applied ?? subject.outcome !== 'neutral', sourceActor: event.actor, affected: [] },
  }))];
}

export function statusClassification(status, source) {
  const kind = status === 'stink' ? 'repulsive' : status === 'slow' ? 'negative' : ['coffee', 'shield', 'hiding', 'beacon'].includes(status) ? 'positive' : status === 'platform' ? 'neutral' : source?.kind ?? 'neutral';
  return { kind, secondaryKinds: status === 'platform' ? ['positive', 'negative'] : [...(source?.secondaryKinds ?? [])] };
}

/**
 * Continuous zones do not emit an event every tick. Recover only a proven entry
 * or refresh from adjacent authoritative observations. An uninterrupted stay
 * yields one display event, so a platform never flashes twenty times a second.
 */
export function zoneInteractionEvents(replay) {
  const events = [], episodes = new Map(), frames = replay.frames ?? [];
  const inside = (fighter, zone) => finite(fighter?.x) && finite(fighter?.y) && (fighter.x - zone.x) ** 2 + (fighter.y - zone.y) ** 2 < zone.radius ** 2;
  for (let index = 1; index < frames.length; index++) {
    const before = frames[index - 1], after = frames[index], tick = after.tick;
    if (before.tick !== tick - 1) { episodes.clear(); continue; }
    for (const fighter of after.fighters ?? []) {
      const previous = before.fighters?.find(entry => entry.id === fighter.id);
      if (!previous || fighter.hp <= 0 || fighter.pose === 'khole') continue;
      for (const status of ['slow', 'platform', 'beacon']) {
        const key = `${fighter.id}:${status}`, expiry = fighter.statuses?.[status] ?? 0;
        if (!(expiry > tick)) { episodes.delete(key); continue; }
        if (!(expiry > (previous.statuses?.[status] ?? 0))) continue;
        const candidates = (before.zones ?? []).filter(zone => zone.propId != null && zone.until > tick
          && zone.kind === (status === 'slow' ? 'slow-pulse' : status) && inside(previous, zone)
          && (status !== 'slow' || tick >= (previous.until ?? 0) && previous.pose !== 'hiding' && (previous.immuneUntil ?? 0) <= tick
            && (!zone.period || (tick - zone.start) % zone.period < zone.on))
          && expiry === Math.max(previous.statuses?.[status] ?? 0, tick + (status === 'slow' ? zone.slow ?? 12 : 2)));
        // Overlapping sources are ambiguous; retain the status color but do not
        // invent a connection to either prop.
        if (candidates.length !== 1) { episodes.delete(key); continue; }
        const zone = candidates[0], prior = episodes.get(key);
        if (prior?.zoneId === zone.id && prior.expiry >= tick) { prior.expiry = expiry; continue; }
        const outcome = status === 'slow' ? 'negative' : status === 'platform' ? 'mixed' : 'positive';
        const event = { id: `zone:${zone.id}:${fighter.id}:${tick}`, tick, type: 'mechanic', actor: fighter.id, target: null,
          value: { propId: zone.propId, propType: zone.propType, x: zone.x, y: zone.y, effect: zone.effect,
            sourceActor: zone.owner, zoneStatus: status, applied: true, outcome, affected: [],
            before: { statuses: { [status]: previous.statuses?.[status] ?? 0 } }, after: { statuses: { [status]: expiry } } } };
        events.push(event); episodes.set(key, { zoneId: zone.id, expiry });
      }
    }
  }
  return events;
}

/** Canonical events plus derived display-only zone entries, in replay order. */
export function interactionEvents(replay) {
  return [...(replay.events ?? []).flatMap(interactionSubjects), ...zoneInteractionEvents(replay)].sort((a, b) => a.tick - b.tick);
}

/** Recover environmental outcomes from recorded frames, never mutate mechanics. */
export function interactionEvidence(event, replay) {
  const evidence = { clearedSlowZones: 0 };
  if (event.type !== 'wash' || !finite(event.tick)) return evidence;
  const before = currentFrame(replay, event.tick - 1), after = currentFrame(replay, event.tick);
  const point = event.value?.to;
  // Adjacent observations distinguish a real cleanup from an already expired
  // patch in an old sparse frame. The prop centre is not the actor's wash radius.
  if (before?.tick !== event.tick - 1 || after?.tick !== event.tick || !finite(point?.x) || !finite(point?.y)) return evidence;
  const events = replay.events ?? [];
  const index = events.findIndex(entry => entry === event || event.id != null && entry.id === event.id && entry.type === event.type && entry.tick === event.tick && entry.actor === event.actor);
  if (index < 0) return evidence;
  const priorWashes = events.slice(0, index).filter(entry => entry.type === 'wash' && entry.tick === event.tick);
  for (const zone of before.zones ?? []) {
    if (!['slow', 'slow-pulse'].includes(zone.kind) || zone.id == null || !(zone.until > event.tick)
      || !finite(zone.x) || !finite(zone.y) || (zone.x - point.x) ** 2 + (zone.y - point.y) ** 2 >= 1800 ** 2) continue;
    const cleared = after.zones?.find(current => current.id === zone.id && current.kind === zone.kind
      && current.x === zone.x && current.y === zone.y && current.until === event.tick);
    if (!cleared) continue;
    // A second wash in the same tick cannot claim the first operator's cleanup.
    // Missing earlier positions are ambiguous, so do not invent that benefit.
    if (priorWashes.some(entry => !finite(entry.value?.to?.x) || !finite(entry.value?.to?.y)
      || (zone.x - entry.value.to.x) ** 2 + (zone.y - entry.value.to.y) ** 2 < 1800 ** 2)) continue;
    evidence.clearedSlowZones++;
  }
  return evidence;
}

function sourceFor(event, replay) {
  const value = event.value ?? {};
  if (event.type === 'fooled') {
    if (value.decoyId != null && finite(value.decoyX) && finite(value.decoyY)) return {
      itemKey: `decoy:${value.decoyId}`, decoyId: value.decoyId, decoyArt: value.decoyArt, x: value.decoyX, y: value.decoyY,
    };
    // Core records the victim's point, not a prop/decoy id. Recover only an
    // unambiguous foreign decoy that could actually have been consumed here.
    const before = currentFrame(replay, event.tick - 1), after = currentFrame(replay, event.tick);
    if (!before || before.tick >= event.tick || !finite(value.x) || !finite(value.y)) return {};
    const candidates = (before.decoys ?? []).filter(decoy => decoy.id != null && decoy.owner !== event.actor
      && decoy.until > event.tick && finite(decoy.x) && finite(decoy.y)
      && (decoy.x - value.x) ** 2 + (decoy.y - value.y) ** 2 < 350 ** 2
      && (after?.tick === event.tick
        ? after.decoys?.some(current => current.id === decoy.id && current.until === event.tick)
        : before.tick === event.tick - 1));
    if (candidates.length !== 1) return {};
    const decoy = candidates[0];
    return { itemKey: `decoy:${decoy.id}`, decoyId: decoy.id, decoyArt: decoy.art, x: decoy.x, y: decoy.y };
  }
  if (value.propId != null) {
    const prop = replay.map?.props?.find(item => item.id === value.propId);
    return { itemKey: `prop:${value.propId}`, propId: value.propId, propType: value.propType ?? prop?.type, x: value.x ?? prop?.x, y: value.y ?? prop?.y };
  }
  if (event.type === 'coin' && value.coinId != null) {
    const coin = replay.map?.coins?.find(item => item.id === value.coinId);
    // The replay map contains final coin positions. The event owns pickup origin.
    return { itemKey: `coin:${value.coinId}`, coinId: value.coinId, x: value.x ?? coin?.x, y: value.y ?? coin?.y };
  }
  return {};
}

/** Build once per replay. No wall clock, random draws or mutation of game state. */
export function buildInteractionFeedback(replay) {
  const hz = replay.hz ?? HZ, impacts = [], sources = new Map();
  for (const [index, event] of interactionEvents(replay).entries()) {
    if (!ITEM_EVENTS.has(event.type) && event.type !== 'coin' && event.type !== 'damage' && event.type !== 'prepare') continue;
    if (!finite(event.tick) || event.actor == null) continue;
    const source = sourceFor(event, replay);
    const signal = {
      id: `interaction:${event.id ?? index}`, eventType: event.type, actor: event.actor,
      effect: event.value?.effect, statuses: [...Object.keys(event.value?.after?.statuses ?? {}).filter(status => event.value.after.statuses[status] > (event.value?.before?.statuses?.[status] ?? 0)), ...(event.value?.after?.shield > (event.value?.before?.shield ?? 0) ? ['shield'] : [])],
      ...source, ...classifyInteraction(event, interactionEvidence(event, replay)), phase: event.type === 'prepare' ? 'prepare' : 'impact',
      startedAt: event.tick / hz, endsAt: event.tick / hz + (event.type === 'fooled' ? 8 / hz : event.type === 'damage' ? .68 : event.type === 'coin' ? .95 : 1.25),
    };
    if (event.type === 'prepare') {
      // Preparation comes from frame.channel below so interruption ends it at once.
      signal.endsAt = signal.startedAt + (ITEMS[source.propType]?.effect === 'devotion' ? 2 : .7);
    } else impacts.push(signal);
    if (ITEM_EVENTS.has(event.type) || event.type === 'prepare') {
      if (!sources.has(event.actor)) sources.set(event.actor, []);
      sources.get(event.actor).push(signal);
    }
  }
  return { hz, impacts, sources };
}

function currentFrame(replay, tick) {
  const frames = replay.frames ?? [];
  // Canonical replays have one frame per tick; sparse fixtures remain supported.
  if (frames[tick]?.tick === tick) return frames[tick];
  let low = 0, high = frames.length;
  while (low < high) { const middle = (low + high) >>> 1; if (frames[middle].tick <= tick) low = middle + 1; else high = middle; }
  return frames[Math.max(0, low - 1)];
}

function atTime(signal, seconds) {
  const duration = Math.max(.001, signal.endsAt - signal.startedAt), age = Math.max(0, seconds - signal.startedAt);
  const progress = Math.max(0, Math.min(1, age / duration));
  const intensity = signal.phase === 'impact' ? Math.max(0, 1 - progress ** 1.5) : signal.phase === 'prepare' ? .72 : .45;
  return { ...signal, secondaryKinds: [...signal.secondaryKinds], duration, age, progress, intensity };
}

function mergeSignal(map, key, signal) {
  const previous = map.get(key);
  if (!previous) { map.set(key, signal); return; }
  const priority = item => (item.phase === 'impact' ? 100 : item.phase === 'prepare' ? 20 : 0) + RANK[item.kind];
  const dominant = priority(signal) > priority(previous) || priority(signal) === priority(previous) && signal.startedAt > previous.startedAt ? signal : previous;
  const kinds = [...new Set([previous.kind, ...previous.secondaryKinds, signal.kind, ...signal.secondaryKinds])].filter(kind => kind !== dominant.kind && kind !== 'neutral');
  map.set(key, { ...dominant, secondaryKinds: kinds });
}

/**
 * Clock-seekable sprite cues. Item keys are `prop:<id>`, `coin:<id>` or a proven
 * `decoy:<id>`; fighter
 * keys are seat IDs. Item source positions survive a coin disappearing. Status
 * cues follow authoritative frames and stop on wash, interruption or K-hole.
 */
export function interactionFeedbackAt(replay, track, seconds) {
  if (!finite(seconds)) throw new RangeError('Finite replay time required');
  const now = Math.max(0, seconds), tick = Math.floor(now * track.hz);
  const frame = currentFrame(replay, tick), items = new Map(), fighters = new Map(), links = [];
  const add = (signal, item = true, link = true) => {
    const timed = atTime(signal, now);
    mergeSignal(fighters, timed.actor, timed);
    if (item && timed.itemKey && finite(timed.x) && finite(timed.y)) {
      mergeSignal(items, timed.itemKey, { ...timed, kind: timed.itemKind ?? timed.kind });
      if (link) links.push(timed);
    }
  };
  for (const signal of track.impacts) if (signal.startedAt <= now && now < signal.endsAt) add(signal);
  for (const fighter of frame?.fighters ?? []) {
    if (fighter.hp <= 0) continue;
    const sources = (track.sources.get(fighter.id) ?? []).filter(signal => signal.startedAt <= now);
    if (fighter.channel && fighter.until > tick) {
      const source = sources.findLast(signal => signal.phase === 'prepare' && signal.propId === fighter.channel.propId);
      if (source) add({ ...source, endsAt: fighter.until / track.hz });
    }
    const statuses = { ...fighter.statuses };
    if (fighter.shield > 0) statuses.shield = (replay.ticks ?? frame.tick) + 1;
    if (fighter.pose === 'hiding') statuses.hiding = fighter.coverUntil;
    for (const [status, expiry] of Object.entries(statuses)) {
      if (!(expiry > tick) || !STATUS_EVENTS[status] && !MECHANIC_STATUSES.has(status)) continue;
      const source = sources.findLast(signal => signal.statuses?.includes(status) || signal.eventType === STATUS_EVENTS[status] || status === 'roll' && signal.eventType === 'skate');
      add({
        ...(source ?? {}), id: `status:${fighter.id}:${status}`, actor: fighter.id, eventType: status,
        phase: 'status', ...statusClassification(status, source),
        startedAt: source?.startedAt ?? frame.tick / track.hz, endsAt: expiry / track.hz,
      }, false, false);
    }
  }
  return { items, fighters, links };
}
