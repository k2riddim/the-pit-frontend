// The intent controller shared by the published engine and the sandbox: territory, engagement,
// item classes, target criterion, one later phase, and the balance rules (sudden death, second
// wind, thick skin, bleed, last stand). Dependency-free apart from the engine's own helpers; it
// never consumes the simulation RNG, so equal inputs give byte-identical replays everywhere.
//
// core.mjs builds this controller with RULES when simulate() is called without a runtime; the
// sandbox builds it with its parameters and tracing switched on. The cycle between core.mjs and
// this module is safe: neither uses the other's exports while loading.
import { makeMap, move, scoreActions, selectAction, rng, WORLD, RADIUS, HZ, TICKS, FINAL_COLLAPSE_TICK } from './core.mjs';
import { DEFAULT_INTENT, validateIntent } from './sandbox-policy.mjs';
import { ITEMS } from './content.mjs';
import { fidelity, validatePolicy, randomPolicy } from './policy.mjs';

export const CONTROLLER_VERSION = 'yard-controller-2';

// Every rule the controller reads, with the values that reproduce the sandbox before the balance
// work (2026-09-12). core.mjs owns the published values in RULES.
export const RULE_DEFAULTS = Object.freeze({
  speedMultiplier: 1, damageMultiplier: 1, perceptionRadius: 3600, zoneStartSeconds: 40, propCount: null,
  suddenDeathSeconds: 50, suddenDeathMultiplier: 3, healthTieBreak: 1,
  finisherHeal: 0, retaliationFloor: 12, aggressionPower: 0, evadeStamina: 0, suddenDeathBleed: 0, aggressionArmor: 0,
});

// Visible-object classes the contract can seek or avoid, derived from each item's effect.
const ITEM_CLASS_BY_EFFECT=Object.freeze({shelter:'shelter',barricade:'shelter',weapon:'weapon',reach:'weapon',charge:'weapon',feint:'weapon',guard:'protection',parry:'protection',brace:'protection',anchor:'protection',dustguard:'protection',platform:'protection',food:'recovery',heal:'recovery',coffee:'recovery',wash:'recovery',chest:'container',trap:'hazard',snare:'hazard',slide:'hazard',slow:'hazard',stink:'hazard',projectile:'hazard','pulse-zone':'hazard',shove:'hazard',door:'hazard','coin-snare':'hazard',decoy:'hazard',fake:'hazard',trip:'hazard'});
export const itemClass=effect=>ITEM_CLASS_BY_EFFECT[effect]??'gadget';
const TRIGGER_WORDS=Object.freeze({time:v=>`${v} seconds have passed`,health:v=>`health fell below ${v}`,zone:()=>'the boundary started closing',damaged:()=>'the first hit landed',coins:v=>`${v} coins were banked`});

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const d2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const point=p=>({x:Math.round(p.x),y:Math.round(p.y)});
const anchors=Object.freeze({'top-left':{x:1800,y:1800},'top-right':{x:8200,y:1800},'bottom-left':{x:1800,y:8200},'bottom-right':{x:8200,y:8200},center:{x:5000,y:5000}});
const radii=Object.freeze({small:650,medium:1050,large:1550});
export const suddenDeathTick=rules=>rules.suddenDeathSeconds>=60?Infinity:rules.suddenDeathSeconds*HZ;

