// Presentation only: expressions never repaint source artwork or change hitboxes.
const TAU = Math.PI * 2, INK = '#29232e', PAPER = '#fff9e9';
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const clock = value => Number.isFinite(value) ? value : 0;

export const EMOTION_PALETTE = Object.freeze({
  angry: Object.freeze({ color: '#d94d42', face: '#ffd5b8', light: '#fff0d9' }),
  afraid: Object.freeze({ color: '#459bc8', face: '#d7edf1', light: '#a9e9ff' }),
  happy: Object.freeze({ color: '#399765', face: '#ddf1bb', light: '#f8ffcd' }),
  upset: Object.freeze({ color: '#b95a77', face: '#f1cad0', light: '#ffe1dc' }),
  disgusted: Object.freeze({ color: '#82629f', face: '#ddd2e6', light: '#c8c04d' }),
  curious: Object.freeze({ color: '#bd8536', face: '#ffe1a5', light: '#fff1c7' }),
  calm: Object.freeze({ color: '#65968e', face: '#e0ece0', light: '#f0f5de' }),
});

// One compact gesture per behavioral profile. These are intent, never item buffs.
export const EMOTION_MOTIFS = Object.freeze(['cover', 'coins', 'guard', 'fight', 'ambush', 'mischief', 'odor-seeking', 'devotion', 'tools', 'trap', 'mystery', 'speed', 'watch', 'riposte', 'wonder']);
const motifs = new Set(EMOTION_MOTIFS);

function activeMotif(signal) {
  if (!motifs.has(signal?.motif) || ['interaction', 'status'].includes(signal.source)
    || ['upset', 'disgusted'].includes(signal.kind) || signal.reason === 'incoming-attack') return null;
  return signal.motif;
}

/** A small posture added to the existing pose; even the quiet mode keeps emotion. */
export function emotionTransform(signal, t = 0, reduced = false) {
  const tr = { x: 0, y: 0, angle: 0, sx: 1, sy: 1 };
  if (!signal || !EMOTION_PALETTE[signal.kind]) return tr;
  const strength = clamp(signal.intensity ?? 1);
  const phase = clock(t) * 8 + clock(signal.actor ?? signal.id) * 1.73;
  const sway = reduced ? 0 : Math.sin(phase);
  if (signal.kind === 'angry') {
    tr.x = 1.5 * strength; tr.angle = .038 * strength;
    tr.sx += .035 * strength; tr.sy -= .025 * strength;
    tr.y = reduced ? 0 : -Math.abs(sway) * .8 * strength;
  } else if (signal.kind === 'afraid') {
    tr.x = sway * 1.5 * strength; tr.y = 3.8 * strength;
    tr.angle = -.045 * strength; tr.sx -= .025 * strength; tr.sy -= .07 * strength;
  } else if (signal.kind === 'happy') {
    tr.y = -(1.2 + (reduced ? 0 : Math.max(0, Math.sin(phase * .7)) * 2.5)) * strength;
    tr.sx -= .012 * strength; tr.sy += .025 * strength; tr.angle = sway * .015 * strength;
  } else if (signal.kind === 'upset') {
    tr.y = 3.6 * strength; tr.angle = -.055 * strength;
    tr.sx += .015 * strength; tr.sy -= .055 * strength;
  } else if (signal.kind === 'disgusted') {
    tr.y = 2.4 * strength; tr.angle = (-.035 + sway * .012) * strength;
    tr.sx -= .015 * strength; tr.sy -= .025 * strength;
  } else if (signal.kind === 'curious') {
    tr.angle = -.055 * strength; tr.y = -.8 * strength;
  } else {
    tr.y = (1 + sway * .45) * strength; tr.sy -= .012 * strength;
  }
  const motif = activeMotif(signal), motion = reduced ? 0 : Math.sin(phase * .6);
  if (motif === 'cover') { tr.x -= .8 * strength; tr.y += .9 * strength; tr.sy -= .01 * strength; }
  else if (motif === 'coins') { tr.x += .7 * strength; tr.y -= .5 * strength; tr.angle += .025 * strength; }
  else if (motif === 'guard') { tr.y += .6 * strength; tr.sx += .018 * strength; tr.angle -= .02 * strength; }
  else if (motif === 'fight') { tr.x += .8 * strength; tr.angle += .022 * strength; tr.sx += .02 * strength; }
  else if (motif === 'ambush') { tr.x += .9 * strength; tr.y += strength; tr.angle += .026 * strength; tr.sy -= .025 * strength; }
  else if (motif === 'mischief') { tr.x += motion * .5 * strength; tr.angle += (-.025 + motion * .018) * strength; }
  else if (motif === 'odor-seeking') { tr.x += .7 * strength; tr.y -= .7 * strength; tr.angle += .038 * strength; }
  else if (motif === 'devotion') { tr.y -= .6 * strength; tr.sx -= .005 * strength; tr.sy += .008 * strength; }
  else if (motif === 'tools') { tr.x += .9 * strength; tr.angle -= .03 * strength; tr.y -= .6 * strength; }
  else if (motif === 'trap') { tr.x -= .7 * strength; tr.y += 1.1 * strength; tr.angle += .035 * strength; }
  else if (motif === 'mystery') { tr.y -= strength; tr.sx += .008 * strength; tr.sy += .009 * strength; }
  else if (motif === 'speed') { tr.x += 1.7 * strength; tr.angle += .055 * strength; tr.sx -= .015 * strength; }
  else if (motif === 'watch') { tr.y += .2 * strength; tr.sx += .02 * strength; }
  else if (motif === 'riposte') { tr.x -= 1.3 * strength; tr.angle -= .05 * strength; tr.sy += .012 * strength; }
  else if (motif === 'wonder') { tr.y -= .6 * strength; tr.angle += (.045 + motion * .045) * strength; }
  return tr;
}

