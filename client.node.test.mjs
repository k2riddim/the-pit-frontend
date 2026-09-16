import test from 'node:test';
import assert from 'node:assert/strict';
import {units,decimalWei,api,safeImage} from './api.mjs';
import {createWallet} from './wallet.mjs';
import {parseInscriptionList,importCollection} from './collection-import.mjs';
import {mintProgress} from './mint-state.mjs';
import {fighterPresentation} from './fighter-view.mjs';
import {entryReadiness,preparationState} from './fighter-state.mjs';
import {hasPendingJackpot} from './room-state.mjs';
import {launchActions} from './launch-state.mjs';
import {AVATAR_PLACEHOLDER,PICTURE_UNAVAILABLE,avatarImageSource,loadAvatarImage,setAvatarImage} from './avatar-image.mjs';

test('a sock label cannot replace the followed fighter name or note',()=>{
  const shown=fighterPresentation({name:'TEST SOCK',note:'Take the coins.',avatar:{name:'Your sock',key:123,id:'sock:free'}},0,'red');
  assert.equal(shown.name,'TEST SOCK');assert.equal(shown.note,'Take the coins.');assert.equal(shown.key,123);assert.equal(shown.id,0);
});

test('entry needs saved changes and either a blank note or a prepared note',()=>{
  const input={address:'connected',profile:{note:'',policyId:null},config:{contracts:{arena:'deployed'},features:{arena:true}}};
  assert.equal(entryReadiness(input).ready,true);
  assert.equal(entryReadiness({...input,dirty:true}).ready,false);
  assert.equal(entryReadiness({...input,busy:true}).ready,false);
  assert.equal(entryReadiness({...input,address:null}).ready,false);
  assert.equal(entryReadiness({...input,profile:null}).ready,false);
  assert.equal(entryReadiness({...input,config:{contracts:{arena:'deployed'},features:{arena:false}}}).ready,false);
  assert.match(entryReadiness({...input,profile:{note:'Get coins.',policyId:null}}).message,/Prepare your saved note/);
  assert.match(entryReadiness({...input,profile:{note:'Get coins.',policyId:null},preparation:{status:'queued'}}).message,/being prepared/);
  assert.equal(entryReadiness({...input,profile:{note:'Get coins.',policyId:'committed'}}).ready,true);
});

test('queued brain answers keep one recoverable job and never masquerade as usable answers',()=>{
  for(const status of ['queued','running'])assert.deepEqual(preparationState({pending:true,jobId:'job_123',status}),{
    jobId:'job_123',status,message:'Your note is waiting for the test brain. No PIT has been charged.'});
  assert.equal(preparationState({status:'failed',jobId:'job_123',message:'Retry explicitly.'}).status,'failed');
  assert.equal(preparationState({status:'superseded',jobId:'job_123'}).status,'failed');
  assert.equal(preparationState({receipt:{chargedWei:'0'},cached:true}).status,'ready');
  assert.match(preparationState({receipt:{chargedWei:'0'},cached:true}).message,/reuse/);
  assert.equal(preparationState({}),null);
  assert.throws(()=>preparationState({pending:true}),/recovery reference/);
  assert.throws(()=>preparationState({pending:true,jobId:'../other-job'}),/recovery reference/);
});

test('a pending jackpot on any payout keeps the full result pending',()=>{
  assert.equal(hasPendingJackpot({jackpotPending:true}),true);
  assert.equal(hasPendingJackpot({payouts:[{id:0,jackpotPending:true},{id:1,jackpotPending:false}]}),true);
  assert.equal(hasPendingJackpot({payouts:{0:{jackpotPending:true}}}),true);
  assert.equal(hasPendingJackpot({payouts:[{jackpotPending:false}]}),false);
  assert.equal(hasPendingJackpot({}),false);
});

test('launch actions follow explicit lifecycle capabilities and cannot refund successful purchases',()=>{
  const ready={connected:true,configured:true};
  const all={canBuy:true,canCollect:true,canRefund:true,canWithdrawExcess:true,canGraduate:true};
  assert.deepEqual(launchActions({...all,status:'active'},ready),{buy:true,collect:false,refund:true,excess:true,graduate:true});
  assert.deepEqual(launchActions({...all,status:'graduated'},ready),{buy:false,collect:true,refund:false,excess:true,graduate:false});
  assert.deepEqual(launchActions({...all,status:'failed'},ready),{buy:false,collect:false,refund:true,excess:true,graduate:false});
  assert.equal(launchActions({status:'active'},ready).buy,false);
  assert.equal(launchActions({...all,status:'pending'},ready).buy,false);
  for(const options of [{...ready,busy:true},{...ready,connected:false},{...ready,configured:false}])assert.ok(Object.values(launchActions({...all,status:'active'},options)).every(value=>value===false));
});