// Deterministic patrol point inside a territory: it changes every two seconds per fighter and
// never consumes the simulation RNG.
function patrolSpot(id,tick,t){
  const slot=Math.floor(tick/40);
  let n=(Math.imul(slot+1,0x9e3779b1)^Math.imul(id+1,0x85ebca6b)^0x5bd1e995)>>>0;
  const next=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
  const ux=next(),uy=next(),{minX,minY,maxX,maxY}=t.bounds;
  return {x:Math.round(minX+ux*(maxX-minX)),y:Math.round(minY+uy*(maxY-minY))};
}
// When one simultaneous batch would fell everyone left: the healthiest stands (rule 1), the hardest
// hitter (2), or the fighter with the most fight left, health plus damage dealt (3). Equal scores
// fall back to health, then the frozen bell order. Rule 0 keeps the bell order alone.
export function chooseLastStand(lethal){
  return [...lethal].sort((a,b)=>b.hp-a.hp||(a.initiative??a.id)-(b.initiative??b.id))[0]??null;
}
export function chooseLastStandByDamage(lethal,dealt){
  return [...lethal].sort((a,b)=>(dealt[b.id]??0)-(dealt[a.id]??0)||b.hp-a.hp||(a.initiative??a.id)-(b.initiative??b.id))[0]??null;
}
export function chooseLastStandByFight(lethal,dealt){
  return [...lethal].sort((a,b)=>(b.hp+(dealt[b.id]??0))-(a.hp+(dealt[a.id]??0))||b.hp-a.hp||(a.initiative??a.id)-(b.initiative??b.id))[0]??null;
}
export const LAST_STAND_TEXTS=Object.freeze(['ONE LEFT. THE TIE ORDER SAVED THEM.','ONE LEFT. THE HEALTHIEST STOOD.','ONE LEFT. THE HARDEST HITTER STOOD.','ONE LEFT. THE MOST FIGHT LEFT STOOD.']);

export function borderAt(tick,rules=RULE_DEFAULTS) {
  const start=(rules.zoneStartSeconds??RULE_DEFAULTS.zoneStartSeconds)*HZ,t=clamp(tick,0,TICKS);
  return t<=start?850:t<=FINAL_COLLAPSE_TICK?850+Math.floor((t-start)*1000/(FINAL_COLLAPSE_TICK-start)):1850+Math.floor((t-FINAL_COLLAPSE_TICK)*3150/(TICKS-FINAL_COLLAPSE_TICK));
}
export function territoryFor(intent,tick,rules=RULE_DEFAULTS) {
  if(!intent||intent.territory.anchor==='any')return null;
  const requested=anchors[intent.territory.anchor];
  if(!requested)throw new TypeError('Unknown sandbox anchor');
  const border=borderAt(tick,rules),margin=Math.min(350,Math.max(0,5000-border));
  const low=border+margin,high=WORLD-low,x=clamp(requested.x,low,high),y=clamp(requested.y,low,high),radius=radii[intent.territory.radius];
  return {anchor:intent.territory.anchor,mode:intent.territory.mode,x,y,radius,bounds:{minX:Math.max(border,x-radius),minY:Math.max(border,y-radius),maxX:Math.min(WORLD-border,x+radius),maxY:Math.min(WORLD-border,y+radius)},requested:{...requested},relocated:x!==requested.x||y!==requested.y,border};
}
export function inside(p,t,margin=0){return Boolean(t&&p.x>=t.bounds.minX+margin&&p.x<=t.bounds.maxX-margin&&p.y>=t.bounds.minY+margin&&p.y<=t.bounds.maxY-margin);}
function project(p,t){return {x:Math.round(clamp(p.x,t.bounds.minX,t.bounds.maxX)),y:Math.round(clamp(p.y,t.bounds.minY,t.bounds.maxY))};}
function segmentClear(a,b,props,padding=8){
  const dx=b.x-a.x,dy=b.y-a.y,denom=dx*dx+dy*dy;
  return !props.some(p=>{if(p.solid===false)return false;const t=denom?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/denom,0,1):0;return (a.x+dx*t-p.x)**2+(a.y+dy*t-p.y)**2<(p.radius+RADIUS+padding)**2;});
}
function walkable(p,props){return p.x>=850&&p.y>=850&&p.x<=9150&&p.y<=9150&&!props.some(q=>q.solid!==false&&d2(p,q)<(q.radius+RADIUS+10)**2);}

