// Opt-in spell runtime. No money, provider calls, live input or global RNG draws.
export const ULTIMATE_VERSION = 'yard-ultimates-3';
export const ULTIMATE_HZ = 20;
export const ULTIMATE_RULES = Object.freeze({
  firstReadyTick: 140, readySpacingTicks: 23, windupTicks: 22,
  opportunityTicks: 60, castSpacingTicks: 10, maxWindups: 2,
  guardPoints: 18, guardTicks: 160, snareTicks: 26, snareImmunityTicks: 80,
});
export const ULTIMATES = Object.freeze([
  {id:'peace-patch',name:'Peace Patch',kind:'heal',heal:26,radius:650,maxTargets:0,detail:'Heal up to 26 HP and shake off the snare. At full health: an 18-point shield for 8 seconds.'},
  {id:'big-bonk',name:'Big Bonk',kind:'damage',damage:24,range:3000,radius:950,maxTargets:1,detail:'A giant mallet lands in a marked circle. Up to 24 damage to one legal opponent; they can dodge.'},
  {id:'sticky-situation',name:'Sticky Situation',kind:'snare',range:3000,radius:1200,maxTargets:2,detail:'Trap up to two legal opponents for 1.3 seconds. They can still attack. Zone escape and knockback still work.'},
  {id:'socknado',name:'Socknado',kind:'push',damage:12,range:1800,radius:1800,windupTicks:14,maxTargets:2,push:320,detail:'A 0.7-second tell, then a shockwave: up to 12 damage and a push to two legal opponents.'},
  {id:'pocket-shed',name:'Pocket Shed',kind:'guard',radius:650,maxTargets:0,detail:'An 18-point shield for 8 seconds. Does not block border, collapse or sudden-death bleed.'},
  {id:'wossum-beam',name:'Wossum Beam',kind:'beam',damage:18,range:3000,radius:500,windupTicks:16,maxTargets:2,detail:'A fixed gold beam with a 0.8-second tell. Up to 18 damage each to two legal opponents. Step out of the line.'},
  {id:'scrapfall',name:'Scrapfall',kind:'damage',damage:10,range:3200,radius:1400,windupTicks:26,maxTargets:3,detail:'A 1.3-second warning, then falling scrap hits a fixed circle. Up to 10 damage each to three legal opponents. Leave the circle to dodge.'},
  {id:'magnet-mayhem',name:'Magnet Mayhem',kind:'pull',damage:8,range:2000,radius:2000,windupTicks:20,maxTargets:2,pull:400,detail:'A 1-second tell, then up to two legal opponents take 8 damage and are pulled toward your marked starting position. Obstacles still block movement.'},
  {id:'lunch-break',name:'Lunch Break',kind:'mend',heal:14,guard:10,guardTicks:120,radius:650,maxTargets:0,detail:'Recover up to 14 HP and gain a 10-point shield for 6 seconds. Does not cleanse snares or block border, collapse or sudden-death bleed.'},
  {id:'bass-drop',name:'Bass Drop',kind:'snare',damage:8,range:1600,radius:1600,windupTicks:18,snareTicks:14,maxTargets:2,anchor:'caster',detail:'A 0.9-second tell, then a bass pulse around your marked starting position: up to 8 damage and a 0.7-second snare to two legal opponents. Re-snare immunity still applies.'},
].map(Object.freeze));
const byId=new Map(ULTIMATES.map(a=>[a.id,a]));
const R=ULTIMATE_RULES, HZ=ULTIMATE_HZ;
const d2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2;
const pt=f=>({x:Math.round(f.x),y:Math.round(f.y)});
const offensive=a=>!['heal','guard','mend'].includes(a.kind);
export function ultimateDefinition(id){const a=byId.get(id);if(!a)throw new RangeError('Unknown ultimate');return a;}
export function validateUltimateChoices(choices=Array(6).fill('auto')){
  if(!Array.isArray(choices)||choices.length!==6||choices.some(x=>x!=='auto'&&!byId.has(x)))throw new TypeError('Choose six known ultimates or auto');
  return [...choices];
}
function shuffled(seed,size=6,salt=0x71a777e){
  let s=(seed^salt)>>>0;const order=Array.from({length:size},(_,i)=>i);
  for(let i=size-1;i>0;i--){s=(Math.imul(s,1664525)+1013904223)>>>0;const j=Math.floor(s/4294967296*(i+1));[order[i],order[j]]=[order[j],order[i]];}
  return order;
}
export function ultimateAssignments(seed,roster,choices){
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new RangeError('Ultimate seed must be uint32');
  if(!Array.isArray(roster)||roster.length!==6||roster.some((r,i)=>r.id!==i))throw new TypeError('Six ordered ultimate seats required');
  // Ability variety and the six charge windows use separate deterministic draws.
  // Every spell is reachable without extending charge time when the catalog grows.
  const picked=validateUltimateChoices(choices),order=shuffled(seed);
  const abilitySeed=Math.imul(seed^0x6d2b79f5,0x85ebca6b)>>>0;
  const abilities=shuffled(abilitySeed,ULTIMATES.length,0xb0a7cafe);
  const support=ULTIMATES.filter(a=>!offensive(a)),supportOrder=shuffled(abilitySeed,support.length,0x5aeed);
  return roster.map((r,id)=>({id,ability:picked[id]==='auto'?
    r.intent?.engagement?.mode==='avoid'?support[supportOrder[id%support.length]].id:ULTIMATES[abilities[id]].id:picked[id],
    readyTick:R.firstReadyTick+order.indexOf(id)*R.readySpacingTicks}));
}
function lineDistanceSquared(p,from,to){
  const dx=to.x-from.x,dy=to.y-from.y,l=dx*dx+dy*dy;
  if(!l)return d2(p,from);
  const fraction=((p.x-from.x)*dx+(p.y-from.y)*dy)/l;
  if(fraction<0||fraction>1)return Infinity;
  return d2(p,{x:from.x+fraction*dx,y:from.y+fraction*dy});
}