const owner='0x'+'a'.repeat(40),pit='0x'+'b'.repeat(40),arena='0x'+'c'.repeat(40),outsider='0x'+'d'.repeat(40);
const hash='0x'+'1'.repeat(64);
const config={chain:{id:46630,name:'Game testnet'},contracts:{pit,arena}};

function fixture({failed=false}={}){
  const calls=[],posts=[];
  const provider={
    on(){},removeListener(){},
    async request(request){
      calls.push(request);
      if(request.method==='eth_requestAccounts'||request.method==='eth_accounts')return [owner];
      if(request.method==='eth_chainId')return '0xb626';
      if(request.method==='personal_sign')return '0x'+'2'.repeat(130);
      if(request.method==='eth_sendTransaction')return hash;
      if(request.method==='eth_getTransactionReceipt')return {status:failed?'0x0':'0x1',transactionHash:hash};
      throw new Error('Unexpected method '+request.method);
    },
  };
  globalThis.window=Object.assign(new EventTarget(),{ethereum:provider});
  globalThis.location={origin:'https://pit.example'};
  globalThis.fetch=async(path,options)=>{
    const body=options.body?JSON.parse(options.body):{};posts.push({path,body});
    return {ok:true,status:200,async json(){return path.endsWith('/challenge')?{message:'Sign in to The Pit '+owner,nonce:'once'}:{ok:true};}};
  };
  return {wallet:createWallet(()=>config),calls,posts};
}

test('money conversion is integer-only, bounded and does not round through Number',()=>{
  assert.equal(decimalWei('0.100000000000000001'),'100000000000000001');
  assert.equal(decimalWei('777000000'),'777000000000000000000000000');
  assert.equal(units('777000000000000000000000000'),'777,000,000');
  assert.equal(units('1234567890123456789',18,18),'1.234567890123456789');
  assert.equal(units(undefined),'Unavailable');
  for(const value of ['0','-1','1e18','1.0000000000000000001','NaN','0x10'])assert.throws(()=>decimalWei(value));
});

test('API refuses arbitrary remote endpoints and image URLs',async()=>{
  fixture();await assert.rejects(api('https://other.example/api/me'),/must use this site/);
  assert.equal(safeImage('/assets/yard.png'),'https://pit.example/assets/yard.png');
  assert.equal(safeImage('https://tracker.example/picture.png'),'');
  assert.equal(safeImage('javascript:alert(1)'),'');
  assert.equal(safeImage('data:image/svg+xml,<svg/>'),'');
});

test('NFT previews reject document and remote sources without substituting an unrelated sock',()=>{
  fixture();
  for(const source of ['https://other.example/art.png','javascript:alert(1)','data:text/html,<script>','data:image/svg+xml,<svg/>','blob:https://other.example/test','blob:https://pit.example/test',''])assert.equal(avatarImageSource(source),AVATAR_PLACEHOLDER);
  assert.equal(avatarImageSource('/api/ownership/content/test'),'https://pit.example/api/ownership/content/test');
  assert.equal(avatarImageSource('blob:https://pit.example/generated-sock',true),'blob:https://pit.example/generated-sock');
});

test('one unsupported NFT preview falls back without rejecting the arena image batch or changing identity',async()=>{
  fixture();const calls=[],fighter={name:'LASO HOLDER',note:'Hide in the shed.',avatar:{id:'bitcoin:verified',name:'Lasogette #42',affiliate:true,collectionId:'lasogettes',image:'/api/ownership/content/recursive-test'}};
  const identity=structuredClone(fighter);
  const loaded=await loadAvatarImage(fighter.avatar.image,async source=>{calls.push(source);if(source!==AVATAR_PLACEHOLDER)throw new Error('415 unsupported recursive HTML');return {kind:'neutral-sticker'};});
  assert.deepEqual(loaded,{image:{kind:'neutral-sticker'},source:AVATAR_PLACEHOLDER,unavailable:true});
  assert.deepEqual(calls,['https://pit.example/api/ownership/content/recursive-test',AVATAR_PLACEHOLDER]);
  assert.deepEqual(fighter,identity);assert.equal(fighterPresentation(fighter,3,'yellow').name,'LASO HOLDER');
  const again=[];await loadAvatarImage(fighter.avatar.image,async source=>{again.push(source);return {};});assert.deepEqual(again,[AVATAR_PLACEHOLDER]);
});

