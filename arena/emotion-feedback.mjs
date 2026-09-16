import { ITEMS } from './content.mjs';
import { ITEM_EVENTS, MECHANIC_STATUSES, buildInteractionFeedback, classifyInteraction, interactionEvidence, interactionEvents, statusClassification } from './interaction-feedback.mjs';
import { BEHAVIOR_EXPRESSIONS, expressionProfile, itemExpression } from './expression-catalog.mjs';

const HZ = 20;
export const EMOTION_DISPLAY_VERSION = 'pit-emotion-display-2';
const EMOTION_KINDS = new Set(['angry', 'afraid', 'happy', 'upset', 'disgusted', 'curious', 'calm']);
const MODIFIER_FOR = { angry: 'attack', afraid: 'threat', happy: 'benefit', upset: 'harm', disgusted: 'harm', curious: 'discovery', calm: 'focus' };
const OUTCOME_EVENTS = new Set(['coin', 'damage', ...ITEM_EVENTS]);
const finite = Number.isFinite;
const distance2 = (a, b) => finite(a?.x) && finite(b?.x) && finite(a?.y) && finite(b?.y) ? (a.x - b.x) ** 2 + (a.y - b.y) ** 2 : Infinity;
const samePoint = (a, b) => a && b && finite(a.x) && finite(a.y) && a.x === b.x && a.y === b.y;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function reaction(event, hz, replay) {
  if (!OUTCOME_EVENTS.has(event.type) || event.actor == null || !finite(event.tick)) return null;
  // Odor is an authoritative status. A cached event must never restore it after washing.
  if (event.type === 'stink') return null;
  const result = classifyInteraction(event, interactionEvidence(event, replay));
  let kind = result.kind === 'positive' ? 'happy' : result.kind === 'negative' ? 'upset' : result.kind === 'repulsive' ? 'disgusted' : null;
  if (event.type === 'fooled') kind = 'upset';
  if (!kind && ['music', 'skate', 'trail', 'decoy', 'trap', 'coin-route'].includes(event.type)) kind = 'curious';
  if (event.type === 'devotion') kind = 'calm';
  if (!kind && ['mechanic', 'mechanic-hit'].includes(event.type) && event.value?.applied !== false) kind = 'curious';
  // Mixed equipment changes have a discovery cue, without promising a bonus.
  if (!kind && result.secondaryKinds.length) kind = 'curious';
  // Hiding is an intentional fear cue; its protective benefit is on the interaction layer.
  if (event.type === 'shed') return null;
  if (!kind) return null;
  const item = ITEMS[event.value?.propType ?? replay.map?.props?.find(prop => prop.id === event.value?.propId)?.type];
  const expression = itemExpression(item);
  const motif = event.type === 'coin' ? 'coins' : event.type === 'fooled' ? 'mischief' : expression.motif;
  return {
    key: `event:${event.id ?? `${event.tick}:${event.type}:${event.actor}`}`,
    actor: event.actor, kind, motif, gesture: expression.gesture, reason: event.type, source: 'interaction',
    outcome: result.kind, secondaryKinds: result.secondaryKinds,
    startedAt: event.tick / hz,
    expiresAt: event.tick / hz + (kind === 'upset' ? 1.7 : 1.55),
    strength: kind === 'upset' ? 1 : .9,
  };
}

function goalFor(fighter, previous, replay, frame) {
  const goal = fighter.goal;
  if (!goal) return null;
  const prop = replay.map?.props?.find(item => samePoint(item, goal) && !(fighter.used ?? []).includes(item.id));
  if (prop) return { type: 'prop', propId: prop.id, effect: ITEMS[prop.type]?.effect, preference: ITEMS[prop.type]?.preference, item: ITEMS[prop.type] };
  const observation = previous ?? frame;
  const coin = (observation?.coinPositions ?? replay.map?.coins ?? []).find(item => samePoint(item, goal) && (observation?.coins ? observation.coins.includes(item.id) : item.owner == null));
  if (coin) return { type: 'coin', coinId: coin.id };
  const decoy = observation?.decoys?.find(item => item.owner !== fighter.id && item.until > frame.tick && samePoint(item, goal));
  if (decoy) return { type: 'decoy', decoyId: decoy.id };
  const foe = previous?.fighters?.find(other => other.id !== fighter.id && other.hp > 0 && samePoint(other, goal));
  if (foe) return { type: 'foe', actor: foe.id };
  return null;
}

