// Deterministic service steps around the sandbox compiler: what happens before inference (trivial
// notes never reach the model), after inference (plain-words warnings, compile rules the model
// cannot be trusted with) and for the player (a one-sentence readback of the accepted plan).
// Dependency-free so the inference gateway Worker, the public lab Worker, the loopback lab and the
// Node study tools all run exactly the same code.
import { AXES } from './policy.mjs';
import { DEFAULT_INTENT } from './sandbox-policy.mjs';

export const SERVICE_VERSION = 'yard-sandbox-service-2';
export const NEUTRAL_LEVEL = 35;
export const MIN_TOTAL = 150;

const WORD_LIMIT = 30;
const BANNED = /\b(weights?|preferences?|intents?|executable|engagement|anchors?|territory|territories|contract|schema|compiler|controller|parameters?|defaults?|axis|axes|policy|tendenc(?:y|ies))\b/i;
const CLASSES = [
  [/\b(shed|hangar|hut|cabane|szop\w*|caseta|capanno|сарай|棚)\b|棚/iu, 'The tool shed is reserved for affiliated fighters; yours will look for other cover.'],
  [/\b(time[sd]?|timer|seconds?|minutes?|phase[sd]?|sequence[sd]?|schedul\w*|later|first then|after that|when (?:hurt|damaged|low|the zone|shrinking))\b/i, 'Your fighter cannot follow a timed plan; it plays the first part of your note from the bell.'],
  [/\b(target\w*|specific (?:opponent|fighter|player)|player \d|opponents? by name|team\w*|all(?:y|ies|iance)|friend\w*|pact|truce)\b/i, 'Your fighter cannot pick out one opponent or team up; it treats everyone the same.'],
  [/\b(chair|mallet|hammer|toilet|cooler|crate|box|cone|sign|ladder|glasses|crown|object|item|weapon|shield|armou?r|prop)\w*\b/i, 'Naming an object only makes your fighter prefer that kind of object when it sees one.'],
  [/\b(health|hp|damage|speed|iq|stats?|invincib\w*|immortal\w*|teleport\w*|god mode|invisib\w*)\b/i, 'Notes cannot change health, damage or speed; those are fixed by the game.'],
  [/\b(win|wins|winning|victory|guarantee\w*|rig\w*|cheat\w*)\b/i, 'No note can promise a win; the rules stay the same for everyone.'],
  [/\b(coordinates?|exact (?:spot|position|path)|route|path)\b/i, 'Your fighter cannot follow an exact path; it can hold or roam a corner or the middle.'],
];
const FALLBACK = 'Part of your note has no matching move in this game; your fighter keeps the rest.';

const words = text => String(text ?? '').trim().split(/\s+/).filter(Boolean);

/** A note with fewer than three letters, or no word of three letters, carries no order. */
export function trivialNote(note) {
  if (typeof note !== 'string') return true;
  const letters = note.match(/\p{L}/gu) ?? [];
  if (letters.length < 3) return true;
  return !note.split(/[\s\p{P}]+/u).some(token => (token.match(/\p{L}/gu) ?? []).length >= 3);
}

export function neutralPolicy() {
  return { preferences: Object.fromEntries(AXES.map(k => [k, NEUTRAL_LEVEL])), tone: 'plain' };
}

/** The answer for a note that never reaches the model: the match seed picks the personality. */
export const TRIVIAL_MESSAGE = 'Your note has no orders, so the match seed picks a random personality. No inference was used.';
export const NO_ORDERS_MESSAGE = 'Your note gave no orders, so the match seed picks a random personality, exactly as for a blank note.';
export function blankPlan(reason = TRIVIAL_MESSAGE) {
  return { policy: null, intent: structuredClone(DEFAULT_INTENT), warnings: [reason] };
}

