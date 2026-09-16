export function hasPendingJackpot(room) {
  return room?.jackpotPending===true||Object.values(room?.payouts||{}).some(payout=>payout?.jackpotPending===true);
}
