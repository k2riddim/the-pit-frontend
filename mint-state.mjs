const UINT256_MAX=(1n<<256n)-1n;
const HEX32=/^0x[0-9a-f]{64}$/i;
const ADDRESS=/^0x[0-9a-f]{40}$/i;
export function mintWei(value,{positive=false}={}){
  if(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value))throw Error('The mint amount is unreadable. Refresh before paying.');
  const amount=BigInt(value);
  if(amount>UINT256_MAX||positive&&amount===0n)throw Error('The mint amount is invalid. Refresh before paying.');
  return amount;
}
export function mintQuantity(value){
  if(typeof value==='string'&&/^(?:[1-9]|10)$/.test(value))return Number(value);
  if(typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=10)return value;
  throw Error('Choose a whole number from 1 to 10 socks.');
}
export function mintProtocol(config,data){
  const configured=config?.mintProtocol||'legacy-v1',reported=data?.protocol||'legacy-v1';
  if(!['legacy-v1','batch-v2'].includes(configured)||!['legacy-v1','batch-v2'].includes(reported)||data&&configured!==reported)
    throw Error('The mint configuration changed. Refresh before making a purchase.');
  return configured;
}
export function batchMintEstimate(data,quantity){
  quantity=mintQuantity(quantity);
  if(data?.protocol!=='batch-v2'||data.maxBatch!==10||data.lifetimeCap!==null)
    throw Error('Batch mint details are unavailable. Refresh before paying.');
  const mintPriceWei=mintWei(data.mintPriceWei,{positive:true});
  if(mintPriceWei>UINT256_MAX/10n)throw Error('The mint price is invalid. Refresh before paying.');
  if(!['verified','unlinked','unavailable','relink','checking'].includes(data.freeEligibility)||!Number.isInteger(data.freeRemaining)||data.freeRemaining<0||data.freeRemaining>2)
    throw Error('Your free-mint allowance could not be verified. Nothing has been charged.');
  if(data.freeEligibility==='unavailable')throw Error('Ownership checks are unavailable. No paid substitute will be requested. Try again after checks recover.');
  if(data.freeEligibility==='checking')throw Error('Check in progress'+(data.checking?': '+data.checking.scanned+' of '+data.checking.total+' outputs':'')+'. Quote again when it completes.');
  if(data.freeEligibility==='relink')throw Error('Your Bitcoin link has expired or changed. Verify it again, or unlink it in My fighter, before this mint is priced. No paid substitute will be requested.');
  if(data.freeEligibility==='unlinked'&&data.freeRemaining!==0)throw Error('Link and verify your Bitcoin wallet before using its free allowance.');
  const freeMints=data.freeEligibility==='verified'?Math.min(quantity,data.freeRemaining):0;
  const paidMints=quantity-freeMints;
  return {quantity,freeMints,paidMints,mintPriceWei:mintPriceWei.toString(),ethWei:(mintPriceWei*BigInt(paidMints)).toString(),freeEligibility:data.freeEligibility};
}
export function validateBatchMintQuote(quote,expected,{address,contract,chainId,now=Date.now()}={}){
  if(quote?.kind!=='mint-batch'||!HEX32.test(quote.quoteId||'')||!ADDRESS.test(address||'')||!ADDRESS.test(contract||''))
    throw Error('This batch quote is incomplete. No wallet request was started.');
  const transaction=quote.transaction;
  if(!transaction||transaction.to?.toLowerCase()!==contract.toLowerCase()||quote.approval||quote.transactions)
    throw Error('This batch quote has an unexpected payment destination or extra action.');
  if(!/^0x(?:[0-9a-f]{2})+$/i.test(transaction.data||''))throw Error('The batch payment details are unreadable.');
  if(transaction.chainId===undefined||BigInt(transaction.chainId)!==BigInt(chainId))throw Error('The batch quote is for a different network.');
  for(const field of ['quantity','freeMints','paidMints']){
    if(!Number.isInteger(quote[field])||quote[field]!==expected[field])throw Error('The free or paid mint count changed. Refresh and review a new quote; no replacement payment was started.');
  }
  mintQuantity(quote.quantity);
  if(quote.freeMints<0||quote.freeMints>2||quote.paidMints<0||quote.freeMints+quote.paidMints!==quote.quantity)
    throw Error('The batch mint count is invalid.');
  const price=mintWei(quote.mintPriceWei,{positive:true}),payment=mintWei(quote.ethWei);
  if(price!==mintWei(expected.mintPriceWei)||payment!==mintWei(expected.ethWei)||payment!==price*BigInt(quote.paidMints)||BigInt(transaction.value??-1)!==payment)
    throw Error('The exact ETH price changed. Refresh and review a new quote before paying.');
  const expiry=Number(quote.expiresAt),expiryMs=expiry<1e12?expiry*1000:expiry;
  if(!Number.isSafeInteger(expiry)||expiryMs<=now)throw Error('This mint quote has expired. Refresh before approving a new quote.');
  if(quote.quote?.nonce!==undefined&&quote.quote.nonce.toLowerCase()!==quote.quoteId.toLowerCase())throw Error('The batch quote reference does not match its authorization.');
  if(quote.quote?.wallet!==undefined&&quote.quote.wallet.toLowerCase()!==address.toLowerCase())throw Error('The batch quote belongs to a different wallet.');
  // A narrow protocol-v2 guard, verified against the compiled ABI in the tests.
  // The browser does not sign or construct vouchers. It only checks that the one
  // encoded call actually purchases the wallet/count/nonce/deadline being shown.
  const encoded=transaction.data.toLowerCase(),word=index=>encoded.slice(10+index*64,10+(index+1)*64);
  if(encoded.slice(0,10)!=='0xa08a316c'||encoded.length!==10+12*64||word(0)!==address.toLowerCase().slice(2).padStart(64,'0')
    ||BigInt('0x'+word(1))!==BigInt(quote.quantity)||BigInt('0x'+word(2))!==BigInt(quote.freeMints)
    ||'0x'+word(5)!==quote.quoteId.toLowerCase()||BigInt('0x'+word(6))!==BigInt(Math.floor(expiryMs/1000))
    ||BigInt('0x'+word(7))!==256n||BigInt('0x'+word(8))!==65n||!/^[0-9a-f]{2}0{62}$/.test(word(11))
    ||quote.freeMints>0&&/^0+$/.test(word(3)))throw Error('The encoded mint does not match the displayed batch authorization. No wallet request was started.');
  return {...expected,quoteId:quote.quoteId,expiresAt:expiryMs};
}
export function mintScope({address,contract,chainId}){
  if(!ADDRESS.test(address||'')||!ADDRESS.test(contract||'')||!Number.isSafeInteger(Number(chainId))||Number(chainId)<=0)
    throw Error('Connect the correct game wallet before checking this mint.');
  return {address:address.toLowerCase(),contract:contract.toLowerCase(),chainId:Number(chainId)};
}
export function mintStorageKey(scope){
  const value=mintScope(scope);
  return 'the-pit.mint-batch.v2:'+value.chainId+':'+value.contract+':'+value.address;
}
export function mintRequestId(random=globalThis.crypto){
  if(!random?.getRandomValues)throw Error('Secure request identifiers are unavailable in this browser.');
  return '0x'+Array.from(random.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
}
export function createMintJournal(storage,scope){
  const identity=mintScope(scope),key=mintStorageKey(identity);
  const validate=value=>{
    if(!value||value.version!==1||JSON.stringify(value.scope)!==JSON.stringify(identity)||!HEX32.test(value.requestId||'')||!['quoting','quoted','submitting','sent'].includes(value.phase))
      throw Error('The saved mint record is unreadable. Check wallet activity before another purchase; do not clear site data to retry.');
    if(!value.expected||mintQuantity(value.expected.quantity)!==value.expected.quantity)throw Error('The saved mint quantity is invalid.');
    mintWei(value.expected.ethWei);mintWei(value.expected.mintPriceWei,{positive:true});
    if(!Number.isInteger(value.expected.freeMints)||value.expected.freeMints<0||value.expected.freeMints>2||!Number.isInteger(value.expected.paidMints)||value.expected.paidMints<0||value.expected.freeMints+value.expected.paidMints!==value.expected.quantity||mintWei(value.expected.ethWei)!==mintWei(value.expected.mintPriceWei)*BigInt(value.expected.paidMints))throw Error('The saved mint breakdown is invalid.');
    if(value.phase!=='quoting'&&(!HEX32.test(value.quoteId||'')||value.quote?.quoteId!==value.quoteId))throw Error('The saved mint authorization is incomplete. Check wallet activity before another purchase.');
    if(value.hash!==undefined&&!HEX32.test(value.hash))throw Error('The saved mint transaction hash is invalid.');
    if(value.phase==='sent'&&!value.hash)throw Error('The submitted mint hash is missing.');
    return value;
  };
  const get=()=>{
    let raw;try{raw=storage.getItem(key);}catch{throw Error('Local recovery storage is unavailable. No new mint can be submitted safely.');}
    if(raw===null)return null;
    try{return validate(JSON.parse(raw));}catch(error){throw Error('Your saved mint needs recovery: '+error.message);}
  };
  const save=value=>{
    const record=validate({...value,version:1,scope:identity}),raw=JSON.stringify(record);
    if(raw.length>64000)throw Error('The saved mint record is too large. No wallet submission was started.');
    try{storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('storage mismatch');}
    catch{throw Error('The mint recovery record could not be saved. Check wallet activity before retrying.');}
    return record;
  };
  const clear=()=>{try{storage.removeItem(key);if(storage.getItem(key)!==null)throw Error('storage mismatch');}catch{throw Error('The completed mint could not be cleared from local recovery. Check this same purchase again.');}};
  return {get,save,clear,key,scope:identity};
}
export async function withMintLock(scope,work,locks=globalThis.navigator?.locks){
  if(!locks?.request)throw Error('This browser cannot protect a mint across tabs. Use a browser with Web Locks enabled before minting.');
  return locks.request(mintStorageKey(scope),{mode:'exclusive',ifAvailable:true},lock=>{
    if(!lock)throw Error('This mint is already open in another tab. Check that tab before continuing.');
    return work();
  });
}
export function mintProgress(data) {
  const requests = Array.isArray(data.requests) ? data.requests : [];
  const pending = Number(data.pending || 0);
  const refund = BigInt(data.refundWei || '0');
  let message = data.message || 'Your final sock is delivered automatically after the draw.';
  if (pending > 0) message = pending + (pending === 1 ? ' sock is' : ' socks are') + ' being prepared. No second payment or signature is needed.';
  if (refund > 0n) message = 'A mint could not finish. Its accepted ETH is available to recover below. Network fees are not returned.';
  if(data.protocol==='batch-v2'){
    const delivered=requests.filter(r=>r.status==='fulfilled').length,freeRestored=requests.filter(r=>r.status==='refunded'&&(r.free===true||r.freeMint===true)).length;
    message=pending>0?pending+(pending===1?' sock is':' socks are')+' still being prepared. '+(delivered?delivered+' delivered. ':'')+'No second payment or signature is needed.':'Every accepted sock is delivered separately after its draw. No later reveal.';
    if(refund>0n)message+=' Paid mint ETH is available to recover below; delivered socks are kept. Network fees are not returned.';
    if(freeRestored>0)message+=' Undelivered free requests were released back to their Bitcoin wallet allowance. They did not pay ETH.';
    return {message,refund,pending,requests:requests.map(request=>{
      const free=request.free===true||request.freeMint===true,prefix='Request #'+request.id;
      const label=request.status==='fulfilled'?'SOCK #'+request.tokenId+' delivered'+(free?' · Free mint':'')
        :request.status==='refunded'?prefix+(free?': free allowance restored; no ETH paid':': paid ETH credited for recovery')
        :['ready','captured'].includes(request.status)?prefix+': draw saved, delivery in progress'+(free?' · Free mint':'')
        :prefix+': waiting for the draw'+(free?' · Free mint':'');
      return {id:request.id,batchId:request.batchId||request.batchNonce,free,paymentWei:request.paymentWei,label};
    })};
  }
  return { message, refund, pending, requests: requests.map(request => ({
    id: request.id,
    label: request.status === 'fulfilled' ? 'SOCK #' + request.tokenId + ' delivered'
      : request.status === 'refunded' ? 'Purchase #' + request.id + ': refund credited'
      : request.status === 'ready' ? 'Purchase #' + request.id + ': draw saved, delivery in progress'
      : 'Purchase #' + request.id + ': waiting for the draw',
  })) };
}
