import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {encodeFunctionData} from 'viem';
import {createWallet} from './wallet.mjs';
import {batchMintEstimate,createMintJournal} from './mint-state.mjs';

const artifact=JSON.parse(await readFile(new URL('../../contracts/out/PitSocksBatch.sol/PitSocksBatch.json',import.meta.url),'utf8'));
const owner='0x'+'a'.repeat(40),contract='0x'+'b'.repeat(40),hash='0x'+'c'.repeat(64),nonce='0x'+'d'.repeat(64);
const config={mintProtocol:'batch-v2',chain:{id:46630},contracts:{socksBatch:contract},features:{socks:true}};
const scope={address:owner,contract,chainId:46630};
function memory(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function lockManager(){const held=new Set();return {async request(key,options,callback){if(held.has(key))return callback(null);held.add(key);try{return await callback({name:key});}finally{held.delete(key);}}};}
function record(quantity=3){
  const expected=batchMintEstimate({protocol:'batch-v2',mintPriceWei:'1234567890123456789',maxBatch:10,lifetimeCap:null,freeRemaining:2,freeEligibility:'verified'},quantity);
  const expiresAt=Math.floor(Date.now()/1000)+120;
  const data=encodeFunctionData({abi:artifact.abi,functionName:'requestMint',args:[{wallet:owner,quantity,freeMints:expected.freeMints,eligibilityKey:nonce,affiliationVersion:nonce,nonce,deadline:BigInt(expiresAt)},'0x'+'11'.repeat(65)]});
  const quote={kind:'mint-batch',quoteId:nonce,expiresAt,...expected,quote:{nonce,wallet:owner},transaction:{to:contract,chainId:46630,value:expected.ethWei,data}};
  return {phase:'quoted',requestId:'0x'+'e'.repeat(64),expected,quoteId:nonce,quote};
}
function fixture({storage=memory(),locks=lockManager(),send,receipt,confirmation,reconcile,activeConfig=structuredClone(config)}={}){
  const calls=[],posts=[],events=new Map();
  const journal=createMintJournal(storage,scope);
  const provider={on:(name,fn)=>events.set(name,fn),removeListener:name=>events.delete(name),async request(request){
    calls.push(request);
    if(request.method==='eth_requestAccounts'||request.method==='eth_accounts')return [owner];
    if(request.method==='eth_chainId')return '0xb626';
    if(request.method==='personal_sign')return '0x'+'2'.repeat(130);
    if(request.method==='eth_sendTransaction'){assert.equal(journal.get().phase,'submitting','durable safety record must precede wallet send');return send?send(request):hash;}
    if(request.method==='eth_getTransactionReceipt')return receipt?receipt(request):{status:'0x1',transactionHash:hash};
    throw Error('Unexpected wallet method '+request.method);
  }};
  globalThis.window=Object.assign(new EventTarget(),{ethereum:provider});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks}});
  globalThis.localStorage=storage;
  globalThis.fetch=async(path,options)=>{
    const body=options.body?JSON.parse(options.body):{};posts.push({path,body});
    let payload;
    if(path.endsWith('/challenge'))payload={message:'The Pit '+owner,nonce:'test'};
    else if(path==='/api/transactions')payload=confirmation?await confirmation(body):{confirmed:true,hash:body.hash,quoteId:body.quoteId};
    else if(path.startsWith('/api/socks/quotes/'))payload=reconcile?await reconcile(path):{state:'pending',quoteId:nonce};
    else payload={ok:true};
    return {ok:true,status:200,json:async()=>payload};
  };
  return {wallet:createWallet(()=>activeConfig),journal,storage,locks,calls,posts,events,activeConfig};
}

test('one exact batch is saved before submission, indexed with its nonce and then retired',async()=>{
  const f=fixture(),saved=f.journal.save(record());await f.wallet.connect();const states=[];
  assert.equal(await f.wallet.transact(saved.quote,info=>states.push(info)),hash);
  const sends=f.calls.filter(x=>x.method==='eth_sendTransaction');assert.equal(sends.length,1);
  assert.equal(BigInt(sends[0].params[0].value),BigInt(saved.expected.ethWei));
  assert.deepEqual(f.posts.find(x=>x.path==='/api/transactions').body,{hash,quoteId:nonce,kind:'mint-batch'});
  assert.equal(f.journal.get(),null);assert.equal(states.at(-1).phase,'confirmed');
});