function line(g, draw, color = INK, width = 1.8) {
  g.beginPath(); draw(g); g.strokeStyle = color; g.lineWidth = width; g.stroke();
}

function dot(g, x, y, rx = 1.3, ry = rx, color = INK) {
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fillStyle = color; g.fill();
}

function sparkle(g, x, y, r, color) {
  g.beginPath();
  g.moveTo(x, y - r); g.quadraticCurveTo(x + r * .18, y - r * .18, x + r, y);
  g.quadraticCurveTo(x + r * .18, y + r * .18, x, y + r);
  g.quadraticCurveTo(x - r * .18, y + r * .18, x - r, y);
  g.quadraticCurveTo(x - r * .18, y - r * .18, x, y - r);
  g.fillStyle = color; g.fill(); g.strokeStyle = INK; g.lineWidth = 1.3; g.stroke();
}

function teardrop(g, x, y, color) {
  g.beginPath(); g.moveTo(x, y - 4.5);
  g.bezierCurveTo(x + 1, y - 2, x + 4, y + 1, x + 2, y + 3);
  g.bezierCurveTo(x - 2, y + 5, x - 4, y + 1, x, y - 4.5);
  g.fillStyle = color; g.fill(); g.strokeStyle = INK; g.lineWidth = 1.2; g.stroke();
}

