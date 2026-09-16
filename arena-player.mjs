import { frameAt, HZ, safeBorder } from '/arena/core.mjs';
import { poseTransform } from '/arena/avatars.mjs';
import { ITEMS, buildReadability, feedbackAt, spectatorFeedback, cameraAt, project, unproject, healthLabelLayout } from '/arena/readability.mjs';
import { buildInteractionFeedback, interactionFeedbackAt, classifyInteraction, interactionEvidence, INTERACTION_PALETTE } from '/arena/interaction-feedback.mjs';
import { createInteractionPainter } from '/arena/interaction-art.mjs';
import { buildEmotionFeedback, emotionsAt } from '/arena/emotion-feedback.mjs';
import { emotionTransform, paintEmotion } from '/arena/emotion-art.mjs';
import { paintMechanicStatus, paintMechanicZones } from '/arena/mechanic-art.mjs';
import { paintUltimateWorld, paintUltimateHud } from '/arena/ultimate-art.mjs';
import { WEAPONS } from '/arena/content.mjs';
import { preparePropSprites } from './prop-art.mjs';
import { CATALOG_WINDOWS } from './catalog-art.mjs';
import { fighterPresentation } from './fighter-view.mjs';
import { avatarImageSource,loadAvatarImage,AVATAR_PLACEHOLDER } from './avatar-image.mjs';
import { composeSock, isValidKey } from '/sock/sock.js';