function intentFor(fighter, frame, previousFighter, goal, replay, tendency) {
  const tick = frame.tick, p = replay.policies?.[fighter.id]?.preferences ?? {};
  const cue = (kind, reason, priority, strength = .82, motif = tendency.motif, gesture = tendency.gesture) => ({ kind, reason, motif, gesture, source: 'intent', priority, strength });
  const foes = frame.fighters.filter(other => other.id !== fighter.id && other.hp > 0);
  const counterTarget = foes.find(other => other.id === fighter.counterTarget && other.pose === 'recover');
  const counterReady = fighter.counterUntil > tick && counterTarget && (p.counter ?? 0) >= 50;
  if (fighter.pose === 'windup') return cue('angry', 'attack-windup', 88, .96, counterReady && fighter.target === counterTarget.id ? 'riposte' : 'fight', 'lean');
  const incoming = frame.fighters.find(other => other.id !== fighter.id && other.hp > 0 && other.pose === 'windup' && other.target === fighter.id && distance2(other, fighter) < 1200 ** 2);
  if (incoming) return cue('afraid', 'incoming-attack', 86, .96, 'cover', 'recoil');
  if (fighter.pose === 'hiding') return cue('afraid', 'hiding', 73, .83, 'cover', 'crouch');
  // Rolling is imposed by a slide/skate item, not a decision to flee.
  if (fighter.pose === 'evade' && !(fighter.statuses?.roll > tick)) return cue('afraid', 'escaping', 84, .9, (p.mobility ?? 0) >= 65 || (p.range ?? 0) >= 65 ? 'speed' : 'cover', 'dart');
  if (fighter.pose === 'stagger') return cue('upset', 'hurt', 92, .96);
  if (counterReady && distance2(fighter, counterTarget) < 1800 ** 2) return cue('angry', 'counter-opening', 76, .88, 'riposte', 'recoil');
  if (fighter.statuses?.devoted > tick) return cue('calm', 'devotion', 40, .75, 'devotion', 'breathe');
  if (fighter.channel) {
    const item = ITEMS[fighter.channel.type ?? replay.map?.props?.find(prop => prop.id === fighter.channel.propId)?.type];
    const expression = itemExpression(item);
    return cue(expression.kind, item?.effect === 'devotion' ? 'devotion' : 'using-item', 40, .76, expression.motif, expression.gesture);
  }
  if (fighter.pose === 'recover' && fighter.target != null) return cue('angry', 'attack-recovery', 70, .73, fighter.weapon != null && tendency.motif === 'tools' ? 'tools' : 'fight', 'recoil');
  if (fighter.shield > 0 && (p.defense ?? 0) >= 60 && samePoint(fighter.goal, fighter) && ['idle', 'travel'].includes(fighter.pose)) return cue('calm', 'holding-ground', 44, .74, tendency.motif === 'watch' ? 'watch' : 'guard', tendency.motif === 'watch' ? 'scan' : 'brace');
  if (fighter.pose !== 'travel') return null;
  if (goal?.type === 'prop' && !(fighter.used ?? []).includes(goal.propId)) {
    const expression = itemExpression(goal.item);
    if (goal.effect === 'shelter') return cue('afraid', 'seeking-cover', 65, .78, 'cover', 'crouch');
    if (goal.effect === 'guard') return cue((p.caution ?? 0) >= 60 ? 'afraid' : 'calm', 'seeking-protection', 42, .7, tendency.motif === 'watch' ? 'watch' : 'guard', 'brace');
    if (goal.effect === 'devotion') return cue('calm', 'seeking-devotion', 42, .7, 'devotion', 'breathe');
    return cue(expression.kind, goal.effect === 'weapon' ? 'seeking-tool' : goal.effect === 'wash' ? 'seeking-wash' : 'investigating-item', 42, .76, expression.motif, expression.gesture);
  }
  if (goal?.type === 'coin' && (!frame.coins || frame.coins.includes(goal.coinId))) return cue('curious', 'seeking-coins', 43, .8, 'coins', 'reach');
  if (goal?.type === 'decoy' && frame.decoys?.some(decoy => decoy.id === goal.decoyId && decoy.until > tick)) return cue('curious', 'investigating-decoy', 43, .8, 'mischief', 'tilt');
  if (goal?.type === 'foe') {
    const target = foes.find(other => other.id === goal.actor);
    if (target) {
      const opening = (p.opportunism ?? 0) >= 60 && (target.hp < 50 || target.pose === 'recover');
      return cue('angry', opening ? 'seizing-opening' : 'seeking-fight', opening ? 75 : 72, .85, opening ? 'ambush' : 'fight', opening ? 'prowl' : 'lean');
    }
  }
  // The replay stores goal coordinates, not private decision labels. Only infer
  // flight when actual movement increases separation from a nearby opponent.
  if (previousFighter && tendency.kind === 'afraid' && fighter.goal) {
    const nearest = frame.fighters.filter(other => other.id !== fighter.id && other.hp > 0 && distance2(other, fighter) < 1800 ** 2).sort((a, b) => distance2(a, fighter) - distance2(b, fighter))[0];
    if (nearest && distance2(fighter, nearest) > distance2(previousFighter, nearest) + 100 && distance2(fighter.goal, nearest) > distance2(fighter, nearest)) return cue('afraid', 'keeping-distance', 66, .78, 'speed', 'dart');
  }
  if (fighter.goal && (p.novelty ?? 0) >= 65) return cue('curious', 'exploring', 28, .64, tendency.motif === 'mischief' ? 'mischief' : 'wonder', 'sway');
  return null;
}