/** Rewrite a model warning that speaks designer, or runs too long, into one fixed plain sentence. */
export function plainWarning(warning) {
  const text = String(warning ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (!BANNED.test(text) && words(text).length <= WORD_LIMIT) return text;
  for (const [pattern, sentence] of CLASSES) if (pattern.test(text)) return sentence;
  return FALLBACK;
}
export function plainWarnings(warnings) {
  const out = [];
  for (const w of Array.isArray(warnings) ? warnings : []) { const p = plainWarning(w); if (p && !out.includes(p)) out.push(p); }
  return out.slice(0, 12);
}

const ANCHOR_WORDS = Object.freeze({ 'top-left': 'top-left corner', 'top-right': 'top-right corner', 'bottom-left': 'bottom-left corner', 'bottom-right': 'bottom-right corner', center: 'middle of the yard' });
const SHED_WORDS = /\b(shed|hangar|hut|cabane|szop\w*|caseta|capanno|hide|hiding|hideout|cach(?:e|er|é)\w*|schowaj|escond\w*|nascond\w*|verstec\w*|прячься|спрячься|隠れ|躲|棚)\b|棚|躲|隠れ/iu;

// Neutral preferences do not mean "no orders" when the compiler has also accepted
// an actual corner, engagement rule, item choice or later phase. Older optional
// fields are checked by meaning, rather than object key order or JSON equality.
function hasOrders(intent) {
  return intent.territory.anchor !== 'any' || intent.engagement.mode !== 'any'
    || intent.engagement.chase !== 'any' || (intent.engagement.target ?? 'any') !== 'any'
    || Boolean(intent.items?.seek?.length || intent.items?.avoid?.length || intent.then);
}

/**
 * Deterministic rules applied to every accepted plan. Returns a new plan; never throws on a valid
 * plan. `options.affiliate` says whether the fighter may use the shed; `options.note` is the note.
 */
export function applyCompileRules(plan, options = {}) {
  const note = typeof options.note === 'string' ? options.note : '';
  // The shed lock is only asserted when the caller knows the fighter is not affiliated.
  const lockShed = options.affiliate === false;
  const policy = { preferences: { ...plan.policy.preferences }, tone: plan.policy.tone };
  // Copy the whole intent, including the version 2 fields (items, then) when present.
  const intent = structuredClone(plan.intent);
  intent.territory = { ...plan.intent.territory }; intent.engagement = { ...plan.intent.engagement };
  const warnings = plainWarnings(plan.warnings).map(warning => intent.then && warning === CLASSES[1][1]
    ? 'Your fighter can change plans once; any later steps in your note cannot be followed.' : warning);
  const applied = [];
  // The compiler answers a note without orders with the neutral profile (every tendency 35). Measured
  // against seeded random personalities that profile is a strong fighter (docs/35 section 5), so a
  // note without orders must not earn it: it is treated exactly like a blank note. An all-zero or
  // near-empty profile gets the same treatment.
  const total = AXES.reduce((n, k) => n + policy.preferences[k], 0);
  if (!hasOrders(intent) && (total < MIN_TOTAL || AXES.every(k => policy.preferences[k] === NEUTRAL_LEVEL))) {
    const blank = blankPlan(NO_ORDERS_MESSAGE);
    // Keep real limitations (for example no allies) instead of erasing the only
    // explanation of why the request could not be followed. Drop the compiler's
    // obsolete neutral-personality sentence, which the seed deliberately replaces.
    blank.warnings = [...new Set([NO_ORDERS_MESSAGE, ...warnings.filter(warning => !/\b(?:no orders|balanced (?:game|personality|profile))\b/i.test(warning))])].slice(0, 12);
    return { plan: blank, applied: ['no-orders-random'] };
  }
  if (total < MIN_TOTAL) {
    policy.preferences = neutralPolicy().preferences;
    warnings.push('Your fighter keeps its accepted orders and uses a balanced style for its other choices.');
    applied.push('empty-preferences-balanced');
  }
  if (intent.territory.mode === 'hold' && policy.preferences.greed >= 60 && intent.territory.anchor !== 'any') {
    intent.territory.mode = 'roam';
    intent.territory.radius = 'large';
    if (intent.engagement.mode === 'intruders') intent.engagement.mode = 'any';
    if (intent.engagement.chase === 'territory') intent.engagement.chase = 'any';
    warnings.push(`A held area has few coins, so your fighter roams around the ${ANCHOR_WORDS[intent.territory.anchor]} instead of standing in it.`);
    applied.push('greedy-hold-roams');
  }
  if (lockShed && SHED_WORDS.test(note)) {
    const sentence = 'The tool shed is reserved for affiliated fighters; yours will look for other cover.';
    if (!warnings.includes(sentence)) warnings.push(sentence);
    applied.push('shed-lock');
  }
  return { plan: { policy, intent, warnings: [...new Set(warnings)].slice(0, 12) }, applied };
}

const TRAIT_WORDS = Object.freeze({
  aggression: 'picks fights', greed: 'goes for coins', cover: 'looks for shelter', range: 'keeps its distance', novelty: 'tries every gadget it sees',
  caution: 'plays it safe', opportunism: 'hunts weakened fighters', defense: 'holds its ground', stink: 'goes for gross tricks', devotion: 'takes devotion pauses',
  scavenge: 'grabs tools first', sabotage: 'sets traps', chest: 'opens risky crates', mobility: 'keeps moving', counter: 'waits for openings, then punishes',
});

const ITEM_WORDS = Object.freeze({ weapon: 'weapons', protection: 'protective gear', recovery: 'recovery items', container: 'containers', shelter: 'shelter', hazard: 'hazards', gadget: 'gadgets' });
const TARGET_WORDS = Object.freeze({ weakest: 'the lowest-health fighters', richest: 'the fighters carrying the most coins', attacker: 'fighters that recently hurt it', armed: 'armed fighters', unarmed: 'unarmed fighters' });
const joinWords = values => values.length < 2 ? values[0] ?? '' : values.slice(0, -1).join(', ') + ' and ' + values.at(-1);
function orderWords(intent) {
  const parts = [], t = intent.territory, e = intent.engagement;
  if (t.anchor !== 'any') parts.push(t.mode === 'hold' ? `stays in the ${ANCHOR_WORDS[t.anchor]}` : `roams around the ${ANCHOR_WORDS[t.anchor]}`);
  if (e.mode === 'avoid') parts.push('never starts a fight');
  else if (e.mode === 'intruders') parts.push('only attacks whoever enters its area');
  else if (e.mode === 'retaliate') parts.push('only hits back');
  else if (e.chase === 'none') parts.push('waits for opponents to come close');
  if (TARGET_WORDS[e.target]) parts.push(`prefers ${TARGET_WORDS[e.target]} when choosing whom to fight`);
  if (intent.items?.seek?.length) parts.push(`looks for ${joinWords(intent.items.seek.map(kind => ITEM_WORDS[kind]))}`);
  if (intent.items?.avoid?.length) parts.push(`avoids using ${joinWords(intent.items.avoid.map(kind => ITEM_WORDS[kind]))}`);
  return parts;
}
const TRIGGER_WORDS = Object.freeze({
  time: value => `after ${value} seconds`, health: value => `when health falls below ${value}`,
  zone: () => 'when the boundary starts closing', damaged: () => 'after its first health loss', coins: value => `after collecting ${value} coin${value === 1 ? '' : 's'}`,
});

/** Plain readback of every accepted order; no internal labels or preference scores.
 * The optional second sentence names its actual trigger, including player-relevant
 * time/health/coin thresholds, so the player can identify the change on the board.
 */
export function describePlan(plan, options = {}) {
  if (!plan || !plan.policy) return 'Your fighter gets a random personality from the match seed and follows no orders.';
  const p = plan.policy.preferences, intent = plan.intent ?? DEFAULT_INTENT;
  const ranked = AXES.map(k => [k, p[k]]).sort((a, b) => b[1] - a[1] || AXES.indexOf(a[0]) - AXES.indexOf(b[0]));
  const strong = ranked.filter(([, v]) => v >= 55).slice(0, 2);
  const parts = [];
  if (!strong.length) parts.push('plays a balanced game');
  else if (strong.length === 1) parts.push(TRAIT_WORDS[strong[0][0]]);
  else parts.push(`${TRAIT_WORDS[strong[0][0]]} and ${TRAIT_WORDS[strong[1][0]]}`);
  parts.push(...orderWords(intent));
  let sentence = 'Your fighter ' + (parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1)) + '.';
  if (intent.then) {
    const next = orderWords(intent.then), trigger = TRIGGER_WORDS[intent.then.trigger.kind](intent.then.trigger.value);
    sentence += ` Then, ${trigger}, it ${next.length ? joinWords(next) : 'roams freely and chooses freely whom to fight and which objects to use'}.`;
  }
  if (options.affiliate === false && p.cover >= 55) sentence += ' The tool shed is closed to it, so it looks for other cover.';
  return sentence;
}
