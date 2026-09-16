// Replay-only mechanical cues. Original portraits and collision geometry are untouched.
const TAU = Math.PI * 2, INK = '#27232b', PAPER = '#fff6dd';
const STATUS_GLYPHS = Object.freeze({
  magnet: 'magnet', reach: 'reach', perch: 'perch', alert: 'eye', focus: 'headphones',
  brace: 'shield', read: 'scan', mark: 'target', taunt: 'sound', feint: 'feint',
  parry: 'parry', tempo: 'clock', anchor: 'anchor', escort: 'cart', dustguard: 'umbrella', charge: 'charge', platform: 'platform', beacon: 'lamp',
});
export const MECHANIC_STATUS_KEYS = Object.freeze(Object.keys(STATUS_GLYPHS));

function path(g, points) {
  g.beginPath(); points.forEach(([x, y], index) => index ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
}
function circle(g, x, y, radius) { g.beginPath(); g.arc(x, y, radius, 0, TAU); g.stroke(); }
function glyph(g, kind) {
  if (kind === 'magnet') {
    g.beginPath(); g.moveTo(-5, -5); g.lineTo(-5, 1); g.bezierCurveTo(-5, 8, 5, 8, 5, 1); g.lineTo(5, -5); g.stroke();
    path(g, [[-7, -3], [-3, -3]]); path(g, [[3, -3], [7, -3]]);
  } else if (kind === 'reach') {
    path(g, [[-7, 0], [7, 0]]); path(g, [[-4, -3], [-7, 0], [-4, 3]]); path(g, [[4, -3], [7, 0], [4, 3]]);
  } else if (kind === 'perch') {
    path(g, [[-5, 7], [-3, -7]]); path(g, [[5, 7], [3, -7]]);
    for (const y of [-4, 0, 4]) path(g, [[-3, y], [3, y]]);
  } else if (kind === 'eye') {
    g.beginPath(); g.moveTo(-7, 0); g.quadraticCurveTo(0, -8, 7, 0); g.quadraticCurveTo(0, 8, -7, 0); g.stroke(); circle(g, 0, 0, 2);
  } else if (kind === 'headphones') {
    g.beginPath(); g.arc(0, 0, 6, Math.PI, TAU); g.stroke(); path(g, [[-6, -1], [-6, 5], [-3, 5], [-3, 0]]); path(g, [[6, -1], [6, 5], [3, 5], [3, 0]]);
  } else if (kind === 'shield') {
    path(g, [[0, -7], [6, -4], [5, 3], [0, 7], [-5, 3], [-6, -4], [0, -7]]);
  } else if (kind === 'scan') {
    for (const x of [-1, 1]) for (const y of [-1, 1]) path(g, [[x * 3, y * 7], [x * 7, y * 7], [x * 7, y * 3]]);
    path(g, [[-3, 0], [3, 0]]);
  } else if (kind === 'target') { circle(g, 0, 0, 5); path(g, [[0, -8], [0, 8]]); path(g, [[-8, 0], [8, 0]]); }
  else if (kind === 'sound') {
    path(g, [[-6, -2], [-2, -2], [3, -6], [3, 6], [-2, 2], [-6, 2], [-6, -2]]); path(g, [[6, -4], [8, 0], [6, 4]]);
  } else if (kind === 'feint') {
    g.beginPath(); g.moveTo(5, 6); g.bezierCurveTo(9, -7, -9, -7, -4, 0); g.stroke(); path(g, [[-7, -1], [-4, 2], [-1, -1]]);
  } else if (kind === 'parry') {
    path(g, [[-7, -6], [-1, 0], [-7, 6]]); path(g, [[-1, 0], [7, -6]]); path(g, [[3, -6], [7, -6], [7, -2]]);
  } else if (kind === 'clock') { circle(g, 0, 0, 7); path(g, [[0, -4], [0, 0], [4, 2]]); }
  else if (kind === 'anchor') {
    circle(g, 0, -5, 2); path(g, [[0, -3], [0, 7]]); path(g, [[-6, 0], [-6, 3], [0, 7], [6, 3], [6, 0]]); path(g, [[-3, -1], [3, -1]]);
  } else if (kind === 'cart') {
    path(g, [[-7, -6], [-4, -6], [-3, 3], [6, 3], [7, -3], [-3, -3]]); circle(g, -1, 6, 1); circle(g, 5, 6, 1);
  } else if (kind === 'umbrella') {
    g.beginPath(); g.arc(0, 0, 7, Math.PI, TAU); g.lineTo(-7, 0); g.stroke(); path(g, [[0, 0], [0, 6], [3, 7], [4, 5]]);
  } else if (kind === 'charge') {
    path(g, [[-6, -6], [0, 0], [-6, 6]]); path(g, [[1, -6], [7, 0], [1, 6]]);
  } else if (kind === 'platform') {
    path(g, [[-7, -2], [7, -2]]); path(g, [[-5, -2], [-5, 6]]); path(g, [[5, -2], [5, 6]]); path(g, [[-3, -5], [0, -8], [3, -5]]);
  } else if (kind === 'lamp') {
    circle(g, 0, -2, 4); path(g, [[-2, 2], [-2, 6], [2, 6], [2, 2]]);
    path(g, [[-8, -2], [-6, -2]]); path(g, [[6, -2], [8, -2]]); path(g, [[0, -8], [0, -7]]);
  }
}

/** At most two small equipment marks, separate from the emotional face sticker. */
export function paintMechanicStatus(g, fighter, seconds, { x = 0, y = 0, size = 102, hz = 20, color = '#56d9f5' } = {}) {
  if (!fighter || fighter.hp <= 0 || fighter.pose === 'khole' || !Number.isFinite(seconds)) return;
  const active = MECHANIC_STATUS_KEYS.filter(key => fighter.statuses?.[key] > seconds * hz).slice(0, 2);
  if (!active.length) return;
  g.save(); g.translate(x, y); g.scale(size / 102, size / 102); g.lineJoin = 'round'; g.lineCap = 'round';
  active.forEach((key, index) => {
    g.save(); g.translate(36 - index * 25, 32);
    g.beginPath(); g.arc(0, 0, 11, 0, TAU); g.fillStyle = PAPER; g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
    g.strokeStyle = key === 'mark' ? '#c93551' : color; g.lineWidth = 3.4; glyph(g, STATUS_GLYPHS[key]);
    g.strokeStyle = INK; g.lineWidth = 1.35; glyph(g, STATUS_GLYPHS[key]); g.restore();
  });
  g.restore();
}

/** Draw only declared regions. scale converts simulation distance into canvas units. */
export function paintMechanicZones(g, frame, seconds, { reduced = false, project = p => ({ x: p.x * .1024, y: p.y * .1024 }), scale = .1024 } = {}) {
  const tick = frame.tick;
  for (const zone of frame.zones ?? []) {
    if (!['pulse', 'slow-pulse', 'platform', 'beacon'].includes(zone.kind) || zone.start > tick || zone.until <= tick) continue;
    const p = project(zone), radius = zone.radius * scale;
    if (![p.x, p.y, radius].every(Number.isFinite) || radius <= 0) continue;
    const warning = zone.kind === 'pulse' && tick < zone.impact;
    const dormant = zone.kind === 'slow-pulse' && zone.period > 0 && (tick - zone.start) % zone.period >= zone.on;
    const color = zone.kind === 'platform' ? zone.speedCost > 0 ? '#38b4d1' : '#309a66' : zone.kind === 'beacon' ? '#e9b333' : dormant ? '#637a80' : warning ? '#efae24' : '#d54860';
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = color; g.fillStyle = color + '30'; g.lineWidth = 3;
    if (dormant) g.globalAlpha *= .35;
    g.beginPath(); g.arc(p.x, p.y, radius, 0, TAU); g.fill(); g.setLineDash(warning ? [8, 6] : zone.kind === 'slow-pulse' ? [4, 6] : []);
    g.strokeStyle = INK; g.lineWidth = 6; g.stroke(); g.strokeStyle = color; g.lineWidth = 3; g.stroke(); g.setLineDash([]);
    if (warning) {
      const progress = Math.max(0, Math.min(1, (tick - zone.start) / Math.max(1, zone.impact - zone.start)));
      g.lineWidth = 5; g.beginPath(); g.arc(p.x, p.y, radius + 4, -Math.PI / 2, -Math.PI / 2 + TAU * (reduced ? .75 : progress)); g.stroke();
      // Keep the warning below the feet so the fighter cannot hide it.
      const markerY = p.y + Math.min(35, radius * .55);
      g.beginPath(); g.moveTo(p.x, markerY - 12); g.lineTo(p.x + 11, markerY + 8); g.lineTo(p.x - 11, markerY + 8); g.closePath();
      g.fillStyle = '#ffd563'; g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
      path(g, [[p.x, markerY - 5], [p.x, markerY]]); circle(g, p.x, markerY + 4, 1);
    } else if (zone.kind === 'platform') {
      for (const side of [-1, 1]) path(g, [[p.x + side * radius * .7, p.y + 12], [p.x + side * radius * .5, p.y], [p.x + side * radius * .3, p.y + 12]]);
    } else if (zone.kind === 'beacon') {
      const a = reduced ? 0 : seconds * .55;
      for (let i = 0; i < 4; i++) { const angle = a + i * TAU / 4; path(g, [[p.x + Math.cos(angle) * radius * .35, p.y + Math.sin(angle) * radius * .35], [p.x + Math.cos(angle) * radius * .82, p.y + Math.sin(angle) * radius * .82]]); }
    } else {
      const r = radius * (reduced ? .65 : .55 + .1 * Math.sin(seconds * 5));
      g.globalAlpha *= .6; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.stroke();
    }
    g.restore();
  }
}