/**
 * Build a deterministic display-only timeline once. The engine, policies and RNG
 * are never changed. Short intent holds bridge recovery frames, while new harm,
 * windups and evasions immediately replace a less urgent expression.
 */
export function buildEmotionFeedback(replay) {
  const publicTrack = readPublicEmotionFeedback(replay);
  if (publicTrack) return publicTrack;
  const hz = replay.hz ?? HZ, fighters = new Map(), personalities = new Map();
  const statusSources = buildInteractionFeedback(replay).sources;
  const events = interactionEvents(replay).map(event => reaction(event, hz, replay)).filter(Boolean).sort((a, b) => a.startedAt - b.startedAt);
  const recent = new Map(), goals = new Map(), active = new Map(), statusStarts = new Map();
  const observations = replay.frames ?? [];
  const lastTick = Math.max(replay.ticks ?? 0, observations.at(-1)?.tick ?? 0);
  let eventIndex = 0, frameIndex = 0, previous;
  for (let tick = 0; tick <= lastTick; tick++) {
    while (frameIndex + 1 < observations.length && observations[frameIndex + 1].tick <= tick) frameIndex++;
    const observed = observations[frameIndex];
    if (!observed || observed.tick > tick) continue;
    // Sparse fixtures/replays retain their last authoritative observation.
    const frame = observed.tick === tick ? observed : { ...observed, tick };
    const now = frame.tick / hz;
    while (eventIndex < events.length && events[eventIndex].startedAt <= now) {
      const event = events[eventIndex++];
      if (!recent.has(event.actor)) recent.set(event.actor, []);
      recent.get(event.actor).push(event);
    }
    for (const fighter of frame.fighters ?? []) {
      if (!personalities.has(fighter.id)) personalities.set(fighter.id, expressionProfile(replay.policies?.[fighter.id]));
      if (fighter.hp <= 0 || fighter.pose === 'khole') { active.delete(fighter.id); statusStarts.delete(fighter.id); continue; }
      const tendency = personalities.get(fighter.id);
      const previousFighter = previous?.fighters?.find(other => other.id === fighter.id);
      if (!samePoint(fighter.goal, previousFighter?.goal)) goals.set(fighter.id, goalFor(fighter, previous, replay, frame));
      let candidate = { ...tendency, source: 'personality', priority: 0, key: `personality:${fighter.id}`, startedAt: now };
      const statuses = fighter.statuses ?? {}, stink = statuses.stink > frame.tick, slow = statuses.slow > frame.tick;
      let starts = statusStarts.get(fighter.id) ?? {};
      starts = { stink: stink ? starts.stink ?? now : undefined, slow: slow ? starts.slow ?? now : undefined };
      statusStarts.set(fighter.id, starts);
      if (stink || slow) candidate = {
        kind: slow ? 'upset' : 'disgusted', reason: slow ? 'slowed' : 'stink', source: 'status', priority: slow ? 57 : 55,
        key: `status:${fighter.id}:${slow ? 'slow' : 'stink'}:${slow ? starts.slow : starts.stink}`,
        startedAt: slow ? starts.slow : starts.stink, strength: .86, motif: slow ? 'speed' : 'odor-seeking', gesture: slow ? 'recoil' : 'sniff',
      };
      for (const [status, expiry] of Object.entries(statuses)) {
        if (!(expiry > frame.tick) || !MECHANIC_STATUSES.has(status)) continue;
        const source = (statusSources.get(fighter.id) ?? []).findLast(signal => signal.startedAt <= now && signal.statuses?.includes(status));
        if (!source) continue;
        const outcome = statusClassification(status, source), expression = itemExpression(ITEMS[source.propType]);
        const kind = outcome.kind === 'negative' ? 'upset' : outcome.kind === 'repulsive' ? 'disgusted' : outcome.kind === 'positive' ? 'happy' : expression.kind === 'calm' ? 'calm' : 'curious';
        const priority = kind === 'upset' ? 57 : kind === 'disgusted' ? 55 : 32;
        if (priority <= candidate.priority) continue;
        candidate = { kind, reason: status, source: 'status', priority, key: `status:${fighter.id}:${status}:${source.startedAt}`, startedAt: source.startedAt, strength: .65, motif: expression.motif, gesture: expression.gesture, outcome: outcome.kind, secondaryKinds: outcome.secondaryKinds };
      }
      const intent = intentFor(fighter, frame, previousFighter, goals.get(fighter.id), replay, tendency);
      if (intent && intent.priority > candidate.priority) candidate = { ...intent, key: `intent:${fighter.id}:${intent.reason}:${intent.motif}`, startedAt: now, observedAt: now };
      const reactions = (recent.get(fighter.id) ?? []).filter(event => event.expiresAt > now);
      recent.set(fighter.id, reactions);
      for (const event of reactions) {
        const age = now - event.startedAt;
        const priority = event.kind === 'upset' ? age < .55 ? 100 : 69 : age < .35 ? 82 : 60;
        if (priority > candidate.priority || priority === candidate.priority && event.startedAt >= candidate.startedAt) candidate = { ...event, priority };
      }
      const prior = active.get(fighter.id);
      if (candidate.source === 'intent' && prior?.key === candidate.key) candidate.startedAt = prior.startedAt;
      // One-frame evasions recur between travel frames. Hold that expression
      // instead of flickering between fear and an older reward/goal. New harm,
      // windups, threats, hiding and newly applied rewards still interrupt it.
      const urgentIntent = candidate.source === 'intent' && ['attack-windup', 'incoming-attack', 'escaping', 'hiding'].includes(candidate.reason);
      const newOutcome = candidate.source === 'interaction' && candidate.startedAt > (prior?.observedAt ?? -Infinity);
      if (prior?.source === 'intent' && prior.reason !== 'counter-opening' && ['angry', 'afraid'].includes(prior.kind) && (now - prior.startedAt < .65 || now - prior.observedAt < .3) && candidate.priority < prior.priority && !urgentIntent && !newOutcome) candidate = { ...prior };
      const key = `${candidate.key}:${candidate.kind}`;
      const timeline = fighters.get(fighter.id) ?? [];
      const endTick = frame.tick + 1;
      const last = timeline.at(-1);
      if (last && last.key === key && last.toTick >= frame.tick) last.toTick = endTick;
      else timeline.push({ ...candidate, key, fromTick: frame.tick, toTick: endTick });
      fighters.set(fighter.id, timeline);
      active.set(fighter.id, candidate);
    }
    previous = frame;
  }
  for (const timeline of fighters.values()) for (const signal of timeline) {
    signal.endsAt = signal.toTick / hz;
    delete signal.priority;
  }
  return { hz, fighters, personalities };
}