function odor(g, age, reduced) {
  // Fumes stay on the fighter for the whole status, even under a different face.
  for (let i = 0; i < 3; i++) {
    const phase = reduced ? .4 : ((age * .38 + i * .31) % 1 + 1) % 1;
    const side = i === 1 ? -1 : 1, x = side * (35 + (i === 2 ? 9 : 0));
    const y = 19 - phase * 28 + (i === 2 ? -12 : 0);
    g.save(); g.globalAlpha *= reduced ? .8 : .45 + Math.sin(phase * Math.PI) * .45;
    g.beginPath(); g.moveTo(x, y);
    g.bezierCurveTo(x - side * 8, y - 7, x + side * 8, y - 11, x + side * 1, y - 18);
    g.bezierCurveTo(x - side * 4, y - 22, x - side * 2, y - 25, x + side * 2, y - 28);
    g.strokeStyle = '#645268'; g.lineWidth = 4.8; g.stroke();
    g.strokeStyle = '#c8c04d'; g.lineWidth = 2.9; g.stroke();
    if (i !== 2) dot(g, x + side * 6, y - 29, 1.5, 1.5, '#837759');
    g.restore();
  }
}

function faceShape(g, kind) {
  // Slight asymmetry, warm paper edge and a little attached corner fit the art.
  g.beginPath(); g.moveTo(-13, -4);
  g.bezierCurveTo(-12.7, -12, -6, -15.5, 1, -14.3);
  g.bezierCurveTo(10, -15, 15, -8, 14.2, -.6);
  g.quadraticCurveTo(15, 4, 10.6, 8);
  g.lineTo(13.8, 13); g.lineTo(6.4, 11.8);
  g.bezierCurveTo(-4, 16, -15, 9.5, -13, -4); g.closePath();
  g.strokeStyle = PAPER; g.lineWidth = 6; g.stroke();
  g.fillStyle = EMOTION_PALETTE[kind].face; g.fill();
  g.strokeStyle = INK; g.lineWidth = 2.2; g.stroke();
  line(g, p => { p.moveTo(-10.8, -4); p.bezierCurveTo(-10.2, -10.8, -4.4, -13, 1.6, -11.9); }, EMOTION_PALETTE[kind].color, 2.2);
}

