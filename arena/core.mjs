// Deterministic six-fighter arena. Funding and settlement are separate from simulation.
import { ITEMS, ACTIVE_TYPES, WEAPONS, CONTENT_VERSION } from './content.mjs';
import { validatePolicy, randomPolicy, fidelity, POLICY_VERSION } from './policy.mjs';
import { expandedCombatStats, expandedProtection, applyExpandedItem, updateExpandedStatuses, mechanicSnapshot, pushMultiplier, warningReactionBonus, pursuitBonus, canBeFooled, canCollectCoin } from './mechanics.mjs';
import { createIntentController } from './controller.mjs';
import { createUltimateRuntime } from './ultimate-system.mjs';
export { applyExpandedItem, updateExpandedStatuses, mechanicSnapshot } from './mechanics.mjs';
export const VERSION = 'pit-arena-9';
// The rules every published match runs with since pit-arena-7 (docs/35 section 4): sudden death at
// 45 s x3 with a bleed of 6 health per second, second wind 50, thick skin 3, strike power 3 and the
// most-fight-left last stand. The sandbox overrides them through its parameters.
export const RULES = Object.freeze({speedMultiplier:1,damageMultiplier:1.25,perceptionRadius:3600,zoneStartSeconds:40,propCount:null,suddenDeathSeconds:45,suddenDeathMultiplier:3,healthTieBreak:3,finisherHeal:50,retaliationFloor:12,aggressionPower:3,evadeStamina:0,suddenDeathBleed:6,aggressionArmor:3});
export const HZ = 20, TICKS = 60 * HZ, WORLD = 10000, RADIUS = 170;
export const FINAL_COLLAPSE_TICK = 50 * HZ;
export const PROP_NAMES = ITEMS.map(item=>item.name);
export const POSES = ['idle','travel','windup','recover','pickup','evade','stagger','khole'];
export function safeBorder(tick) {
  const t=Math.min(Math.max(0,tick),TICKS);
  return t<=800?850:t<=FINAL_COLLAPSE_TICK?850+(t-800)*5:1850+Math.floor((t-FINAL_COLLAPSE_TICK)*3150/(TICKS-FINAL_COLLAPSE_TICK));
}
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const distance2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const distance=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const spawn=[[1400,1400],[5000,1100],[8600,1400],[8600,8600],[5000,8900],[1400,8600]];
const sites=[[2600,2600],[5100,2500],[7400,2600],[2100,5000],[4600,4800],[7600,4700],[2400,7300],[5000,7200],[7700,7300],[6600,5900],[3400,6100],[6200,3900]];
export function rng(seed) { let n=seed>>>0; return max=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return Math.floor(n/4294967296*max);}; }
// This priority is fixed before any decisions or damage. It is a game rule, not
// cryptographic randomness or proof that a trusted server chose an honest seed.
export function initiativeOrder(seed, ids=[0,1,2,3,4,5]) {
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('Seed must be uint32');
  if(!Array.isArray(ids)||ids.length<2||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)||id<0))throw new RangeError('Unique seat IDs required');
  const order=[...ids].sort((a,b)=>a-b),random=rng(seed^0xa11ce777);
  for(let i=order.length-1;i>0;i--){const j=random(i+1);[order[i],order[j]]=[order[j],order[i]];}
  return order;
}
export function combatStats(f) {
  return expandedCombatStats(f);
}
export function makeMap(seed,options={}) {
  const random=rng(seed^0x5eeda11), sampledCount=8+random(5), count=options.propCount??sampledCount, types=[];
  if(!Number.isInteger(count)||count<6||count>12)throw new RangeError('Prop count must be 6..12');
  const choose=pool=>pool[random(pool.length)];
  for(const effect of ['weapon','chest','guard','wheels']) types.push(choose(ACTIVE_TYPES.filter(i=>ITEMS[i].effect===effect)));
  if(random(4)===0)types.push(0);
  const limited=new Set(['stink','slide','trap','coin-route','decoy','devotion','projectile','pulse-zone','platform','beacon','fake','door','barricade']);
  for(let attempt=0;types.length<count&&attempt<300;attempt++){
    const type=choose(ACTIVE_TYPES),item=ITEMS[type];
    if(type===0||types.includes(type))continue;
    if(limited.has(item.effect)&&types.some(i=>ITEMS[i].effect===item.effect))continue;
    if(item.effect==='weapon'&&types.filter(i=>ITEMS[i].effect==='weapon').length>=2)continue;
    if(['slow','slide','stink'].includes(item.effect)&&types.filter(i=>['slow','slide','stink'].includes(ITEMS[i].effect)).length>=2)continue;
    types.push(type);
  }
  if(types.length!==count)throw new Error('Map sampling budget exhausted');
  const spots=sites.map(x=>[...x]);
  for(let i=spots.length-1;i>0;i--){const j=random(i+1);[spots[i],spots[j]]=[spots[j],spots[i]];}
  const props=types.map((type,id)=>({id,type,x:spots[id][0]+random(201)-100,y:spots[id][1]+random(201)-100,radius:['shelter','guard'].includes(ITEMS[type].effect)?350:240,solid:!['slow','slide','stink','trail'].includes(ITEMS[type].effect)}));
  const coins=[];
  for(let i=0;i<600&&coins.length<24;i++){
    const c={id:coins.length,x:1100+random(7801),y:1100+random(7801),value:1,owner:null};
    if(props.some(p=>distance2(c,p)<(p.radius+RADIUS+180)**2)||coins.some(p=>distance2(c,p)<350**2))continue;
    coins.push(c);
  }
  if(coins.length!==24)throw new Error('Coin sampling budget exhausted');
  const hazards=[];
  for(let tick=100;tick<TICKS;tick+=100)hazards.push({tick,x:2100+random(5801),y:2100+random(5801),radius:1050});
  hazards.push({tick:TICKS,x:5000,y:5000,radius:WORLD,amount:1000,cause:'collapse'});
  return {props,coins,hazards};
}
export function rankFighters(fighters) {
  return [...fighters].sort((a,b)=>Number(b.hp>0)-Number(a.hp>0)||(b.outOrder??-1)-(a.outOrder??-1)||(b.outAt??-1)-(a.outAt??-1)||(a.initiative??a.id)-(b.initiative??b.id))
    .map((f,i)=>({id:f.id,rank:i+1,hp:f.hp,coins:f.coins,outAt:f.outAt,outOrder:f.outOrder??null}));
}
export function endReason(fighters,tick) {
  const n=fighters.filter(f=>f.hp>0).length;
  if(n===0||tick>=TICKS&&n!==1)throw new Error('Arena must finish with exactly one survivor');
  return n===1?'last-survivor':null;
}
export function strikeHits(strike,target) {return Boolean(target&&target.hp>0&&strike.zone&&distance2(target,strike.zone)<430**2);}
export function qualifyStrikes(strikes,fighters) {return strikes.map(s=>({...s,landed:strikeHits(s,fighters.find(f=>f.id===s.target))}));}
export function resolveDamage(fighters,hits,tick,initiative,spare=null,armor=null,recordContributions=null) {
  if(!Array.isArray(initiative)||initiative.length!==fighters.length||new Set(initiative).size!==fighters.length||fighters.some(f=>!initiative.includes(f.id)))throw new RangeError('Frozen initiative must cover every fighter');
  const out=[],lethal=[];
  let alive=fighters.filter(f=>f.hp>0).length;
  let nextOutOrder=1+Math.max(-1,...fighters.map(f=>f.outOrder??-1));
  for(const f of fighters){
    if(f.hp<=0)continue;
    const impacts=hits.filter(h=>h.id===f.id).sort((a,b)=>b.amount-a.amount||Number(b.cause==='collapse')-Number(a.cause==='collapse'));
    let total=0,busy=0;const contributions=[];
    for(const {amount,cause,source=null} of impacts){
      if(!Number.isSafeInteger(amount)||amount<=0)throw new RangeError('Damage must be a positive integer');
      // Unavoidable endgame damage ignores protection and is never credited to a fighter.
      if(cause==='collapse'||cause==='bleed'){total+=amount;contributions.push({source,cause,amount});continue;}
      const protection=f.shield>0?6:0;if(f.shield>0)f.shield--;
      const extra=expandedProtection(f,amount,cause,tick);busy=Math.max(busy,extra.busy);
      // The controller supplies the published strike plating or sandbox override.
      const plate=armor?armor(f,cause):0;
      const effective=Math.max(1,amount-protection-(f.pose==='hiding'?5:0)-(f.statuses?.devoted?2:0)-extra.reduction-plate);
      total+=effective;contributions.push({source,cause:cause??'attack',amount:effective});
    }
    if(!total)continue;
    recordContributions?.(f.id,contributions);
    f.until=tick+5+busy;f.channel=null;
    if(total>=f.hp)lethal.push(f);
    else {f.hp-=total;f.pose='stagger';}
  }
  // Lower priority is eliminated first within one simultaneous impact batch.
  // If every remaining fighter would fall, first priority stays at 1 HP. No
  // action is rerolled and this survivor cannot collect a dead fighter's coins.
  lethal.sort((a,b)=>initiative.indexOf(b.id)-initiative.indexOf(a.id));
  // An optional runtime rule (sandbox only) may name who stands when everyone left would fall;
  // without it the frozen bell order decides exactly as published.
  if(spare&&lethal.length>=alive){const keep=spare(lethal.map(f=>({id:f.id,hp:f.hp,initiative:f.initiative,coins:f.coins})),tick);const index=lethal.findIndex(f=>f.id===keep?.id);if(index>=0)lethal.push(...lethal.splice(index,1));}
  for(const f of lethal){
    if(alive===1){f.hp=1;f.pose='stagger';f.lastStandAt=tick;continue;}
    f.hp=0;f.pose='khole';f.outAt=tick;f.outOrder=nextOutOrder++;alive--;out.push(f.id);
  }
  return out;
}
export function move(f,target,props,step=65) {
  const dx=target.x-f.x,dy=target.y-f.y,norm=Math.max(Math.abs(dx),Math.abs(dy),1);
  const vx=Math.round(dx*step/norm),vy=Math.round(dy*step/norm);
  const free=(x,y)=>x>=850&&x<=9150&&y>=850&&y<=9150&&!props.some(p=>p.solid!==false&&distance2({x,y},p)<(p.radius+RADIUS)**2);
  for(const [x,y] of [[vx,vy],[-vy,vx],[vy,-vx],[vx,0],[0,vy]])if(free(f.x+x,f.y+y)){f.x+=x;f.y+=y;return;}
}
// Scoring reads ordinary shared observations, never future hazards or other policies.
export function scoreActions(policy,actions) {
  const p=policy.preferences;
  return actions.map(a=>({...a,score:4*p[a.preference]+(a.bonus??0)-Math.floor((a.distance??0)/30)-Math.floor((a.risk??0)*p.caution/60)}))
    .sort((a,b)=>b.score-a.score||(a.key<b.key?-1:a.key>b.key?1:0));
}
export function selectAction(policy,actions,roll,iq=0) {
  const scores=scoreActions(policy,actions);if(!scores.length)return null;
  const second=scores[1];
  return roll>=fidelity(iq)&&second&&scores[0].score-second.score<=120?second:scores[0];
}
const EMOTES={plain:['oh.','mine?','still here.'],giddy:['wee!','shiny!','look at that.'],grumpy:['hands off.','not again.','absolutely not.'],odd:['init.','world peace.','normal day.']};
// Without a runtime the published intent controller runs with RULES; the sandbox passes the same
// controller built from its own parameters, with tracing. Every branch stays deterministic.
export function simulate(seed=777,roster=[],runtime=null) {
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('Seed must be uint32');
  if(roster.length!==6||new Set(roster.map(r=>r.id)).size!==6||roster.some((r,i)=>r.id!==i))throw new RangeError('Six unique ordered seats required');
  if(runtime===null)runtime=createIntentController(seed,roster,RULES).runtime;
  // The published game and sandbox use exactly the same spell runtime. Only
  // explicit developer controls can disable it; client notes cannot set these.
  if(runtime.ultimates!==false&&runtime.rules?.ultimates!==false&&!runtime.ultimateSummary){
    // Seat choices are frozen with the join profile; developer overrides remain
    // explicit. Missing choices retain the exact seeded assignments of v8.
    const choices=runtime.ultimateChoices===undefined?roster.map(r=>r.ultimateChoice===undefined?'auto':r.ultimateChoice):runtime.ultimateChoices;
    runtime=createUltimateRuntime(runtime,{seed,roster,choices}).runtime;
  }
  const map=runtime?.makeMap?runtime.makeMap(seed):makeMap(seed),initiative=initiativeOrder(seed),random=rng(seed^0xc011ec7),start=random(6),reverse=random(2)?1:-1;
  const borderAt=runtime?.safeBorder??safeBorder,zoneStartTick=runtime?.zoneStartTick??800;
  let currentTick=0;
  const travel=(f,target,props,step=65,kind='travel')=>runtime?.move?runtime.move({f,target,props,step,tick:currentTick,kind,defaultMove:move}):move(f,target,props,step);
  const brains=roster.map((_,i)=>rng(seed^Math.imul(i+1,0x9e3779b1)));
  const outcomes=roster.map((_,i)=>rng(seed^Math.imul(i+1,0x85ebca6b)));
  const policies=roster.map((r,id)=>r.policy?validatePolicy(r.policy):randomPolicy(rng(seed^Math.imul(id+1,0x1277abcd))));
  const fighters=roster.map((r,id)=>{const pos=spawn[(start+reverse*id+12)%6];return {id,initiative:initiative.indexOf(id),x:pos[0],y:pos[1],hp:100,stamina:100,coins:0,pose:'idle',until:0,outAt:null,outOrder:null,target:null,equipment:null,weapon:null,shield:0,coverUntil:0,used:[],affiliate:r.affiliate===true,statuses:{},channel:null,counterUntil:0,immuneUntil:0,lastEmote:-100,decisionAt:0};});
  const events=[],frames=[],zones=[],decoys=[],metrics=fighters.map(()=>({decisions:0,attacks:0,evades:0,props:0,distance:0,byPreference:{}}));
  const emit=(tick,type,actor=null,target=null,value=null)=>{const event={id:events.length,tick,type,actor,target,value};events.push(event);runtime?.onEvent?.(event);};
  const snapshot=mechanicSnapshot;
  const record=tick=>frames.push({tick,fighters:fighters.map(({lastEmote,decisionAt,...f})=>({...f,used:[...f.used],statuses:{...f.statuses},channel:f.channel?{...f.channel}:null,goal:f.goal?{...f.goal}:null})),coins:map.coins.filter(c=>c.owner===null).map(c=>c.id),coinPositions:map.coins.filter(c=>c.owner===null).map(({id,x,y})=>({id,x,y})),zones:zones.filter(z=>z.until>=tick).map(z=>({...z})),decoys:decoys.filter(d=>d.until>=tick).map(d=>({...d}))});
  const emote=(tick,f)=>{if(tick-f.lastEmote<70)return;f.lastEmote=tick;const words=EMOTES[policies[f.id].tone];emit(tick,'emote',f.id,null,{text:words[(tick+f.id)%words.length]});};
  runtime?.onStart?.({tick:0,seed,map,fighters,emit});
  emit(0,'bell',null,null,{initiative});record(0);
  for(let tick=1;tick<=TICKS;tick++){
    currentTick=tick;
    if(tick===FINAL_COLLAPSE_TICK){
      emit(tick,'final-collapse',null,null,{deadline:TICKS,initiative,text:'FINAL COLLAPSE. NO MORE SHELTER.'});
      for(const f of fighters)if(f.hp>0&&f.pose==='hiding'){f.pose='evade';f.coverUntil=tick;f.until=tick;emit(tick,'shelter-closed',f.id,null,{x:f.x,y:f.y});}
    }
    const hits=[],strikes=[],observed=fighters.map(f=>({...f,statuses:Object.fromEntries(Object.entries(f.statuses).filter(([,expiry])=>expiry>tick))}));
    const seenCoins=map.coins.map(c=>({...c})),seenZones=zones.map(z=>({...z})),seenDecoys=decoys.map(d=>({...d}));
    const damage=(id,amount,source,cause='attack')=>hits.push({id,amount:runtime?.scaleDamage?runtime.scaleDamage(amount,cause,tick):amount,source,cause});
    const mechanicalContext={tick,seed,map,fighters,observed,zones,decoys,damage,move:(f,target,props,step)=>travel(f,target,props,step,'forced'),emit};
    runtime?.beforeTick?.(mechanicalContext);
    const addZone=(kind,x,y,owner,amount=0)=>{const z={id:zones.length,kind,x,y,owner,radius:700,start:tick,impact:tick+20,until:tick+(kind==='trap'?25:100),amount};zones.push(z);return z;};
    const finishItem=(f,prop)=>{
      if(runtime?.allowItem&&!runtime.allowItem({f,prop,tick,observed,map})){f.used=f.used.filter(id=>id!==prop.id);return;}
      const item=ITEMS[prop.type],before=snapshot(f);let type=item.effect;
      const expanded=item.mechanic?applyExpandedItem(f,prop,mechanicalContext):null;
      if(expanded)type='mechanic';
      else if(type==='shelter'){f.pose='hiding';f.coverUntil=tick+110;f.until=f.coverUntil;f.shelterId=prop.id;type='shed';}
      else if(type==='weapon'){f.weapon=item.param;f.equipment='mallet';type='tool';}
      else if(type==='guard'){f.shield=Math.max(f.shield,item.param);type='cover';}
      else if(type==='chest'){const lucky=rng(seed^Math.imul(prop.id+1,719)^Math.imul(f.id+1,1999))(2);if(lucky){f.hp=Math.min(100,f.hp+item.param);type='lucky';}else{damage(f.id,15,null,'crate');type='oops';}}
      else if(type==='wheels'){f.equipment='wheels';f.weapon=null;}
      else if(type==='trip'){damage(f.id,item.param,null,'cone');}
      else if(type==='food')f.stamina=Math.min(100,f.stamina+item.param);
      else if(type==='heal'){f.hp=Math.min(100,f.hp+item.param);type='lucky';}
      else if(type==='coffee')f.statuses.coffee=tick+item.param;
      else if(type==='stink')f.statuses.stink=tick+item.param;
      else if(type==='devotion')f.statuses.devoted=tick+120;
      else if(type==='slow'){f.statuses.slow=Math.max(f.statuses.slow??0,tick+20);f.immuneUntil=tick+40;addZone('slow',prop.x,prop.y,f.id);}
      else if(type==='slide'||type==='skate'){f.until=tick+1;f.statuses.roll=tick+1+(type==='skate'?20:10);f.rollGoal={x:clamp(f.x+(f.goal?.x-f.x||500)*5,900,9100),y:clamp(f.y+(f.goal?.y-f.y||300)*5,900,9100)};f.immuneUntil=tick+40;}
      else if(type==='trail')f.statuses.trail=tick+item.param;
      else if(type==='wash'){delete f.statuses.stink;delete f.statuses.slow;for(const z of zones)if(['slow','slow-pulse'].includes(z.kind)&&distance2(z,f)<1800**2)z.until=tick;}
      else if(type==='decoy')decoys.push({id:decoys.length,x:f.x,y:f.y,owner:f.id,art:item.art,until:tick+80});
      else if(type==='trap'){const foe=observed.filter(o=>o.id!==f.id&&o.hp>0&&distance2(o,f)<1800**2).sort((a,b)=>distance2(a,f)-distance2(b,f))[0];addZone('trap',foe?.x??prop.x,foe?.y??prop.y,f.id,item.param);}
      else if(type==='coin-route'){for(const c of map.coins.filter(c=>c.owner===null&&distance2(c,prop)<2400**2).slice(0,3)){const prev={x:c.x,y:c.y};c.x=f.x;c.y=f.y;emit(tick,'coin-moved',f.id,null,{coinId:c.id,from:prev,to:{x:c.x,y:c.y}});}}
      emit(tick,type,f.id,null,{propId:prop.id,propType:prop.type,x:prop.x,y:prop.y,to:{x:f.x,y:f.y},before,after:snapshot(f),...(expanded??{})});emote(tick,f);
    };
    updateExpandedStatuses(mechanicalContext);
    for(const h of map.hazards){
      if(h.tick-20===tick)emit(tick,'warning',null,null,h);
      if(h.tick===tick){emit(tick,'dust',null,null,h);fighters.filter(f=>f.hp>0&&distance2(f,h)<h.radius**2).forEach(f=>damage(f.id,h.amount??9,null,h.cause??'dust'));}
    }
    for(const z of zones)if(z.kind==='trap'&&z.impact===tick){emit(tick,'site-impact',z.owner,null,{...z});fighters.filter(f=>f.hp>0&&distance2(f,z)<z.radius**2).forEach(f=>damage(f.id,z.amount,z.owner,'site'));}
    for(const f of [...fighters.slice(tick%6),...fighters.slice(0,tick%6)]){
      if(f.hp<=0)continue;
      for(const [status,expiry] of Object.entries(f.statuses))if(expiry<=tick)delete f.statuses[status];
      if(tick%8===0)f.stamina=Math.min(100,f.stamina+(runtime?.staminaRegen?runtime.staminaRegen(tick):1));
      const rand=brains[f.id],p=policies[f.id].preferences;
      if(f.channel&&tick>=f.until){const channel=f.channel;f.channel=null;f.pose='pickup';f.until=tick+5;finishItem(f,map.props[channel.propId]);}
      if(tick>=f.coverUntil&&f.pose==='hiding'){f.pose='travel';f.until=tick;}
      if(f.pose==='windup'&&tick===f.until){
        const stats=combatStats(f),weapon=WEAPONS[f.weapon];strikes.push({actor:f.id,target:f.target,zone:f.aim,amount:stats.minPower+outcomes[f.id](stats.maxPower-stats.minPower+1)+(runtime?.strikeBonus?runtime.strikeBonus(f,p):0),weapon:f.weapon});
        f.pose='recover';f.until=tick+stats.recovery;
      }
      if(tick<f.until||f.pose==='hiding')continue;
      if(f.statuses.roll){f.pose='evade';const old={x:f.x,y:f.y};travel(f,f.rollGoal,map.props,110,'forced-roll');metrics[f.id].distance+=distance(f,old);continue;}
      const boundary=borderAt(tick);
      // A committed animation finishes first. Once free, every controller must
      // leave unsafe ground before choosing another attack or spacing maneuver.
      if(tick>zoneStartTick&&(f.x<boundary||f.y<boundary||f.x>WORLD-boundary||f.y>WORLD-boundary)){
        f.pose='evade';const old={x:f.x,y:f.y};travel(f,{x:5000,y:5000},map.props,combatStats(f).speed,'safety');metrics[f.id].distance+=distance(f,old);metrics[f.id].byPreference.caution=(metrics[f.id].byPreference.caution??0)+1;continue;
      }
      const foes=observed.filter(o=>o.id!==f.id&&o.hp>0&&distance2(f,o)<(runtime?.perceptionRadius??3600)**2).sort((a,b)=>distance2(f,a)-distance2(f,b)||a.id-b.id),nearest=foes[0];
      const warnings=[...map.hazards.filter(h=>h.tick>tick&&h.tick-tick<=20),...seenZones.filter(z=>['trap','pulse'].includes(z.kind)&&z.impact>tick&&z.impact-tick<=24),...(runtime?.warnings?.({f,tick,zones:seenZones})??[])];
      const floorThreat=warnings.find(h=>distance2(f,h)<(h.radius+180)**2);
      const threat=foes.find(o=>o.pose==='windup'&&o.target===f.id&&distance2(f,o)<1200**2);
      const evadeCost=runtime?.evadeStamina??0;
      if((threat||floorThreat)&&f.stamina>=evadeCost&&(!runtime?.allowEvade||runtime.allowEvade({f,tick}))&&rand(100)<Math.min(95,35+Math.floor(p.caution/2)+warningReactionBonus(f,threat,floorThreat))){
        const q=threat??floorThreat;f.pose='evade';f.stamina-=evadeCost;travel(f,{x:f.x*2-q.x,y:f.y*2-q.y},map.props,90,threat?'evade-attack':'evade-hazard');if(threat?.aim&&distance2(f,threat.aim)>=430**2){f.counterUntil=tick+18+(f.statuses.read?f.readCounter??10:0);f.counterTarget=threat.id;}runtime?.onAction?.({tick,actor:f.id,type:'evade',reason:threat?'Visible opponent windup':'Visible floor warning',target:threat?.id??null,observed:{threat:threat?.id??null,floorThreat:floorThreat?{x:floorThreat.x,y:floorThreat.y,radius:floorThreat.radius}:null}});metrics[f.id].evades++;continue;
      }
      const weapon=WEAPONS[f.weapon],reach=combatStats(f).reach;
      if(nearest&&nearest.pose!=='recover'&&distance2(f,nearest)<(reach*.7)**2&&rand(100)<p.range/2){
        f.pose='travel';travel(f,{x:f.x*2-nearest.x,y:f.y*2-nearest.y},map.props,combatStats(f).speed,'spacing');metrics[f.id].byPreference.range=(metrics[f.id].byPreference.range??0)+1;continue;
      }
      if(nearest&&distance2(f,nearest)<reach**2&&f.stamina>=8&&(!runtime?.allowAttack||runtime.allowAttack({f,foe:nearest,tick,observed,map}))&&rand(100)<Math.max(runtime?.attackFloor??12,p.aggression+(nearest.pose==='recover'?p.counter*(f.counterUntil>=tick&&f.counterTarget===nearest.id?1:.5):0)-(nearest.statuses.stink?35:0))){
        f.target=nearest.id;f.aim={x:nearest.x,y:nearest.y};f.pose='windup';f.until=tick+combatStats(f).windup;f.stamina-=8;runtime?.onAction?.({tick,actor:f.id,type:'attack',target:nearest.id,reason:'Eligible opponent in weapon reach; attack roll passed',position:{x:f.x,y:f.y},goal:{...f.aim},observed:{distance:Math.round(Math.sqrt(distance2(f,nearest))),reach}});metrics[f.id].attacks++;continue;
      }
      if(tick>=f.decisionAt||!f.goal){
        const actions=[];
        for(const c of seenCoins)if(c.owner===null&&distance2(f,c)<4400**2)actions.push({key:'coin'+c.id,preference:'greed',x:c.x,y:c.y,distance:distance(f,c),risk:nearest&&distance2(c,nearest)<1000**2?40:0});
        for(const prop of map.props)if(!f.used.includes(prop.id)&&(prop.type!==0||f.affiliate&&tick<FINAL_COLLAPSE_TICK)&&distance2(f,prop)<5000**2){
          if(['slow','slide','trip'].includes(ITEMS[prop.type].effect))continue;
          const item=ITEMS[prop.type];if(item.effect==='snip'&&!f.statuses.slow)continue;
          const bonus=Math.floor(p.novelty/2)+(item.effect==='weapon'&&f.weapon===null?30:0)+(item.effect==='snip'?200:0);
          actions.push({key:'prop'+prop.id,preference:item.preference,x:prop.x,y:prop.y,distance:distance(f,prop),bonus,risk:['trip','trap','slide'].includes(item.effect)?40:0});
        }
        for(const foe of foes)actions.push({key:'foe'+foe.id,preference:'aggression',x:foe.x,y:foe.y,distance:distance(f,foe),bonus:Math.floor(p.opportunism*(100-foe.hp)/100)+(foe.pose==='recover'?p.counter:0)+pursuitBonus(f,foe),risk:foe.statuses.stink?80:foe.equipment?35:15});
        if(nearest&&distance2(f,nearest)<2000**2)actions.push({key:'escape',preference:'mobility',x:clamp(f.x*2-nearest.x,1200,8800),y:clamp(f.y*2-nearest.y,1200,8800),distance:500,bonus:Math.floor(p.range/2)+(f.hp<30?100:0)});
        if(f.shield&&p.defense>60&&(!nearest||distance2(f,nearest)>1100**2))actions.push({key:'hold',preference:'defense',x:f.x,y:f.y,distance:0,bonus:-40});
        for(const d of seenDecoys)if(d.until>tick&&d.owner!==f.id&&distance2(f,d)<2000**2&&canBeFooled(f,d,p))actions.push({key:'decoy'+d.id,preference:d.fake?'greed':'novelty',x:d.x,y:d.y,distance:distance(f,d),bonus:20});
        const border=borderAt(tick);
        const inPressure=f.x<border+300||f.y<border+300||f.x>WORLD-border-300||f.y>WORLD-border-300;
        const chosen=runtime?.chooseAction?runtime.chooseAction({f,tick,actions,policy:policies[f.id],iq:roster[f.id].iq,roll:inPressure?null:rand(100),inPressure,foes,warnings,map}):inPressure?{key:'safe-ground',preference:'caution',x:5000,y:5000}:selectAction(policies[f.id],actions,rand(100),roster[f.id].iq);
        f.goal=chosen?{x:chosen.x,y:chosen.y}: {x:1500+rand(7001),y:1500+rand(7001)};
        f.decisionAt=tick+12;metrics[f.id].decisions++;const key=chosen?.preference??'explore';metrics[f.id].byPreference[key]=(metrics[f.id].byPreference[key]??0)+1;
      }
      f.pose='travel';const previous={x:f.x,y:f.y};travel(f,f.goal,map.props,combatStats(f).speed);metrics[f.id].distance+=distance(f,previous);
      for(const z of zones)if(z.kind==='slow'&&z.until>tick&&f.immuneUntil<=tick&&distance2(f,z)<z.radius**2){f.statuses.slow=Math.max(f.statuses.slow??0,tick+20);f.immuneUntil=tick+40;}
      const decoy=decoys.find(d=>d.until>tick&&d.owner!==f.id&&distance2(f,d)<350**2&&canBeFooled(f,d,p));
      if(decoy){decoy.until=tick;f.pose='pickup';f.until=tick+8;emit(tick,'fooled',f.id,null,{x:f.x,y:f.y,decoyId:decoy.id,decoyArt:decoy.art,decoyX:decoy.x,decoyY:decoy.y,propId:decoy.propId,propType:decoy.propType,fake:decoy.fake===true});}
      const touch=map.props.find(prop=>!f.used.includes(prop.id)&&distance2(f,prop)<(prop.radius+RADIUS+110)**2&&(prop.type!==0||f.affiliate&&tick<FINAL_COLLAPSE_TICK)&&!(prop.type===0&&fighters.some(o=>o.pose==='hiding'&&o.shelterId===prop.id))&&(!runtime?.allowItem||runtime.allowItem({f,prop,tick,observed,map})));
      if(touch){
        f.used.push(touch.id);metrics[f.id].props++;const item=ITEMS[touch.type];
        const channel=Boolean(item.channelTicks)||['devotion','food','coffee','heal','trap','coin-route','decoy','wash'].includes(item.effect);
        f.pose=channel?'channel':'pickup';f.until=tick+(item.channelTicks??(item.effect==='devotion'?40:channel?14:7));
        if(channel){f.channel={propId:touch.id,type:touch.type};emit(tick,'prepare',f.id,null,{propId:touch.id,propType:touch.type});}
        else finishItem(f,touch);
      }
    }
    // Freeze hit qualification before any weapon moves a target. Committed
    // mutual strikes cannot be cancelled by whichever shove is iterated first.
    const qualified=qualifyStrikes(strikes,fighters);
    const pushes=[];
    for(const s of qualified){
      const target=fighters[s.target],attacker=fighters[s.actor],weapon=WEAPONS[s.weapon];
      if(s.landed){
        damage(target.id,s.amount,s.actor);emit(tick,'bump',s.actor,target.id,{from:{x:attacker.x,y:attacker.y},to:{x:target.x,y:target.y}});
        const push=combatStats(attacker).push;
        if(push){const dx=target.x-attacker.x,dy=target.y-attacker.y,norm=Math.max(Math.abs(dx),Math.abs(dy),1);pushes.push({id:target.id,x:Math.round(dx*push/norm),y:Math.round(dy*push/norm)});}
        if(weapon?.slow)addZone('slow',target.x,target.y,s.actor);
        if(weapon?.tether){target.statuses.slow=Math.max(target.statuses.slow??0,tick+20);attacker.statuses.slow=Math.max(attacker.statuses.slow??0,tick+20);}
        emote(tick,attacker);
      }else emit(tick,'miss',s.actor,s.target,{x:s.zone.x,y:s.zone.y});
    }
    for(const f of fighters){const p=pushes.filter(p=>p.id===f.id),dx=p.reduce((n,p)=>n+p.x,0),dy=p.reduce((n,p)=>n+p.y,0);if(dx||dy)travel(f,{x:f.x+dx,y:f.y+dy},map.props,Math.round(Math.min(400,Math.max(Math.abs(dx),Math.abs(dy)))*pushMultiplier(f)),'knockback');}
    for(const c of map.coins.filter(c=>c.owner===null)){
      const claimants=fighters.filter(f=>canCollectCoin(f,c)).sort((a,b)=>distance2(a,c)-distance2(b,c)||((a.id+tick)%6)-((b.id+tick)%6));
      if(claimants.length){const f=claimants[0];c.owner=f.id;f.coins+=c.value;if(f.pose==='travel'){f.pose='pickup';f.until=tick+5;}emit(tick,'coin',f.id,null,{coinId:c.id,amount:c.value,x:c.x,y:c.y,to:{x:f.x,y:f.y}});}
    }
    if(runtime?.bleed&&tick%20===0){const amount=runtime.bleed(tick);if(amount>0)for(const f of fighters)if(f.hp>0)damage(f.id,amount,null,'bleed');}
    if(tick>zoneStartTick&&tick%20===0){const b=borderAt(tick);fighters.filter(f=>f.hp>0&&(f.x<b||f.y<b||f.x>WORLD-b||f.y>WORLD-b)).forEach(f=>damage(f.id,tick>=FINAL_COLLAPSE_TICK?8:2,null,'border'));if(tick===zoneStartTick+20)emit(tick,'closing');}
    runtime?.beforeDamage?.({tick,fighters,hits,emit});
    const contributions=new Map();
    const before=fighters.map(f=>({hp:f.hp,shield:f.shield})),out=resolveDamage(fighters,hits,tick,initiative,runtime?.lastStand??null,runtime?.armor??null,(id,parts)=>contributions.set(id,parts));
    for(const f of fighters)if(f.hp<before[f.id].hp)emit(tick,'damage',f.id,null,{x:f.x,y:f.y,hpBefore:before[f.id].hp,hpAfter:f.hp,amount:before[f.id].hp-f.hp,shieldBefore:before[f.id].shield,shieldAfter:f.shield,sources:hits.filter(h=>h.id===f.id).map(h=>h.source),causes:hits.filter(h=>h.id===f.id).map(h=>h.cause),contributions:contributions.get(f.id)??[]});
    for(const id of out)emit(tick,'khole',id,null,{x:fighters[id].x,y:fighters[id].y});
    // Optional sandbox rule: the fighter whose blow finished an opponent may be credited (second wind).
    if(runtime?.onFinish)for(const id of out){const blows=hits.filter(h=>h.id===id&&Number.isInteger(h.source)&&h.source!==id&&fighters[h.source].hp>0).sort((a,b)=>b.amount-a.amount||a.source-b.source);if(!blows.length)continue;const killer=fighters[blows[0].source],hpBefore=killer.hp,staminaBefore=killer.stamina,credit=runtime.onFinish({tick,killer,victim:fighters[id]});if(credit)emit(tick,'second-wind',killer.id,id,{x:killer.x,y:killer.y,amount:credit,healed:killer.hp-hpBefore,hpBefore,hp:killer.hp,staminaBefore,stamina:killer.stamina,text:'SECOND WIND.'});}
    for(const f of fighters)if(f.lastStandAt===tick)emit(tick,'last-stand',f.id,null,{x:f.x,y:f.y,initiative,text:runtime?.lastStandText??'ONE LEFT. THE TIE ORDER SAVED THEM.'});
    record(tick);if(endReason(fighters,tick))break;
  }
  const ticks=frames.at(-1).tick,reason=endReason(fighters,ticks);emit(ticks,'finish',null,null,{reason});
  return {version:VERSION,contentVersion:CONTENT_VERSION,policyVersion:POLICY_VERSION,policies,intents:runtime?.intents??null,initiative,seed,hz:HZ,ticks,maxTicks:TICKS,reason,map,frames,events,ranking:rankFighters(fighters),pickupBudget:24,metrics,...(runtime.ultimateSummary?{ultimates:runtime.ultimateSummary()}:{})};
}
export function frameAt(replay,seconds) {if(!Number.isFinite(seconds))throw new RangeError('Finite replay time required');return replay.frames[clamp(Math.floor(seconds*HZ),0,replay.ticks)];}