/** Compose with, never replace, the current sandbox's navigation and attack rules. */
export function createUltimateRuntime(base={}, {seed,roster,choices}={}){
  const assignments=ultimateAssignments(seed,roster,choices);
  let context=null,lastCast=-R.castSpacingTicks;
  const states=assignments.map(a=>({...a,pending:null,casts:0,impacts:0,heal:0,guarded:0,damageQueued:0,snares:0,dodges:0,fallback:false,misses:0}));
  const warningObservations=new Map(),dodged=new Set();
  const eligible=(f,foe,ctx,observed=ctx.observed)=>foe.id!==f.id&&foe.hp>0&&(!base.allowAttack||base.allowAttack({
    f,foe,tick:ctx.tick,map:ctx.map,
    observed:observed.filter(o=>d2(o,f)<=(base.perceptionRadius??Infinity)**2),
  }));
  const write=(ctx,type,f,target,value)=>ctx.emit(ctx.tick,type,f.id,target,{ability:f.ultimateId,x:f.x,y:f.y,...value});
  function cancel(ctx,f,reason){
    const s=states[f.id];if(!s.pending)return;
    s.pending.zone.until=ctx.tick-1;s.pending=null;f.ultimatePhase='spent';
    write(ctx,'ultimate-cancel',f,null,{reason});
  }
  function guard(ctx,f,s,reason,amount=R.guardPoints,duration=R.guardTicks){
    f.ultimateGuard=amount;f.ultimateGuardUntil=ctx.tick+duration;
    write(ctx,'ultimate-guard',f,f.id,{amount,until:f.ultimateGuardUntil,reason});
  }
  function impact(ctx,f,s,p){
    const a=ultimateDefinition(p.effect),zone=p.zone;
    f.ultimatePhase='spent';s.pending=null;s.impacts++;
    if(a.kind==='guard'){guard(ctx,f,s,p.fallback?'No useful legal target; defensive fallback':'Temporary protection');return;}
    if(a.kind==='heal'){
      const before=f.hp,amount=Math.min(a.heal,100-before);
      f.hp+=amount;f.ultimateSnaredUntil=0;delete f.statuses.slow;s.heal+=amount;
      if(!amount){guard(ctx,f,s,'Already at full health; defensive fallback');s.fallback=true;}
      else write(ctx,'ultimate-heal',f,f.id,{amount,hpBefore:before,hpAfter:f.hp,cleansed:true});
      return;
    }
    if(a.kind==='mend'){
      const before=f.hp,amount=Math.min(a.heal,100-before);
      f.hp+=amount;s.heal+=amount;
      write(ctx,'ultimate-heal',f,f.id,{amount,hpBefore:before,hpAfter:f.hp,cleansed:false});
      guard(ctx,f,s,'Lunch Break protection',a.guard,a.guardTicks);
      return;
    }
    const from={x:zone.fromX,y:zone.fromY},to={x:zone.x,y:zone.y};
    const targets=ctx.fighters.filter(o=>o.id!==f.id&&o.hp>0)
      .filter(o=>a.kind==='beam'?lineDistanceSquared(o,from,to)<=a.radius**2:d2(o,to)<=a.radius**2)
      .sort((a,b)=>d2(a,to)-d2(b,to)||a.initiative-b.initiative)
      .filter(o=>eligible(f,o,ctx,ctx.fighters)).slice(0,a.maxTargets);
    if(!targets.length){s.misses++;write(ctx,'ultimate-miss',f,null,{reason:'The marked area has no legal opponent at impact',at:to});}
    for(const foe of targets){
      if(a.damage){ctx.damage(foe.id,a.damage,f.id,'ultimate:'+a.id);s.damageQueued+=a.damage;}
      if(a.kind==='snare'){
        if(a.damage)write(ctx,'ultimate-hit',f,foe.id,{queuedDamage:a.damage,from:pt(foe),to:pt(foe),actualDamageIn:'damage event after shields and simultaneous resolution'});
        if(foe.ultimateSnareGuardUntil>ctx.tick){write(ctx,'ultimate-resist',f,foe.id,{reason:'Short re-snare immunity',at:pt(foe)});continue;}
        const duration=a.snareTicks??R.snareTicks;
        foe.ultimateSnaredUntil=ctx.tick+duration;foe.ultimateSnareGuardUntil=ctx.tick+R.snareImmunityTicks;s.snares++;
        write(ctx,'ultimate-snare',f,foe.id,{until:foe.ultimateSnaredUntil,seconds:duration/HZ,at:pt(foe)});
      }else{
        const before=pt(foe);
        if(a.kind==='push'){
          const dx=foe.x-zone.x,dy=foe.y-zone.y,norm=Math.max(Math.abs(dx),Math.abs(dy),1);
          ctx.move(foe,{x:foe.x+(dx||1)/norm*a.push,y:foe.y+dy/norm*a.push},ctx.map.props,a.push);
        }
        if(a.kind==='pull'){
          const dx=zone.x-foe.x,dy=zone.y-foe.y,norm=Math.max(Math.abs(dx),Math.abs(dy));
          // The navigation primitive takes a max-axis step and may slide along
          // props. Bound even diagonal pulls to 400 world units and stop at the
          // frozen center instead of overshooting a nearby opponent.
          if(norm){
            let step=Math.min(norm,Math.floor(a.pull*norm/Math.hypot(dx,dy)));
            while(step>0&&Math.round(dx*step/norm)**2+Math.round(dy*step/norm)**2>a.pull**2)step--;
            if(step>0)ctx.move(foe,to,ctx.map.props,step);
          }
        }
        write(ctx,'ultimate-hit',f,foe.id,{queuedDamage:a.damage,from:before,to:pt(foe),actualDamageIn:'damage event after shields and simultaneous resolution'});
      }
    }
  }
  function launch(ctx,f,s,a,target,fallback){
    const effect=fallback?'pocket-shed':a.id,actual=ultimateDefinition(effect);
    const origin=pt(f),casterCentered=['push','pull'].includes(actual.kind)||actual.anchor==='caster';
    let aim=offensive(actual)&&!casterCentered?pt(target):origin;
    if(actual.kind==='beam'){
      const dx=aim.x-origin.x,dy=aim.y-origin.y,length=Math.hypot(dx,dy);
      // A laser has its full declared range, not an invisible cutoff at the
      // nearest target. Coincident targets still get a visible finite beam.
      aim={x:Math.round(Math.max(850,Math.min(9150,origin.x+(length?dx/length:1)*actual.range))),
        y:Math.round(Math.max(850,Math.min(9150,origin.y+(length?dy/length:0)*actual.range)))};
    }
    const zone={id:ctx.zones.length,kind:'ultimate',ability:effect,requestedAbility:a.id,owner:f.id,
      ...aim,fromX:origin.x,fromY:origin.y,radius:actual.radius,start:ctx.tick,impact:ctx.tick+(actual.windupTicks??R.windupTicks),until:ctx.tick+(actual.windupTicks??R.windupTicks)+22};
    ctx.zones.push(zone);s.pending={zone,effect,fallback};s.casts++;s.fallback=fallback;lastCast=ctx.tick;
    f.ultimatePhase='casting';f.ultimateCastTick=ctx.tick;f.ultimateImpactTick=zone.impact;
    f.ultimateOriginX=origin.x;f.ultimateOriginY=origin.y;f.ultimateAimX=aim.x;f.ultimateAimY=aim.y;
    // Ultimates do not consume a picked-up item or silently discard its pending channel.
    // Launch waits for the current action; its own cast has no item channel.
    f.pose='channel';f.until=zone.impact;f.channel=null;
    write(ctx,'ultimate-cast',f,target?.id??f.id,{effect,impact:zone.impact,origin,aim,radius:zone.radius,
      reason:fallback?'No useful legal target; use the temporary shield instead':'A useful legal opportunity',fallback});
  }
  function tick(ctx){
    context=ctx;
    for(const f of ctx.fighters){
      const s=states[f.id];
      if(f.hp<=0){cancel(ctx,f,'K-hole before impact');continue;}
      if(f.ultimateGuard&&f.ultimateGuardUntil<=ctx.tick){f.ultimateGuard=0;write(ctx,'ultimate-expire',f,f.id,{effect:'guard'});}
      if(f.ultimateSnaredUntil&&f.ultimateSnaredUntil<=ctx.tick){f.ultimateSnaredUntil=0;write(ctx,'ultimate-release',f,f.id,{effect:'snare'});}
      if(s.pending){
        if(ctx.tick>=s.pending.zone.impact)impact(ctx,f,s,s.pending);
        else {f.until=Math.max(f.until,s.pending.zone.impact);f.pose='channel';}
        continue;
      }
      if(s.casts)continue;
      f.ultimateCharge=Math.min(100,Math.floor(ctx.tick*100/s.readyTick));
      if(ctx.tick>=s.readyTick&&f.ultimatePhase==='charging'){
        f.ultimatePhase='ready';write(ctx,'ultimate-ready',f,null,{name:ultimateDefinition(s.ability).name});
      }
    }
    const queue=states.filter(s=>!s.casts&&ctx.tick>=s.readyTick).sort((a,b)=>a.readyTick-b.readyTick);
    for(const s of queue){
      const f=ctx.fighters[s.id];
      if(f.hp<=0||ctx.tick-lastCast<R.castSpacingTicks||states.filter(s=>s.pending).length>=R.maxWindups)continue;
      // Never throw away a weapon strike or item channel that has already committed.
      if(f.channel||f.pose==='windup'||['recover','stagger'].includes(f.pose)&&f.until>ctx.tick)continue;
      const a=ultimateDefinition(s.ability),waiting=ctx.tick-s.readyTick>=R.opportunityTicks;
      if(['heal','mend'].includes(a.kind)&&f.hp>80&&!waiting)continue;
      if(a.kind==='guard'&&!waiting&&!ctx.observed.some(o=>o.id!==f.id&&o.hp>0&&d2(o,f)<1800**2)&&!ctx.map.hazards.some(h=>h.tick>ctx.tick&&h.tick-ctx.tick<=24&&d2(f,h)<h.radius**2))continue;
      const seen=ctx.observed.filter(o=>o.id!==f.id&&o.hp>0&&d2(o,f)<=Math.min(a.range??0,base.perceptionRadius??Infinity)**2)
        .sort((a,b)=>d2(a,f)-d2(b,f)||a.initiative-b.initiative);
      const target=offensive(a)?seen.find(o=>eligible(f,o,ctx)):null;
      if(offensive(a)&&!target&&!waiting)continue;
      const fallback=offensive(a)&&!target||a.kind==='heal'&&f.hp===100;
      launch(ctx,f,s,a,target,fallback);
    }
  }
  const runtime={...base,
    onStart(ctx){
      base.onStart?.(ctx);context=ctx;
      for(const f of ctx.fighters){f.ultimateId=states[f.id].ability;f.ultimateCharge=0;f.ultimatePhase='charging';
        f.ultimateReadyTick=states[f.id].readyTick;f.ultimateCastTick=null;f.ultimateImpactTick=null;
        f.ultimateGuard=0;f.ultimateGuardUntil=0;f.ultimateSnaredUntil=0;f.ultimateSnareGuardUntil=0;}
    },
    beforeTick(ctx){base.beforeTick?.(ctx);tick(ctx);},
    warnings(args){
      const {f,tick,zones}=args,result=[...(base.warnings?.(args)??[])];
      for(const z of zones){
        if(z.kind!=='ultimate'||z.owner===f.id||z.until<tick||z.impact<=tick||z.impact-tick>24)continue;
        const a=ultimateDefinition(z.ability);if(!offensive(a))continue;
        if(a.kind==='beam'){
          const dx=z.x-z.fromX,dy=z.y-z.fromY,len=dx*dx+dy*dy;
          const u=len?Math.max(0,Math.min(1,((f.x-z.fromX)*dx+(f.y-z.fromY)*dy)/len)):0;
          let x=z.fromX+u*dx,y=z.fromY+u*dy;
          // The generic avoidance vector points away from a warning center.
          // At the exact centerline, nudge that observation within its visible
          // safety margin so an opponent can actually step off the beam.
          if((f.x-x)**2+(f.y-y)**2<1){const n=Math.hypot(dx,dy)||1;x+=-dy/n*100;y+=dx/n*100;}
          result.push({...z,x,y});
        }else result.push(d2(f,z)<1?{...z,x:z.x-100}:z);
      }
      warningObservations.set(f.id,{position:pt(f),warnings:result});
      return result;
    },
    onAction(entry){
      base.onAction?.(entry);
      if(entry.type!=='evade'||entry.reason!=='Visible floor warning'||!context)return;
      const obs=warningObservations.get(entry.actor),tell=entry.observed?.floorThreat,f=context.fighters[entry.actor];
      if(!obs||!tell||d2(obs.position,f)===0)return;
      const z=obs.warnings.find(z=>z.kind==='ultimate'&&z.x===tell.x&&z.y===tell.y&&z.radius===tell.radius);
      if(!z||dodged.has(`${z.id}:${f.id}`))return;dodged.add(`${z.id}:${f.id}`);states[z.owner].dodges++;
      write(context,'ultimate-dodge',context.fighters[z.owner],f.id,{ability:z.requestedAbility,at:pt(f),reason:'Opponent reacted to the visible ultimate warning and moved'});
    },
    beforeDamage(ctx){
      base.beforeDamage?.(ctx);
      for(let i=0;i<ctx.hits.length;i++){
        const hit=ctx.hits[i],f=ctx.fighters[hit.id];
        if(f.hp<=0||!f.ultimateGuard||f.ultimateGuardUntil<=ctx.tick||['collapse','border','bleed'].includes(hit.cause))continue;
        const amount=Math.min(f.ultimateGuard,hit.amount);f.ultimateGuard-=amount;hit.amount-=amount;states[f.id].guarded+=amount;
        write(ctx,'ultimate-block',f,hit.source,{amount,remaining:f.ultimateGuard});
        if(!hit.amount){ctx.hits.splice(i,1);i--;}
      }
    },
    scaleDamage(amount,cause,tick){return cause.startsWith('ultimate:')?amount:base.scaleDamage?base.scaleDamage(amount,cause,tick):amount;},
    onEvent(event){
      base.onEvent?.(event);
      if(event.type==='khole'&&context){cancel({...context,tick:event.tick},context.fighters[event.actor],'K-hole before impact');}
    },
    // Rooted fighters may still attack. Do not spend stamina and their entire
    // action attempting a dodge that the movement-only snare would suppress.
    allowEvade(args){return !(args.f.ultimateSnaredUntil>args.tick)&&(!base.allowEvade||base.allowEvade(args));},
    move(args){
      const {f,tick,kind}=args,forced=['forced','forced-roll','knockback','safety'].includes(kind);
      if(f.ultimateSnaredUntil>tick&&!forced)return;
      return base.move?base.move(args):args.defaultMove(f,args.target,args.props,args.step);
    },
  };
  const summary=()=>({version:ULTIMATE_VERSION,rules:{...R},assignments:assignments.map(x=>({...x})),
    fighters:states.map(({pending,...s})=>({...s,pending:Boolean(pending)}))});
  return {runtime:{...runtime,ultimateSummary:summary},summary};
}