function expression(g, kind, motif) {
  if (strategyFace(g, motif)) return;
  const { color, light } = EMOTION_PALETTE[kind];
  if (kind === 'angry') {
    line(g, p => { p.moveTo(-9, -6.7); p.lineTo(-3.2, -3.5); p.moveTo(3.1, -3.5); p.lineTo(8.8, -6.7); }, INK, 2.2);
    dot(g, -5.4, -1.8, 1.25, 1.5); dot(g, 5.3, -1.8, 1.25, 1.5);
    g.beginPath(); g.moveTo(-6.2, 4.3); g.quadraticCurveTo(0, 1.9, 6.3, 4);
    g.lineTo(5.2, 8); g.lineTo(-5.2, 8); g.closePath();
    g.fillStyle = PAPER; g.fill(); g.lineWidth = 1.5; g.strokeStyle = INK; g.stroke();
    line(g, p => { p.moveTo(-1.8, 4); p.lineTo(-1.8, 7.5); p.moveTo(2.2, 4); p.lineTo(2.2, 7.5); }, INK, 1);
    if (!motif) line(g, p => { p.moveTo(15, -14); p.lineTo(14.5, -10.5); p.lineTo(18.3, -10); p.moveTo(20.5, -17); p.lineTo(21, -13.5); p.lineTo(24, -13); p.moveTo(19.2, -8); p.lineTo(19.5, -5); p.lineTo(23, -5.8); }, color, 2);
  } else if (kind === 'afraid') {
    line(g, p => { p.moveTo(-9.2, -8.6); p.quadraticCurveTo(-6, -11.5, -3.6, -8.7); p.moveTo(3, -9); p.quadraticCurveTo(6, -11.9, 9, -8.7); }, INK, 1.6);
    for (const side of [-1, 1]) {
      dot(g, side * 5.8, -3.1, 3.2, 4.1, PAPER); dot(g, side * 5.4, -2.7, 1.15, 2.15);
    }
    dot(g, .1, 6.3, 2.6, 3.8); dot(g, -.5, 6.2, .7, 1.8, '#ae7d8b');
    if (!motif) teardrop(g, 17, -7, light);
  } else if (kind === 'happy') {
    line(g, p => { p.moveTo(-9, -2.3); p.quadraticCurveTo(-6, -7.9, -2.6, -2.5); p.moveTo(2.7, -2.5); p.quadraticCurveTo(6, -7.9, 9, -2.3); }, INK, 2.1);
    g.beginPath(); g.moveTo(-7.8, 2.8); g.quadraticCurveTo(0, 5.8, 7.8, 2.8);
    g.quadraticCurveTo(5.7, 11.7, 0, 10.4); g.quadraticCurveTo(-5.8, 10.4, -7.8, 2.8);
    g.fillStyle = INK; g.fill();
    g.beginPath(); g.moveTo(-5.5, 4.2); g.quadraticCurveTo(0, 6.1, 5.5, 4.2); g.lineTo(4.3, 6.7); g.lineTo(-4, 6.7); g.closePath(); g.fillStyle = PAPER; g.fill();
    dot(g, -9, 2.2, 2, 1.1, '#91bd79'); dot(g, 9, 2.2, 2, 1.1, '#91bd79');
    if (!motif) sparkle(g, 19.7, -11, 4.4, light);
  } else if (kind === 'upset') {
    line(g, p => { p.moveTo(-9, -5); p.lineTo(-3.5, -8); p.moveTo(3.4, -8); p.lineTo(9, -5); }, INK, 1.8);
    line(g, p => { p.moveTo(-8, -1.6); p.quadraticCurveTo(-5.7, .5, -3.3, -1.4); p.moveTo(3.3, -1.4); p.quadraticCurveTo(5.7, .5, 8, -1.6); }, INK, 1.8);
    line(g, p => { p.moveTo(-5.5, 8); p.quadraticCurveTo(0, 1.6, 5.8, 8); }, INK, 2);
    if (!motif) line(g, p => { p.moveTo(17.5, -10); p.lineTo(17.5, -4.5); p.moveTo(21, -7.5); p.lineTo(21, -2); }, color, 1.8);
  } else if (kind === 'disgusted') {
    line(g, p => { p.moveTo(-9, -6.3); p.lineTo(-3.5, -4); p.moveTo(3.5, -4); p.lineTo(9, -6.3); }, INK, 1.6);
    line(g, p => { p.moveTo(-8.5, -1.5); p.lineTo(-5.5, -3); p.lineTo(-2.9, -.8); p.moveTo(3, -.8); p.lineTo(5.5, -3); p.lineTo(8.5, -1.5); }, INK, 1.8);
    dot(g, -9, 3.3, 2.4, 1.5, light); dot(g, 9, 3.3, 2.4, 1.5, light);
    line(g, p => { p.moveTo(-5.4, 6.8); p.lineTo(-2.9, 5); p.lineTo(-.4, 7); p.lineTo(2.2, 5.2); p.lineTo(5.4, 7); }, INK, 1.9);
  } else if (kind === 'curious') {
    line(g, p => { p.moveTo(-9, -6); p.lineTo(-3.4, -6.4); p.moveTo(3.4, -9); p.quadraticCurveTo(6, -11.5, 9.5, -8.4); }, INK, 1.8);
    dot(g, -5.1, -1.4, 1.35, 1.65); dot(g, 6.3, -2, 1.4, 2);
    line(g, p => { p.moveTo(-3.5, 6.5); p.quadraticCurveTo(.5, 7.2, 4.8, 4.5); }, INK, 1.8);
    // A tiny curled query is a drawing, so it never depends on font/emoji support.
    if (!motif) {
      line(g, p => { p.moveTo(16.5, -13); p.bezierCurveTo(15.5, -18.5, 24.5, -18.5, 23, -13.5); p.quadraticCurveTo(22.8, -12, 20, -10.6); p.lineTo(20, -8.5); }, color, 2);
      dot(g, 20, -5.2, 1.1, 1.1, color);
    }
  } else {
    line(g, p => { p.moveTo(-9, -3.2); p.quadraticCurveTo(-6, -.2, -2.8, -3.2); p.moveTo(2.8, -3.2); p.quadraticCurveTo(6, -.2, 9, -3.2); }, INK, 1.8);
    line(g, p => { p.moveTo(-4.3, 5.1); p.quadraticCurveTo(0, 8, 4.4, 5.1); }, INK, 1.7);
  }
}

