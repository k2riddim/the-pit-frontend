import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fighterDraft,fighterChanges,createProfileRequestGate,entryReadiness} from './fighter-state.mjs';
import {ultimateChoiceOptions,ultimateChoicePresentation} from './fighter-view.mjs';
import {ULTIMATES} from '../arena/ultimate-system.mjs';

const main=readFileSync(new URL('./main.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
function sourceBetween(start,end){
  const from=main.indexOf(start),to=main.indexOf(end,from);
  assert.ok(from>=0&&to>from,'Missing separately testable frontend function: '+start);
  return main.slice(from,to);
}
const draftSource=sourceBetween('function readFighterDraft(){','function transactionStatus(');
const saveSource=sourceBetween('async function saveFighter(','async function connect(');
const refreshSource=sourceBetween('async function refreshMe(){','async function saveFighter(');
const entrySource=sourceBetween('async function enterRoom(id){','async function loadSocks(');
const quoteSource=sourceBetween('function quoteDetails(quote,title){','async function confirmQuote(');
const owner='0x'+'a'.repeat(40);
const profile=()=>({id:owner,name:'LITTLE BONKER',note:'Hold the top-right corner.',avatarId:'sock:free',
  ultimateChoice:'auto',policyId:'current-prepared-plan',readback:'Hold the corner.',avatar:{id:'sock:free',affiliate:false},iq:7,games:4});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function fixture({saved=profile(),postGate=null,postError=null,valid=true}={}){
  const state={me:{address:owner,profile:structuredClone(saved),fighters:[structuredClone(saved)]},busy:false,
    profileDirty:false,profileSaveUncertain:false,profileDraftRevision:0,preparation:{status:'ready',jobId:'kept-job'},preparationChecks:3};
  const wallet={address:owner},profileRequests=createProfileRequestGate(),posts=[],messages=[];
  const ids=['fighter-name','fighter-note','fighter-avatar','fighter-ultimate','play-ultimate','play-ultimate-detail',
    'fighter-ultimate-detail','save-ultimate','review-fighter-draft','play-ultimate-state','brain-receipt'];
  const elements=Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',hidden:false,disabled:false}]));
  elements['fighter-form']={reportValidity:()=>valid};
  const $=id=>{assert.ok(elements[id],'Unexpected DOM lookup: '+id);return elements[id];};
  function writeForm(p){for(const [key,id] of [['name','fighter-name'],['note','fighter-note'],['avatarId','fighter-avatar'],['ultimateChoice','fighter-ultimate']])$(id).value=p[key]|| (key==='ultimateChoice'?'auto':'');}
  writeForm(saved);
  let renderChoices;
  const updateEntry=()=>renderChoices?.();
  const renderMe=()=>{if(!state.profileDirty)writeForm(state.me.profile);updateEntry();};
  const chosenFighter=()=>state.me?.profile;
  const status=message=>messages.push(message);
  const post=async(path,body)=>{
    posts.push({path,body:structuredClone(body)});
    assert.equal(path,'/api/fighter','Saving a spell must not enter, mint or invoke inference.');
    if(postGate)await postGate.promise;
    if(postError)throw postError;
    const result={...structuredClone(saved),...body};
    if(result.note!==saved.note)result.policyId=null;
    return {profile:result};
  };
  const operations=new Function('$','state','wallet','chosenFighter','ultimateChoicePresentation','fighterDraft','fighterChanges','profileRequests','post','renderMe','updateEntry','status',
    draftSource+saveSource+'; return {readFighterDraft,renderUltimateChoices,editFighterDraft,selectUltimate,saveFighter};')(
      $,state,wallet,chosenFighter,ultimateChoicePresentation,fighterDraft,fighterChanges,profileRequests,post,renderMe,updateEntry,status);
  renderChoices=operations.renderUltimateChoices;
  operations.renderUltimateChoices();
  return {...operations,state,wallet,profileRequests,posts,messages,elements,$,renderMe};
}

test('the chooser offers Surprise me and every canonical spell with canonical effect descriptions',()=>{
  assert.deepEqual(ultimateChoiceOptions.map(c=>c.id),['auto',...ULTIMATES.map(c=>c.id)]);
  for(const spell of ULTIMATES)assert.deepEqual(ultimateChoicePresentation(spell.id),{name:spell.name,detail:spell.detail});
  assert.match(ultimateChoicePresentation().detail,/no-combat plan.*healing or shield/);
  assert.throws(()=>ultimateChoicePresentation('invented-spell'),/Unknown ultimate/);
});

test('legacy missing choice means auto; choice-only and hidden fighter edits are distinguished',()=>{
  const saved=profile();delete saved.ultimateChoice;
  assert.equal(fighterDraft(saved).ultimateChoice,'auto');
  assert.deepEqual(fighterChanges(saved,{...saved,ultimateChoice:'auto'}),{dirty:false,other:false,ultimate:false});
  assert.deepEqual(fighterChanges(saved,{...saved,ultimateChoice:'peace-patch'}),{dirty:true,other:false,ultimate:true});
  for(const field of ['name','note','avatarId'])assert.equal(fighterChanges(saved,{...saved,[field]:'New value',ultimateChoice:'big-bonk'}).other,true);
});

test('both selectors synchronize a draft without saving or joining, and revert cleanly',()=>{
  const f=fixture();
  f.$('play-ultimate').value='big-bonk';f.selectUltimate('play-ultimate');
  assert.equal(f.$('fighter-ultimate').value,'big-bonk');
  assert.equal(f.state.me.profile.ultimateChoice,'auto');assert.equal(f.state.profileDirty,true);
  assert.equal(f.$('save-ultimate').hidden,false);assert.equal(f.$('review-fighter-draft').hidden,true);
  assert.match(f.$('play-ultimate-state').textContent,/Unsaved choice/);assert.deepEqual(f.posts,[]);
  assert.equal(entryReadiness({address:owner,profile:f.state.me.profile,config:{contracts:{arena:'connected'}},dirty:f.state.profileDirty}).ready,false);
  f.$('fighter-ultimate').value='auto';f.selectUltimate('fighter-ultimate');
  assert.equal(f.$('play-ultimate').value,'auto');assert.equal(f.state.profileDirty,false);assert.equal(f.$('save-ultimate').hidden,true);
});

test('every catalog choice saves for free and affiliated avatars while preserving the prepared note',async()=>{
  for(const affiliate of [false,true])for(const ultimate of ULTIMATES){
    const saved={...profile(),avatarId:affiliate?'bitcoin:verified':'sock:free',avatar:{id:affiliate?'bitcoin:verified':'sock:free',affiliate}};
    const f=fixture({saved});f.$('play-ultimate').value=ultimate.id;f.selectUltimate('play-ultimate');
    const preparation=structuredClone(f.state.preparation);
    assert.equal(await f.saveFighter({choiceOnly:true}),true);
    assert.deepEqual(f.posts,[{path:'/api/fighter',body:{name:saved.name,note:saved.note,avatarId:saved.avatarId,ultimateChoice:ultimate.id}}]);
    for(const key of ['name','note','avatarId','policyId','readback','iq','games'])assert.deepEqual(f.state.me.profile[key],saved[key]);
    assert.deepEqual(f.state.preparation,preparation);assert.equal(f.state.preparationChecks,3);
    assert.equal(f.state.me.fighters[0].ultimateChoice,ultimate.id);assert.equal(f.$('fighter-ultimate').value,ultimate.id);
    assert.equal(f.state.profileDirty,false);assert.match(f.messages.at(-1),/No inference was requested/);
  }
});

test('Play cannot silently save an unsaved name, note or avatar',async()=>{
  for(const id of ['fighter-name','fighter-note','fighter-avatar']){
    const f=fixture();f.$(id).value='My unsaved change';f.editFighterDraft();
    f.$('play-ultimate').value='socknado';f.selectUltimate('play-ultimate');
    assert.equal(f.$('save-ultimate').hidden,true);assert.equal(f.$('review-fighter-draft').hidden,false);
    await assert.rejects(f.saveFighter({choiceOnly:true}),/Review your unsaved name, note or face/);
    assert.equal(f.$(id).value,'My unsaved change');assert.equal(f.$('fighter-ultimate').value,'socknado');assert.deepEqual(f.posts,[]);
  }
});

test('the explicit full fighter save includes choice and resets preparation only if its note changes',async()=>{
  const f=fixture();f.$('fighter-name').value='NEW NAME';f.$('fighter-note').value='A new plan';
  f.$('fighter-avatar').value='bitcoin:verified';f.$('fighter-ultimate').value='wossum-beam';f.editFighterDraft();
  await f.saveFighter();
  assert.deepEqual(f.posts[0].body,{name:'NEW NAME',note:'A new plan',avatarId:'bitcoin:verified',ultimateChoice:'wossum-beam'});
  assert.equal(f.state.preparation,null);assert.equal(f.state.preparationChecks,0);assert.equal(f.$('brain-receipt').hidden,true);
  assert.equal(f.state.profileDirty,false);assert.match(f.messages.at(-1),/Ask the brain/);
});

test('a delayed save confirms its own choice but preserves newer name, note, face and spell edits',async()=>{
  const gate=deferred(),f=fixture({postGate:gate});
  f.$('play-ultimate').value='big-bonk';f.selectUltimate('play-ultimate');
  const pending=f.saveFighter({choiceOnly:true});
  f.$('fighter-name').value='NEWER NAME';f.$('fighter-note').value='Newer plan';f.$('fighter-avatar').value='bitcoin:later';
  f.$('fighter-ultimate').value='pocket-shed';f.selectUltimate('fighter-ultimate');
  gate.resolve();await pending;
  assert.equal(f.state.me.profile.ultimateChoice,'big-bonk');assert.equal(f.state.me.profile.note,profile().note);
  assert.deepEqual(f.readFighterDraft(),{name:'NEWER NAME',note:'Newer plan',avatarId:'bitcoin:later',ultimateChoice:'pocket-shed'});
  assert.equal(f.$('play-ultimate').value,'pocket-shed');assert.equal(f.state.profileDirty,true);
  assert.match(f.messages.at(-1),/newer edits still need saving/);
});

test('a wallet switch discards a late save response, including returning to the same address',async()=>{
  const gate=deferred(),f=fixture({postGate:gate});
  f.$('play-ultimate').value='peace-patch';f.selectUltimate('play-ultimate');
  const pending=f.saveFighter({choiceOnly:true});
  f.profileRequests.sessionChanged();f.wallet.address=null;
  f.profileRequests.sessionChanged();f.wallet.address=owner;
  f.state.me.profile={...profile(),name:'NEW SESSION'};f.state.profileDirty=false;
  gate.resolve();assert.equal(await pending,false);
  assert.equal(f.state.me.profile.name,'NEW SESSION');assert.deepEqual(f.messages,[]);
});

test('an uncertain save keeps the draft and blocks entry even when the user reverts to an old value',async()=>{
  const f=fixture({postError:new Error('Connection lost')});
  f.$('play-ultimate').value='sticky-situation';f.selectUltimate('play-ultimate');
  await assert.rejects(f.saveFighter({choiceOnly:true}),/Connection lost/);
  assert.equal(f.state.profileDirty,true);assert.equal(f.state.profileSaveUncertain,true);
  assert.equal(f.$('fighter-ultimate').value,'sticky-situation');assert.equal(f.state.me.profile.ultimateChoice,'auto');
  f.$('fighter-ultimate').value='auto';f.selectUltimate('fighter-ultimate');
  assert.equal(f.state.profileDirty,true);assert.equal(f.$('review-fighter-draft').hidden,false);
  assert.deepEqual(f.messages,[]);
});

test('missing wallet and invalid form cannot initiate a save',async()=>{
  const f=fixture({valid:false});f.$('fighter-ultimate').value='big-bonk';f.editFighterDraft();
  assert.equal(await f.saveFighter(),false);assert.deepEqual(f.posts,[]);
  f.wallet.address=null;await assert.rejects(f.saveFighter(),/Connect and load/);assert.deepEqual(f.posts,[]);
});

test('profile request gate rejects old reads, reads across a save, and previous wallet sessions',()=>{
  const gate=createProfileRequestGate(),first=gate.beginRead(owner),second=gate.beginRead(owner);
  assert.equal(gate.acceptRead(first,owner),false);assert.equal(gate.acceptRead(second,owner),true);
  const save=gate.beginSave(owner);assert.equal(gate.acceptRead(second,owner),false);
  const during=gate.beginRead(owner);gate.invalidateReads();assert.equal(gate.acceptRead(during,owner),false);
  assert.equal(gate.sameSession(save,owner),true);gate.sessionChanged();assert.equal(gate.sameSession(save,owner),false);
  assert.equal(gate.acceptRead(gate.beginRead(owner),null),false);
});

test('late /api/me responses do not overwrite a saved profile or disconnect a different wallet',async()=>{
  const f=fixture(),pending=deferred();let renders=0,disconnected=false;
  f.wallet.disconnect=()=>{disconnected=true;};
  const refresh=new Function('wallet','profileRequests','api','state','renderMe','showPreparation','fighterChanges','readFighterDraft',
    refreshSource+';return refreshMe;')(f.wallet,f.profileRequests,()=>pending.promise,f.state,()=>renders++,()=>{},fighterChanges,f.readFighterDraft);
  const task=refresh();f.profileRequests.beginSave(owner);
  f.state.me.profile.ultimateChoice='wossum-beam';
  pending.resolve({address:'0x'+'b'.repeat(40),profile:profile()});
  assert.equal(await task,false);assert.equal(f.state.me.profile.ultimateChoice,'wossum-beam');assert.equal(renders,0);assert.equal(disconnected,false);
});

test('entry checks the fighter snapshot both after loading a quote and before its wallet approval',async()=>{
  for(const changedAt of ['none','loading','dialog','wallet']){
    const f=fixture(),events=[];f.state.config={contracts:{arena:'connected'}};
    const chosenFighter=()=>f.state.me.profile;
    const change=()=>{f.$('fighter-ultimate').value='big-bonk';f.editFighterDraft();};
    const post=async()=>{events.push('quote-request');if(changedAt==='loading')change();return {roomId:'42',ultimateChoice:'auto',transaction:{to:'arena'}};};
    const confirmQuote=async(quote,title,options)=>{
      events.push('quote-dialog');assert.equal(quote.ultimateChoice,'auto');
      if(changedAt==='dialog')change();
      if(changedAt==='wallet'){f.profileRequests.sessionChanged();f.wallet.address=null;}
      options.beforePayment();events.push('wallet-approval');return true;
    };
    const openRoom=async()=>events.push('room-open');
    const run=new Function('entryReadiness','wallet','state','chosenFighter','profileRequests','fighterDraft','post','document','confirmQuote','openRoom','renderRoom','status',
      entrySource+';return enterRoom;')(entryReadiness,f.wallet,f.state,chosenFighter,f.profileRequests,fighterDraft,post,
        {querySelector:()=>({value:'2'})},confirmQuote,openRoom,()=>{},()=>{});
    if(changedAt==='none'){await run();assert.deepEqual(events,['quote-request','quote-dialog','wallet-approval','room-open']);}
    else {await assert.rejects(run(),/fighter or wallet changed.*No entry was approved/);assert.equal(events.includes('wallet-approval'),false);assert.equal(events.includes('room-open'),false);}
  }
});

test('payment dialog presents the returned frozen spell rather than an edited local draft',()=>{
  const makeNode=(tag,content)=>({tag,textContent:content||'',children:[],append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];}});
  const elements={'quote-title':makeNode('h2'),'quote-detail':makeNode('div')};
  Object.defineProperty(elements['quote-detail'],'childNodes',{get(){return this.children;}});
  const show=new Function('$','node','state','ultimateChoicePresentation','exactPit','units',quoteSource+';return quoteDetails;')(
    id=>elements[id],makeNode,{config:null,me:{profile:{ultimateChoice:'wossum-beam'}}},ultimateChoicePresentation,String,String);
  show({ultimateChoice:'peace-patch'},'Your place in the pit');
  const allText=node=>[node.textContent,...node.children.flatMap(allText)].join(' ');
  const text=allText(elements['quote-detail']);
  assert.match(text,/Peace Patch/);assert.match(text,/locked for this entry/);assert.doesNotMatch(text,/Wossum Beam/);
});

test('Play and My fighter expose accessible compact selectors and explicit save wiring',()=>{
  for(const prefix of ['play','fighter']){
    assert.match(html,new RegExp('<label for="'+prefix+'-ultimate">'));
    assert.match(html,new RegExp('id="'+prefix+'-ultimate" aria-describedby="'+prefix+'-ultimate-detail '+prefix+'-ultimate-help"'));
    assert.match(main,new RegExp("\\$\\('"+prefix+"-ultimate'\\)\\.addEventListener\\('change',\\(\\)=>selectUltimate\\('"+prefix+"-ultimate'\\)\\)"));
  }
  assert.match(html,/Every spell is free for every avatar/);assert.match(html,/casts automatically, at most once per match/);
  assert.match(main,/save-ultimate.*action\(\(\)=>saveFighter\(\{choiceOnly:true\}\)\)/);
  assert.doesNotMatch(saveSource,/\/compile|enterRoom|confirmQuote|transact|\/api\/rooms/);
  assert.match(main,/profile\?\.ultimateChoice\|\|'auto'/);
});