test('visible fallback labels and alt text survive repeated renders without image error loops',()=>{
  fixture();const assignments=[],image={hidden:false,onerror:null,onload:null,alt:'',title:'',set src(value){assignments.push(value);},get src(){return assignments.at(-1);}},caption={hidden:true,textContent:''};
  const source='/api/ownership/content/dom-failure-test';
  setAvatarImage(image,source,{label:'LASO HOLDER',caption});assert.equal(caption.hidden,true);
  const obsoleteError=image.onerror;image.onerror();
  assert.equal(image.src,AVATAR_PLACEHOLDER);assert.equal(caption.hidden,false);assert.equal(caption.textContent,PICTURE_UNAVAILABLE);assert.equal(image.alt,'LASO HOLDER · Picture unavailable');
  setAvatarImage(image,source,{label:'SAME FIGHTER',caption});assert.equal(assignments.length,2);assert.match(image.alt,/SAME FIGHTER/);
  image.onerror();assert.equal(image.hidden,true);assert.equal(assignments.length,2);assert.equal(caption.hidden,false);
  setAvatarImage(image,'/assets/puppet-1306.png',{label:'NEXT FIGHTER',caption});assert.equal(image.hidden,false);assert.equal(caption.hidden,true);assert.equal(image.alt,'NEXT FIGHTER');
  obsoleteError();assert.equal(image.alt,'NEXT FIGHTER');assert.equal(caption.hidden,true);
});

test('the neutral placeholder is code-owned SVG with no active or remote content',async()=>{
  const {readFile}=await import('node:fs/promises'),svg=await readFile(new URL('./avatar-unavailable.svg',import.meta.url),'utf8');
  assert.match(svg,/Neutral placeholder, not the NFT artwork/);
  assert.doesNotMatch(svg,/<(?:script|foreignObject|image|use|iframe|object)\b|\b(?:href|onload|onerror)=/i);
});

test('only note preparation has a timeout longer than the bounded inference call',async()=>{
  fixture();
  const originalTimer=globalThis.setTimeout,originalClear=globalThis.clearTimeout,delays=[];
  try{
    globalThis.setTimeout=(_callback,delay)=>{delays.push(delay);return 1;};globalThis.clearTimeout=()=>{};
    await api('/api/fighter/compile',{method:'POST',body:{note:'Take the coins.',modelId:'kimi'}});
    await api('/api/rooms');
    assert.deepEqual(delays,[55000,30000]);
  }finally{globalThis.setTimeout=originalTimer;globalThis.clearTimeout=originalClear;}
});

test('wallet authenticates with a message before any transaction',async()=>{
  const {wallet,calls,posts}=fixture();assert.equal(await wallet.connect(),owner);
  assert.equal(calls.filter(c=>c.method==='eth_sendTransaction').length,0);
  assert.equal(posts.at(-1).path,'/api/auth/verify');
  assert.equal(posts.at(-1).body.address,owner);
  assert.equal(wallet.address,owner);
});

test('approval is confirmed before entry and only final payment is indexed',async()=>{
  const {wallet,calls,posts}=fixture();await wallet.connect();
  await wallet.transact({quoteId:'q1',roomId:'room1',approval:{to:pit,data:'0x1234',value:'0'},transaction:{to:arena,data:'0x5678',value:'0',chainId:46630}});
  const txs=calls.filter(c=>c.method==='eth_sendTransaction');assert.equal(txs.length,2);
  assert.equal(txs[0].params[0].to,pit);assert.equal(txs[1].params[0].to,arena);
  const timeline=calls.map(c=>c.method);const first=timeline.indexOf('eth_sendTransaction');
  assert.equal(timeline[first+1],'eth_getTransactionReceipt');assert.equal(timeline[first+2],'eth_sendTransaction');
  const receipts=posts.filter(p=>p.path==='/api/transactions');assert.equal(receipts.length,1);
  assert.equal(receipts[0].body.quoteId,'q1');assert.equal(receipts[0].body.hash,hash);
});

