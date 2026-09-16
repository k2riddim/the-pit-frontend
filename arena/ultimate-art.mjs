// Replay-only Sticker Yard spell art. Shapes use recorded footprints; decoration
// never applies gameplay, draws randomness, or changes replay timing.
const TAU = Math.PI * 2, SCALE = .1024, HZ = 20;
const INK = '#27232b', PAPER = '#fff6dd';
export const ULTIMATE_PALETTE = Object.freeze({
  'peace-patch': Object.freeze({ name: 'Peace Patch', color: '#54bf76', glyph: 'peace' }),
  'big-bonk': Object.freeze({ name: 'Big Bonk', color: '#f69b3c', glyph: 'hammer' }),
  'sticky-situation': Object.freeze({ name: 'Sticky Situation', color: '#d870bb', glyph: 'goo' }),
  socknado: Object.freeze({ name: 'Socknado', color: '#4fcddd', glyph: 'wind' }),
  'pocket-shed': Object.freeze({ name: 'Pocket Shed', color: '#639aee', glyph: 'shed' }),
  'wossum-beam': Object.freeze({ name: 'Wossum Beam', color: '#f1d344', glyph: 'star' }),
  scrapfall: Object.freeze({ name: 'Scrapfall', color: '#d9a86a', glyph: 'scrap' }),
  'magnet-mayhem': Object.freeze({ name: 'Magnet Mayhem', color: '#ed7085', glyph: 'magnet' }),
  'lunch-break': Object.freeze({ name: 'Lunch Break', color: '#ffbd80', glyph: 'lunch' }),
  'bass-drop': Object.freeze({ name: 'Bass Drop', color: '#f173ca', glyph: 'speaker' }),
});
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finite = (...values) => values.every(Number.isFinite);
const support = ability => ability === 'peace-patch' || ability === 'pocket-shed' || ability === 'lunch-break';
/** Detailed state belongs in the accessible inspector, not six floating labels. */
export function ultimateStatus(fighter, tick = 0) {
  const definition = ULTIMATE_PALETTE[fighter?.ultimateId];
  if (!definition || !Number.isFinite(fighter?.ultimateCharge)) return null;
  const charge = clamp(fighter.ultimateCharge, 0, 100);
  const phase = fighter.hp <= 0 ? 'K-hole' : fighter.ultimatePhase === 'spent' ? 'Used this match'
    : fighter.ultimatePhase === 'ready' ? 'Ready' : fighter.ultimatePhase === 'casting' ? 'Casting'
    : `Charging ${Math.round(charge)}%`;
  const guard = fighter.hp > 0 && fighter.ultimateGuardUntil > tick ? Math.max(0, fighter.ultimateGuard ?? 0) : 0;
  const snared = fighter.hp > 0 && fighter.ultimateSnaredUntil > tick;
  return { name: definition.name, charge, phase, guard, snared,
    text: `${definition.name} · ${phase}${guard > 0 ? ` · ${guard} shield` : ''}${snared ? ' · Snared' : ''}` };
}
function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); }
function line(g, points) { g.beginPath(); points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); }
function polygon(g, points) { g.beginPath(); points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); }
function ellipse(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); }
function outline(g, color, width = 3) { g.fillStyle = color; g.fill(); g.strokeStyle = INK; g.lineWidth = width; g.stroke(); }
function star(g, x, y, radius) {
  polygon(g, Array.from({ length: 8 }, (_, i) => {
    const angle = i * Math.PI / 4 - Math.PI / 2, r = radius * (i % 2 ? .25 : 1);
    return [x + Math.cos(angle) * r, y + Math.sin(angle) * r];
  }));
}
const easeOut = p => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
function linearGlow(g, x0, y0, x1, y1, stops) {
  const gradient = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color)); return gradient;
}
function radialGlow(g, x, y, radius, stops) {
  const gradient = g.createRadialGradient(x, y, 0, x, y, Math.max(.1, radius));
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color)); return gradient;
}
function luminousStroke(g, color, width, core = PAPER) {
  g.strokeStyle = color + '28'; g.lineWidth = width * 3; g.stroke();
  g.strokeStyle = color + '85'; g.lineWidth = width * 1.7; g.stroke();
  g.strokeStyle = color; g.lineWidth = width; g.stroke();
  g.strokeStyle = core; g.lineWidth = Math.max(1, width * .28); g.stroke();
}
function shard(g, x, y, size, angle, color) {
  g.save(); g.translate(x, y); g.rotate(angle);
  polygon(g, [[-size, 0], [-size * .25, -size * .8], [size, -size * .15], [size * .5, size * .65]]);
  g.fillStyle = color; g.fill(); g.strokeStyle = '#453340'; g.lineWidth = 1.5; g.stroke();
  line(g, [[-size * .25, -size * .8], [size * .1, 0], [size, -size * .15]]); g.restore();
}
function corona(g, x, y, radius, color, phase = 0) {
  // This is a floating four-point flare, not another ground damage marker.
  g.save(); g.translate(x, y); g.rotate(phase);
  star(g, 0, 0, radius); g.fillStyle = color + '38'; g.fill();
  star(g, 0, 0, radius * .65); g.fillStyle = color; g.fill();
  star(g, 0, 0, radius * .37); g.fillStyle = PAPER; g.fill(); g.restore();
}
function fade(age, lifetime, reduced) {
  // One smooth envelope, not a periodic flash. Reduced motion stays static.
  return reduced ? .9 : clamp((lifetime - age) / Math.max(5, lifetime * .42), 0, 1);
}
function beamPath(g, zone, radius) {
  const x = zone.x * SCALE, y = zone.y * SCALE, fx = zone.fromX * SCALE, fy = zone.fromY * SCALE;
  const dx = x - fx, dy = y - fy, length = Math.hypot(dx, dy);
  const nx = -dy / length * radius, ny = dx / length * radius;
  polygon(g, [[fx + nx, fy + ny], [x + nx, y + ny], [x - nx, y - ny], [fx - nx, fy - ny]]);
}
function boundary(g, zone, radius) {
  if (zone.ability === 'wossum-beam') beamPath(g, zone, radius);
  else circle(g, zone.x * SCALE, zone.y * SCALE, radius);
}
function groundWarning(g, zone, definition, tick, radius, reduced) {
  const progress = reduced ? .7 : clamp((tick - zone.start) / Math.max(1, zone.impact - zone.start), 0, 1);
  const x = zone.x * SCALE, y = zone.y * SCALE;
  if (support(zone.ability)) {
    // A self-buff, not a healing/damage area for neighbouring fighters.
    ellipse(g, x, y + 5, 35, 12); g.fillStyle = definition.color + '38'; g.fill();
    luminousStroke(g, definition.color, 3); return;
  }
  boundary(g, zone, radius); g.fillStyle = definition.color + '20'; g.fill();
  g.strokeStyle = '#27232bba'; g.lineWidth = 6; g.stroke();
  g.setLineDash([11, 7]); luminousStroke(g, definition.color, 2.5); g.setLineDash([]);
  // Charging light is clipped to the committed gameplay footprint.
  g.save(); boundary(g, zone, radius); g.clip();
  if (zone.ability === 'wossum-beam') {
    const fx = zone.fromX * SCALE, fy = zone.fromY * SCALE;
    g.strokeStyle = definition.color + '80'; g.lineWidth = 2 + progress * 4;
    line(g, [[fx, fy], [x, y]]);
    const nx = -(y - fy) / Math.hypot(x - fx, y - fy), ny = (x - fx) / Math.hypot(x - fx, y - fy);
    for (const side of [-1, 1]) {
      const distance = radius * (1 - progress * .68) * side;
      line(g, [[fx + nx * distance, fy + ny * distance], [x + nx * distance, y + ny * distance]]);
    }
  } else if (zone.ability === 'magnet-mayhem') {
    g.translate(x, y); magnetRails(g, radius, progress);
  } else {
    circle(g, x, y, radius);
    g.fillStyle = radialGlow(g, x, y, radius, [[0, definition.color + '00'], [.56, definition.color + '04'], [.86, definition.color + '38'], [1, definition.color + '00']]); g.fill();
    // Four contracting brackets and inward shafts read as one impending impact.
    for (let i = 0; i < 4; i++) {
      const angle = i * TAU / 4 + .15, r = radius * (.92 - progress * .26);
      g.save(); g.translate(x + Math.cos(angle) * r, y + Math.sin(angle) * r); g.rotate(angle);
      g.strokeStyle = PAPER; g.lineWidth = 3; line(g, [[7, -10], [0, 0], [7, 10]]);
      g.strokeStyle = definition.color; g.lineWidth = 2; line(g, [[11, 0], [radius * .27, 0]]); g.restore();
    }
  }
  g.restore();
}
function blastGround(g, definition, age, radius, reduced) {
  const expansion = reduced ? .96 : .15 + .81 * easeOut(age / 8);
  circle(g, 0, 0, radius); g.fillStyle = '#492c2824'; g.fill();
  g.strokeStyle = '#73402b'; g.lineWidth = 2; g.stroke();
  g.save(); circle(g, 0, 0, radius); g.clip();
  circle(g, 0, 0, radius);
  g.fillStyle = radialGlow(g, 0, 0, radius, [[0, '#fffbd39c'], [.24, '#ffdc7472'], [.66, '#f69b3c22'], [1, '#f69b3c00']]); g.fill();
  circle(g, 0, 0, radius * expansion); luminousStroke(g, '#ffac48', reduced ? 5 : 10 - 5 * clamp(age / 20, 0, 1));
  circle(g, 0, 0, radius * expansion * .79); g.strokeStyle = '#f7c478'; g.lineWidth = 2; g.stroke();
  // Fissures terminate inside the real 950-unit impact circle.
  for (let i = 0; i < 7; i++) {
    const a = i * TAU / 7 + .13, r = radius * .87;
    g.strokeStyle = '#492b27'; g.lineWidth = i % 2 ? 3 : 5;
    line(g, [[Math.cos(a) * 15, Math.sin(a) * 15], [Math.cos(a + .14) * r * .47, Math.sin(a + .14) * r * .47],
      [Math.cos(a - .06) * r * .68, Math.sin(a - .06) * r * .68], [Math.cos(a) * r, Math.sin(a) * r]]);
    g.strokeStyle = '#ffc269'; g.lineWidth = 1.2; g.stroke();
  }
  g.restore();
}
function gooGround(g, radius, age, reduced) {
  const spread = reduced ? .94 : .3 + .64 * easeOut(age / 6);
  circle(g, 0, 0, radius); g.strokeStyle = '#723063'; g.lineWidth = 2; g.stroke();
  g.save(); circle(g, 0, 0, radius); g.clip();
  circle(g, 0, 0, radius * spread);
  g.fillStyle = radialGlow(g, 0, 0, radius, [[0, '#3c174bba'], [.45, '#9e388f9a'], [.8, '#e784d179'], [1, '#d870bb00']]); g.fill();
  g.strokeStyle = '#f28ed7'; g.lineWidth = 3; g.stroke();
  for (let i = 0; i < 6; i++) {
    const a = i * TAU / 6 + .3, r = radius * spread;
    g.beginPath(); g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    g.bezierCurveTo(Math.cos(a + .5) * r * .7, Math.sin(a + .5) * r * .7,
      Math.cos(a - .4) * r * .3, Math.sin(a - .4) * r * .3, 0, 0);
    luminousStroke(g, '#e77acc', 2.5, '#ffdcf0');
  }
  g.restore();
}
function windGround(g, radius, age, reduced) {
  circle(g, 0, 0, radius); g.strokeStyle = '#367d89'; g.lineWidth = 2; g.stroke();
  g.save(); circle(g, 0, 0, radius); g.clip();
  circle(g, 0, 0, radius);
  g.fillStyle = radialGlow(g, 0, 0, radius, [[0, '#143d6048'], [.34, '#56d9e44d'], [.72, '#9befff18'], [1, '#4fcddd00']]); g.fill();
  const expansion = reduced ? .96 : .16 + .8 * easeOut(age / 9);
  circle(g, 0, 0, radius * expansion); luminousStroke(g, '#5bdfe8', 5);
  for (let i = 0; i < 5; i++) {
    const angle = i * TAU / 5 + (reduced ? .2 : age * .09);
    g.beginPath(); g.arc(0, 0, radius * (.25 + i * .13), angle, angle + 1.6);
    g.strokeStyle = i % 2 ? '#f0ffffce' : '#61d7eac2'; g.lineWidth = 2 + i * .6; g.stroke();
  }
  g.restore();
}
function scrapGround(g, radius, age, reduced) {
  // A shallow steel-grey crater and three radial cracks. The falling assembly,
  // rather than a second ring of particles, carries this spell's silhouette.
  g.save(); circle(g, 0, 0, radius); g.clip();
  circle(g, 0, 0, radius);
  g.fillStyle = radialGlow(g, 0, 0, radius, [[0, '#3e475522'], [.5, '#54657818'], [.82, '#d9a86a33'], [1, '#d9a86a00']]); g.fill();
  const expansion = reduced ? .93 : .18 + .75 * easeOut(age / 7);
  circle(g, 0, 0, radius * expansion); luminousStroke(g, '#dbbc85', 4, '#fff0c8');
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3 + .55;
    const at = (r, turn = 0) => [Math.cos(a + turn) * radius * r, Math.sin(a + turn) * radius * r];
    g.strokeStyle = '#3b4652'; g.lineWidth = 3;
    line(g, [at(.3), at(.48, .15), at(.63, -.04), at(.89)]);
  }
  g.restore();
}
function magnetRails(g, radius, progress) {
  // Four inward rails only. Both ends stay within the frozen cast footprint;
  // they do not connect to a moving caster or imply a map-wide pull.
  for (let i = 0; i < 4; i++) {
    const angle = i * TAU / 4 + .35, r = radius * (.8 - .39 * progress);
    g.save(); g.rotate(angle);
    g.strokeStyle = i % 2 ? '#7ad6e099' : '#f3a0b199'; g.lineWidth = 2;
    line(g, [[radius * .27, 0], [radius * .87, 0]]);
    g.beginPath(); g.moveTo(r + 15, -11); g.lineTo(r, 0); g.lineTo(r + 15, 11);
    luminousStroke(g, i % 2 ? '#8ddfe7' : '#f4a0b5', 3); g.restore();
  }
}
function magnetGround(g, radius, age, reduced) {
  g.save(); circle(g, 0, 0, radius); g.clip();
  circle(g, 0, 0, radius);
  g.fillStyle = radialGlow(g, 0, 0, radius, [[0, '#ed708500'], [.55, '#ed70850d'], [.9, '#ed70852d'], [1, '#ed708500']]); g.fill();
  g.strokeStyle = '#c76a85'; g.lineWidth = 2; g.stroke();
  magnetRails(g, radius, reduced ? .65 : easeOut(age / 10));
  g.restore();
}
function bassGround(g, radius, age, reduced) {
  g.save(); circle(g, 0, 0, radius); g.clip();
  circle(g, 0, 0, radius); g.strokeStyle = '#8e4b7d'; g.lineWidth = 2; g.stroke();
  // One coherent wave, not repeated pulses or musical-note confetti. Its edge
  // expands to, and never past, the actual damage/snare circle under the feet.
  const expansion = reduced ? .93 : .15 + .78 * easeOut(age / 9);
  const waveRadius = radius * expansion;
  circle(g, 0, 0, waveRadius);
  g.fillStyle = radialGlow(g, 0, 0, waveRadius, [[0, '#f173ca00'], [.7, '#f173ca00'], [.92, '#f173ca36'], [1, '#ffbb7445']]); g.fill();
  luminousStroke(g, '#f173ca', reduced ? 6 : 10 - 4 * clamp(age / 18, 0, 1), '#ffd5a2');
  g.restore();
}
function beamGround(g, zone, radius, age, reduced) {
  // The marked corridor remains below avatars. Light is clipped to its exact
  // rectangular footprint, including the longitudinal rays.
  beamPath(g, zone, radius); g.fillStyle = '#94652158'; g.fill();
  g.strokeStyle = '#9d6824'; g.lineWidth = 2; g.stroke();
  g.save(); beamPath(g, zone, radius); g.clip();
  const x = zone.x * SCALE, y = zone.y * SCALE, fx = zone.fromX * SCALE, fy = zone.fromY * SCALE;
  const dx = x - fx, dy = y - fy, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
  beamPath(g, zone, radius);
  g.fillStyle = linearGlow(g, fx - nx * radius, fy - ny * radius, fx + nx * radius, fy + ny * radius,
    [[0, '#ec922c05'], [.15, '#ec922c9d'], [.32, '#ffe34eea'], [.46, '#fffbe9'], [.54, '#fffbe9'], [.68, '#ffe34eea'], [.85, '#ec922c9d'], [1, '#ec922c05']]); g.fill();
  const punch = reduced ? .7 : 1 - clamp(age / 22, 0, 1);
  g.strokeStyle = PAPER; g.lineWidth = radius * (.3 + punch * .25); line(g, [[fx, fy], [x, y]]);
  for (const side of [-1, 1]) {
    g.beginPath();
    for (let i = 0; i <= 14; i++) {
      const u = i / 14, flutter = reduced ? Math.sin(i * 1.7) : Math.sin(i * 1.7 - age * .52);
      const transverse = radius * (.66 + flutter * .13) * side;
      const px = fx + dx * u + nx * transverse, py = fy + dy * u + ny * transverse;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    luminousStroke(g, '#ffd55a', 2.3);
  }
  const offset = reduced ? .22 : (age % 7) / 7;
  for (let i = 0; i < 6; i++) {
    const u = (i + offset) / 6, cx = fx + dx * u, cy = fy + dy * u;
    g.strokeStyle = '#fffce7'; g.lineWidth = 2;
    line(g, [[cx - nx * radius * .88 - dx / len * 21, cy - ny * radius * .88 - dy / len * 21],
      [cx, cy], [cx + nx * radius * .88 - dx / len * 21, cy + ny * radius * .88 - dy / len * 21]]);
  }
  g.restore();
}
function groundImpact(g, zone, definition, tick, radius, reduced, fighter) {
  const age = Math.max(0, tick - zone.impact);
  g.globalAlpha = fade(age, zone.until - zone.impact, reduced);
  if (zone.ability === 'wossum-beam') { beamGround(g, zone, radius, age, reduced); return; }
  g.translate(support(zone.ability) && fighter ? fighter.x * SCALE : zone.x * SCALE,
    support(zone.ability) && fighter ? fighter.y * SCALE : zone.y * SCALE);
  if (zone.ability === 'big-bonk') blastGround(g, definition, age, radius, reduced);
  else if (zone.ability === 'sticky-situation') gooGround(g, radius, age, reduced);
  else if (zone.ability === 'socknado') windGround(g, radius, age, reduced);
  else if (zone.ability === 'scrapfall') scrapGround(g, radius, age, reduced);
  else if (zone.ability === 'magnet-mayhem') magnetGround(g, radius, age, reduced);
  else if (zone.ability === 'bass-drop') bassGround(g, radius, age, reduced);
  else {
    ellipse(g, 0, 5, 38, 14); g.fillStyle = definition.color + '55'; g.fill(); luminousStroke(g, definition.color, 4);
    ellipse(g, 0, 5, 27, 9); g.strokeStyle = PAPER; g.lineWidth = 2; g.stroke();
  }
}
function mallet(g, tick, zone, reduced) {
  const telling = tick < zone.impact, age = tick - zone.impact;
  const progress = reduced ? .7 : clamp((tick - zone.start) / Math.max(1, zone.impact - zone.start), 0, 1);
  const plunge = Math.pow(clamp((progress - .62) / .38, 0, 1), 3);
  const drop = reduced ? 12 : telling ? 205 - 193 * plunge : -Math.sin(clamp(age / 9, 0, 1) * Math.PI) * 18;
  const x = zone.x * SCALE, y = zone.y * SCALE;
  g.save(); g.translate(x, y - 20 - drop);
  g.rotate(reduced ? -.12 : telling ? -.36 + .24 * plunge : -.12);
  const size = telling ? .84 + .16 * progress : reduced ? 1 : 1 + .08 * (1 - clamp(age / 6, 0, 1)); g.scale(size, size);
  // Vertical trails stop at the head; they never add another damage footprint.
  if (telling && progress > .64 && !reduced) {
    for (const sx of [-66, -39, 43, 70]) {
      g.strokeStyle = sx % 2 ? '#ffddaaab' : '#e69440a0'; g.lineWidth = sx % 2 ? 4 : 2;
      line(g, [[sx, -67], [sx + 16, -190]]);
    }
  }
  polygon(g, [[-11, -152], [10, -152], [15, -25], [-13, -25]]);
  g.fillStyle = linearGlow(g, -12, 0, 14, 0, [[0, '#644734'], [.28, '#c49465'], [.58, '#f2c28a'], [1, '#79523e']]); g.fill(); g.strokeStyle = INK; g.lineWidth = 3; g.stroke();
  for (let i = 0; i < 5; i++) { g.strokeStyle = '#724a37'; g.lineWidth = 3; line(g, [[-9, -141 + i * 13], [10, -147 + i * 13]]); }
  polygon(g, [[-77, -46], [58, -46], [78, -31], [78, 9], [57, 26], [-77, 26], [-87, 12], [-87, -29]]);
  g.fillStyle = linearGlow(g, 0, -46, 0, 26, [[0, '#fff1b2'], [.22, '#ffca68'], [.55, '#ef9635'], [1, '#9d4c20']]); g.fill(); g.strokeStyle = '#4b2e29'; g.lineWidth = 4; g.stroke();
  polygon(g, [[-77, -46], [58, -46], [78, -31], [-66, -31]]); g.fillStyle = '#ffeeb5'; g.fill();
  polygon(g, [[58, -46], [78, -31], [78, 9], [57, 26], [57, -17]]); outline(g, '#b46324', 2);
  g.strokeStyle = '#724329'; g.lineWidth = 5; line(g, [[-56, -31], [-56, 23]]); line(g, [[41, -31], [41, 23]]);
  g.strokeStyle = '#fff1c3'; g.lineWidth = 2; line(g, [[-53, -29], [-53, 20]]); line(g, [[44, -29], [44, 19]]);
  star(g, -5, -2, 16); g.fillStyle = '#ffe4a0'; g.fill();
  g.restore();
  if (!telling) {
    const flight = reduced ? .55 : clamp(age / 18, 0, 1), radius = zone.radius * SCALE;
    for (let i = 0; i < 9; i++) {
      const a = i * TAU / 9 + .2, r = radius * (.2 + .68 * easeOut(flight)), lift = Math.sin(flight * Math.PI) * (27 + i % 3 * 11);
      shard(g, x + Math.cos(a) * r, y + Math.sin(a) * r - lift, 4 + i % 3 * 2, a + flight * 3, i % 2 ? '#edb571' : '#8b6554');
    }
    if (reduced || age < 6) corona(g, x, y - 26, reduced ? 37 : 70 * (1 - age / 8), '#ffd272', .3);
  }
}
function lightColumn(g, x, y, ability, telling, progress, reduced) {
  const healing = ability === 'peace-patch', color = healing ? '#54bf76' : '#639aee';
  const height = telling ? 185 + progress * 92 : 352, width = telling ? 18 + progress * 12 : 36;
  g.save(); g.translate(x, y);
  // A tall authored shaft, open in the centre: the player remains visible even
  // at impact. The small foot halo is still the only support ground marker.
  const glow = linearGlow(g, 0, -height, 0, 10, [[0, color + '00'], [.18, color + '20'], [.6, color + '15'], [1, color + '55']]);
  polygon(g, [[-width * 1.35, -height], [width * 1.35, -height], [width, 3], [-width, 3]]); g.fillStyle = glow; g.fill();
  for (const side of [-1, 1]) {
    const shaft = linearGlow(g, 0, -height, 0, 0, [[0, color + '00'], [.23, '#fffef166'], [.65, color + 'cc'], [1, '#fffbed']]);
    polygon(g, [[side * width * 1.2, -height], [side * width * .88, -height], [side * width * .85, 0], [side * width * 1.1, 0]]); g.fillStyle = shaft; g.fill();
    g.beginPath(); g.moveTo(side * width * 1.08, -height * .85); g.lineTo(side * width, 0); luminousStroke(g, color, telling ? 1.8 : 3.2);
  }
  if (!telling) {
    // Three broad, ascending energy arcs replace a cloud of little sparkles.
    for (let i = 0; i < 3; i++) {
      const ascent = reduced ? .3 : progress, cy = -30 - ((i / 3 + ascent * .8) % 1) * (height - 60);
      g.beginPath(); g.ellipse(0, cy, 34 + i * 3, 8 + i * 2, -.15, .1, Math.PI * 1.16);
      luminousStroke(g, color, 2.5);
    }
  }
  if (healing) {
    const lift = telling ? height * .68 : 218 + (reduced ? 0 : progress * 26);
    g.save(); g.translate(0, -lift);
    corona(g, 0, 0, telling ? 36 : 67, '#a0f7a8', -.12);
    circle(g, 0, 0, telling ? 23 : 31); g.fillStyle = '#245137'; g.fill(); luminousStroke(g, '#8dec9b', 4);
    const s = telling ? .73 : 1; g.scale(s, s);
    g.beginPath(); g.moveTo(0, -27); g.lineTo(0, 27); g.moveTo(-19, 20); g.lineTo(0, 0); g.lineTo(19, 20); luminousStroke(g, '#9df5a8', 4); g.restore();
  } else {
    // A projected architectural crown, not a damage dome.
    const roofY = telling ? -149 : -187;
    corona(g, 0, roofY + 14, telling ? 26 : 60, '#8dc5ff', .2);
    polygon(g, [[-54, roofY + 35], [0, roofY], [54, roofY + 35], [41, roofY + 43], [0, roofY + 14], [-41, roofY + 43]]);
    g.fillStyle = linearGlow(g, 0, roofY, 0, roofY + 43, [[0, '#f5fbff'], [.45, '#abd5ff'], [1, '#4687db']]); g.fill(); g.strokeStyle = '#286197'; g.lineWidth = 2; g.stroke();
    if (!telling) {
      for (const side of [-1, 1]) {
        g.beginPath(); g.moveTo(side * 42, roofY + 49); g.lineTo(side * 48, -97); g.lineTo(side * 34, -72); luminousStroke(g, '#8dc5ff', 3);
      }
      polygon(g, [[-18, roofY + 57], [0, roofY + 48], [18, roofY + 57], [13, roofY + 83], [0, roofY + 93], [-13, roofY + 83]]); g.fillStyle = '#315c97'; g.fill(); luminousStroke(g, '#b9dcff', 2);
    }
  }
  g.restore();
}
function tornado(g, x, y, age, reduced) {
  g.save(); g.translate(x, y);
  const growth = reduced ? 1 : .38 + .62 * easeOut(age / 6); g.scale(growth, growth);
  // A single dimensional tapered storm, with layered front and rear ribbons.
  g.beginPath(); g.moveTo(-80, -257); g.bezierCurveTo(-131, -195, -7, -127, -13, 0);
  g.quadraticCurveTo(0, 20, 13, 0); g.bezierCurveTo(8, -110, 137, -213, 80, -257); g.closePath();
  g.fillStyle = linearGlow(g, -90, 0, 90, 0, [[0, '#16374910'], [.18, '#257e9674'], [.42, '#8ff2f84a'], [.55, '#e1ffff33'], [.8, '#3095a575'], [1, '#204d630d']]); g.fill();
  for (let i = 0; i < 6; i++) {
    const drift = reduced ? Math.sin(i * .8) * 4 : Math.sin(age * .24 + i * .8) * 9;
    const cy = -20 - i * 44, rx = 15 + i * 16, ry = 7 + i * 3;
    g.beginPath(); g.ellipse(drift, cy, rx, ry, -.12, Math.PI, TAU); g.strokeStyle = '#347b9380'; g.lineWidth = 9 + i; g.stroke();
    g.beginPath(); g.moveTo(drift - rx, cy + 3);
    g.bezierCurveTo(drift - rx * .5, cy + ry * 1.7, drift + rx * .76, cy + ry * 1.2, drift + rx, cy - 5);
    g.lineTo(drift + rx * .96, cy + 4);
    g.bezierCurveTo(drift + rx * .65, cy + ry * 2, drift - rx * .65, cy + ry * 2.2, drift - rx, cy + 9); g.closePath();
    g.fillStyle = linearGlow(g, drift - rx, 0, drift + rx, 0, [[0, '#2c869bb4'], [.25, '#8de8f3dc'], [.55, '#edfffff0'], [.83, '#61d8e7c7'], [1, '#207f9790']]); g.fill();
    g.beginPath(); g.ellipse(drift, cy, rx, ry, -.12, .1, Math.PI * .95); luminousStroke(g, '#6cdeed', i % 2 ? 2 : 3.5);
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + (reduced ? .8 : age * .19), r = 48 + i * 15;
    shard(g, Math.cos(a) * r, -90 - i * 56 + Math.sin(a) * 15, 7 + i, a, i % 2 ? '#fae8d2' : '#99dde2');
  }
  g.restore();
}
function gooTendrils(g, x, y, radius, age, reduced) {
  g.save(); g.translate(x, y);
  const rise = reduced ? .86 : .26 + .74 * easeOut(age / 6);
  for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4 + .7, px = Math.cos(a) * radius * .59, py = Math.sin(a) * radius * .5;
    const height = (75 + i % 2 * 24) * rise, side = px < 0 ? 1 : -1;
    g.save(); g.translate(px, py); g.scale(side, 1);
    g.beginPath(); g.moveTo(-12, 3); g.bezierCurveTo(-26, -height * .5, -15, -height, 9, -height);
    g.quadraticCurveTo(28, -height + 1, 28, -height + 24); g.lineTo(15, -height + 16);
    g.quadraticCurveTo(-5, -height + 10, 8, -11); g.lineTo(16, 3); g.closePath();
    g.fillStyle = linearGlow(g, -20, 0, 25, 0, [[0, '#522954'], [.35, '#a83fa3'], [.68, '#ef9fdb'], [1, '#ab458f']]); g.fill(); g.strokeStyle = '#532648'; g.lineWidth = 2.5; g.stroke();
    g.beginPath(); g.moveTo(-4, -5); g.bezierCurveTo(-17, -height * .6, -9, -height + 5, 10, -height + 8); luminousStroke(g, '#f297de', 2);
    corona(g, 20, -height + 14, 12, '#f9bce8', .1); g.restore();
  }
  g.restore();
}
function chargeCrest(g, zone, telling, progress, reduced) {
  const beam = zone.ability === 'wossum-beam', wind = zone.ability === 'socknado';
  const color = beam ? '#ffe46b' : '#82e6f2', x = (beam ? zone.fromX : zone.x) * SCALE, y = (beam ? zone.fromY : zone.y) * SCALE;
  const lift = telling ? 113 + progress * 22 : 140, size = telling ? 14 + progress * 15 : 34;
  g.save(); g.translate(x, y - lift);
  // One crest above the caster supplies a readable source, not extra HUD text.
  if (beam) {
    corona(g, 0, 0, size * (telling ? 1.25 : 2), color, -.15);
    polygon(g, [[0, -size], [size * .75, 0], [0, size], [-size * .75, 0]]); g.fillStyle = '#835522'; g.fill(); luminousStroke(g, color, 2.5);
    star(g, 0, 0, size * .62); g.fillStyle = PAPER; g.fill();
    if (telling) for (const side of [-1, 1]) {
      g.beginPath(); g.moveTo(side * 19, 24); g.quadraticCurveTo(side * 34, 58, side * 22, lift - 10); luminousStroke(g, color, 1.7);
    }
  } else if (wind && telling) {
    for (let i = 0; i < 3; i++) {
      const turn = reduced ? .2 : progress * 2, a = i * TAU / 3 + turn;
      g.beginPath(); g.arc(0, 0, size + i * 6, a, a + 1.9); luminousStroke(g, color, 2);
    }
  }
  g.restore();
}
function fallingScrap(g, zone, telling, progress, age, reduced) {
  const x = zone.x * SCALE, y = zone.y * SCALE, radius = zone.radius * SCALE;
  const plunge = Math.pow(clamp((progress - .58) / .42, 0, 1), 3);
  const lift = reduced ? telling ? 195 : 118 : telling ? 258 - plunge * 190 : 68;
  if (telling || reduced || age < 6) {
    g.save(); g.translate(x, y - lift); g.rotate(-.16);
    const size = reduced ? 1 : telling ? .83 + .17 * progress : 1 - age * .04; g.scale(size, size);
    // One recognisable junk assembly: a bolted steel girder with an open lower
    // frame and a toothed end. At impact it breaks away, exposing the fighters.
    polygon(g, [[-78, -72], [58, -72], [80, -52], [70, -26], [50, -21], [-74, -29]]);
    g.fillStyle = linearGlow(g, 0, -72, 0, -21, [[0, '#e3e9e7'], [.32, '#97a8ad'], [.5, '#d9bc8a'], [1, '#475c67']]);
    g.fill(); g.strokeStyle = '#35424b'; g.lineWidth = 4; g.stroke();
    polygon(g, [[-67, -30], [-44, -30], [-44, 7], [33, 7], [33, -25], [54, -25], [54, 28], [-67, 28]]); outline(g, '#7d9097', 3);
    polygon(g, [[58, -72], [80, -52], [70, -26], [57, -28], [65, -48], [49, -65]]); outline(g, '#c4965b', 2);
    for (const bx of [-56, -9, 38]) { circle(g, bx, -51, 5); outline(g, '#f5dfb6', 2); }
    g.strokeStyle = '#edf3ef'; g.lineWidth = 2; line(g, [[-60, 13], [-60, -20]]); line(g, [[-69, -63], [46, -63]]);
    g.restore();
  }
  if (!telling) {
    const flight = reduced ? .6 : clamp(age / 18, 0, 1);
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3 + .5, distance = radius * (.28 + .52 * easeOut(flight));
      const rise = reduced ? 18 : Math.sin(flight * Math.PI) * (25 + i * 10);
      shard(g, x + Math.cos(a) * distance, y + Math.sin(a) * distance - rise,
        11 + i * 2, a + flight, i % 2 ? '#a3b4b7' : '#d8b17d');
    }
  }
}
function horseshoe(g, x, y, telling, progress, reduced) {
  g.save(); g.translate(x, y - (telling ? 155 + progress * 20 : 177));
  const size = reduced ? 1 : telling ? .75 + progress * .25 : 1 + .08 * (1 - progress); g.scale(size, size);
  // Open horseshoe, large enough to recognise but entirely above the avatar.
  polygon(g, [[-65, 29], [-65, -25], [-52, -60], [-28, -78], [28, -78], [52, -60], [65, -25], [65, 29],
    [36, 29], [36, -20], [26, -43], [13, -50], [-13, -50], [-26, -43], [-36, -20], [-36, 29]]);
  g.fillStyle = linearGlow(g, -65, 0, 65, 0, [[0, '#a64063'], [.27, '#ffabb4'], [.5, '#d85277'], [.74, '#eb8a99'], [1, '#7f3459']]);
  g.fill(); g.strokeStyle = '#4d334d'; g.lineWidth = 4; g.stroke();
  for (const side of [-1, 1]) {
    const ax = side < 0 ? -65 : 36;
    polygon(g, [[ax, 5], [ax + 29, 5], [ax + 29, 33], [ax, 33]]); outline(g, side < 0 ? '#ffe9cf' : '#8bdde4', 3);
    g.strokeStyle = '#fff8e8'; g.lineWidth = 2; line(g, [[ax + 4, 12], [ax + 25, 12]]);
  }
  g.beginPath(); g.moveTo(-52, -23); g.quadraticCurveTo(-48, -66, -16, -65); luminousStroke(g, '#ffd4d6', 2);
  g.restore();
}
function lunchbox(g, x, y, telling, progress, reduced) {
  const opening = telling ? 0 : reduced ? 1 : easeOut(progress * 5);
  g.save(); g.translate(x, y);
  if (!telling) {
    // Two broad peach steam ribbons frame an empty centre, never an AoE dome.
    for (const side of [-1, 1]) {
      g.beginPath(); g.moveTo(side * 24, -8);
      g.bezierCurveTo(side * 49, -50, side * 27, -104, side * 54, -151);
      g.strokeStyle = linearGlow(g, 0, -160, 0, -8, [[0, '#ffe7ae00'], [.35, '#ffc78e63'], [.7, '#ffbd8055'], [1, '#ffedbb88']]);
      g.lineWidth = 13; g.stroke();
      g.beginPath(); g.moveTo(side * 35, -199);
      const drift = reduced ? 4 : Math.sin(progress * Math.PI) * 9;
      g.bezierCurveTo(side * (64 + drift), -222, side * 13, -239, side * 39, -273);
      luminousStroke(g, '#ffd39b', 3, '#fff0c8');
    }
  }
  g.translate(0, telling ? -141 - progress * 15 : -158);
  const size = reduced ? 1 : telling ? .78 + .22 * progress : 1; g.scale(size, size);
  polygon(g, [[-65, -24], [65, -24], [58, 27], [-57, 27]]);
  g.fillStyle = linearGlow(g, 0, -24, 0, 27, [[0, '#ffe8b2'], [.45, '#ffb477'], [1, '#bd6a43']]); g.fill(); g.strokeStyle = '#674536'; g.lineWidth = 4; g.stroke();
  if (!telling) {
    ellipse(g, 0, -24, 56, 10); g.fillStyle = '#fff2bd'; g.fill(); luminousStroke(g, '#ffcb82', 3);
    // A single steaming meal, not floating heal numbers or new status badges.
    ellipse(g, 0, -27, 32, 7); g.fillStyle = '#f4c674'; g.fill();
  }
  g.save(); g.translate(-65, -28); g.rotate(-opening * .72);
  polygon(g, [[-2, -12], [130, -12], [132, 3], [0, 7]]); outline(g, '#ffce94', 3);
  g.beginPath(); g.moveTo(47, -14); g.lineTo(47, -30); g.quadraticCurveTo(64, -42, 81, -30); g.lineTo(81, -14);
  g.strokeStyle = '#5e453d'; g.lineWidth = 7; g.stroke();
  g.restore();
  polygon(g, [[-8, -13], [8, -13], [8, 4], [-8, 4]]); outline(g, '#ffebba', 2);
  g.strokeStyle = '#ffe2b0'; g.lineWidth = 2; line(g, [[-48, 15], [44, 15]]);
  g.restore();
}
function boombox(g, x, y, telling, progress, reduced) {
  const punch = telling || reduced ? 0 : 1 - easeOut(progress * 5);
  g.save(); g.translate(x, y - 153 - punch * 12); g.rotate(-.1);
  const size = reduced ? 1 : telling ? .73 + .27 * progress : 1 + punch * .12; g.scale(size, size);
  // Two physical speakers in one silhouette, rather than floating music notes.
  polygon(g, [[-84, -42], [78, -42], [89, -30], [86, 35], [-82, 35], [-89, 21]]);
  g.fillStyle = linearGlow(g, 0, -42, 0, 35, [[0, '#645269'], [.4, '#322f42'], [1, '#191e2d']]); g.fill(); g.strokeStyle = '#28232e'; g.lineWidth = 4; g.stroke();
  polygon(g, [[-84, -42], [78, -42], [89, -30], [-75, -30]]); outline(g, '#eb899d', 2);
  g.beginPath(); g.moveTo(-36, -44); g.lineTo(-36, -62); g.lineTo(39, -62); g.lineTo(39, -44); g.strokeStyle = '#312b3b'; g.lineWidth = 8; g.stroke();
  for (const sx of [-50, 51]) {
    circle(g, sx, -1, 27); g.fillStyle = '#1d1f2d'; g.fill(); luminousStroke(g, '#f173ca', 3, '#ffba87');
    circle(g, sx, -1, 18 + punch * 3); g.fillStyle = radialGlow(g, sx, -1, 23, [[0, '#ffdcb2'], [.3, '#eb84b7'], [.55, '#534257'], [1, '#292b3d']]); g.fill();
    circle(g, sx, -1, 6); g.fillStyle = '#ffd6a2'; g.fill();
  }
  polygon(g, [[-16, -14], [17, -14], [17, 15], [-16, 15]]); outline(g, '#b07491', 2);
  polygon(g, [[-10, -8], [11, -8], [11, 3], [-10, 3]]); g.fillStyle = '#ffe4ac'; g.fill();
  g.strokeStyle = '#ffd1a3'; g.lineWidth = 2; line(g, [[-66, 29], [67, 29]]);
  g.restore();
}
function foreground(g, zone, tick, radius, reduced, fighter) {
  const telling = tick < zone.impact, age = Math.max(0, tick - zone.impact);
  const progress = reduced ? .65 : telling ? clamp((tick - zone.start) / Math.max(1, zone.impact - zone.start), 0, 1)
    : clamp(age / Math.max(1, zone.until - zone.impact), 0, 1);
  if (!telling) g.globalAlpha = fade(age, zone.until - zone.impact, reduced);
  if (zone.ability === 'big-bonk') mallet(g, tick, zone, reduced);
  else if (zone.ability === 'scrapfall') fallingScrap(g, zone, telling, progress, age, reduced);
  else if (zone.ability === 'magnet-mayhem') horseshoe(g, zone.x * SCALE, zone.y * SCALE, telling, progress, reduced);
  else if (zone.ability === 'bass-drop') boombox(g, zone.x * SCALE, zone.y * SCALE, telling, progress, reduced);
  else if (zone.ability === 'lunch-break') lunchbox(g, fighter ? fighter.x * SCALE : zone.x * SCALE,
    fighter ? fighter.y * SCALE : zone.y * SCALE, telling, progress, reduced);
  else if (support(zone.ability)) lightColumn(g, fighter ? fighter.x * SCALE : zone.x * SCALE,
    fighter ? fighter.y * SCALE : zone.y * SCALE, zone.ability, telling, progress, reduced);
  else if (zone.ability === 'socknado') {
    if (telling) chargeCrest(g, zone, telling, progress, reduced);
    else tornado(g, zone.x * SCALE, zone.y * SCALE, age, reduced);
  }
  else if (!telling && zone.ability === 'sticky-situation') gooTendrils(g, zone.x * SCALE, zone.y * SCALE, radius, age, reduced);
  else if (zone.ability === 'wossum-beam') chargeCrest(g, zone, telling, progress, reduced);
  // Beam energy stays below avatars; only its overhead source crest is in front.
}
function fighterEffects(g, fighters, tick, layer) {
  for (const fighter of fighters.slice(0, 6)) {
    if (!finite(fighter.x, fighter.y, fighter.hp) || fighter.hp <= 0) continue;
    const x = fighter.x * SCALE, y = fighter.y * SCALE;
    if (layer === 'ground' && fighter.ultimateSnaredUntil > tick) {
      ellipse(g, x, y + 5, 28, 11); g.strokeStyle = INK; g.lineWidth = 7; g.stroke();
      g.strokeStyle = '#d870bb'; g.lineWidth = 4; g.stroke();
      line(g, [[x - 20, y + 1], [x - 18, y - 8]]); line(g, [[x + 20, y + 1], [x + 18, y - 8]]);
    }
    if (layer === 'foreground' && Number.isFinite(fighter.ultimateGuard) && fighter.ultimateGuard > 0 && fighter.ultimateGuardUntil > tick) {
      // Open blue contour carries persistent protection without a second label.
      g.beginPath(); g.moveTo(x - 29, y - 89); g.lineTo(x - 43, y - 71);
      g.quadraticCurveTo(x - 46, y - 4, x - 13, y + 10);
      g.moveTo(x + 29, y - 89); g.lineTo(x + 43, y - 71);
      g.quadraticCurveTo(x + 46, y - 4, x + 13, y + 10);
      g.strokeStyle = PAPER; g.lineWidth = 6; g.stroke(); g.strokeStyle = '#639aee'; g.lineWidth = 3; g.stroke();
    }
  }
}

