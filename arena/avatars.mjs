// Presentation only: never change combat geometry or original NFT files.
export const ROSTER = Object.freeze([
  { id: 0, name: 'DOOMBA', color: '#cf3634', key: 616563414, affiliate: false, source: 'Sock specimen · key 616563414', note: 'grab the shiny things. avoid trouble. probably.' },
  { id: 1, name: 'GRIMSOCK', color: '#a43287', key: 2156819263, affiliate: false, source: 'Sock specimen · Gizmo artwork preserved', note: 'keep the little cat safe. everyone else can wait.' },
  { id: 2, name: 'SOGGY LASAGNA', color: '#2968b6', key: 6, affiliate: false, source: 'Sock specimen · key 6', note: 'if it looks like a bad idea, have a little look.' },
  { id: 3, name: 'PUPSTIN 3:16', color: '#387746', image: '/assets/puppet-2800.png', affiliate: true, source: 'Bitcoin Puppets #2800 · full original image', note: 'two chairs. one terrible plan. world peace.' },
  { id: 4, name: 'WOSSUM PRIME', color: '#9c7020', image: '/assets/puppet-1306.png', affiliate: true, source: 'Bitcoin Puppets #1306 · full original image', note: 'coffee first. everything else after.' },
  { id: 5, name: 'THE CONSULTANT', color: '#486266', key: 0, affiliate: false, source: 'Original sock specimen · key 0', note: 'i have prepared a very sensible plan.' },
]);

export function poseTransform(pose, seconds, seat = 0, reduced = false) {
  if (!Number.isFinite(seconds)) throw new RangeError('Finite animation time required');
  const phase = seconds * 12 + seat * 1.7;
  let x = 0, y = 0, angle = 0, sx = 1, sy = 1;
  if (pose === 'khole') { angle = 0.9; sy = 0.82; y = 7; }
  else if (!reduced) {
    if (pose === 'idle' || pose === 'hiding' || pose === 'channel') y = Math.sin(phase * .22) * 1.2;
    if (pose === 'travel') { y = -Math.abs(Math.sin(phase)) * 5; angle = Math.sin(phase) * .065; }
    if (pose === 'windup') { angle = -.2; x = -4; sx = 1.06; sy = .94; }
    if (pose === 'recover') { angle = .15; x = 3; }
    if (pose === 'pickup') { y = -5 - Math.abs(Math.sin(phase * .8)) * 5; sy = 1.03; }
    if (pose === 'evade') { angle = -.22; x = Math.sin(phase) * 3; }
    if (pose === 'stagger') { angle = Math.sin(phase * 2) * .12; x = Math.sin(phase * 2) * 3; }
  }
  // Never flip an entire NFT: its text and asymmetric features stay correctly oriented.
  return { x, y, angle, sx, sy };
}

export const POSE_LABELS = { idle: 'waiting', travel: 'on the move', windup: 'winding up', recover: 'catching breath', pickup: 'found something', evade: 'getting away', stagger: 'seeing stars', khole: 'K-hole', hiding: 'taking cover' };
