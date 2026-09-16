import { AXES, PRESETS } from './policy.mjs';

// Local visual-review vocabulary. These profiles do not select or alter a brain:
// the display compares the actual compiled preference vector to these examples.
const descriptions = [
  ['cover', 'afraid', 'Taking cover', 'crouch', 'Peeks out, shrinks back and keeps a shelter close.', ['cover', 'caution']],
  ['coins', 'curious', 'Collecting', 'reach', 'Bright coin eyes and an eager reach toward the next pickup.', ['greed', 'mobility']],
  ['guard', 'calm', 'Staying protected', 'brace', 'A compact stance tucked behind a protective guard.', ['defense', 'caution']],
  ['fight', 'angry', 'Looking for a fight', 'lean', 'Leans forward with a clenched attack mark.', ['aggression', 'scavenge']],
  ['ambush', 'angry', 'Seizing an opening', 'prowl', 'Narrows its eyes and stalks an exposed opponent.', ['opportunism', 'aggression', 'counter']],
  ['mischief', 'curious', 'Making mischief', 'tilt', 'A sideways grin and a playful decoy flourish.', ['novelty', 'sabotage', 'range']],
  ['odor-seeking', 'curious', 'Seeking gross things', 'sniff', 'An inquisitive nose; actual fumes begin only after a stink effect.', ['stink', 'defense']],
  ['devotion', 'calm', 'Finding a quiet ritual', 'breathe', 'A slow centred breath with a small devotional glow.', ['devotion', 'cover']],
  ['tools', 'curious', 'Hunting for tools', 'inspect', 'Studies equipment with a small tool-shaped glint.', ['scavenge', 'opportunism']],
  ['trap', 'curious', 'Setting a surprise', 'scheme', 'A calculating look and a tiny trap mechanism.', ['sabotage', 'novelty']],
  ['mystery', 'curious', 'Opening a mystery', 'peek', 'Wide questioning eyes and an impatient little peek.', ['chest', 'novelty']],
  ['speed', 'afraid', 'Keeping a way out', 'dart', 'A light stance, glances back and quick escape marks.', ['mobility', 'range', 'caution']],
  ['watch', 'calm', 'Watching the perimeter', 'scan', 'Stands upright and scans both sides from its guarded position.', ['defense', 'aggression', 'counter']],
  ['riposte', 'angry', 'Waiting to counter', 'recoil', 'Coils back, then answers an opponent with a return arrow.', ['counter', 'opportunism']],
  ['wonder', 'curious', 'Trying everything', 'sway', 'Alternating delighted eyes and a scattered burst of discovery.', ['novelty', 'chest', 'mobility']],
];

export const BEHAVIOR_EXPRESSIONS = Object.freeze(PRESETS.map((preset, index) => {
  const [motif, kind, label, gesture, description, axes] = descriptions[index];
  return Object.freeze({ id: preset.id, index, motif, kind, label, gesture, description, axes: Object.freeze(axes), policy: Object.freeze({ preferences: preset.preferences, tone: preset.tone }) });
}));

const clamp = value => Math.max(0, Math.min(1, value));

/** Every numeric axis contributes to matching, expression strength and/or reaction. */
export function expressionProfile(policy) {
  const provided = policy?.preferences;
  const traits = Object.fromEntries(AXES.map(axis => [axis, Number.isFinite(provided?.[axis]) ? clamp(provided[axis] / 100) : 0]));
  // An older replay without policies remains a quiet neutral presence.
  let profile = BEHAVIOR_EXPRESSIONS[2], error = 0;
  if (provided) {
    const matches = BEHAVIOR_EXPRESSIONS.map(candidate => ({
      candidate,
      error: AXES.reduce((sum, axis) => sum + (traits[axis] - candidate.policy.preferences[axis] / 100) ** 2, 0) / AXES.length,
    })).sort((a, b) => a.error - b.error || a.candidate.index - b.candidate.index);
    profile = matches[0].candidate;
    error = matches[0].error;
  }
  const mean = AXES.reduce((sum, axis) => sum + traits[axis], 0) / AXES.length;
  const motive = profile.axes.reduce((sum, axis) => sum + traits[axis], 0) / profile.axes.length;
  const modifiers = {
    benefit: .78 + traits.greed * .1 + traits.scavenge * .07 + traits.chest * .05,
    harm: .78 + traits.caution * .08 + traits.cover * .08 + traits.defense * .06,
    threat: .7 + traits.caution * .14 + traits.range * .1 + traits.cover * .06,
    attack: .7 + traits.aggression * .15 + traits.opportunism * .1 + traits.counter * .05,
    discovery: .72 + traits.novelty * .12 + traits.chest * .07 + traits.sabotage * .05 + traits.stink * .04,
    focus: .75 + traits.devotion * .1 + traits.defense * .08 + traits.counter * .07,
    energy: .8 + traits.mobility * .2,
  };
  return {
    ...profile, reason: `strategy-${profile.motif}`, profileId: profile.id,
    strength: provided ? .75 * motive + .25 * mean : .3,
    confidence: provided ? clamp(1 - Math.sqrt(error)) : 0,
    traits, modifiers,
  };
}