test('reverted approval prevents entry and never posts a paid result',async()=>{
  const {wallet,calls,posts}=fixture({failed:true});await wallet.connect();
  await assert.rejects(wallet.transact({approval:{to:pit,data:'0x1234'},transaction:{to:arena,data:'0x5678'}}),/did not complete/);
  assert.equal(calls.filter(c=>c.method==='eth_sendTransaction').length,1);
  assert.equal(posts.filter(p=>p.path==='/api/transactions').length,0);
});

test('two withdrawals are labelled as actions, never as an allowance',async()=>{
  const {wallet}=fixture();await wallet.connect();const states=[];
  await wallet.transact({transactions:[{to:arena,data:'0x1234'},{to:arena,data:'0x5678'}]},state=>states.push(state));
  assert.deepEqual(states.filter(state=>state.phase==='wallet').map(state=>state.message),['Confirm action 1 of 2 in your wallet.','Confirm action 2 of 2 in your wallet.']);
});

test('mint delivery and refund messages distinguish pending, delivered and refunded purchases',()=>{
  const pending=mintProgress({pending:1,requests:[{id:'1',status:'ready'}]});
  assert.match(pending.message,/No second payment/);assert.match(pending.requests[0].label,/delivery in progress/);
  const delivered=mintProgress({requests:[{id:'1',status:'fulfilled',tokenId:'12'}]});
  assert.equal(delivered.requests[0].label,'SOCK #12 delivered');assert.equal(delivered.refund,0n);
  const refunded=mintProgress({refundWei:'123456789123456789',requests:[{id:'2',status:'refunded'}]});
  assert.equal(refunded.refund,123456789123456789n);assert.match(refunded.message,/available to recover/);
  assert.match(refunded.requests[0].label,/refund credited/);
});

test('unconfigured destinations and wrong-chain quotes cannot request wallet payment',async()=>{
  const {wallet,calls}=fixture();await wallet.connect();
  await assert.rejects(wallet.transact({transaction:{to:outsider,data:'0x1234'}}),/configured game contract/);
  await assert.rejects(wallet.transact({transaction:{to:arena,data:'0x1234',chainId:1}}),/different network/);
  await assert.rejects(wallet.transact({transaction:{to:arena,data:'0x1'}}),/unreadable/);
  assert.equal(calls.filter(c=>c.method==='eth_sendTransaction').length,0);
});

test('the active frontend has one server replay and no client result simulation',async()=>{
  const {readFile}=await import('node:fs/promises');
  const main=await readFile(new URL('./main.mjs',import.meta.url),'utf8');
  const player=await readFile(new URL('./arena-player.mjs',import.meta.url),'utf8');
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert.doesNotMatch(player,/\bsimulate\s*\(/);
  for(const view of ['play','fighter','socks','ladder','launch','rules','manifesto','admin'])assert.ok(html.includes('data-view="'+view+'"'));
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
  for(const id of [...main.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]))assert.ok(ids.includes(id),'missing DOM ID '+id);
  for(const source of [main,player,html])assert.ok(!source.includes(String.fromCodePoint(0x2014)));
  for(const source of [main,html])assert.doesNotMatch(source,/\b(?:USDG|SDG|play puppet|stock betting|asset betting|memecoin betting)\b/i);
  assert.match(html,/PIT for every contestant/);
  assert.match(main,/state\.preparationChecks>=60/);
  assert.match(main,/\/api\/fighter\/compile\/.*encodeURIComponent\(job\.jobId\)/);
});