// A deterministic grid route prevents a fighter from endlessly scraping a pallet. Search only runs
// when the straight line is blocked; caches are local to this replay and never touch the RNG.
function makeNavigator(props){
  const spacing=250,side=33,nodes=Array.from({length:side*side},(_,i)=>({x:1000+(i%side)*spacing,y:1000+Math.floor(i/side)*spacing}));
  const free=nodes.map(p=>walkable(p,props)),neighbors=new Map(),cache=new Map();
  const neighborsOf=id=>{
    if(neighbors.has(id))return neighbors.get(id);
    const out=[],x=id%side,y=Math.floor(id/side);
    for(const [dx,dy] of [[0,-1],[-1,0],[1,0],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]){const nx=x+dx,ny=y+dy,j=ny*side+nx;if(nx<0||nx>=side||ny<0||ny>=side||!free[j]||!segmentClear(nodes[id],nodes[j],props))continue;out.push(j);}
    neighbors.set(id,out);return out;
  };
  const nearest=(p,bounds)=>{let best=-1,dist=Infinity;for(let i=0;i<nodes.length;i++){if(!free[i]||bounds&&!inside(nodes[i],bounds))continue;const n=d2(p,nodes[i]);if(n<dist&&segmentClear(p,nodes[i],props,0)){dist=n;best=i;}}return best;};
  function destination(target,from,bounds){
    let goal={x:clamp(Math.round(target.x),850,9150),y:clamp(Math.round(target.y),850,9150)};
    if(bounds)goal=project(goal,bounds);
    for(let n=0;n<props.length+1;n++){
      const obstacle=props.find(p=>p.solid!==false&&d2(goal,p)<(p.radius+RADIUS+12)**2);if(!obstacle)return goal;
      // Item centers are solid: approach the near edge, within pickup reach.
      let best=null,bestDist=Infinity;
      for(let i=0;i<32;i++){const angle=2*Math.PI*i/32,r=obstacle.radius+RADIUS+24,candidate={x:Math.round(obstacle.x+Math.cos(angle)*r),y:Math.round(obstacle.y+Math.sin(angle)*r)};if(!walkable(candidate,props)||bounds&&!inside(candidate,bounds))continue;const dist=d2(from,candidate);if(dist<bestDist){bestDist=dist;best=candidate;}}
      if(!best)break;goal=best;
    }
    return walkable(from,props)?point(from):goal;
  }
  return {destination,next(from,target,bounds){
    const goal=destination(target,from,bounds);
    if(segmentClear(from,goal,props,0))return {waypoint:goal,goal,detour:false};
    const start=nearest(from,bounds),end=nearest(goal,bounds);
    if(start<0||end<0)return {waypoint:point(from),goal,detour:true,blocked:true};
    const key=`${start}:${end}:${bounds?Object.values(bounds.bounds).map(Math.round).join(','):''}`;
    let route=cache.get(key);
    if(!route){
      const open=new Set([start]),cost=new Map([[start,0]]),parent=new Map();let found=false;
      while(open.size){let current=-1,best=Infinity;for(const id of open){const estimate=cost.get(id)+Math.sqrt(d2(nodes[id],nodes[end]));if(estimate<best||estimate===best&&id<current){best=estimate;current=id;}}open.delete(current);if(current===end){found=true;break;}
        for(const next of neighborsOf(current)){if(bounds&&!inside(nodes[next],bounds))continue;const value=cost.get(current)+Math.sqrt(d2(nodes[current],nodes[next]));if(value<(cost.get(next)??Infinity)){cost.set(next,value);parent.set(next,current);open.add(next);}}
      }
      route=[];if(found){for(let id=end;;id=parent.get(id)){route.unshift(id);if(id===start)break;}}
      cache.set(key,route);if(cache.size>4000)cache.delete(cache.keys().next().value);
    }
    if(!route.length)return {waypoint:point(from),goal,detour:true,blocked:true};
    let waypoint=nodes[route[0]];
    for(const id of route){if(segmentClear(from,nodes[id],props,0))waypoint=nodes[id];else break;}
    return {waypoint,goal,detour:true};
  }};
}

/**
 * Builds the runtime that core.simulate() drives. `rules` is a complete rule record (RULES in
 * core.mjs, or the validated sandbox configuration); `trace` records the decision audit that the
 * lab shows. Returns the runtime, the validated intents, the per-fighter counters, the audit, and
 * metrics(replay) which finishes the counters once the replay exists.
 */
