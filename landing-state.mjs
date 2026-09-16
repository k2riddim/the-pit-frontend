// Only automatic landing changes after graduation. Explicit receipts, refunds,
// manifesto and fighter routes remain accessible, including during RPC failures.
export function landingView(hash, config) {
  const requested=String(hash||'').replace(/^#/,'').split('?')[0];
  const home=!config || config.launchGate?.required && config.launchGate.ready!==true ? 'launch' : 'play';
  return ['play','fighter','socks','ladder','launch','rules','manifesto','admin'].includes(requested)?requested:home;
}