test('only explicit room opening scrolls to the match and respects reduced motion',async()=>{
  const {readFile}=await import('node:fs/promises');
  const main=await readFile(new URL('./main.mjs',import.meta.url),'utf8');
  const openSource=main.slice(main.indexOf('async function openRoom('),main.indexOf('async function enterRoom('));
  const events=[],state={view:'play'};let reduced=false;
  const openRoom=new Function('api','state','renderRoom','$','window','return ('+openSource+');')(
    async()=>({room:{id:'room1'}}),state,async()=>{events.push('render');},
    id=>{assert.equal(id,'room-view');return {querySelector:selector=>{assert.equal(selector,'.room-heading');return {scrollIntoView:options=>events.push(options)};}};},
    {matchMedia:query=>{assert.equal(query,'(prefers-reduced-motion: reduce)');return {matches:reduced};}}
  );
  await openRoom('room1');assert.deepEqual(events,['render']);events.length=0;
  await openRoom('room1',{reveal:true});assert.deepEqual(events,['render',{behavior:'smooth',block:'start'}]);events.length=0;
  reduced=true;await openRoom('room1',{reveal:true});assert.deepEqual(events,['render',{behavior:'auto',block:'start'}]);events.length=0;
  state.view='fighter';await openRoom('room1',{reveal:true});assert.deepEqual(events,['render']);
  assert.match(main,/openRoom\(room\.id,\{reveal:true\}\)/);
  assert.doesNotMatch(main.slice(main.indexOf('async function renderRoom('),main.indexOf('async function openRoom(')),/scrollIntoView/);
  assert.doesNotMatch(main.slice(main.indexOf('async function boot(')),/scrollIntoView|openRoom\(/);
});

test('successful page reload clears only its own read failure, not a wallet action error',async()=>{
  const {readFile}=await import('node:fs/promises');
  const main=await readFile(new URL('./main.mjs',import.meta.url),'utf8');
  const source=main.slice(main.indexOf('let readErrorView='),main.indexOf('function explain('));
  const element={textContent:'',error:false,classList:{toggle(name,value){assert.equal(name,'error');element.error=value;}}};
  const {status,clearReadError}=new Function('$',source+'\nreturn {status,clearReadError};')(()=>element);
  status('Read unavailable',true,'launch');clearReadError('socks');assert.equal(element.textContent,'Read unavailable');
  clearReadError('launch');assert.equal(element.textContent,'');assert.equal(element.error,false);
  status('Read unavailable',true,'launch');status('Wallet transaction failed',true);clearReadError('launch');assert.equal(element.textContent,'Wallet transaction failed');assert.equal(element.error,true);
  status('Transaction pending');clearReadError('launch');assert.equal(element.textContent,'Transaction pending');
  assert.match(main,/async function loadView\(view\).*clearReadError\(view\)/);
  assert.match(main,/clearReadError\(pollView\)/);
  assert.match(main,/true,initialView\)/);
});

test('collection imports validate canonical IDs and de-duplicate without changing identity',()=>{
  const id='a'.repeat(64)+'i0',other='b'.repeat(64)+'i12';
  assert.deepEqual(parseInscriptionList(JSON.stringify([other,id,id])),[id,other]);
  assert.deepEqual(parseInscriptionList(id+'\n'+other),[id,other]);
  assert.throws(()=>parseInscriptionList('["Bitcoin Puppets"]'),/invalid/);
  assert.throws(()=>parseInscriptionList('{"name":"puppets"}'),/JSON list/);
});

test('collection import accepts the 10,001 Puppets and enforces the 20,000 hard bound',()=>{
  const ids=Array.from({length:20001},(_,i)=>i.toString(16).padStart(64,'0')+'i0');
  assert.equal(parseInscriptionList(ids.slice(0,10001).join('\n')).length,10001);
  assert.equal(parseInscriptionList(JSON.stringify(ids.slice(0,20000))).length,20000);
  assert.throws(()=>parseInscriptionList(ids.join('\n')),/1 to 20,000/);
});

test('collection upload uses bounded ordered chunks and never silently completes a partial upload',async()=>{
  const ids=Array.from({length:201},(_,i)=>i.toString(16).padStart(64,'0')+'i0'),calls=[];
  await importCollection({id:'puppets',name:'Puppets',kind:'bitcoin-inscriptions',enabled:true,inscriptionIds:ids},async(path,body)=>{calls.push({path,body});return {importId:'stage1'};});
  assert.deepEqual(calls.map(c=>c.body.inscriptionIds.length),[100,100,1]);
  assert.deepEqual(calls.map(c=>c.body.offset),[0,100,200]);
  assert.equal(calls[1].body.importId,'stage1');
  for(const call of calls)assert.ok(JSON.stringify(call.body).length<16384);
  await assert.rejects(importCollection({inscriptionIds:ids},async()=>({})),/continuation reference/);
});