export function createIntentController(seed,roster,rules,{trace=false}={}) {
  if(!Array.isArray(roster)||roster.length!==6)throw new RangeError('Six fighters required');
  if(typeof trace!=='boolean')throw new TypeError('Trace must be boolean');
  const settings={...RULE_DEFAULTS,...rules};
  const intents=roster.map(r=>validateIntent(r.intent??DEFAULT_INTENT));
  // One later phase per fighter: its trigger is checked from the fighter's own observations and
  // recorded once; before it fires the first phase applies, after it the second, never back.
  const phaseAt=roster.map(()=>null),damagedAt=roster.map(()=>null),hpNow=roster.map(()=>100),coinsNow=roster.map(()=>0);
  const secondPhase=intents.map(i=>i.then?{territory:i.then.territory,engagement:i.then.engagement,items:i.then.items,then:null,fallback:i.fallback}:null);
  const intentAtTick=(id,tick)=>phaseAt[id]!==null&&tick>=phaseAt[id]?secondPhase[id]:intents[id];
  const dealt=roster.map(()=>0);
  // The same personalities the engine derives: explicit ones validated, blank seats seeded exactly like core.mjs.
  const policies=roster.map((r,id)=>r.policy?validatePolicy(r.policy):randomPolicy(rng(seed^Math.imul(id+1,0x1277abcd))));
  const audit=[],last=new Map(),arrived=roster.map(()=>false),revenge=roster.map(()=>new Map()),stats=roster.map((r,id)=>({id,decisions:0,blockedAttacks:0,coinFirst:0,filteredActions:0,relocations:0,attacks:0,outsideTerritoryAttacks:0}));
  let navigator;
  const record=entry=>{if(trace)audit.push({id:audit.length,...entry});};
  const distinct=(key,signature,entry)=>{if(last.get(key)===signature)return;last.set(key,signature);record(entry);};
  function activeIntent(id,tick,f=null){
    const base=intents[id];
    if(!base.then)return base;
    if(phaseAt[id]===null){
      const {kind,value}=base.then.trigger;let fired=false;
      if(kind==='time')fired=tick>=value*HZ;
      else if(kind==='zone')fired=tick>settings.zoneStartSeconds*HZ;
      else if(kind==='damaged')fired=damagedAt[id]!==null;
      else if(kind==='coins')fired=coinsNow[id]>=value;
      else if(kind==='health')fired=(f?f.hp:hpNow[id])<value;
      if(fired){phaseAt[id]=tick;record({tick,actor:id,type:'phase-change',reason:`Second phase begins: ${TRIGGER_WORDS[kind](value)}`,position:f?point(f):null,trigger:{kind,value}});}
    }
    return phaseAt[id]===null?base:secondPhase[id];
  }
  const territory=(id,tick,f=null)=>territoryFor(activeIntent(id,tick,f),tick,settings);
  const matchesTarget=(f,foe,target,foes,tick)=>{
    if(target==='any')return true;
    if(target==='weakest')return foe.hp===Math.min(...foes.map(o=>o.hp));
    if(target==='richest')return foe.coins>0&&foe.coins===Math.max(...foes.map(o=>o.coins));
    if(target==='attacker')return (revenge[f.id].get(foe.id)??-1)>=tick;
    // Mobility gear also uses `equipment` (wheels explicitly clear the weapon).
    // Only the actual weapon slot makes a fighter armed; index zero is valid.
    const armed=foe.weapon!==null&&foe.weapon!==undefined;
    return target==='armed'?armed:!armed;
  };
  function attackRule(f,foe,tick,foes=null){
    const intent=activeIntent(f.id,tick,f),t=territory(f.id,tick,f),mode=intent.engagement.mode;
    if(mode==='avoid')return 'The accepted plan forbids initiating attacks';
    if(intent.engagement.target!=='any'&&foes&&!matchesTarget(f,foe,intent.engagement.target,foes,tick)&&foes.some(o=>o.id!==foe.id&&matchesTarget(f,o,intent.engagement.target,foes,tick)&&d2(o,f)<1500**2))return 'A closer match for the chosen kind of opponent is available';
    if(t&&!inside(f,t))return 'Return to assigned territory before engaging';
    if(t&&!inside(foe,t))return 'Opponent is outside defended territory';
    if(mode==='intruders'&&!inside(foe,t))return 'Opponent has not entered defended territory';
    if(mode==='retaliate'&&!((revenge[f.id].get(foe.id)??-1)>=tick))return 'Opponent has not damaged this fighter in the last 10 seconds';
    return null;
  }
  function itemRule(f,prop,tick,foes){
    const item=ITEMS[prop.type],intent=activeIntent(f.id,tick,f);
    if(intent.items.avoid.includes(itemClass(item.effect)))return 'The accepted plan avoids this kind of object';
    if(!['projectile','trap','snare','shove','door'].includes(item.effect)||intent.engagement.mode==='any')return null;
    if(intent.engagement.mode==='avoid')return 'Offensive item activation conflicts with avoid combat';
    const range=Math.min(item.mechanic?.range??1800,settings.perceptionRadius),target=foes.filter(o=>o.id!==f.id&&o.hp>0&&d2(o,f)<range**2).sort((a,b)=>d2(a,f)-d2(b,f)||a.id-b.id)[0];
    if(!target)return 'Offensive item has no eligible observed target';
    return attackRule(f,target,tick,foes);
  }
  const runtime={
    rules:settings,
    perceptionRadius:settings.perceptionRadius,zoneStartTick:settings.zoneStartSeconds*HZ,
    safeBorder:tick=>borderAt(tick,settings),
    makeMap(seed){const map=makeMap(seed,settings.propCount===null||settings.propCount===undefined?{}:{propCount:settings.propCount});navigator=makeNavigator(map.props);return map;},
    scaleDamage:(amount,cause,tick=0)=>{
      if(cause==='collapse'||cause==='bleed')return amount;
      const multiplier=settings.damageMultiplier*(tick>=suddenDeathTick(settings)?settings.suddenDeathMultiplier:1);
      return Math.max(1,Math.round(amount*multiplier));
    },
    staminaRegen:tick=>tick>=suddenDeathTick(settings)?2:1,
    lastStand:settings.healthTieBreak===1?chooseLastStand:settings.healthTieBreak===2?lethal=>chooseLastStandByDamage(lethal,dealt):settings.healthTieBreak===3?lethal=>chooseLastStandByFight(lethal,dealt):null,
    lastStandText:settings.healthTieBreak?LAST_STAND_TEXTS[settings.healthTieBreak]:undefined,
    attackFloor:settings.retaliationFloor,
    armor:(f,cause)=>cause==='attack'?Math.round(settings.aggressionArmor*policies[f.id].preferences.aggression/100):0,
    strikeBonus:(f,p)=>Math.round(settings.aggressionPower*p.aggression/100),
    evadeStamina:settings.evadeStamina,
    bleed:tick=>tick>=suddenDeathTick(settings)?settings.suddenDeathBleed:0,
    onFinish({tick,killer,victim}){
      if(!settings.finisherHeal||killer.hp<=0)return 0;
      const hpBefore=killer.hp,staminaBefore=killer.stamina;
      killer.hp=Math.min(100,killer.hp+settings.finisherHeal);killer.stamina=Math.min(100,killer.stamina+settings.finisherHeal);
      record({tick,actor:killer.id,type:'second-wind',target:victim.id,reason:'Finishing blow: the rules return health and stamina to the fighter who ended the fight',position:point(killer),hpBefore,hpAfter:killer.hp,staminaBefore,staminaAfter:killer.stamina});
      return settings.finisherHeal;
    },
    onEvent(event){
      if(event.type==='damage'){
        const hostile=source=>Number.isInteger(source)&&source>=0&&source<roster.length&&source!==event.actor;
        if(Array.isArray(event.value.contributions)){
          // The resolver supplies effective, post-protection hits. Environmental
          // damage participates in the denominator but never earns fighter credit.
          // Scale overkill down to actual HP lost; a blocked hit cannot establish
          // retaliation just because a hazard hurt the same fighter on this tick.
          const hits=event.value.contributions.filter(hit=>Number.isFinite(hit.amount)&&hit.amount>0);
          const total=hits.reduce((amount,hit)=>amount+hit.amount,0);
          if(total>0&&event.value.amount>0)for(const hit of hits)if(hostile(hit.source)){
            revenge[event.actor].set(hit.source,event.tick+10*HZ);
            dealt[hit.source]+=event.value.amount*hit.amount/total;
          }
        }else{
          // Older replay studies and synthetic controller fixtures have no
          // contribution breakdown. Keep their historical source-list behavior.
          const sources=(event.value.sources??[]).filter(hostile);
          for(const source of sources){revenge[event.actor].set(source,event.tick+10*HZ);dealt[source]+=event.value.amount/sources.length;}
        }
        hpNow[event.actor]=event.value.hpAfter;
        // "When hurt" means the first real health loss, including a crate or site
        // hazard. Retaliation above still requires an identified hostile source.
        if(event.value.amount>0&&damagedAt[event.actor]===null)damagedAt[event.actor]=event.tick;
      }
      else if(event.type==='coin'&&Number.isInteger(event.actor))coinsNow[event.actor]+=event.value?.amount??1;
      else if(event.type==='second-wind'&&Number.isInteger(event.actor))hpNow[event.actor]=event.value.hp;
      else if(['lucky','mechanic'].includes(event.type)&&Number.isInteger(event.actor)&&Number.isInteger(event.value?.after?.hp))hpNow[event.actor]=event.value.after.hp;
    },
    onAction(entry){
      if(entry.type==='attack'){stats[entry.actor].attacks++;const t=territory(entry.actor,entry.tick);if(t&&(!inside(entry.position,t)||!inside(entry.goal,t)))stats[entry.actor].outsideTerritoryAttacks++;}
      record({...entry,territory:territory(entry.actor,entry.tick)});
    },
    allowAttack({f,foe,tick,observed=[],map=null}){
      const p=policies[f.id].preferences;
      // Greed survives aggression: a collector takes a coin within reach before swinging.
      if(map&&p.greed>=60&&p.greed>p.aggression&&map.coins.some(c=>c.owner===null&&d2(c,f)<600**2)){
        stats[f.id].coinFirst++;distinct(`coin-first:${f.id}`,Math.floor(tick/20),{tick,actor:f.id,type:'coin-first',target:foe.id,reason:'A coin within reach comes first for a collector; the swing waits',position:point(f)});
        return false;
      }
      const reason=attackRule(f,foe,tick,observed.filter(o=>o.id!==f.id&&o.hp>0));
      if(reason){stats[f.id].blockedAttacks++;distinct(`attack:${f.id}:${foe.id}`,reason,{tick,actor:f.id,type:'attack-blocked',target:foe.id,reason,position:point(f),goal:point(foe),territory:territory(f.id,tick)});return false;}
      last.delete(`attack:${f.id}:${foe.id}`);return true;
    },
    allowItem({f,prop,tick,observed}){
      const reason=itemRule(f,prop,tick,observed);
      if(reason){distinct(`item:${f.id}:${prop.id}`,reason,{tick,actor:f.id,type:'item-blocked',reason,propId:prop.id,position:point(f),territory:territory(f.id,tick)});return false;}
      last.delete(`item:${f.id}:${prop.id}`);return true;
    },
    chooseAction({f,tick,actions,policy,iq,roll,inPressure,foes,warnings,map}){
      const intent=activeIntent(f.id,tick,f),t=territory(f.id,tick,f),holding=intent.territory.mode==='hold',filtered=[],allowed=[];
      const target=intent.engagement.target,anyMatch=target!=='any'&&foes.some(o=>matchesTarget(f,o,target,foes,tick));
      if(tick>=suddenDeathTick(settings))distinct('sudden-death','on',{tick,actor:null,type:'sudden-death',reason:'Sudden death: attack, item and border damage are multiplied and stamina regenerates faster until the end'});
      if(t&&inside(f,t))arrived[f.id]=true;
      for(const a of actions){
        let reason=null;
        if(t&&!inside(a,t))reason='Destination would leave the assigned territory';
        if(a.key.startsWith('foe')){
          const foe=foes.find(o=>`foe${o.id}`===a.key);
          reason=reason??attackRule(f,foe,tick,foes);
          if(!reason&&anyMatch){if(matchesTarget(f,foe,target,foes,tick))a.bonus=(a.bonus??0)+120;else reason='Not the chosen kind of opponent while one is in sight';}
          if(!reason&&intent.engagement.chase==='none')reason='No pursuit: wait for opponents to enter weapon reach';
          if(!reason&&intent.engagement.chase==='territory'&&!inside(a,t))reason='Pursuit cannot leave the assigned territory';
        }
        if(a.key.startsWith('coin')&&policy.preferences.greed>=60&&(a.distance??0)<1500)a.bonus=(a.bonus??0)+(policy.preferences.greed-50);
        if(a.key.startsWith('prop')){
          const prop=map.props[Number(a.key.slice(4))],cls=itemClass(ITEMS[prop.type].effect);
          reason=reason??itemRule(f,prop,tick,foes);
          const holdsKind=cls==='weapon'?f.weapon!==null&&f.weapon!==undefined:cls==='protection'?f.shield>0:false;
          if(!reason&&intent.items.seek.includes(cls)&&!holdsKind)a.bonus=(a.bonus??0)+150;
        }
        if(intent.engagement.mode==='avoid'&&['aggression','sabotage'].includes(a.preference))reason='Combat-seeking actions conflict with avoid combat';
        if(reason)filtered.push({key:a.key,reason});else allowed.push(a);
      }
      let chosen,reason;
      if(t&&!inside(f,t)){
        chosen={key:t.relocated?'relocate-territory':arrived[f.id]?'return-territory':'reach-territory',preference:'defense',x:t.x,y:t.y};
        reason=t.relocated?'Shrinking zone made the requested corner unsafe; relocate to its nearest safe territory':arrived[f.id]?'Return to assigned territory after displacement':'Travel to the assigned territory before choosing optional actions';
      }else if(inPressure){
        const goal=t??{x:5000,y:5000};chosen={key:'safe-ground',preference:'caution',x:goal.x,y:goal.y};reason='The visible shrinking zone takes priority over optional actions';
      }else{
        if(holding&&t){
          // Holding means living inside the territory, not freezing on the anchor: patrol a
          // deterministic point inside the bounds; standing still only wins when nothing else does.
          const spot=patrolSpot(f.id,tick,t);
          allowed.push({key:'patrol-territory',preference:'defense',x:spot.x,y:spot.y,distance:Math.max(Math.abs(spot.x-f.x),Math.abs(spot.y-f.y)),bonus:0});
          allowed.push({key:'hold-territory',preference:'defense',x:f.x,y:f.y,distance:0,bonus:-60});
        }
        chosen=selectAction(policy,allowed,roll??0,iq);
        if(!chosen)chosen={key:holding?'hold-territory':'wait',preference:'defense',x:f.x,y:f.y};
        reason=chosen.key==='patrol-territory'?'Patrol inside the assigned territory; no higher-scoring permitted action':chosen.key==='hold-territory'?'Hold position inside the assigned territory; no higher-scoring permitted action':chosen.key==='wait'?'No currently permitted observed action':'Eligible action selected by scores and the bounded personality/IQ tie choice';
      }
      stats[f.id].decisions++;stats[f.id].filteredActions+=filtered.length;
      if(trace)record({tick,actor:f.id,type:'decision',reason,position:point(f),goal:point(chosen),target:chosen.key.startsWith('foe')?Number(chosen.key.slice(3)):null,chosen:{...chosen},filtered,territory:t,observed:{foes:foes.map(o=>({id:o.id,x:o.x,y:o.y,hp:o.hp,pose:o.pose,target:o.target})),warnings:warnings.map(w=>({x:w.x,y:w.y,radius:w.radius,impact:w.impact??w.tick}))},roll,fidelity:fidelity(iq),scores:scoreActions(policy,allowed).map(a=>({key:a.key,score:a.score,preference:a.preference,preferenceWeight:policy.preferences[a.preference],base:4*policy.preferences[a.preference],distancePenalty:Math.floor((a.distance??0)/30),riskPenalty:Math.floor((a.risk??0)*policy.preferences.caution/60),bonus:a.bonus??0})),iq:Number.isFinite(iq)?iq:0});
      return chosen;
    },
    move({f,target,props,step,tick,kind}){
      const intent=activeIntent(f.id,tick,f),t=territory(f.id,tick,f),before=point(f);
      const physicallyForced=['forced','forced-roll','knockback'].includes(kind);
      if(t&&inside(f,t))arrived[f.id]=true;
      if(physicallyForced){
        move(f,target,props,step);
        record({tick,actor:f.id,type:'forced-movement',reason:kind==='knockback'?'Weapon knockback temporarily overrides positioning':kind==='forced-roll'?'Active rolling effect temporarily overrides positioning':'An active item effect temporarily overrides positioning',position:before,goal:point(target),after:point(f),territory:t});return;
      }
      let goal=point(target),bounds=null;
      if(t){
        if(!inside(f,t))goal={x:t.x,y:t.y};
        else {bounds=t;goal=project(goal,t);}
        if(t.relocated){const key=`relocation:${f.id}`,signature=`${Math.floor(t.x/300)}:${Math.floor(t.y/300)}`;if(last.get(key)!==signature){stats[f.id].relocations++;distinct(key,signature,{tick,actor:f.id,type:'safety-override',reason:'Shrinking zone made the requested anchor unsafe; the defended territory moved inward',position:before,goal:{x:t.x,y:t.y},territory:t});}}
      }
      if(kind==='safety'){
        goal=t?{x:t.x,y:t.y}:{x:5000,y:5000};bounds=null;
        distinct(`safety:${f.id}`,`${Math.floor(goal.x/300)}:${Math.floor(goal.y/300)}`,{tick,actor:f.id,type:'safety-override',reason:'Currently outside the safe zone; retreat before attacking or collecting',position:before,goal,territory:t});
      }else last.delete(`safety:${f.id}`);
      const route=navigator.next(f,goal,bounds),adjustedStep=Math.min(Math.round(step*settings.speedMultiplier),Math.max(Math.abs(route.waypoint.x-f.x),Math.abs(route.waypoint.y-f.y)));
      if(adjustedStep>0)move(f,route.waypoint,props,adjustedStep);
      // The shared mover tries collision sidesteps; a boundary-clipped step must not quietly choose
      // a sidestep outside the defended rectangle.
      if(bounds&&!inside(f,bounds)){f.x=before.x;f.y=before.y;}
      f.goal=point(route.goal);
      if(f.x===before.x&&f.y===before.y&&kind==='travel')f.pose='idle';
      if(route.detour)distinct(`route:${f.id}`,`${Math.floor(goal.x/250)}:${Math.floor(goal.y/250)}:${route.blocked?'blocked':'detour'}`,{tick,actor:f.id,type:route.blocked?'path-blocked':'path-detour',reason:route.blocked?'No safe reachable route to the requested point; holding position':'Solid map object blocks the direct line; follow a deterministic walkable route',position:before,goal:route.goal,waypoint:point(route.waypoint),territory:t});else last.delete(`route:${f.id}`);
      if(['spacing','evade-attack','evade-hazard'].includes(kind))record({tick,actor:f.id,type:'movement',reason:kind==='spacing'?'Maintain weapon spacing within positioning constraints':kind==='evade-hazard'?'Avoid a visible floor warning within positioning constraints':'Evade an observed attack within positioning constraints',position:before,goal:route.goal,after:point(f),territory:t});
    },
  };
  function metrics(replay){
    for(const entry of stats){
      const alive=replay.frames.filter(frame=>frame.fighters[entry.id].hp>0),intent=intents[entry.id];
      const anchored=frame=>intentAtTick(entry.id,frame.tick).territory.anchor!=='any';
      const insideFrames=alive.filter(frame=>anchored(frame)&&inside(frame.fighters[entry.id],territoryFor(intentAtTick(entry.id,frame.tick),frame.tick,settings)));
      entry.phaseChangeTick=phaseAt[entry.id];
      entry.aliveTicks=alive.length;entry.insideTerritoryTicks=insideFrames.length;entry.arrivalTick=insideFrames[0]?.tick??null;entry.timeToTerritorySeconds=entry.arrivalTick===null?null:entry.arrivalTick/HZ;
      entry.adherence=(intent.territory.anchor!=='any'||secondPhase[entry.id]?.territory.anchor!=='any')&&insideFrames.length?Math.round(1000*insideFrames.length/Math.max(1,alive.length-entry.arrivalTick))/10:null;
      entry.damageDealt=Math.round(dealt[entry.id]);
    }
    return stats;
  }
  runtime.intents=intents;
  return {runtime,intents,policies,stats,trace:audit,rules:settings,metrics};
}
