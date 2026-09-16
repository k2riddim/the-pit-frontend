// Actual PIT atomic-unit settlement for one fully funded six-seat arena.
// This pure calculation does not verify deposits, signatures or an honest seed.
// The caller must bind its output to the frozen roster and one on-chain outcome.
export const ECONOMY_VERSION = 'pit-arena-economy-1';
export const PIT_UNIT = 10n ** 18n;
export const PICKUP_UNITS = 24;
export const ENTRY_TIERS_USD_CENTS = Object.freeze([200, 1000, 2000]);
export const UINT256_MAX = (1n << 256n) - 1n;

const sum = values => values.reduce((total, value) => total + value, 0n);
const seatId = id => Number.isInteger(id) && id >= 0 && id < 6;
function amount(value, label) {
  if (typeof value !== 'bigint' || value < 0n || value > UINT256_MAX) throw new RangeError(`${label} must be a uint256 BigInt`);
  return value;
}

/**
 * Value a fighter's banked units out of the 24 existing one-unit map coins.
 * Input/output monetary values are PIT atomic-unit BigInts, never JS numbers.
 * Match PitArena.sol exactly: floor this fighter's proportional share. Rounding
 * remainder stays in the unspent pickup pot and is redistributed to the podium.
 */
export function pickupPayout(pickupBudgetPit, units) {
  amount(pickupBudgetPit, 'Pickup budget');
  if (!Number.isInteger(units) || units < 0 || units > PICKUP_UNITS) throw new RangeError('Pickup units outside the funded supply');
  return pickupBudgetPit * BigInt(units) / BigInt(PICKUP_UNITS);
}

/**
 * Stable settlement interface:
 * allocateArenaPayouts({
 *   contributions: [{ id: 0..5, amountPit: bigint > 0, human: boolean }],
 *   ranking: [{ id: 0..5, rank: 1..6, hp, coins, outAt, outOrder }],
 *   pickups: [{ id: 0..23, value: 1, owner: 0..5 | null }]
 * })
 *
 * All six seats must be genuinely funded at the same locked PIT stake; at least
 * one is human. Inputs are
 * not mutated. Output payouts are ordered by rank and include all six seats.
 * BigInts must be serialized as decimal strings at an API/storage boundary.
 *
 * Rounding matches PitArena.sol: floor 20% pickups, 50% first, 5% fee; the second
 * base receives the remainder. Split unspent pickup funds 2:1, assigning division
 * remainder to second. Founder fee is the human share
 * rounded down; the rest of the fee goes back to the bot bankroll. The separate
 * jackpot reserve is never an input or a beneficiary of this ordinary split.
 */