test('two free socks still require exactly one zero-value transaction and separate gas',async()=>{
  const f=fixture(),saved=f.journal.save(record(2));await f.wallet.connect();
  await f.wallet.transact(saved.quote);
  assert.equal(f.calls.find(x=>x.method==='eth_sendTransaction').params[0].value,'0x0');
});

test('uncertain wallet submission remains locked even if the quote later expires',async()=>{
  const f=fixture({send:()=>{throw Error('wallet transport disconnected');},reconcile:()=>({state:'expired-or-unknown',quoteId:nonce})});
  const saved=f.journal.save(record());await f.wallet.connect();
  await assert.rejects(f.wallet.transact(saved.quote),/transport/);assert.equal(f.journal.get().phase,'submitting');
  await assert.rejects(f.wallet.transact(saved.quote),/already have been submitted/);
  const result=await f.wallet.recoverMint();assert.equal(result.accepted,false);assert.match(result.message,/does not prove/);
  assert.equal(f.journal.get().phase,'submitting');assert.equal(f.calls.filter(x=>x.method==='eth_sendTransaction').length,1);
});

test('an explicit wallet rejection alone restores the unsent quote for deliberate retry',async()=>{
  let rejected=true;
  const f=fixture({send:()=>{if(rejected)throw Object.assign(Error('rejected'),{code:4001});return hash;}}),saved=f.journal.save(record());await f.wallet.connect();
  await assert.rejects(f.wallet.transact(saved.quote),/rejected/);assert.equal(f.journal.get().phase,'quoted');
  assert.equal(f.calls.filter(x=>x.method==='eth_sendTransaction').length,1);
  rejected=false;await f.wallet.transact(saved.quote);assert.equal(f.journal.get(),null);
});

test('a post-send indexing failure survives reload and recovery never requests another payment',async()=>{
  const f=fixture({confirmation:()=>{throw Error('indexing unavailable');}}),saved=f.journal.save(record());await f.wallet.connect();
  await assert.rejects(f.wallet.transact(saved.quote),/indexing unavailable/);assert.equal(f.journal.get().hash,hash);
  const next=fixture({storage:f.storage,locks:f.locks});await next.wallet.connect();
  assert.equal((await next.wallet.recoverMint()).accepted,true);
  assert.equal(next.calls.filter(x=>x.method==='eth_sendTransaction').length,0);assert.equal(next.journal.get(),null);
});

test('confirmation must positively bind the exact hash and quote before clearing recovery',async()=>{
  for(const answer of [{ok:true},{confirmed:false},{confirmed:true,hash,quoteId:'0x'+'f'.repeat(64)},{confirmed:true,hash:'0x'+'f'.repeat(64),quoteId:nonce}]){
    const f=fixture({confirmation:()=>answer}),saved=f.journal.save(record());await f.wallet.connect();
    await assert.rejects(f.wallet.transact(saved.quote),/not been confirmed/);assert.equal(f.journal.get().hash,hash);
  }
});

test('nonce reconciliation of an unknown submission can finish without sending again',async()=>{
  const f=fixture({reconcile:()=>({state:'accepted',quoteId:nonce,hash})});f.journal.save({...record(),phase:'submitting'});await f.wallet.connect();
  assert.equal((await f.wallet.recoverMint()).accepted,true);assert.equal(f.journal.get(),null);
  assert.equal(f.calls.filter(x=>x.method==='eth_sendTransaction').length,0);
});

test('a manually pasted hash is verified by the canonical route before touching the saved record',async()=>{
  let accept=false;
  const f=fixture({confirmation:body=>{assert.equal(body.hash,hash);if(!accept)throw Error('wrong transaction');return {confirmed:true,hash,quoteId:nonce};}});
  const saved=f.journal.save({...record(),phase:'submitting'});await f.wallet.connect();
  await assert.rejects(f.wallet.recoverMint(()=>{},hash),/wrong transaction/);assert.deepEqual(f.journal.get(),saved);
  accept=true;assert.equal((await f.wallet.recoverMint(()=>{},hash)).accepted,true);
  assert.equal(f.calls.filter(x=>x.method==='eth_sendTransaction').length,0);
});

test('a saved wallet hash cannot be replaced by another pasted hash',async()=>{
  const f=fixture();f.journal.save({...record(),phase:'sent',hash});await f.wallet.connect();
  await assert.rejects(f.wallet.recoverMint(()=>{},'0x'+'f'.repeat(64)),/cannot be replaced/);
  assert.equal(f.posts.filter(x=>x.path==='/api/transactions').length,0);assert.equal(f.journal.get().hash,hash);
});