function strategyFace(g, motif) {
  const sly = motif === 'ambush' || motif === 'trap';
  if (sly) {
    line(g, p => { p.moveTo(-9, -5); p.lineTo(-2.6, -4); p.moveTo(2.5, -4); p.lineTo(9, -6); }, INK, 1.9);
    dot(g, -3.8, -.9, 1.1, 1.4); dot(g, 7, -1.2, 1.1, 1.4);
    line(g, p => { p.moveTo(-5, 6); p.quadraticCurveTo(1, 8, 6.4, 3.8); }, INK, 1.9);
  } else if (motif === 'mischief') {
    line(g, p => { p.moveTo(-9, -2); p.lineTo(-5.5, -4.6); p.lineTo(-2.5, -2.1); p.moveTo(3.1, -7); p.quadraticCurveTo(6, -9.5, 9, -6.5); }, INK, 1.8);
    dot(g, 6, -2, 1.4, 2);
    line(g, p => { p.moveTo(-5.8, 4.3); p.quadraticCurveTo(0, 10, 7.5, 2.4); p.moveTo(6.7, 2.3); p.lineTo(9, 2.8); }, INK, 1.8);
  } else if (motif === 'coins') {
    for (const x of [-5.5, 5.5]) {
      dot(g, x, -2.6, 3.1, 3.7, '#e8b64e');
      line(g, p => { p.moveTo(x, -5.1); p.lineTo(x, -.2); }, INK, 1.4);
    }
    line(g, p => { p.moveTo(-8.8, -8.2); p.quadraticCurveTo(-5.5, -10.5, -2.7, -7.9); p.moveTo(2.7, -7.9); p.quadraticCurveTo(5.5, -10.5, 8.8, -8.2); }, INK, 1.6);
    line(g, p => { p.moveTo(-5.7, 5.2); p.quadraticCurveTo(.5, 10, 6.3, 4.8); }, INK, 1.9);
  } else if (motif === 'odor-seeking') {
    line(g, p => { p.moveTo(-9, -7); p.lineTo(-3.2, -5); p.moveTo(3.2, -5); p.lineTo(9, -7); }, INK, 1.6);
    dot(g, -5.5, -2.5, 1.2, 1.8); dot(g, 5.5, -2.5, 1.2, 1.8);
    line(g, p => { p.moveTo(-1.3, -1.1); p.quadraticCurveTo(4.7, 1.2, 1.1, 3.7); p.lineTo(-1.6, 3); p.moveTo(-4.2, 7); p.quadraticCurveTo(0, 4.6, 4.5, 7); }, INK, 1.6);
  } else if (motif === 'watch' || motif === 'riposte') {
    for (const x of [-5.5, 5.5]) {
      dot(g, x, -2.5, 3.1, motif === 'watch' ? 3.5 : 2.5, PAPER);
      dot(g, x + 1, -2.3, 1.1, 1.7);
    }
    line(g, p => { p.moveTo(-9, -7); p.lineTo(-2.5, -6.1); p.moveTo(2.5, -6.1); p.lineTo(9, -7.5); p.moveTo(-4.4, 6.4); p.lineTo(4.4, 6.4); }, INK, 1.8);
  } else if (motif === 'mystery' || motif === 'wonder') {
    dot(g, -5.4, -3.1, 3, 3.7, PAPER); dot(g, 5.6, -3.2, 3.3, motif === 'wonder' ? 4.5 : 3.7, PAPER);
    dot(g, -5.1, -3.5, 1.2, 1.9); dot(g, 6, -3.8, 1.25, 2);
    line(g, p => { p.moveTo(-9, -9); p.quadraticCurveTo(-5.5, -11.5, -2.5, -9); p.moveTo(2.8, -9.7); p.quadraticCurveTo(6, -12.6, 9, -10.3); }, INK, 1.5);
    if (motif === 'wonder') dot(g, .8, 6.3, 2.6, 3.1);
    else line(g, p => { p.moveTo(-4.5, 5.5); p.quadraticCurveTo(0, 10.5, 5.2, 5); }, INK, 1.8);
  } else return false;
  return true;
}