export function allocateArenaPayouts({ contributions, ranking, pickups } = {}) {
  if (!Array.isArray(contributions) || contributions.length !== 6 || new Set(contributions.map(s => s.id)).size !== 6
    || contributions.some(s => !seatId(s.id) || typeof s.human !== 'boolean')) throw new RangeError('Six uniquely identified funded seats required');
  for (const seat of contributions) if (amount(seat.amountPit, 'Seat contribution') === 0n) throw new RangeError('Every seat must be funded');
  if (contributions.some(seat => seat.amountPit !== contributions[0].amountPit)) throw new RangeError('All seats require the same locked stake');
  if (!contributions.some(s => s.human)) throw new RangeError('A paid arena requires a human participant');
  const grossPit = amount(sum(contributions.map(s => s.amountPit)), 'Funded total');
  if (!Array.isArray(ranking) || ranking.length !== 6 || new Set(ranking.map(f => f.id)).size !== 6
    || new Set(ranking.map(f => f.rank)).size !== 6 || ranking.some(f => !seatId(f.id) || !Number.isInteger(f.rank) || f.rank < 1 || f.rank > 6
      || !Number.isInteger(f.hp) || f.hp < 0 || f.hp > 100 || !Number.isInteger(f.coins) || f.coins < 0 || f.coins > PICKUP_UNITS)) throw new RangeError('A complete unique six-place ranking is required');
  const ordered = [...ranking].sort((a, b) => a.rank - b.rank);
  if (ordered[0].hp <= 0 || ordered[0].outAt !== null || ordered[0].outOrder !== null
    || ordered.slice(1).some(f => f.hp !== 0 || !Number.isInteger(f.outAt) || f.outAt < 1 || f.outAt > 1200
      || f.outOrder !== 6 - f.rank)) throw new RangeError('Ranking must have one survivor and the complete elimination order');
  if (ordered.slice(2).some((f, i) => f.outAt > ordered[i + 1].outAt)) throw new RangeError('Elimination times contradict placement');
  if (!Array.isArray(pickups) || pickups.length !== PICKUP_UNITS || new Set(pickups.map(c => c.id)).size !== PICKUP_UNITS
    || pickups.some(c => !Number.isInteger(c.id) || c.id < 0 || c.id >= PICKUP_UNITS || c.value !== 1 || c.owner !== null && !seatId(c.owner))) throw new RangeError('All 24 unique funded pickups are required');
  if (ordered.some(f => pickups.filter(c => c.owner === f.id).length !== f.coins)) throw new RangeError('Pickup ownership must equal the banked ranking counts');

  const pickupBudgetPit = grossPit * 20n / 100n;
  const feePit = grossPit * 5n / 100n;
  const baseFirstPit = grossPit * 50n / 100n;
  const baseSecondPit = grossPit - pickupBudgetPit - baseFirstPit - feePit;
  const bySeat = Array(6).fill(0n);
  for (const fighter of ordered) bySeat[fighter.id] = pickupPayout(pickupBudgetPit, fighter.coins);
  const collectedPit = sum(bySeat);
  const uncollectedPit = pickupBudgetPit - collectedPit;
  const uncollectedFirstPit = uncollectedPit * 2n / 3n;
  const uncollectedSecondPit = uncollectedPit - uncollectedFirstPit;
  const humanContributionsPit = sum(contributions.filter(s => s.human).map(s => s.amountPit));
  const botContributionsPit = grossPit - humanContributionsPit;
  const founderFeePit = feePit * humanContributionsPit / grossPit;
  const botFeeReturnPit = feePit - founderFeePit;
  const payouts = ordered.map(f => {
    const seat = contributions.find(s => s.id === f.id);
    const podiumPit = f.rank === 1 ? baseFirstPit + uncollectedFirstPit : f.rank === 2 ? baseSecondPit + uncollectedSecondPit : 0n;
    return { id: f.id, rank: f.rank, human: seat.human, contributionPit: seat.amountPit,
      pickupUnits: f.coins, pickupsPit: bySeat[f.id], podiumPit, totalPit: bySeat[f.id] + podiumPit };
  });
  const humanPayoutsPit = sum(payouts.filter(p => p.human).map(p => p.totalPit));
  const botWinningsPit = sum(payouts.filter(p => !p.human).map(p => p.totalPit));
  const botBankrollReturnPit = botWinningsPit + botFeeReturnPit;
  if (humanPayoutsPit + botBankrollReturnPit + founderFeePit !== grossPit) throw new Error('Funded PIT conservation failed');
  return { version: ECONOMY_VERSION, grossPit, pickupBudgetPit, baseFirstPit, baseSecondPit, feePit,
    humanContributionsPit, botContributionsPit, founderFeePit, botFeeReturnPit, collectedPit, uncollectedPit,
    uncollectedFirstPit, uncollectedSecondPit, payouts, humanPayoutsPit, botWinningsPit, botBankrollReturnPit };
}

/** Adapter for the canonical simulation: rejects unfinished/contradictory replays. */
export function settleArenaPayouts(replay, contributions) {
  if (!replay || replay.reason !== 'last-survivor' || !Number.isInteger(replay.ticks) || replay.ticks < 1 || replay.ticks > 1200
    || replay.hz !== 20 || replay.maxTicks !== 1200 || replay.pickupBudget !== PICKUP_UNITS) throw new RangeError('A completed one-survivor replay is required');
  const terminal = replay.frames?.at(-1);
  if (!terminal || terminal.tick !== replay.ticks || !Array.isArray(terminal.fighters) || terminal.fighters.length !== 6
    || new Set(terminal.fighters.map(f => f.id)).size !== 6 || !Array.isArray(replay.ranking) || replay.ranking.length !== 6
    || terminal.fighters.some(f => {
      const ranked = replay.ranking.find(r => r.id === f.id);
      return !ranked || ranked.hp !== f.hp || ranked.coins !== f.coins || ranked.outAt !== f.outAt || ranked.outOrder !== f.outOrder;
    }) || replay.ranking.some(f => f.outAt !== null && f.outAt > replay.ticks)) throw new RangeError('Replay terminal state contradicts its ranking');
  return allocateArenaPayouts({ contributions, ranking: replay.ranking, pickups: replay.map?.coins });
}
