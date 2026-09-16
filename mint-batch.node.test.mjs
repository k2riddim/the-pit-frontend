import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {encodeFunctionData} from 'viem';
import {mintWei,mintQuantity,mintProtocol,batchMintEstimate,validateBatchMintQuote,mintProgress,createMintJournal,mintStorageKey,mintRequestId,withMintLock} from './mint-state.mjs';

const artifact=JSON.parse(await readFile(new URL('../../contracts/out/PitSocksBatch.sol/PitSocksBatch.json',import.meta.url),'utf8'));

const owner='0x'+'1'.repeat(40),contract='0x'+'2'.repeat(40),nonce='0x'+'3'.repeat(64);
const base={protocol:'batch-v2',mintPriceWei:'1234567890123456789',maxBatch:10,lifetimeCap:null,freeRemaining:2,freeEligibility:'verified'};
const config={mintProtocol:'batch-v2',chain:{id:46630},contracts:{socksBatch:contract}};
function quoted(quantity=3,data=base){
  const expected=batchMintEstimate(data,quantity);
  const input=encodeFunctionData({abi:artifact.abi,functionName:'requestMint',args:[{wallet:owner,quantity,freeMints:expected.freeMints,eligibilityKey:nonce,affiliationVersion:nonce,nonce,deadline:2000000000n},'0x'+'44'.repeat(65)]});
  return {expected,quote:{...expected,kind:'mint-batch',quoteId:nonce,expiresAt:2000000000,quote:{nonce,wallet:owner},transaction:{to:contract,chainId:46630,data:input,value:expected.ethWei}}};
}
const options={address:owner,contract,chainId:46630,now:1800000000000};