/** All active mechanical families have an anticipation/reaction motif. */
export const ITEM_EXPRESSIONS = Object.freeze(Object.fromEntries([
  ['shelter', 'cover', 'afraid', 'crouch'],
  ['weapon', 'tools', 'curious', 'inspect'],
  ['guard', 'guard', 'calm', 'brace'],
  ['chest', 'mystery', 'curious', 'peek'],
  ['wheels', 'speed', 'curious', 'dart'],
  ['trip', 'trap', 'afraid', 'recoil'],
  ['music', 'wonder', 'curious', 'sway'],
  ['food', 'coins', 'curious', 'reach'],
  ['heal', 'guard', 'calm', 'breathe'],
  ['coffee', 'speed', 'curious', 'dart'],
  ['stink', 'odor-seeking', 'curious', 'sniff'],
  ['devotion', 'devotion', 'calm', 'breathe'],
  ['slow', 'trap', 'afraid', 'recoil'],
  ['slide', 'speed', 'afraid', 'recoil'],
  ['skate', 'speed', 'curious', 'dart'],
  ['trail', 'mischief', 'curious', 'tilt'],
  ['wash', 'guard', 'calm', 'breathe'],
  ['decoy', 'mischief', 'curious', 'tilt'],
  ['trap', 'trap', 'curious', 'scheme'],
  ['coin-route', 'coins', 'curious', 'reach'],
  ['magnet', 'coins', 'curious', 'reach'],
  ['snare', 'trap', 'curious', 'scheme'],
  ['reach', 'tools', 'curious', 'inspect'],
  ['perch', 'watch', 'calm', 'scan'],
  ['snip', 'tools', 'curious', 'inspect'],
  ['alert', 'watch', 'calm', 'scan'],
  ['focus', 'watch', 'calm', 'breathe'],
  ['brace', 'guard', 'calm', 'brace'],
  ['read', 'watch', 'curious', 'scan'],
  ['mark', 'ambush', 'angry', 'prowl'],
  ['taunt', 'fight', 'angry', 'lean'],
  ['feint', 'mischief', 'curious', 'tilt'],
  ['parry', 'riposte', 'calm', 'recoil'],
  ['tempo', 'speed', 'curious', 'dart'],
  ['anchor', 'guard', 'calm', 'brace'],
  ['shove', 'fight', 'angry', 'lean'],
  ['projectile', 'tools', 'curious', 'inspect'],
  ['escort', 'guard', 'calm', 'brace'],
  ['platform', 'watch', 'calm', 'scan'],
  ['rush', 'speed', 'angry', 'dart'],
  ['coin-snare', 'coins', 'curious', 'reach'],
  ['pulse-zone', 'trap', 'curious', 'scheme'],
  ['fake', 'mischief', 'curious', 'tilt'],
  ['barricade', 'guard', 'calm', 'brace'],
  ['beacon', 'watch', 'calm', 'scan'],
  ['door', 'cover', 'afraid', 'crouch'],
  ['dustguard', 'guard', 'calm', 'brace'],
  ['charge', 'fight', 'angry', 'lean'],
].map(([effect, motif, kind, gesture]) => [effect, Object.freeze({ effect, motif, kind, gesture })])));

export function itemExpression(item) {
  return ITEM_EXPRESSIONS[item?.effect] ?? { motif: 'wonder', kind: 'curious', gesture: 'peek' };
}