// The server supplies the only replay. This player never chooses or reruns a result.
export function createArenaPlayer(canvas, onFrame, onInspect = () => {}, renderOptions = {}) {
const ctx = canvas.getContext('2d');
let artwork = [], urls = [], generatedUrls = [], ROSTER = [], yard, street, sprites, match, track;
let selected = 0, selectedObject = null, hoveredObject = null;
let seconds = 0, running = false, begun = true, follow = true, speed = 1, biome = 'yard';
let last = null, raf = 0, disposed = false, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const tones = { good: '#267545', bad: '#b9322b', power: '#a9490c', cover: '#156c9e', coin: '#876400', neutral: '#6b4d8c' };
const image = src => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('Artwork could not load')); im.src = src; });
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function text(g, value, x, y, size = 24, color = '#201d19', font = 'Talk') { g.font = size + 'px ' + font + ', sans-serif'; g.textAlign = 'center'; g.fillStyle = color; g.fillText(value, x, y); }
function box(g, x, y, w, h, fill, stroke = '#201d19', radius = 8) { g.beginPath(); g.roundRect(x, y, w, h, radius); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); } }
const interactionPainter = createInteractionPainter();
let interactionTrack, emotionTrack;
function prop(g, type, x, y, size, signal) {
  const sprite = sprites[type], w = Math.min(size, size * 1.28 * sprite.width / sprite.height), h = w * sprite.height / sprite.width;
  const left = x - w / 2, top = y - h + size * .24;
  g.drawImage(sprite, left, top, w, h);
  if (signal) {
    interactionPainter.sprite(g, sprite, left, top, w, h, signal, { reduced, role: 'item' });
    interactionPainter.accent(g, x, top + h / 2, Math.max(w, h), signal, { reduced, role: 'item' });
  }
}
function ring(g, x, y, color, id, focus) {
  g.fillStyle = focus ? '#fff1a7ba' : '#ffffff70'; g.beginPath(); g.ellipse(x, y + 3, focus ? 34 : 28, focus ? 15 : 12, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = color; g.lineWidth = focus ? 6 : 3; g.stroke();
  box(g, x - 12, y + 8, 24, 23, color, '#201d19', 2); text(g, String(id + 1), x, y + 27, 22, '#fff', 'Receipt');
}
function fighter(g, f, t, scale = 1, forcePose, signal, emotion) {
  const r = ROSTER[f.id], p = forcePose || f.pose, tr = poseTransform(p, t, f.id, reduced);
  const feeling = emotionTransform(emotion, t, reduced);
  const equipped = f.equipment === 'mallet';
  // Bigger presentation makes the power pickup visible; combat radius stays fixed.
  const growth = equipped ? 1.12 : 1;
  g.save(); g.translate(f.x, f.y); g.scale(scale, scale);
  ring(g, 0, 0, r.color, f.id, selected === f.id);
  g.save(); g.translate(tr.x + feeling.x, -42 + tr.y + feeling.y); g.rotate(tr.angle + feeling.angle); g.scale(tr.sx * growth * feeling.sx, tr.sy * growth * feeling.sy);
  if (r.image) { g.fillStyle = '#fff6e3'; g.fillRect(-34, -42, 68, 74); g.drawImage(artwork[f.id], -30, -38, 60, 60); }
  else { g.filter = 'drop-shadow(1px 0 0 white) drop-shadow(-1px 0 0 white)'; g.drawImage(artwork[f.id], -51, -53, 102, 102); g.filter = 'none'; }
  if (signal) {
    const bounds = r.image ? [-30, -38, 60, 60] : [-51, -53, 102, 102];
    interactionPainter.sprite(g, artwork[f.id], ...bounds, signal, { reduced, role: 'player' });
  }
  g.restore();
  if (signal) interactionPainter.accent(g, 0, -42, 94, signal, { reduced, role: 'player' });
  if (equipped && p !== 'khole') {
    g.save(); g.translate(40, -36);
    const angle = p === 'windup' ? -.65 : p === 'recover' ? .8 : .18;
    g.rotate(angle); prop(g, WEAPONS[f.weapon??0].art, 0, 0, 43); g.restore();
  }
  if (f.equipment === 'wheels' && p !== 'khole') { g.strokeStyle = '#297ea2'; g.lineWidth = 3; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-42 - i * 6, -20 + i * 9); g.lineTo(-29, -20 + i * 9); g.stroke(); } }
  if (p === 'khole') text(g, '✦  ·  ✦', 0, -87, 25, '#fff0a1');
  if (p === 'stagger' && !reduced) { g.strokeStyle = '#cf3d33'; g.lineWidth = 4; g.beginPath(); g.arc(0, -40, 46, 0, Math.PI * 2); g.stroke(); }
  if (p === 'hiding') { g.strokeStyle = '#297f62'; g.lineWidth = 4; g.setLineDash([6, 4]); g.strokeRect(-39, -83, 78, 78); g.setLineDash([]); }
  if (f.hp !== 0 && f.statuses?.devoted) { g.strokeStyle='#f5c43c';g.lineWidth=5;g.beginPath();g.ellipse(0,-96,31,8,0,0,Math.PI*2);g.stroke(); }
  if (f.hp !== 0 && f.statuses?.trail) {g.fillStyle='#527bc7';for(let i=0;i<3;i++){g.beginPath();g.ellipse(-20+i*17,30+i*6,5,3,0,0,Math.PI*2);g.fill();}}
  if (f.id === selected) paintMechanicStatus(g, f, t, { y: -42, color: signal ? INTERACTION_PALETTE[signal.kind].color : undefined });
  g.restore();
}
function duration() { return match.ticks / HZ; }
function currentCamera() { return cameraAt(match, seconds, selected, follow && !reduced); }
function coordinates(frame, t) {
  const next = match.frames[Math.min(frame.tick + 1, match.ticks)], alpha = clamp(t * HZ - frame.tick, 0, 1);
  return frame.fighters.map(f => { const n = next.fighters[f.id]; return { ...f, x: f.x + (n.x - f.x) * alpha, y: f.y + (n.y - f.y) * alpha }; });
}
function worldEffects(feedback, frame, t) {
  // Attack tells and contact lines distinguish combat from wandering near someone.
  for (const f of frame.fighters) if (f.pose === 'windup' && f.aim) {
    ctx.strokeStyle = '#c6382bc0'; ctx.lineWidth = 5; ctx.setLineDash([7, 6]); ctx.beginPath(); ctx.moveTo(f.x * .1024, f.y * .1024 - 25); ctx.lineTo(f.aim.x * .1024, f.aim.y * .1024 - 25); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#9e271f'; ctx.beginPath(); ctx.arc(f.aim.x * .1024, f.aim.y * .1024, 20, 0, Math.PI * 2); ctx.stroke();
  }
  for (const e of feedback.recent) {
    const age = t - e.tick / HZ, v = e.value; if (!v || age < 0) continue;
    if (e.type === 'bump' && age < .35) {
      const a = v.from, b = v.to; ctx.globalAlpha = 1 - age / .35; ctx.strokeStyle = '#f7e6b6'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(a.x * .1024, a.y * .1024 - 25); ctx.lineTo(b.x * .1024, b.y * .1024 - 25); ctx.stroke(); ctx.strokeStyle = '#be3229'; ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x * .1024, b.y * .1024 - 30, 15 + (reduced ? 0 : age * 55), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
}
function healthLabels(fighters, feedback, camera, ui) {
  const labels = healthLabelLayout(fighters.filter(f => f.hp > 0), camera, selected, ui);
  for (const { id, x, y, w, focus, p } of labels) {
    const f = fighters.find(f => f.id === id);
    // Leaders only disambiguate displaced labels; no six-line web over the fight.
    if (Math.abs(x - p.x) > 20 || Math.abs(y - (p.y - 100 * camera.zoom)) > 45) {
      ctx.strokeStyle = ROSTER[f.id].color + '80'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y + 6 * ui); ctx.lineTo(p.x, p.y - 62 * camera.zoom); ctx.stroke();
    }
    const damage = feedback.damage.find(d => d.actor === f.id);
    box(ctx, x - w / 2 - 2, y - 2, w + 4, 12 * ui, '#222019', null, 3);
    ctx.fillStyle = '#8b5447'; ctx.fillRect(x - w / 2, y, w, 8 * ui);
    if (damage) { ctx.fillStyle = '#ffd9b8'; ctx.fillRect(x - w / 2, y, w * damage.hpBefore / 100, 8 * ui); }
    ctx.fillStyle = f.hp > 30 ? '#61c875' : '#ed6a52'; ctx.fillRect(x - w / 2, y, w * f.hp / 100, 8 * ui);
    // Power and exact health live in the followed-fighter DOM panel. Seat identity
    // already sits at the feet; repeating it above every bar adds no information.
    if (focus && f.shield > 0) for (let i = 0; i < f.shield; i++) { ctx.fillStyle = '#78dcff'; ctx.beginPath(); ctx.arc(x + (i - 1) * 10 * ui, y + 17 * ui, 3 * ui, 0, Math.PI * 2); ctx.fill(); }
  }
  return labels;
}
function feedbackCards(feedback, fighters, camera, ui) {
  // One stable lower-edge caption replaces competing three-line floating cards.
  for (const card of feedback.cards) {
    const color = card.event.value?.propId != null ? INTERACTION_PALETTE[classifyInteraction(card.event, interactionEvidence(card.event, match)).kind].ink : tones[card.tone];
    const value = `#${card.actor + 1}  ${card.title}`, size = 22 * ui;
    ctx.font = size + 'px Talk, sans-serif';
    const width = Math.min(720, ctx.measureText(value).width + 36 * ui);
    box(ctx, 512 - width / 2, 970 - 34 * ui, width, 34 * ui, '#fff6df', null, 3);
    ctx.fillStyle = color; ctx.fillRect(512 - width / 2, 970 - 34 * ui, 4 * ui, 34 * ui);
    text(ctx, value, 512, 970 - 9 * ui, size, color);
  }
  for (const d of feedback.damage) {
    const p = project(fighters[d.actor], camera); if (p.x < 20 || p.x > 1004 || p.y < 35 || p.y > 990) continue;
    const age = seconds - d.tick / HZ, x = clamp(p.x + 38 * camera.zoom, 35 * ui, 1024 - 35 * ui), y = p.y - 40 * camera.zoom - (reduced ? 0 : age * 20);
    impactNumber('−' + d.amount, x, y, '#a52621', 28 * ui);
  }
  // Use the actual recorded heal, never the spell's advertised maximum.
  for (const e of feedback.recent.filter(e => e.type === 'ultimate-heal' && e.value.amount > 0).slice(-2)) {
    const p = project(fighters[e.actor], camera), age = seconds - e.tick / HZ;
    if (p.x < 20 || p.x > 1004 || p.y < 35 || p.y > 990) continue;
    const x = clamp(p.x - 42 * camera.zoom, 42 * ui, 1024 - 42 * ui), y = p.y - 40 * camera.zoom - (reduced ? 0 : age * 20);
    impactNumber('+' + e.value.amount, x, y, '#1f7945', 30 * ui);
  }
}
function impactNumber(value, x, y, color, size) {
  ctx.save(); ctx.font = size + 'px Receipt, monospace'; ctx.textAlign = 'center';
  ctx.lineJoin = 'round'; ctx.strokeStyle = '#fff6dd'; ctx.lineWidth = 5;
  ctx.strokeText(value, x, y); ctx.fillStyle = color; ctx.fillText(value, x, y); ctx.restore();
}
function offscreenIndicators(fighters, camera, ui) {
  if (camera.zoom === 1) return;
  for (const f of fighters) {
    const p = project(f, camera); if (p.x >= 25 && p.x <= 999 && p.y >= 25 && p.y <= 999) continue;
    const x = clamp(p.x, 27 * ui, 1024 - 27 * ui), y = clamp(p.y, 27 * ui, 1024 - 27 * ui);
    box(ctx, x - 14 * ui, y - 14 * ui, 28 * ui, 28 * ui, f.hp ? ROSTER[f.id].color : '#776d63', '#fff5da', 8);
    text(ctx, String(f.id + 1), x, y + 7 * ui, 20 * ui, '#fff', 'Receipt');
  }
}
function scene(frame, t, feedback) {
  const camera = currentCamera(), fighters = coordinates(frame, t), ui = Math.max(1, 570 / Math.max(300, canvas.clientWidth));
  const ultimateActive = frame.zones.some(z => z.kind === 'ultimate' && z.start <= frame.tick && z.until > frame.tick);
  const cues = spectatorFeedback(feedback, selected, { ultimateActive });
  const interactions = interactionFeedbackAt(match, interactionTrack, t);
  const emotions = emotionsAt(match, emotionTrack, t);
  ctx.clearRect(0, 0, 1024, 1024); ctx.save(); ctx.translate(512, 512); ctx.scale(camera.zoom, camera.zoom); ctx.translate(-camera.x, -camera.y);
  ctx.drawImage(biome === 'yard' ? yard : street, 0, 0, 1024, 1024);
  if (t > (renderOptions.zoneStartSeconds ?? 40)) {
    const border = (renderOptions.borderAt ?? safeBorder)(t * HZ) * .1024;
    ctx.fillStyle = '#d548283c'; ctx.fillRect(82, 82, border - 82, 860); ctx.fillRect(1024 - border, 82, border - 82, 860); ctx.fillRect(border, 82, 1024 - 2 * border, border - 82); ctx.fillRect(border, 1024 - border, 1024 - 2 * border, border - 82);
    ctx.strokeStyle = '#b93326'; ctx.lineWidth = 3; ctx.setLineDash([9, 10]); ctx.strokeRect(border, border, 1024 - border * 2, 1024 - border * 2); ctx.setLineDash([]);
  }
  for (const h of match.map.hazards) if (frame.tick >= h.tick - 20 && frame.tick < h.tick + 10) {
    ctx.fillStyle = frame.tick < h.tick ? '#f8b32b45' : '#e3c5a3a0'; ctx.strokeStyle = '#ac3021'; ctx.lineWidth = 4; ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.arc(h.x * .1024, h.y * .1024, h.radius * .1024, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    if (frame.tick < h.tick) text(ctx, '!', h.x * .1024, h.y * .1024, 50, '#b93424');
  }
  paintMechanicZones(ctx, frame, t, { reduced });
  for (const z of frame.zones.filter(z => z.kind === 'slow' || z.kind === 'trap')) {
    ctx.fillStyle=z.kind==='slow'?'#b7827448':frame.tick<z.impact?'#ffb52b66':'#bf332b88';ctx.strokeStyle=z.kind==='slow'?'#79513e':'#af3427';ctx.lineWidth=3;ctx.setLineDash([7,6]);ctx.beginPath();ctx.arc(z.x*.1024,z.y*.1024,z.radius*.1024,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);text(ctx,z.kind==='slow'?'SLOW':frame.tick<z.impact?'!':'THUNK',z.x*.1024,z.y*.1024,24,ctx.strokeStyle);
  }
  for (const d of frame.decoys) {
    const signal = interactions.items.get(`decoy:${d.id}`);
    ctx.globalAlpha = signal ? 1 : .75; prop(ctx, d.art, d.x * .1024, d.y * .1024, 55, signal); ctx.globalAlpha = 1;
  }
  // A consumed decoy leaves a brief red visual echo during the victim's pause.
  for (const signal of interactions.items.values()) if (signal.decoyId != null && !frame.decoys.some(d => d.id === signal.decoyId)) {
    ctx.globalAlpha = reduced ? .7 : .9 * (1 - signal.progress);
    prop(ctx, signal.decoyArt, signal.x * .1024, signal.y * .1024, 55, signal); ctx.globalAlpha = 1;
  }
  for (const c of frame.coinPositions) { ctx.fillStyle = '#ffd947'; ctx.strokeStyle = '#60421a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x * .1024, c.y * .1024, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  paintUltimateWorld(ctx, { ...frame, fighters }, t, { reduced, layer: 'ground' });
  const elements = match.map.props.map(p => ({ y: p.y, prop: p }));
  for (const f of fighters) elements.push({ y: f.y, fighter: f });
  elements.sort((a, b) => a.y - b.y);
  for (const el of elements) {
    if (el.prop) {
      const p = el.prop, item = ITEMS[p.type], used = frame.fighters[selected].used.includes(p.id);
      const signal = interactions.items.get('prop:' + p.id);
      const itemColor = signal ? INTERACTION_PALETTE[signal.kind].ink : item.color;
      const x = p.x * .1024, y = p.y * .1024, inspected = p.id === selectedObject || p.id === hoveredObject;
      if (inspected) {
        ctx.fillStyle = itemColor + '25'; ctx.strokeStyle = itemColor; ctx.lineWidth = p.id === selectedObject ? 4 : 2; ctx.beginPath(); ctx.ellipse(x, y + 4, 44, 20, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.globalAlpha = used && !signal ? .72 : 1; prop(ctx, p.type, x, y, p.radius >= 350 ? 112 : 86, signal); ctx.globalAlpha = 1;
      if (inspected) { box(ctx, x - 59, y + 24, 118, 22, '#fff3d8', itemColor, 3); text(ctx, used ? 'USED BY #' + (selected + 1) : item.tag, x, y + 40, 16, itemColor); }
    } else { const f = el.fighter; fighter(ctx, { ...f, x: f.x * .1024, y: f.y * .1024 }, t, 1, undefined, interactions.fighters.get(f.id), emotions.get(f.id)); }
  }
  interactionPainter.links(ctx, ultimateActive ? [] : interactions.links.filter(signal => signal.actor === selected).slice(0, 1), fighters, { reduced });
  for (const [key, signal] of interactions.items) if (key.startsWith('coin:')) {
    interactionPainter.accent(ctx, signal.x * .1024, signal.y * .1024, 30, signal, { reduced, role: 'item' });
  }
  worldEffects(feedback, frame, t);
  paintUltimateWorld(ctx, { ...frame, fighters }, t, { reduced, layer: 'foreground' });
  // Expressions remain attached and visible even when a prop partly hides a body.
  for (const f of fighters) {
    const emotion = emotions.get(f.id);
    if (!emotion || ultimateActive || f.id !== selected && !['windup', 'stagger'].includes(f.pose)) continue;
    const tr = poseTransform(f.pose, t, f.id, reduced), feeling = emotionTransform(emotion, t, reduced);
    paintEmotion(ctx, emotion, {
      x: f.x * .1024 + tr.x + feeling.x, y: f.y * .1024 - 42 + tr.y + feeling.y,
      size: 102, reduced, odor: interactions.fighters.get(f.id)?.kind !== 'repulsive',
    });
  }
  ctx.restore();
  healthLabels(fighters, feedback, camera, ui); feedbackCards(cues, fighters, camera, ui); offscreenIndicators(fighters, camera, ui);
  paintUltimateHud(ctx, { ...frame, fighters }, t, { camera, selected, ui });
  const warning = match.map.hazards.some(h => frame.tick >= h.tick - 20 && frame.tick < h.tick);
  if (t >= 50 && t < 52.5 && frame.fighters.filter(f => f.hp > 0).length > 1) { box(ctx, 357, 12, 310, 38, '#ffce56', null, 4); text(ctx, 'FINAL COLLAPSE', 512, 38, 24, '#88392c'); }
  else if (warning && begun && !ultimateActive) { box(ctx, 365, 12, 294, 38, '#ffce56', null, 4); text(ctx, 'FALLING DEBRIS', 512, 38, 24, '#88392c'); }
}

function render() {
  if (!match || disposed) return;
  const frame = frameAt(match, seconds), feedback = feedbackAt(match, track, seconds, selected);
  scene(frame, seconds, feedback);
  renderOptions.onDraw?.({context:ctx,frame,seconds,selected,camera:currentCamera()});
  onFrame({frame, feedback, seconds, selected, running, duration:duration(), roster:ROSTER, images:urls});
}
function animate(now) {
  if (disposed) return;
  const wasRunning=running;
  if (running && last !== null) {
    seconds = Math.min(duration(), seconds + Math.min(100, now-last)/1000*speed);
    if (seconds >= duration()) running = false;
  }
  last = now;
  if(wasRunning||!renderOptions.staticWhenPaused)render();
  raf = requestAnimationFrame(animate);
}
async function load(replay, roster) {
  if (!replay?.frames?.length || roster?.length !== 6 || replay.ranking?.length !== 6)
    throw new Error('This room does not have a complete six-fighter replay.');
  if (roster.some((f,i) => f.id !== i)) throw new Error('The fighter seats do not match the replay.');
  if (!sprites) {
    const loaded = await Promise.all(['/assets/yard.png','/assets/street.png','/assets/props-v2.png',...'ABCDEFG'.split('').map(x=>'/assets/catalog-'+x+'.png')].map(image));
    [yard,street] = loaded; sprites=preparePropSprites(loaded[2]);
    CATALOG_WINDOWS.forEach((windows,i)=>sprites.push(...preparePropSprites(loaded[3+i],windows)));
  }
  const colors=['#cf3634','#a43287','#2968b6','#387746','#9c7020','#486266'];
  const nextRoster=roster.map((f,i)=>fighterPresentation(f,i,colors[i])),nextGeneratedUrls=[];
  const nextUrls=nextRoster.map(r=>{
    if (r.image) {
      return avatarImageSource(r.image);
    }
    if (!isValidKey(r.key)) return AVATAR_PLACEHOLDER;
    const url=URL.createObjectURL(new Blob([composeSock(r.key,{size:'l',idPrefix:'fighter-'+r.id})],{type:'image/svg+xml'}));
    nextGeneratedUrls.push(url);return url;
  });
  let faces;
  try { faces=await Promise.all(nextUrls.map(source=>loadAvatarImage(source,image))); }
  catch(error){nextGeneratedUrls.forEach(u=>URL.revokeObjectURL(u));throw error;}
  // Commit one complete replay only after all of its images are available.
  generatedUrls.forEach(u=>URL.revokeObjectURL(u));generatedUrls=nextGeneratedUrls;ROSTER=nextRoster;
  artwork=faces.map(face=>face.image);urls=faces.map(face=>face.source);
  match=replay;track=buildReadability(match);interactionTrack=buildInteractionFeedback(match);emotionTrack=buildEmotionFeedback(match);seconds=0;selected=0;last=null;running=false;
  render(); if (!raf) raf=requestAnimationFrame(animate);
}
function click(event) {
  if (!match) return;
  const rect=canvas.getBoundingClientRect();
  const point=unproject({x:(event.clientX-rect.left)/rect.width*1024,y:(event.clientY-rect.top)/rect.height*1024},currentCamera());
  const frame=frameAt(match,seconds);
  const f=[...frame.fighters].sort((a,b)=>Math.hypot(a.x-point.x,a.y-point.y)-Math.hypot(b.x-point.x,b.y-point.y))[0];
  if (Math.hypot(f.x-point.x,f.y-point.y)<600) {selected=f.id;selectedObject=null;render();return;}
  const p=match.map.props.find(p=>Math.hypot(p.x-point.x,p.y-point.y)<Math.max(600,p.radius));
  if(p){selectedObject=p.id;onInspect({...ITEMS[p.type],used:frame.fighters[selected].used.includes(p.id)});render();}
  else {selectedObject=null;render();}
}
canvas.addEventListener('click',click);
return {
  load,
  select(id){if(Number.isInteger(id)&&id>=0&&id<6){selected=id;selectedObject=null;render();}},
  play(){if(match){if(seconds>=duration())seconds=0;running=true;last=null;}},
  pause(){running=false;render();},
  seek(value){if(match){seconds=clamp(Number(value)||0,0,duration());last=null;render();}},
  speed(value){speed=clamp(Number(value)||1,.25,2);},
  follow(value){follow=Boolean(value);render();},
  calm(value){reduced=Boolean(value);render();},
  dispose(){disposed=true;cancelAnimationFrame(raf);canvas.removeEventListener('click',click);generatedUrls.forEach(u=>URL.revokeObjectURL(u));}
};
}
