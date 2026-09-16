import { INTERACTION_PALETTE } from './interaction-feedback.mjs';

const TAU = Math.PI * 2, INK = '#202333';
const clamp = value => Math.max(0, Math.min(1, value));

function appearance(signal, reduced) {
  if (!signal || !INTERACTION_PALETTE[signal.kind] || signal.age < 0 || signal.intensity <= 0
    || (signal.duration > 0 && signal.age >= signal.duration)) return null;
  const progress = clamp(signal.progress ?? 0);
  // The replay supplies the clock, so pause, scrubbing and replay stay identical.
  const strength = reduced ? (signal.phase === 'status' ? .45 : signal.phase === 'prepare' ? .72 : .9)
    : clamp(signal.intensity ?? 1) * (.9 + .1 * Math.cos((signal.age ?? 0) * 9));
  return { ...INTERACTION_PALETTE[signal.kind], strength, progress, travel: reduced ? 0 : progress };
}

function makeCanvas(width, height) {
  const canvas = typeof document === 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

function outline(g, color, width = 3) {
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = INK; g.lineWidth = width + 3; g.stroke();
  g.strokeStyle = color; g.lineWidth = width; g.stroke();
}

function symbol(g, kind, x, y, radius, color, accent) {
  g.save(); g.translate(x, y); g.lineJoin = 'round'; g.lineCap = 'round';
  g.fillStyle = color; g.strokeStyle = INK; g.lineWidth = 3;
  const r = radius;
  g.beginPath();
  if (kind === 'positive') {
    const arm = r * .34;
    g.moveTo(-arm, -r); g.lineTo(arm, -r); g.lineTo(arm, -arm);
    g.lineTo(r, -arm); g.lineTo(r, arm); g.lineTo(arm, arm);
    g.lineTo(arm, r); g.lineTo(-arm, r); g.lineTo(-arm, arm);
    g.lineTo(-r, arm); g.lineTo(-r, -arm); g.lineTo(-arm, -arm); g.closePath();
    g.fill(); g.stroke();
  } else if (kind === 'negative') {
    for (let i = 0; i < 16; i++) {
      const angle = i * TAU / 16 - Math.PI / 2, reach = i % 2 ? r * .72 : r;
      const px = Math.cos(angle) * reach, py = Math.sin(angle) * reach;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-r * .38, -r * .15); g.lineTo(0, r * .32); g.lineTo(r * .38, -r * .15);
    g.strokeStyle = accent; g.lineWidth = 3; g.stroke();
  } else if (kind === 'neutral') {
    g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(0, 0, r * .25, 0, TAU); g.fill();
  } else {
    // A lumpy cloud and rising odour have their own silhouette, even in grayscale.
    g.moveTo(-r * .8, r * .48);
    g.bezierCurveTo(-r * 1.5, r * .12, -r, -r * .8, -r * .42, -r * .53);
    g.bezierCurveTo(-r * .6, -r * 1.25, r * .6, -r * 1.25, r * .62, -r * .52);
    g.bezierCurveTo(r * 1.33, -r * .74, r * 1.4, r * .47, r * .64, r * .55);
    g.quadraticCurveTo(0, r * .9, -r * .8, r * .48); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-r * .3, r * .12); g.quadraticCurveTo(-r * .62, -r * .2, -r * .26, -r * .42);
    g.moveTo(r * .28, r * .1); g.quadraticCurveTo(r * .58, -r * .24, r * .27, -r * .48);
    g.strokeStyle = accent; g.lineWidth = 2.5; g.stroke();
  }
  g.restore();
}