function latestAt(values, value, key) {
  let low = 0, high = values.length;
  while (low < high) { const mid = (low + high) >>> 1; if (values[mid][key] <= value) low = mid + 1; else high = mid; }
  return values[low - 1];
}

/** Seekable emotion map, including odor even when a different emotion dominates. */
export function emotionsAt(replay, track, seconds) {
  if (!finite(seconds)) throw new RangeError('Finite replay time required');
  const now = Math.max(0, seconds), tick = Math.floor(now * track.hz);
  const frame = latestAt(replay.frames ?? [], tick, 'tick'), result = new Map();
  for (const fighter of frame?.fighters ?? []) {
    if (fighter.hp <= 0 || fighter.pose === 'khole') continue;
    const timeline = track.fighters.get(fighter.id) ?? [];
    let signal = latestAt(timeline, tick, 'fromTick');
    if (!signal || signal.toTick <= tick) signal = { ...track.personalities.get(fighter.id), source: 'personality', key: `personality:${fighter.id}` };
    let startedAt = signal.startedAt, endsAt = signal.endsAt, visible = true;
    if (signal.source === 'personality') {
      const period = 4.8, phase = (now + fighter.id * 1.13) % period;
      startedAt = now - phase;
      endsAt = startedAt + period;
      visible = phase < 1.35;
    }
    const duration = Math.max(1 / track.hz, endsAt - startedAt), age = Math.max(0, now - startedAt);
    const progress = clamp(age / duration, 0, 1);
    const tendency = track.personalities.get(fighter.id) ?? expressionProfile();
    const modifier = MODIFIER_FOR[signal.kind];
    const intensity = signal.source === 'personality' ? .22 + (signal.strength ?? .5) * .13 : (signal.strength ?? .8) * (track.public ? 1 : tendency.modifiers[modifier] ?? 1) * (signal.source === 'interaction' ? 1 - .22 * progress : 1);
    const stinky = (fighter.statuses?.stink ?? 0) > tick;
    result.set(fighter.id, {
      id: signal.key, actor: fighter.id, kind: signal.kind ?? 'calm', reason: signal.reason ?? 'strategy-composure', source: signal.source,
      motif: signal.motif ?? tendency.motif, gesture: signal.gesture ?? tendency.gesture, profileId: tendency.id,
      traits: { ...tendency.traits }, modifiers: { ...tendency.modifiers }, outcome: signal.outcome ?? null, secondaryKinds: [...(signal.secondaryKinds ?? [])],
      startedAt, endsAt, duration, age, progress, intensity, visible, stinky, odor: stinky ? 1 : 0,
    });
  }
  return result;
}