test('quantity accepts 1 and 10 and rejects coercions, 0, 11 and fractions',()=>{
  for(const value of [1,10,'1','10'])assert.equal(mintQuantity(value),Number(value));
  for(const value of [0,11,-1,1.5,'0','11','1.0','01',' 1 ','1e0',true,null,undefined])assert.throws(()=>mintQuantity(value),/whole number/);
});
test('mint money uses canonical decimal strings and exact bigint arithmetic',()=>{
  assert.equal(mintWei('123456789012345678901234567890'),123456789012345678901234567890n);
  for(const value of [1,1n,NaN,null,'','01','1e3','-1','0x1',(1n<<256n).toString()])assert.throws(()=>mintWei(value));
  assert.throws(()=>mintWei('0',{positive:true}));
  assert.equal(mintWei('0'),0n);
});
test('batch protocol is explicit and legacy responses cannot masquerade as v2',()=>{
  assert.equal(mintProtocol({},{}),'legacy-v1');
  assert.equal(mintProtocol(config,base),'batch-v2');
  assert.throws(()=>mintProtocol(config,{}));
  assert.throws(()=>mintProtocol({},base));
  assert.throws(()=>mintProtocol({mintProtocol:'something-else'},base));
});
test('two free total means a mixed ten batch has eight paid, with exact wei',()=>{
  assert.deepEqual(batchMintEstimate(base,10),{quantity:10,freeMints:2,paidMints:8,mintPriceWei:base.mintPriceWei,ethWei:'9876543120987654312',freeEligibility:'verified'});
  assert.equal(batchMintEstimate(base,1).ethWei,'0');
  assert.equal(batchMintEstimate({...base,freeRemaining:0},10).paidMints,10);
  assert.equal(batchMintEstimate({...base,freeRemaining:1},3).paidMints,2);
});
test('unlinked is explicitly paid and unavailable ownership never silently becomes paid',()=>{
  const paid=batchMintEstimate({...base,freeRemaining:0,freeEligibility:'unlinked'},2);
  assert.equal(paid.freeMints,0);assert.equal(paid.ethWei,'2469135780246913578');
  for(const freeRemaining of [0,2])assert.throws(()=>batchMintEstimate({...base,freeRemaining,freeEligibility:'unavailable'},2),/No paid substitute/);
  assert.throws(()=>batchMintEstimate({...base,freeEligibility:'unlinked'},2),/verify/);
});
test('malformed supply policy or allowance blocks a batch estimate',()=>{
  for(const patch of [{maxBatch:11},{maxBatch:'10'},{lifetimeCap:2},{freeRemaining:'2'},{freeRemaining:3},{freeRemaining:-1},{freeEligibility:'cached'},{mintPriceWei:'0'}])
    assert.throws(()=>batchMintEstimate({...base,...patch},1));
});
test('a valid free or mixed quote preserves the exact reviewed breakdown',()=>{
  for(const quantity of [1,2,3,10]){
    const {expected,quote}=quoted(quantity);
    assert.equal(validateBatchMintQuote(quote,expected,options).quoteId,nonce);
  }
});
test('a competing free reservation cannot turn the reviewed free socks into paid ones',()=>{
  const {expected}=quoted(3),{quote}=quoted(3,{...base,freeRemaining:0});
  assert.throws(()=>validateBatchMintQuote(quote,expected,options),/count changed/);
});
test('quote validation binds contract, wallet, network, nonce and single action',()=>{
  const {expected,quote}=quoted();
  for(const patch of [{kind:'mint'},{quoteId:'short'},{approval:{}},{transactions:[]},{transaction:{...quote.transaction,to:owner}},{transaction:{...quote.transaction,chainId:1}},{transaction:{...quote.transaction,data:'0x123'}},{quote:{nonce:'0x'+'4'.repeat(64),wallet:owner}},{quote:{nonce,wallet:contract}}])
    assert.throws(()=>validateBatchMintQuote({...quote,...patch},expected,options));
});
test('changing quantity, unit price, total or transaction value needs a fresh review',()=>{
  const {expected,quote}=quoted();
  for(const patch of [{quantity:4},{paidMints:2},{freeMints:1},{mintPriceWei:'1234567890123456790'},{ethWei:'1234567890123456790'},{transaction:{...quote.transaction,value:'0'}}])
    assert.throws(()=>validateBatchMintQuote({...quote,...patch},expected,options));
});
test('expired or malformed deadlines cannot reach wallet approval',()=>{
  const {expected,quote}=quoted();
  for(const expiresAt of [0,1799999999,1800000000,NaN,Infinity,'invalid',2000000000.1])assert.throws(()=>validateBatchMintQuote({...quote,expiresAt},expected,options),/expired/);
});
test('partial delivery does not describe all children as delivered or refunded',()=>{
  const progress=mintProgress({...base,pending:1,refundWei:'12',requests:[
    {id:'1',batchId:nonce,status:'fulfilled',tokenId:'400',free:true,paymentWei:'0'},
    {id:'2',batchId:nonce,status:'refunded',free:true,paymentWei:'0'},
    {id:'3',batchId:nonce,status:'ready',free:false,paymentWei:'12'},
    {id:'4',batchId:nonce,status:'refunded',free:false,paymentWei:'12'},
  ]});
  assert.match(progress.message,/1 sock is still being prepared/);assert.match(progress.message,/1 delivered/);
  assert.match(progress.message,/delivered socks are kept/);
  assert.match(progress.requests[0].label,/SOCK #400 delivered/);
  assert.match(progress.requests[1].label,/free allowance restored; no ETH paid/);
  assert.match(progress.requests[2].label,/delivery in progress/);
  assert.match(progress.requests[3].label,/paid ETH credited/);
  assert.equal(progress.refund,12n);
});
test('a free refund alone never displays a fictitious ETH refund',()=>{
  const progress=mintProgress({...base,pending:0,refundWei:'0',requests:[{id:'5',status:'refunded',free:true,paymentWei:'0'}]});
  assert.equal(progress.refund,0n);
  assert.match(progress.message,/did not pay ETH/);
  assert.doesNotMatch(progress.message,/ETH is available to recover/);
});
test('mint page keeps the free avatar action distinct from NFT free allowance',async()=>{
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert.match(html,/Minting buys a collectible NFT, not access to the arena/);
  assert.match(html,/data-free-sock disabled>USE A FREE SOCK INSTEAD/);
  assert.match(html,/Two free NFT mints total per verified Bitcoin wallet/);
  assert.match(html,/<input id="mint-quantity"[^>]*min="1" max="10" step="1"/);
  assert.match(html,/Network fees still apply/);
  assert.match(html,/id="mint-legacy-recovery"/);
  assert.doesNotMatch(html,/>\$20, paid in ETH|A surprise sock costs \$20|Two lifetime buys/);
});

test('displayed counts cannot differ from the actual compiled batch call',()=>{
  assert.equal(artifact.methodIdentifiers['requestMint((address,uint8,uint8,bytes32,bytes32,bytes32,uint64),bytes)'],'a08a316c');
  const {expected,quote}=quoted();
  const replaceWord=(index,value)=>quote.transaction.data.slice(0,10+index*64)+value.padStart(64,'0')+quote.transaction.data.slice(10+(index+1)*64);
  for(const input of [quote.transaction.data.replace('a08a316c','110f8874'),replaceWord(0,contract.slice(2)),replaceWord(1,'4'),replaceWord(2,'0'),replaceWord(3,'0'),replaceWord(5,'4'.repeat(64)),replaceWord(6,'1'),replaceWord(7,'80'),replaceWord(8,'40'),quote.transaction.data+'00'])
    assert.throws(()=>validateBatchMintQuote({...quote,transaction:{...quote.transaction,data:input}},expected,options),/encoded mint/);
});

function memory(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
const scope={address:owner,contract,chainId:46630};
function draft(){const {expected,quote}=quoted();return {phase:'quoted',requestId:'0x'+'5'.repeat(64),expected,quoteId:nonce,quote};}

test('saved mint is isolated by network, contract and game wallet and survives reload',()=>{
  const storage=memory(),journal=createMintJournal(storage,scope),saved=journal.save(draft());
  assert.deepEqual(createMintJournal(storage,scope).get(),saved);
  for(const other of [{...scope,chainId:1},{...scope,address:contract},{...scope,contract:owner}])assert.equal(createMintJournal(storage,other).get(),null);
  assert.equal(mintStorageKey({...scope,address:owner.toUpperCase().replace('0X','0x')}),journal.key);
  journal.clear();assert.equal(journal.get(),null);
});

test('malformed or unavailable recovery storage fails closed, not as an empty purchase',()=>{
  const storage=memory(),journal=createMintJournal(storage,scope);
  storage.setItem(journal.key,'broken');assert.throws(()=>journal.get(),/needs recovery/);
  storage.setItem(journal.key,JSON.stringify({...draft(),version:1,scope,phase:'sent'}));assert.throws(()=>journal.get(),/hash is missing/);
  assert.throws(()=>createMintJournal({getItem(){throw Error('blocked');}},scope).get(),/storage is unavailable/);
  assert.throws(()=>createMintJournal({setItem(){},getItem(){return null;}},scope).save(draft()),/could not be saved/);
  for(const patch of [{requestId:'bad'},{phase:'completed'},{hash:'bad'},{expected:{...draft().expected,paidMints:0}}])assert.throws(()=>journal.save({...draft(),...patch}));
});

test('request IDs use 32 random bytes and never a time-derived payment identifier',()=>{
  let bytes=0;
  const id=mintRequestId({getRandomValues(array){bytes=array.length;array.fill(17);return array;}});
  assert.equal(bytes,32);assert.equal(id,'0x'+'11'.repeat(32));
  assert.throws(()=>mintRequestId({}),/Secure request/);
});

test('cross-tab lock excludes a second action and releases even on failure',async()=>{
  let busy=false,resolve;
  const locks={async request(key,options,callback){assert.equal(key,mintStorageKey(scope));assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});if(busy)return callback(null);busy=true;try{return await callback({name:key});}finally{busy=false;}}};
  const first=withMintLock(scope,()=>new Promise(done=>{resolve=done;}),locks);
  await assert.rejects(withMintLock(scope,()=>assert.fail('second action'),locks),/another tab/);
  resolve('done');assert.equal(await first,'done');
  await assert.rejects(withMintLock(scope,()=>{throw Error('test failure');},locks),/test failure/);
  assert.equal(await withMintLock(scope,()=>42,locks),42);
  await assert.rejects(withMintLock(scope,()=>assert.fail('unsupported browser'),{}),/Web Locks/);
});