/** Call in 1024-unit camera space. Ground before avatars; foreground after them.
 * Omit layer for standalone callers needing both passes. No world text is drawn.
 */
export function paintUltimateWorld(g, frame, seconds, { reduced = false, layer = 'all' } = {}) {
  if (!frame || !Number.isFinite(seconds) || !['all', 'ground', 'foreground'].includes(layer)) return;
  const tick = Number.isFinite(frame.tick) ? frame.tick : seconds * HZ;
  const fighters = Array.isArray(frame.fighters) ? frame.fighters : [];
  const zones = (Array.isArray(frame.zones) ? frame.zones : []).filter(zone => {
    if (zone?.kind !== 'ultimate' || !ULTIMATE_PALETTE[zone.ability]) return false;
    if (!finite(zone.x, zone.y, zone.radius, zone.start, zone.impact, zone.until, zone.owner)) return false;
    if (Math.abs(zone.x) > 20000 || Math.abs(zone.y) > 20000 || zone.radius <= 0 || zone.radius > 10000 || zone.start > zone.impact || zone.impact >= zone.until || zone.start > tick || zone.until <= tick) return false;
    return zone.ability !== 'wossum-beam' || (finite(zone.fromX, zone.fromY) && Math.abs(zone.fromX) <= 20000 && Math.abs(zone.fromY) <= 20000 && Math.hypot(zone.x - zone.fromX, zone.y - zone.fromY) >= 1);
  }).slice(0, 12);
  g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
  for (const pass of layer === 'all' ? ['ground', 'foreground'] : [layer]) {
    for (const zone of zones) {
      const definition = ULTIMATE_PALETTE[zone.ability], radius = zone.radius * SCALE;
      const fighter = fighters.find(f => f.id === zone.owner && f.hp > 0 && finite(f.x, f.y));
      g.save();
      if (pass === 'ground') {
        if (tick < zone.impact) groundWarning(g, zone, definition, tick, radius, reduced);
        else groundImpact(g, zone, definition, tick, radius, reduced, fighter);
      } else foreground(g, zone, tick, radius, reduced, fighter);
      g.restore();
    }
    fighterEffects(g, fighters, tick, pass);
  }
  g.restore();
}