function motifShape(g, draw, fill) {
  g.beginPath(); draw(g); g.closePath();
  g.strokeStyle = PAPER; g.lineWidth = 3.7; g.stroke();
  g.fillStyle = fill; g.fill(); g.strokeStyle = INK; g.lineWidth = 1.4; g.stroke();
}

function strategyMotif(g, motif, reduced, age) {
  if (!motif) return;
  // This occupies the existing accent slot, not another bubble or HUD row.
  g.save(); g.translate(20, -9);
  const bob = reduced ? 0 : Math.sin(age * 4) * .7;
  if (motif === 'coins') {
    for (const [x, y] of [[-1.5, 2], [1, -1.5]]) {
      g.beginPath(); g.ellipse(x, y, 4.7, 5.8, -.2, 0, TAU); g.fillStyle = '#e8b64e'; g.fill(); g.lineWidth = 1.4; g.strokeStyle = INK; g.stroke();
    }
    line(g, p => { p.moveTo(1, -5); p.lineTo(1, 1.6); }, '#8d6229', 1.4);
  } else if (motif === 'guard') {
    motifShape(g, p => { p.moveTo(-6, -5.5); p.lineTo(0, -7.5); p.lineTo(6, -5.5); p.lineTo(5, 2); p.quadraticCurveTo(3, 5.5, 0, 8); p.quadraticCurveTo(-5, 4.5, -5.5, 1); }, '#8fc8bd');
    line(g, p => { p.moveTo(0, -4.5); p.lineTo(0, 4.2); }, PAPER, 1.7);
  } else if (motif === 'fight') {
    motifShape(g, p => { p.moveTo(-5.5, 4.5); p.lineTo(-6.8, -2.5); p.quadraticCurveTo(-6, -5.4, -3.9, -4); p.quadraticCurveTo(-2.8, -7, -.9, -4.7); p.quadraticCurveTo(1, -7, 2.8, -4.5); p.quadraticCurveTo(5.7, -6, 6.2, -2.5); p.lineTo(5.2, 3.3); p.lineTo(2.5, 6); }, '#eb8170');
    line(g, p => { p.moveTo(-3.7, -3); p.lineTo(-3.2, 0); p.moveTo(-.7, -3.3); p.lineTo(-.3, -.2); p.moveTo(2.4, -3); p.lineTo(2.6, -.4); }, INK, 1);
  } else if (motif === 'ambush') {
    motifShape(g, p => { p.moveTo(-7, 4.5); p.lineTo(-7, -4); p.lineTo(-1, -4); p.lineTo(-1, .3); p.lineTo(6, .3); p.lineTo(6, 4.5); }, '#aaa88a');
    line(g, p => { p.moveTo(0, -3); p.quadraticCurveTo(4, -7, 8, -3); p.quadraticCurveTo(4, .5, 0, -3); }, INK, 1.2);
    dot(g, 5, -3, 1, 1.4);
  } else if (motif === 'mischief') {
    for (const offset of [3, -1]) motifShape(g, p => { p.moveTo(-5 + offset, -5 + offset); p.lineTo(3 + offset, -6 + offset); p.lineTo(4 + offset, 3 + offset); p.quadraticCurveTo(-1 + offset, 8 + offset, -5 + offset, 2 + offset); }, offset === 3 ? '#d9c7db' : '#b999c4');
    dot(g, -3, -1.4, .8); dot(g, 1, -1.8, .8);
    line(g, p => { p.moveTo(-3, 1.3); p.quadraticCurveTo(-.5, 4.3, 1.5, .6); }, INK, 1);
  } else if (motif === 'odor-seeking') {
    // An inquisitive nose: unlike a stink status, it has no rising vapor.
    motifShape(g, p => { p.moveTo(-1, -7); p.quadraticCurveTo(1, -4, 4, -2); p.quadraticCurveTo(10, 1, 4, 4); p.lineTo(-.5, 3.8); p.quadraticCurveTo(-5.5, 5, -4, 1); p.lineTo(-2.2, -.8); }, '#d4c484');
    line(g, p => { p.moveTo(-.4, 2); p.quadraticCurveTo(1.4, .1, 3.2, 2); }, INK, 1.2);
  } else if (motif === 'devotion') {
    motifShape(g, p => { p.moveTo(-6, 6); p.lineTo(-2, -5); p.quadraticCurveTo(0, -7, .2, -3); p.quadraticCurveTo(1, -7, 2.5, -4.5); p.lineTo(6.5, 6); p.lineTo(1, 3); p.lineTo(-.7, 3); }, '#f6d58d');
    line(g, p => { p.moveTo(.4, -3.8); p.lineTo(.4, 3.6); }, INK, 1.1);
    g.beginPath(); g.ellipse(.5, -9, 5.7, 1.8, 0, 0, TAU); g.strokeStyle = '#b68c31'; g.lineWidth = 1.5; g.stroke();
  } else if (motif === 'tools') {
    motifShape(g, p => { p.moveTo(-5.5, 5.5); p.lineTo(1, -.4); p.quadraticCurveTo(-1.8, -5.3, 3, -7); p.lineTo(2.2, -3.7); p.lineTo(4.7, -2.5); p.lineTo(7, -5.4); p.quadraticCurveTo(9.6, -.5, 4.8, 1.5); p.lineTo(-2.8, 8); }, '#a9bfca');
  } else if (motif === 'trap') {
    motifShape(g, p => { p.moveTo(-6.5, 5); p.lineTo(6.5, 5); p.lineTo(7.5, 8); p.lineTo(-7, 8); }, '#ba9383');
    line(g, p => { p.moveTo(0, 4); p.lineTo(4, -4); }, INK, 2.5); dot(g, 4.2, -4.5, 2.4, 2.4, '#ce705a');
    sparkle(g, -4.8, -4.5 + bob, 2.8, '#f7d07e');
  } else if (motif === 'mystery') {
    motifShape(g, p => { p.moveTo(-6, -1.5); p.lineTo(5.8, -1.5); p.lineTo(5.8, 6.5); p.lineTo(-6, 6.5); }, '#d8ae65');
    motifShape(g, p => { p.moveTo(-6.5, -2.8); p.lineTo(-4.4, -7); p.lineTo(7, -5); p.lineTo(5.8, -.7); }, '#edc780');
    line(g, p => { p.moveTo(-.3, 1); p.lineTo(-.3, 4.2); }, INK, 1.6);
    sparkle(g, 7.8, -8 + bob, 2.5, '#fff2c2');
  } else if (motif === 'speed') {
    for (let i = 0; i < 3; i++) line(g, p => { p.moveTo(-8 + i * 2, -5 + i * 4); p.lineTo(2 + i * 2, -5 + i * 4); }, '#458db5', 1.7);
    teardrop(g, 6.5, -5 + bob, '#b9e8f0');
  } else if (motif === 'watch') {
    line(g, p => { p.moveTo(-7, 0); p.quadraticCurveTo(0, -7, 7, 0); p.quadraticCurveTo(0, 7, -7, 0); }, INK, 1.5);
    dot(g, reduced ? 1 : Math.sin(age * 2) * 1.5, 0, 2.1, 2.6, '#609a92');
    line(g, p => { p.moveTo(-7, -5); p.lineTo(-9, -7); p.moveTo(7, -5); p.lineTo(9, -7); }, '#609a92', 1.3);
  } else if (motif === 'riposte') {
    line(g, p => { p.moveTo(-5.5, 5); p.bezierCurveTo(-11, -4, -1, -10, 5.5, -3); p.moveTo(5.5, -3); p.lineTo(5.5, -7.3); p.moveTo(5.5, -3); p.lineTo(1.1, -3.5); }, '#787bb0', 2.4);
    line(g, p => { p.moveTo(-2, 5.5); p.lineTo(7, 5.5); p.moveTo(7, 5.5); p.lineTo(3.9, 2.7); p.moveTo(7, 5.5); p.lineTo(3.9, 8.2); }, INK, 1.5);
  } else if (motif === 'wonder') {
    g.rotate(-.18); sparkle(g, 0, -1 + bob, 6, '#dcc0e1');
    dot(g, 8, -7.5, 1.4, 1.4, '#ac81b4'); dot(g, -6.5, 7, 1, 1, '#ac81b4');
  } else if (motif === 'cover') {
    line(g, p => { p.moveTo(-8, -5); p.lineTo(-8, -9); p.lineTo(4, -9); }, '#518dab', 2);
    teardrop(g, 1.5, 0 + bob, '#a9e9ff');
  }
  g.restore();
}

