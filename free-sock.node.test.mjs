import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const main=readFileSync(new URL('./main.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const start=main.indexOf('async function useFreeSock(){');
const end=main.indexOf('\nfunction renderRooms(',start);
assert.ok(start>=0&&end>start,'The free-sock action must be present and separately testable.');
const source=main.slice(start,end);
const owner='0x'+'a'.repeat(40);
const freeProfile=()=>({id:owner,name:'SOCK AAAA',note:'',avatarId:'sock:free',avatar:{id:'sock:free',affiliate:false,key:0},policyId:null,iq:7,games:4,wins:1});

function fixture({connected=true,profile=freeProfile(),dirty=false,options=['sock:free'],connectError=null,postError=null,refreshError=null,postHook=null,refreshHook=null}={}){
  const events=[],posts=[],statuses=[];
  const wallet={address:connected?owner:null};
  const originalRoom={id:'earlier-room',replay:{frames:[{}]}};
  const state={me:connected?{profile:structuredClone(profile)}:null,profileDirty:dirty,room:originalRoom};
  const elements={
    'fighter-avatar':{value:profile?.avatarId||'',options:options.map(value=>({value}))},
    'fighter-name':{value:'Unsaved nickname'},
    'fighter-note':{value:'  Unsaved note.  '},
    'room-view':{hidden:false},
    lobby:{hidden:true},
  };
  const $=id=>{assert.ok(Object.hasOwn(elements,id),'Unexpected DOM action: '+id);return elements[id];};
  const location={hash:'#socks'};
  let pending=null;
  const connect=async()=>{
    events.push('connect');
    if(connectError)throw connectError;
    wallet.address=owner;state.me={profile:structuredClone(profile)};
  };
  const post=async(path,body)=>{
    assert.equal(path,'/api/fighter','Selecting a sock must never mint, join, prepare inference, or submit a payment.');
    posts.push({path,body:structuredClone(body)});events.push('post');
    if(postHook)await postHook();
    if(postError)throw postError;
    pending=structuredClone(body);events.push('post-confirmed');
    return {profile:{...state.me.profile,...pending}};
  };
  const refreshMe=async()=>{
    events.push('refresh');
    if(refreshHook)await refreshHook();
    if(refreshError)throw refreshError;
    if(pending)state.me.profile={...state.me.profile,...pending,avatar:{id:'sock:free',affiliate:false,key:0}};
    events.push('refresh-confirmed');
  };
  const player={pause(){events.push('pause');}};
  const status=message=>{statuses.push(message);events.push('status');};
  const updateEntry=()=>events.push('update-entry');
  const option=(element,value,label)=>{element.options.push({value,label});events.push('option');};
  const run=new Function('wallet','connect','state','post','refreshMe','player','$','location','status','updateEntry','option','return ('+source+');')(
    wallet,connect,state,post,refreshMe,player,$,location,status,updateEntry,option);
  return {run,state,wallet,events,posts,statuses,elements,location,originalRoom};
}

test('a disconnected newcomer signs in once and gets their default free sock without any gameplay POST',async()=>{
  const f=fixture({connected:false});await f.run();
  assert.equal(f.events.filter(event=>event==='connect').length,1);
  assert.deepEqual(f.posts,[]);
  assert.equal(f.state.me.profile.avatarId,'sock:free');
  assert.equal(f.state.me.profile.note,'');
  assert.equal(f.state.me.profile.policyId,null);
  assert.equal(f.location.hash,'#play');
  assert.match(f.statuses.at(-1),/No mint or Bitcoin wallet needed/);
  assert.match(f.statuses.at(-1),/PIT entry is a separate approval/);
});

test('an NFT holder changes only their avatar and preserves exact saved name, note, policy and record',async()=>{
  const profile={...freeProfile(),name:'  THE COLLECTOR  ',note:'  Coins first.\nKeep my spaces.  ',avatarId:'bitcoin:verified',avatar:{id:'bitcoin:verified',affiliate:true},policyId:'prepared-policy'};
  const f=fixture({profile});await f.run();
  assert.deepEqual(f.posts,[{path:'/api/fighter',body:{name:profile.name,note:profile.note,avatarId:'sock:free'}}]);
  for(const key of ['name','note','policyId','iq','games','wins'])assert.equal(f.state.me.profile[key],profile[key]);
  assert.equal(f.state.me.profile.avatarId,'sock:free');
  assert.equal(f.events.includes('connect'),false);
  assert.deepEqual(f.events.slice(0,5),['post','post-confirmed','refresh','refresh-confirmed','pause']);
});

test('reselecting the current free sock is idempotent and does not save, reload or prepare anything',async()=>{
  const f=fixture();await f.run();await f.run();
  assert.deepEqual(f.posts,[]);
  assert.equal(f.events.includes('refresh'),false);
  assert.equal(f.events.includes('connect'),false);
  assert.equal(f.state.me.profile.avatarId,'sock:free');
  assert.match(f.statuses.at(-1),/PIT entry is a separate approval/);
});

test('an unsaved fighter draft keeps its name and note and asks for an explicit save without any POST',async()=>{
  const profile={...freeProfile(),avatarId:'bitcoin:verified',note:'Saved note',policyId:'prepared-policy'};
  const f=fixture({profile,dirty:true,options:['bitcoin:verified']});
  const draft={name:f.elements['fighter-name'].value,note:f.elements['fighter-note'].value};
  await f.run();
  assert.deepEqual(f.posts,[]);
  assert.equal(f.elements['fighter-name'].value,draft.name);
  assert.equal(f.elements['fighter-note'].value,draft.note);
  assert.equal(f.elements['fighter-avatar'].value,'sock:free');
  assert.equal(f.elements['fighter-avatar'].options.filter(option=>option.value==='sock:free').length,1);
  assert.deepEqual(f.state.me.profile,profile);
  assert.equal(f.state.profileDirty,true);
  assert.equal(f.location.hash,'#fighter');
  assert.match(f.statuses.at(-1),/draft.*name and note are unchanged.*Save your fighter/);
  assert.equal(f.state.room,f.originalRoom);
  assert.equal(f.events.includes('pause'),false);
  await f.run();
  assert.equal(f.elements['fighter-avatar'].options.filter(option=>option.value==='sock:free').length,1);
});

test('a rejected connection leaves the current room and profile untouched with no follow-up action',async()=>{
  const f=fixture({connected:false,connectError:new Error('Connection rejected')});
  await assert.rejects(f.run(),/Connection rejected/);
  assert.deepEqual(f.events,['connect']);assert.deepEqual(f.posts,[]);
  assert.equal(f.state.me,null);assert.equal(f.state.room,f.originalRoom);
  assert.equal(f.location.hash,'#socks');
  assert.equal(f.elements['room-view'].hidden,false);
});

test('a missing loaded profile fails closed instead of manufacturing a wallet or avatar save',async()=>{
  const f=fixture({profile:null});await assert.rejects(f.run(),/fighter could not load.*Reconnect/);
  assert.deepEqual(f.events,[]);assert.deepEqual(f.posts,[]);
  assert.equal(f.state.room,f.originalRoom);assert.equal(f.location.hash,'#socks');
});

test('an existing unprepared note is preserved and gets an explicit warning without calling inference',async()=>{
  const profile={...freeProfile(),avatarId:'bitcoin:verified',note:'Please collect coins.',policyId:null};
  const f=fixture({profile});await f.run();
  assert.equal(f.state.me.profile.note,profile.note);
  assert.equal(f.state.me.profile.policyId,null);
  assert.equal(f.posts.length,1);assert.equal(f.posts[0].path,'/api/fighter');
  assert.match(f.statuses.at(-1),/not prepared yet.*save your fighter again.*leave the note blank/);
});

test('the replay stays open until both the avatar save and refreshed profile are confirmed',async()=>{
  let releasePost,releaseRefresh;
  const postGate=new Promise(resolve=>{releasePost=resolve;});
  const refreshGate=new Promise(resolve=>{releaseRefresh=resolve;});
  const f=fixture({profile:{...freeProfile(),avatarId:'pit-sock:1'},postHook:()=>postGate,refreshHook:()=>refreshGate});
  const task=f.run();
  assert.deepEqual(f.events,['post']);assert.equal(f.state.room,f.originalRoom);
  assert.equal(f.elements['room-view'].hidden,false);assert.equal(f.elements.lobby.hidden,true);
  releasePost();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.events,['post','post-confirmed','refresh']);
  assert.equal(f.state.room,f.originalRoom);assert.equal(f.location.hash,'#socks');
  releaseRefresh();await task;
  assert.equal(f.state.me.profile.avatarId,'sock:free');
  assert.equal(f.events.filter(event=>event==='pause').length,1);
  assert.ok(f.events.indexOf('pause')>f.events.indexOf('refresh-confirmed'));
  assert.equal(f.state.room,null);assert.equal(f.elements['room-view'].hidden,true);
  assert.equal(f.elements.lobby.hidden,false);assert.equal(f.location.hash,'#play');
});

test('a failed avatar save does not leave the current room or report success',async()=>{
  const f=fixture({profile:{...freeProfile(),avatarId:'pit-sock:1'},postError:new Error('Save unavailable')});
  await assert.rejects(f.run(),/Save unavailable/);
  assert.deepEqual(f.events,['post']);assert.deepEqual(f.statuses,[]);
  assert.equal(f.state.room,f.originalRoom);assert.equal(f.location.hash,'#socks');
});

test('an uncertain profile reload cannot close the replay or falsely announce a completed switch',async()=>{
  const f=fixture({profile:{...freeProfile(),avatarId:'pit-sock:1'},refreshError:new Error('Reload unavailable')});
  await assert.rejects(f.run(),/Reload unavailable/);
  assert.deepEqual(f.events,['post','post-confirmed','refresh']);assert.deepEqual(f.statuses,[]);
  assert.equal(f.state.room,f.originalRoom);assert.equal(f.location.hash,'#socks');
});

test('Play, My fighter and mint each expose a real free-sock action with no free-entry claim',()=>{
  for(const view of ['play','fighter','socks']){
    const sectionStart=html.indexOf('<section data-view="'+view+'"');
    assert.ok(sectionStart>=0,'Missing '+view+' view');
    const next=html.indexOf('<section data-view="',sectionStart+1);
    const section=html.slice(sectionStart,next<0?undefined:next);
    assert.match(section,/<button\b[^>]*\bdata-free-sock\b[^>]*>[^<]*FREE SOCK/,'No free-sock button in '+view);
  }
  assert.match(html,/The avatar is free, not an NFT\. Arena entry still costs PIT plus network fees/);
  assert.doesNotMatch(html,/free arena entry|play for free|enter for free|free entry/i);
  assert.match(main,/querySelectorAll\('\[data-free-sock\]'\).*action\(useFreeSock\)/);
  assert.match(main,/button\.disabled=state\.busy\|\|!state\.config/);
  assert.doesNotMatch(source,/confirmQuote|enterRoom|\.transact\(|\/compile|\/socks\/quote|\/api\/rooms|data-bitcoin-wallet/);
});