/** Shared, replay-clock-only effects. sprite overlays an already drawn image. */
export function createInteractionPainter() {
  const cache = new WeakMap();

  function layers(image, color) {
    const sourceWidth = image.naturalWidth || image.width, sourceHeight = image.naturalHeight || image.height;
    if (!(sourceWidth > 0 && sourceHeight > 0)) return null;
    let entry = cache.get(image);
    if (!entry || entry.sourceWidth !== sourceWidth || entry.sourceHeight !== sourceHeight) {
      entry = { sourceWidth, sourceHeight, colors: new Map() }; cache.set(image, entry);
    }
    if (entry.colors.has(color)) return entry.colors.get(color);
    // Fixed-size alpha masks are built once per image/color, never per frame.
    const ratio = Math.min(1, 256 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * ratio)), height = Math.max(1, Math.round(sourceHeight * ratio));
    const pad = Math.max(4, Math.ceil(Math.max(width, height) * .065));
    const tint = makeCanvas(width, height), t = tint.getContext('2d');
    t.drawImage(image, 0, 0, width, height); t.globalCompositeOperation = 'source-in';
    t.fillStyle = color; t.fillRect(0, 0, width, height);
    const rim = makeCanvas(width + pad * 2, height + pad * 2), r = rim.getContext('2d');
    for (let i = 0; i < 16; i++) {
      const a = i * TAU / 16;
      r.drawImage(tint, pad + Math.cos(a) * (pad - 1), pad + Math.sin(a) * (pad - 1));
    }
    r.globalCompositeOperation = 'source-in'; r.fillStyle = INK; r.fillRect(0, 0, rim.width, rim.height);
    r.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 16; i++) {
      const a = i * TAU / 16;
      r.drawImage(tint, pad + Math.cos(a) * pad * .65, pad + Math.sin(a) * pad * .65);
    }
    r.globalCompositeOperation = 'destination-out'; r.drawImage(image, pad, pad, width, height);
    const result = { tint, rim, pad, width, height }; entry.colors.set(color, result); return result;
  }

  function sprite(g, image, x, y, width, height, signal, { reduced = false, role = 'item' } = {}) {
    const style = appearance(signal, reduced);
    if (!style || !image || width <= 0 || height <= 0) return;
    const layer = layers(image, style.color); if (!layer) return;
    const px = layer.pad * width / layer.width, py = layer.pad * height / layer.height;
    g.save();
    g.globalAlpha *= style.strength;
    g.shadowColor = style.color; g.shadowBlur = reduced ? 0 : (role === 'player' ? 9 : 13);
    g.drawImage(layer.rim, x - px, y - py, width + px * 2, height + py * 2);
    g.shadowBlur = 0;
    g.globalAlpha *= role === 'player' ? .2 : .42;
    g.drawImage(layer.tint, x, y, width, height);
    g.restore();
  }

  /** x/y is the sprite centre; size is its larger rendered dimension. */
  function accent(g, x, y, size, signal, { reduced = false, role = 'item' } = {}) {
    const style = appearance(signal, reduced); if (!style) return;
    const { color, accent: light, strength, travel } = style, player = role === 'player';
    g.save(); g.translate(x, y); g.scale(size / 100, size / 100); g.globalAlpha *= strength;
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (!player) {
      g.save(); g.globalAlpha *= .7;
      g.beginPath(); g.ellipse(0, 43, 44 + travel * 7, 12 + travel * 3, 0, 0, TAU); outline(g, color, 2.5);
      g.restore();
    }
    if (signal.phase === 'prepare') {
      g.save(); g.globalAlpha *= .75; g.setLineDash([4, 6]);
      g.beginPath(); g.arc(0, 0, 51, -.7, Math.PI + .7); outline(g, color, 2); g.restore();
    }
    if (signal.kind === 'positive') {
      const rise = travel * 16;
      symbol(g, 'positive', -43, -12 - rise, 7, color, light);
      g.beginPath(); g.moveTo(-22, -43 - rise); g.lineTo(-22, -53 - rise);
      g.moveTo(-27, -48 - rise); g.lineTo(-22, -53 - rise); g.lineTo(-17, -48 - rise); outline(g, color, 2.5);
      if (player) { g.beginPath(); g.moveTo(43, 24); g.lineTo(48, 14); g.lineTo(53, 24); outline(g, color, 3); }
    } else if (signal.kind === 'negative') {
      const fall = travel * 12;
      for (const side of [-1, 1]) {
        g.beginPath(); g.moveTo(side * 37, -21 + fall); g.lineTo(side * 49, -13 + fall);
        g.lineTo(side * 43, -5 + fall); g.lineTo(side * 53, 5 + fall); outline(g, color, 3.5);
      }
      g.beginPath(); g.moveTo(-8, 39 + fall); g.lineTo(0, 47 + fall); g.lineTo(8, 39 + fall); outline(g, color, 3);
    } else if (signal.kind === 'neutral') {
      g.beginPath(); g.ellipse(0, player ? 13 : 21, 47 + travel * 6, 15, 0, Math.PI * .14, Math.PI * .83); outline(g, color, 2.5);
      symbol(g, 'neutral', -43, -12, 6, color, light);
    } else {
      for (const side of [-1, 1]) {
        const drift = travel * 10;
        g.beginPath(); g.moveTo(side * 43, 21 - drift);
        g.bezierCurveTo(side * 61, 10 - drift, side * 30, -3 - drift, side * 48, -19 - drift);
        g.bezierCurveTo(side * 58, -28 - drift, side * 44, -30 - drift, side * 45, -38 - drift);
        outline(g, light, 3);
      }
    }
    // Shared shapes establish meaning; the player's marker sits beside its rim.
    symbol(g, signal.kind, player ? 48 : 39, player ? -37 : -43, player ? 10 : 12, color, light);
    const secondary = [...new Set(signal.secondaryKinds ?? [])].filter(kind => kind !== signal.kind && INTERACTION_PALETTE[kind]);
    for (let i = 0; i < Math.min(2, secondary.length); i++) {
      const kind = secondary[i], palette = INTERACTION_PALETTE[kind];
      symbol(g, kind, -36 + i * 23, -48, 9, palette.color, palette.accent);
    }
    g.restore();
  }

  /** Signals and fighters use simulation coordinates; the canvas uses 1024 units. */
  function links(g, signals, fighters, { reduced = false } = {}) {
    for (const signal of signals) {
      if (signal.phase === 'status') continue;
      const f = fighters.find(fighter => fighter.id === signal.actor), style = appearance(signal, reduced);
      if (!f || !style || !Number.isFinite(signal.x) || !Number.isFinite(signal.y)) continue;
      const x = signal.x * .1024, y = signal.y * .1024 - 12, tx = f.x * .1024, ty = f.y * .1024 - 40;
      if (Math.hypot(tx - x, ty - y) < 18) continue;
      const cx = (x + tx) / 2, cy = Math.min(y, ty) - 20;
      g.save(); g.globalAlpha *= style.strength * (signal.phase === 'prepare' ? .65 : .85);
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(cx, cy, tx, ty); outline(g, style.color, 2.5);
      if (!reduced) {
        const p = signal.phase === 'prepare' ? .5 : clamp((signal.age ?? 0) / .55), q = 1 - p;
        const bx = q * q * x + 2 * q * p * cx + p * p * tx, by = q * q * y + 2 * q * p * cy + p * p * ty;
        g.fillStyle = style.accent; g.strokeStyle = INK; g.lineWidth = 2;
        g.beginPath(); g.arc(bx, by, 4.5, 0, TAU); g.fill(); g.stroke();
      }
      g.restore();
    }
  }

  return { sprite, accent, links };
}