/** Draw beside the upper cheek, below the HUD; x/y denotes the sprite centre. */
export function paintEmotion(g, signal, { x = 0, y = 0, size = 102, reduced = false, facing = 1, odor: showOdor = true } = {}) {
  if (!signal || !(size > 0) || !Number.isFinite(size)) return;
  const palette = EMOTION_PALETTE[signal.kind], intensity = clamp(signal.intensity ?? 1);
  const age = clock(signal.age), stinky = signal.stinky || signal.odor > 0;
  if ((!palette || signal.visible === false || intensity <= 0) && !(stinky && showOdor)) return;
  g.save(); g.translate(x, y); g.scale(size / 102, size / 102);
  g.lineJoin = 'round'; g.lineCap = 'round';
  if (stinky && showOdor) odor(g, age, reduced);
  if (!palette || signal.visible === false || intensity <= 0) { g.restore(); return; }
  // Personality is restrained, while actual decisions/reactions are fully legible.
  g.globalAlpha *= .78 + intensity * .22;
  const strong = signal.source !== 'personality', direction = facing < 0 ? -1 : 1, motif = activeMotif(signal);
  const pulse = reduced ? 0 : Math.sin(age * 5) * (strong ? .9 : .4);
  if (signal.kind === 'afraid' && motif !== 'speed') {
    line(g, p => {
      p.moveTo(-44, 5); p.lineTo(-47, 10); p.lineTo(-43, 15); p.lineTo(-46, 20);
      p.moveTo(40, 4); p.lineTo(43, 9); p.lineTo(39, 14);
    }, palette.color, 2);
  } else if (signal.kind === 'angry' && strong && !motif) {
    line(g, p => { p.moveTo(35 * direction, -13); p.lineTo(41 * direction, -18); p.moveTo(38 * direction, -7); p.lineTo(46 * direction, -8); }, palette.color, 2.1);
  } else if (signal.kind === 'happy' && strong && !motif) {
    sparkle(g, 30, -18 - pulse, 3.5, palette.light);
  }
  g.translate(-33, -18 - (signal.kind === 'happy' ? pulse : 0));
  g.rotate(signal.kind === 'upset' ? -.09 : signal.kind === 'curious' ? -.12 : 0);
  faceShape(g, signal.kind); expression(g, signal.kind, motif); strategyMotif(g, motif, reduced, age);
  g.restore();
}