const mainSource=await readFile(new URL('./main.mjs',import.meta.url),'utf8');
function workflow({postQuote,confirm=false}={}){
  const journal=createMintJournal(memory(),scope),state={config:{...config,features:{socks:true}},socks:{...base}},requests=[],reviews=[],recoveries=[],messages=[];
  const controls={'mint-quantity':{value:'3'},'mint-transaction-hash':{value:''}};
  const wallet={address:owner,mintJournal:()=>journal,async recoverMint(_status,hash){recoveries.push(hash);return {accepted:false,message:'still checking'};}};
  const start=mainSource.indexOf('function requireBatchMint('),end=mainSource.indexOf('async function loadSocks(');
  let held=false;const locks={async request(_key,_options,callback){if(held)return callback(null);held=true;try{return await callback({});}finally{held=false;}}};
  const functions=new Function('state','wallet','mintProtocol','batchMintEstimate','mintQuantity','mintRequestId','validateBatchMintQuote','withMintLock','$','post','confirmQuote','renderMintDesk','loadSocks','status','transactionStatus',mainSource.slice(start,end)+'\nreturn {startBatchMint,resumeBatchMint,discardUnsentMint};')(
    state,wallet,mintProtocol,batchMintEstimate,mintQuantity,()=>nonce,validateBatchMintQuote,(scope,work)=>withMintLock(scope,work,locks),id=>controls[id],
    async(path,body)=>{requests.push({path,body});return postQuote?postQuote(body):quoted(body.quantity,state.socks).quote;},
    async(quote,_title,options)=>{reviews.push(quote);if(confirm){options.beforePayment();journal.clear();}return confirm;},()=>{},async()=>{},message=>messages.push(message),()=>{});
  return {...functions,journal,state,controls,requests,reviews,recoveries,messages};
}