export function describeUltimateEvent(event){
  if(!event.type.startsWith('ultimate-'))return null;
  const v=event.value??{},name=byId.get(v.ability)?.name??'Ultimate';
  const descriptions={
    'ultimate-ready':`${name} is ready`,
    'ultimate-cast':`${name}: ${v.fallback?'temporary shield fallback':'casting'} (${((v.impact??event.tick)-event.tick)/HZ}s warning)`,
    'ultimate-heal':`${name}: +${v.amount} HP (${v.hpBefore} to ${v.hpAfter})`,
    'ultimate-guard':`${name}: ${v.amount}-point shield, ${((v.until??event.tick+R.guardTicks)-event.tick)/HZ} seconds`,
    'ultimate-hit':`${name}: ${v.queuedDamage} damage queued; actual HP loss is recorded by the damage event`,
    'ultimate-snare':`${name}: snared for ${v.seconds}s`,
    'ultimate-block':`Shield absorbed ${v.amount}; ${v.remaining} left`,
    'ultimate-miss':`${name}: missed, no legal opponent at impact`,
    'ultimate-dodge':`${name}: opponent moved in response to its visible warning`,
    'ultimate-resist':`${name}: resisted by re-snare immunity`,
    'ultimate-cancel':`${name}: cancelled, ${v.reason}`,
    'ultimate-expire':'Ultimate shield expired', 'ultimate-release':'Ultimate snare ended',
  };
  return descriptions[event.type]??name;
}