test('only a canonically confirmed reverted saved hash is retired with a gas-loss notice',async()=>{
  const f=fixture({confirmation:()=>({confirmed:false,reverted:true,hash,quoteId:nonce})});f.journal.save({...record(),phase:'sent',hash});await f.wallet.connect();
  const result=await f.wallet.recoverMint();assert.equal(result.reverted,true);assert.equal(result.accepted,false);assert.match(result.message,/Network fees/);assert.equal(f.journal.get(),null);
  f.journal.save({...record(),phase:'submitting'});
  await assert.rejects(f.wallet.recoverMint(()=>{},hash),/does not prove/);assert.equal(f.journal.get().phase,'submitting');
});

test('a wallet-reported revert is not final until the canonical service verifies it',async()=>{
  const f=fixture({receipt:()=>({status:'0x0',transactionHash:hash}),confirmation:()=>{throw Error('wait two blocks');}}),saved=f.journal.save(record());await f.wallet.connect();
  await assert.rejects(f.wallet.transact(saved.quote),/wait two blocks/);assert.equal(f.journal.get().hash,hash);
});

test('expired quotes, altered payment data, and blocked storage never reach the wallet send',async()=>{
  for(const change of [saved=>{saved.quote.expiresAt=1;},saved=>{saved.quote.transaction.value='0';},saved=>{saved.quote.transaction.to=owner;}]){
    const f=fixture(),saved=record();change(saved);f.journal.save(saved);await f.wallet.connect();
    await assert.rejects(f.wallet.transact(saved.quote));assert.equal(f.calls.filter(x=>x.method==='eth_sendTransaction').length,0);
  }
  const f=fixture(),saved=f.journal.save(record());await f.wallet.connect();f.storage.setItem=()=>{throw Error('storage full');};
  await assert.rejects(f.wallet.transact(saved.quote),/could not be saved/);assert.equal(f.calls.filter(x=>x.method==='eth_sendTransaction').length,0);
});

test('an account change after send preserves the original scoped record',async()=>{
  let f;
  f=fixture({receipt:()=>{f.events.get('accountsChanged')();return {status:'0x1',transactionHash:hash};}});
  const saved=f.journal.save(record());await f.wallet.connect();
  await assert.rejects(f.wallet.transact(saved.quote),/wallet changed/);assert.equal(f.journal.get().hash,hash);
  assert.equal(f.posts.filter(x=>x.path==='/api/transactions').length,0);
});

test('closed new mints still allow recovery of an already submitted purchase',async()=>{
  const f=fixture({activeConfig:{...structuredClone(config),features:{socks:false}}}),saved=f.journal.save(record());await f.wallet.connect();
  await assert.rejects(f.wallet.transact(saved.quote),/not available/);
  f.journal.save({...saved,phase:'sent',hash});assert.equal((await f.wallet.recoverMint()).accepted,true);
  assert.equal(f.calls.filter(x=>x.method==='eth_sendTransaction').length,0);
});

test('a saved hash refused as superseded is released only when the quote check confirms another acceptance',async()=>{
  const other='0x'+'9'.repeat(64);let state='pending';
  const f=fixture({reconcile:()=>state==='accepted'?{state,quoteId:nonce,hash:other}:{state,quoteId:nonce}});
  const inner=globalThis.fetch;
  globalThis.fetch=async(path,options)=>path==='/api/transactions'?{ok:false,status:409,json:async()=>({message:'This authorization was accepted in another transaction. Recover that batch before another purchase.'})}:inner(path,options);
  f.journal.save({...record(),phase:'sent',hash});await f.wallet.connect();
  await assert.rejects(f.wallet.recoverMint(),/accepted in another transaction/);
  assert.equal(f.journal.get().hash,hash,'a pending quote check never releases the saved purchase');
  state='accepted';const events=[];
  const result=await f.wallet.recoverMint(info=>events.push(info));
  assert.equal(result.accepted,true);assert.equal(result.hash,other);assert.equal(f.journal.get(),null);
  assert.equal(events.at(-1).hash,other);assert.match(events.at(-1).message,/another transaction/);
  assert.equal(f.calls.filter(x=>x.method==='eth_sendTransaction').length,0);
  globalThis.fetch=inner;
});