test('a lost quote response retries the same quantity and request ID without opening the wallet',async()=>{
  let fail=true;
  const f=workflow({postQuote:body=>{if(fail)throw Error('lost response');return quoted(body.quantity).quote;}});
  await assert.rejects(f.startBatchMint(),/lost response/);assert.equal(f.journal.get().phase,'quoting');assert.equal(f.reviews.length,0);
  fail=false;await f.resumeBatchMint();assert.deepEqual(f.requests[0],f.requests[1]);
  assert.equal(f.journal.get().phase,'quoted');assert.equal(f.reviews.length,1);
});

test('a changed free quote remains unsent and does not silently request a paid substitute',async()=>{
  const f=workflow({postQuote:body=>quoted(body.quantity,{...base,freeRemaining:0}).quote});
  await assert.rejects(f.startBatchMint(),/count changed/);assert.equal(f.reviews.length,0);assert.equal(f.journal.get().phase,'quoting');
  assert.equal(f.requests.length,1);
});

test('cancelling review keeps one quoted purchase; a second start cannot overwrite it',async()=>{
  const f=workflow();await f.startBatchMint();const saved=f.journal.get();
  await assert.rejects(f.startBatchMint(),/already saved/);assert.deepEqual(f.journal.get(),saved);assert.equal(f.requests.length,1);
  await f.resumeBatchMint();assert.equal(f.requests.length,1);assert.equal(f.reviews.length,2);
});

test('only explicitly unsent quotes can be discarded, and no fresh quote is requested by discard',async()=>{
  const f=workflow();await f.startBatchMint();await f.discardUnsentMint();assert.equal(f.journal.get(),null);assert.equal(f.requests.length,1);
  for(const phase of ['submitting','sent']){
    f.journal.save({...draft(),phase,...(phase==='sent'?{hash:nonce}:{})});
    await assert.rejects(f.discardUnsentMint(),/cannot be discarded/);assert.equal(f.journal.get().phase,phase);
  }
});