/**
 * Public replay attachment. Only rendered choices, time intervals and opacity
 * are emitted: no policy, numeric traits, profile names, notes or descriptions.
 * Short tuples and omission of baseline intervals keep the wire payload small.
 */
export function buildPublicEmotionFeedback(replay) {
  const track = buildEmotionFeedback({ ...replay, emotionDisplay: undefined });
  const quantize = value => Math.round(clamp(value ?? .8, 0, 1) * 1000);
  return {
    version: EMOTION_DISPLAY_VERSION, hz: track.hz, ticks: replay.ticks,
    fighters: [...track.personalities].map(([id, tendency]) => ({
      id,
      base: [tendency.kind, tendency.motif, tendency.gesture, quantize(tendency.strength)],
      segments: (track.fighters.get(id) ?? []).filter(signal => signal.source !== 'personality').map(signal => [
        signal.fromTick, signal.toTick, signal.kind, signal.motif ?? tendency.motif, signal.gesture ?? tendency.gesture,
        signal.source, signal.reason, signal.startedAt,
        quantize(signal.strength * (tendency.modifiers[MODIFIER_FOR[signal.kind]] ?? 1)),
        signal.outcome ?? null, [...(signal.secondaryKinds ?? [])],
      ]),
    })),
  };
}

function readPublicEmotionFeedback(replay) {
  const display = replay.emotionDisplay;
  if (!display || display.version !== EMOTION_DISPLAY_VERSION || display.hz !== (replay.hz ?? HZ) || display.ticks !== replay.ticks || !Array.isArray(display.fighters) || display.fighters.length > 6) return null;
  const motifs = new Set(BEHAVIOR_EXPRESSIONS.map(profile => profile.motif));
  const gestures = new Set(BEHAVIOR_EXPRESSIONS.map(profile => profile.gesture));
  const sources = new Set(['intent', 'interaction', 'status']);
  const outcomes = new Set(['positive', 'negative', 'neutral', 'repulsive']);
  const unit = value => Number.isInteger(value) && value >= 0 && value <= 1000;
  const seatIds = new Set((replay.frames?.[0]?.fighters ?? []).map(fighter => fighter.id));
  const fighters = new Map(), personalities = new Map();
  for (const actor of display.fighters) {
    const base = actor?.base;
    if (!seatIds.has(actor?.id) || personalities.has(actor.id) || !Array.isArray(base) || base.length !== 4 || !EMOTION_KINDS.has(base[0]) || !motifs.has(base[1]) || !gestures.has(base[2]) || !unit(base[3]) || !Array.isArray(actor.segments) || actor.segments.length > replay.ticks + 1) return null;
    personalities.set(actor.id, { kind: base[0], motif: base[1], gesture: base[2], strength: base[3] / 1000, reason: 'personality', traits: {}, modifiers: {} });
    const timeline = [];
    let previousEnd = 0;
    for (const [index, row] of actor.segments.entries()) {
      if (!Array.isArray(row) || row.length !== 11) return null;
      const [fromTick, toTick, kind, motif, gesture, source, reason, startedAt, strength, outcome, secondaryKinds] = row;
      if (!Number.isInteger(fromTick) || fromTick < previousEnd || !Number.isInteger(toTick) || toTick <= fromTick || toTick > replay.ticks + 1 || !EMOTION_KINDS.has(kind) || !motifs.has(motif) || !gestures.has(gesture) || !sources.has(source) || typeof reason !== 'string' || reason.length > 48 || !finite(startedAt) || startedAt < 0 || startedAt > fromTick / display.hz || !unit(strength) || outcome !== null && !outcomes.has(outcome) || !Array.isArray(secondaryKinds) || secondaryKinds.length > 3 || secondaryKinds.some(kind => !outcomes.has(kind))) return null;
      timeline.push({ key: `display:${actor.id}:${index}`, fromTick, toTick, kind, motif, gesture, source, reason, startedAt, endsAt: toTick / display.hz, strength: strength / 1000, outcome, secondaryKinds: [...secondaryKinds] });
      previousEnd = toTick;
    }
    fighters.set(actor.id, timeline);
  }
  if (personalities.size !== seatIds.size) return null;
  return { hz: display.hz, fighters, personalities, public: true };
}