/** Discreet selected-fighter charge cue. Full details remain in the DOM HUD. */
export function paintUltimateHud(g, frame, seconds, { camera = { x: 512, y: 512, zoom: 1 }, selected = 0, ui = 1 } = {}) {
  if (!frame || !Number.isFinite(seconds) || !finite(camera?.x, camera?.y, camera?.zoom, ui) || camera.zoom <= 0 || ui <= 0) return;
  const fighter = frame.fighters?.find(f => f.id === selected);
  if (!ULTIMATE_PALETTE[fighter?.ultimateId] || !finite(fighter.x, fighter.y, fighter.hp, fighter.ultimateCharge) || fighter.hp <= 0 || fighter.ultimatePhase === 'spent') return;
  const scale = clamp(ui, .7, 2);
  const x = (fighter.x * SCALE - camera.x) * camera.zoom + 512;
  const y = (fighter.y * SCALE - camera.y) * camera.zoom + 512 + 46 * camera.zoom;
  if (!finite(x, y) || x < 30 || x > 994 || y < 20 || y > 950) return;
  const width = 38 * scale, height = 4 * scale, charge = clamp(fighter.ultimateCharge, 0, 100);
  g.save(); g.fillStyle = INK; g.fillRect(x - width / 2 - 2, y - 2, width + 4, height + 4);
  g.fillStyle = PAPER; g.fillRect(x - width / 2, y, width, height);
  g.fillStyle = ULTIMATE_PALETTE[fighter.ultimateId].color; g.fillRect(x - width / 2, y, width * charge / 100, height);
  g.restore();
}