test('resuming a submitted batch only reconciles the same purchase even when new mints are closed',async()=>{
  const f=workflow();f.journal.save({...draft(),phase:'sent',hash:nonce});f.state.config.features.socks=false;f.state.socks=null;
  await f.resumeBatchMint();assert.equal(f.recoveries.length,1);assert.equal(f.requests.length,0);assert.equal(f.reviews.length,0);
});

test('restoring a pending record renders controls but contains no wallet or API side effect',()=>{
  const rendering=mainSource.slice(mainSource.indexOf('function syncMintPending('),mainSource.indexOf('function requireBatchMint('));
  assert.doesNotMatch(rendering,/\b(?:post|api)\s*\(|\.transact\s*\(|eth_sendTransaction|recoverMint\(/);
  assert.match(mainSource,/addEventListener\('storage',[\s\S]*?renderMintDesk\(\)/);
});

test('the batch rulebook never exposes legacy dollar pricing or wallet caps, even while price loads',()=>{
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{textContent:''});return elements.get(id);};
  const ruleSource=mainSource.slice(mainSource.indexOf('function renderMintRules('),mainSource.indexOf('function syncMintPending('));
  const render=new Function('$','units','return ('+ruleSource+');')(get,value=>value);
  for(const data of [undefined,base]){
    render('batch-v2',data);
    const text=[...elements.values()].map(value=>value.textContent).join(' ');
    assert.match(text,/fixed in the contract/);assert.match(text,/no lifetime wallet mint cap/);assert.match(text,/two free NFT mints in total/);
    assert.doesNotMatch(text,/USDG|SDG|\$20|\$10|Two lifetime buys|ten in total|per-purchase oracle/i);
  }
  render('legacy-v1',{});assert.match(get('socks-rules-price').textContent,/\$20/);assert.match(get('socks-rules-cap').textContent,/Two lifetime buys/);
});

test('shared sock copy assigns only delivered sale proceeds, not escrowed ETH, to the founder',async()=>{
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  const socks=html.slice(html.indexOf('<section data-view="socks"'),html.indexOf('<section data-view="ladder"'));
  const rules=html.slice(html.indexOf('<h2>A sock, not homework.</h2>'),html.indexOf('<section data-view="admin"'));
  for(const text of [socks,rules]){
    assert.match(text,/All proceeds from delivered paid socks go to the founder/);
    assert.doesNotMatch(text,/accepted sock-sale ETH goes|\$20|\$10|USDG|SDG/);
  }
  assert.match(rules,/ETH for undelivered paid socks stays held for delivery or refund/);
  assert.match(mainSource,/batch\?'Testnet ETH only\. This mint has a fixed ETH price\.'/);
});

test('an expired or changed Bitcoin link is a relink refusal, never a silent full-price quote',()=>{
  const data={protocol:'batch-v2',mintPriceWei:'1234567890123456789',maxBatch:10,lifetimeCap:null,freeRemaining:0,freeEligibility:'relink'};
  assert.throws(()=>batchMintEstimate(data,2),/Verify it again, or unlink it/);
  assert.throws(()=>batchMintEstimate(data,2),/No paid substitute/);
  assert.throws(()=>batchMintEstimate({...data,freeEligibility:'stale'},2),/could not be verified/);
});

test('a scan still in progress keeps the quote waiting instead of pricing a partial wallet',()=>{
  const data={protocol:'batch-v2',mintPriceWei:'1234567890123456789',maxBatch:10,lifetimeCap:null,freeRemaining:0,freeEligibility:'checking',checking:{scanned:96,total:250,retryAt:null}};
  assert.throws(()=>batchMintEstimate(data,2),/Check in progress: 96 of 250 outputs/);
  assert.throws(()=>batchMintEstimate({...data,checking:null},1),/Check in progress\./);
});
