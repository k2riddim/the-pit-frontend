import {api,post} from './api.mjs';
import {createMintJournal,validateBatchMintQuote,withMintLock} from './mint-state.mjs';

export function createWallet(getConfig, onChange = () => {}) {
  let provider = null, address = null, generation = 0;
  const changed = () => { generation++; address = null; onChange(null); };
  const hex = value => '0x' + BigInt(value).toString(16);
  const chain = () => getConfig()?.chain;
  const providers = new Map();
  const announce = event => { const d=event.detail; if (d?.info?.uuid && d.provider?.request) providers.set(d.info.uuid,d); };
  window.addEventListener('eip6963:announceProvider',announce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));

  async function ensureChain() {
    const config=chain(); if (!config?.id) throw new Error('The game network is not configured.');
    if (Number(BigInt(await provider.request({method:'eth_chainId'}))) === Number(config.id)) return;
    try { await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:hex(config.id)}]}); }
    catch(error) {
      if (error.code !== 4902) throw error;
      if (!config.rpcUrl || !config.nativeCurrency) throw new Error('Add the game network in your wallet, then reconnect.');
      await provider.request({method:'wallet_addEthereumChain',params:[{
        chainId:hex(config.id),chainName:config.name,rpcUrls:[config.rpcUrl],nativeCurrency:config.nativeCurrency,
        ...(config.explorerUrl?{blockExplorerUrls:[config.explorerUrl]}:{}),
      }]});
    }
    if (Number(BigInt(await provider.request({method:'eth_chainId'}))) !== Number(config.id)) throw new Error('Choose the game network in your wallet.');
  }
  async function connect(id) {
    provider?.removeListener?.('accountsChanged',changed); provider?.removeListener?.('chainChanged',changed);
    provider=id?providers.get(id)?.provider:providers.values().next().value?.provider || window.ethereum;
    if (!provider?.request) throw new Error('Open this site in an Ethereum wallet browser, or install a wallet extension.');
    const accounts=await provider.request({method:'eth_requestAccounts'});
    if (!/^0x[0-9a-f]{40}$/i.test(accounts?.[0] || '')) throw new Error('The wallet did not provide an address.');
    const candidate=accounts[0].toLowerCase();
    await ensureChain();
    const challenge=await post('/api/auth/challenge',{address:candidate});
    if (typeof challenge.message !== 'string' || !challenge.message.toLowerCase().includes(candidate)) throw new Error('The sign-in note does not match your wallet.');
    const encoded='0x'+Array.from(new TextEncoder().encode(challenge.message),n=>n.toString(16).padStart(2,'0')).join('');
    const signature=await provider.request({method:'personal_sign',params:[encoded,candidate]});
    await post('/api/auth/verify',{address:candidate,message:challenge.message,signature,nonce:challenge.nonce});
    address=candidate; generation++;
    provider.on?.('accountsChanged',changed); provider.on?.('chainChanged',changed); onChange(address);
    return address;
  }
  async function transact(quote, onStatus = () => {}) {
    if(quote?.kind==='mint-batch')return transactBatchMint(quote,onStatus);
    if (!address || !provider) throw new Error('Connect your wallet first.');
    await ensureChain();
    if (!address) throw new Error('The network changed. Connect again before this action.');
    const accounts=await provider.request({method:'eth_accounts'});
    if (accounts?.[0]?.toLowerCase() !== address) {changed();throw new Error('The wallet account changed. Connect again before this action.');}
    const owner=address, session=generation, config=getConfig();
    const txs=quote.transactions || [...(quote.approval?[quote.approval]:[]),...(quote.transaction?[quote.transaction]:[])];
    if (!txs.length) throw new Error('This action is not ready for a wallet payment. No coins moved.');
    const allowed=new Set(Object.values(config.contracts || {}).filter(v=>typeof v==='string').map(v=>v.toLowerCase()));
    let finalHash;
    for (const [index,tx] of txs.entries()) {
      if (session !== generation || owner !== address) throw new Error('The wallet changed. Check your activity before trying again.');
      if (!/^0x[0-9a-f]{40}$/i.test(tx.to || '') || !allowed.has(tx.to.toLowerCase())) throw new Error('This payment is not addressed to a configured game contract.');
      if (tx.chainId !== undefined && BigInt(tx.chainId)!==BigInt(config.chain.id)) throw new Error('This payment is for a different network.');
      if (!/^0x(?:[0-9a-f]{2})*$/i.test(tx.data || '')) throw new Error('The payment details are unreadable.');
      if (BigInt(tx.value || 0)<0n) throw new Error('The payment amount is invalid.');
      const approval=quote.approval&&tx.to.toLowerCase()===quote.approval.to.toLowerCase()&&tx.data===quote.approval.data;
      onStatus({phase:'wallet',message:approval?'Allow this exact amount in your wallet.':txs.length>1?'Confirm action '+(index+1)+' of '+txs.length+' in your wallet.':'Confirm the action in your wallet.'});
      const hash=await provider.request({method:'eth_sendTransaction',params:[{from:owner,to:tx.to,data:tx.data,value:hex(tx.value || 0)}]});
      if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('The wallet returned an unreadable transaction reference.');
      onStatus({phase:'chain',hash,message:'Sent. Waiting for the chain to confirm.'});
      let receipt=null;
      for(let attempt=0;attempt<90;attempt++) {
        receipt=await provider.request({method:'eth_getTransactionReceipt',params:[hash]});
        if(receipt)break;
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
      if (!receipt) throw new Error('The chain has not confirmed yet. Check the transaction before sending another one. Reference: '+hash);
      if (BigInt(receipt.status || 0)!==1n) throw new Error('The transaction did not complete. The wallet may still have paid network fees.');
      if (index===txs.length-1) finalHash=hash;
    }
    await post('/api/transactions',{hash:finalHash,quoteId:quote.quoteId,roomId:quote.roomId || quote.room?.id,kind:quote.kind});
    onStatus({phase:'confirmed',hash:finalHash,message:'Confirmed on the chain.'});
    return finalHash;
  }
  function mintJournal(){
    const config=getConfig();
    if(config?.mintProtocol!=='batch-v2')throw Error('Batch minting is not configured for this game.');
    return createMintJournal(globalThis.localStorage,{address,contract:config.contracts?.socksBatch,chainId:config.chain?.id});
  }
  async function batchAccount(){
    if(!address||!provider)throw Error('Connect your wallet first.');
    const owner=address,session=generation;
    await ensureChain();
    const accounts=await provider.request({method:'eth_accounts'});
    if(session!==generation||address!==owner||accounts?.[0]?.toLowerCase()!==owner){changed();throw Error('The wallet changed. Reconnect before checking this purchase.');}
    return {owner,session};
  }
  function sameBatchAccount(owner,session){
    if(owner!==address||session!==generation)throw Error('The wallet changed. Your mint stays saved for the original wallet.');
  }
  async function recordBatchConfirmation(hash,record){
    const result=await post('/api/transactions',{hash,quoteId:record.quoteId,kind:'mint-batch'});
    if((result.confirmed!==true&&!(result.confirmed===false&&result.reverted===true))||result.hash?.toLowerCase()!==hash.toLowerCase()||result.quoteId?.toLowerCase()!==record.quoteId.toLowerCase())throw Error('The purchase has not been confirmed against its saved reference. Check this same purchase again; do not submit another transaction.');
    return result;
  }
  async function transactBatchMint(quote,onStatus){
    const journal=mintJournal();
    return withMintLock(journal.scope,async()=>{
      const record=journal.get();
      if(!record||record.phase!=='quoted'||record.quoteId!==quote.quoteId)
        throw Error('This mint may already have been submitted. Check the saved purchase instead of sending again.');
      if(getConfig()?.features?.socks===false)throw Error('New mint purchases are not available. Your unsent quote remains saved.');
      const {owner,session}=await batchAccount();
      validateBatchMintQuote(quote,record.expected,journal.scope);
      sameBatchAccount(owner,session);
      journal.save({...record,phase:'submitting'});
      onStatus({phase:'wallet',quoteId:record.quoteId,message:'Confirm this exact batch in your wallet. Network fees are separate.'});
      let hash;
      try{
        hash=await provider.request({method:'eth_sendTransaction',params:[{from:owner,to:quote.transaction.to,data:quote.transaction.data,value:hex(quote.ethWei)}]});
      }catch(error){
        if(error?.code===4001||error?.code==='ACTION_REJECTED')journal.save({...record,phase:'quoted'});
        throw error;
      }
      if(!/^0x[0-9a-f]{64}$/i.test(hash||''))throw Error('The wallet did not return a usable transaction hash. Check wallet activity; this purchase remains locked against duplicate submission.');
      const sent=journal.save({...record,phase:'sent',hash});
      onStatus({phase:'chain',hash,quoteId:record.quoteId,message:'Batch sent. The saved transaction can be checked again without another payment.'});
      let receipt=null;
      for(let attempt=0;attempt<90;attempt++){
        sameBatchAccount(owner,session);
        receipt=await provider.request({method:'eth_getTransactionReceipt',params:[hash]});
        if(receipt)break;
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
      if(!receipt)throw Error('This batch is still awaiting the chain. Use Check this purchase. Transaction: '+hash);
      if(receipt.transactionHash&&receipt.transactionHash.toLowerCase()!==hash.toLowerCase())throw Error('The wallet returned a different receipt. Check this saved purchase again.');
      sameBatchAccount(owner,session);
      const result=await recordBatchConfirmation(hash,sent);
      sameBatchAccount(owner,session);journal.clear();
      if(result.reverted===true)throw Error('The saved batch transaction reverted, confirmed after two more blocks. No socks were purchased by that transaction. Network fees may still have been paid. Review a new quote to retry.');
      onStatus({phase:'confirmed',hash,quoteId:record.quoteId,message:'Batch accepted on the chain. Each sock delivery is tracked below.'});
      return hash;
    });
  }
  async function recoverMint(onStatus=()=>{},manualHash=''){
    const journal=mintJournal();
    return withMintLock(journal.scope,async()=>{
      const record=journal.get();
      if(!record||!['submitting','sent'].includes(record.phase))throw Error('There is no submitted batch to check for this wallet.');
      const {owner,session}=await batchAccount();
      if(manualHash&&!/^0x[0-9a-f]{64}$/i.test(manualHash))throw Error('Use the public 0x transaction hash from your wallet activity.');
      if(manualHash&&record.hash&&manualHash.toLowerCase()!==record.hash.toLowerCase())throw Error('This purchase already has a saved transaction hash. Check that same transaction; it cannot be replaced.');
      let hash=record.hash||manualHash;
      if(!hash){
        const result=await api('/api/socks/quotes/'+encodeURIComponent(record.quoteId));
        sameBatchAccount(owner,session);
        if(result.quoteId?.toLowerCase()!==record.quoteId.toLowerCase())throw Error('The recovered purchase reference does not match this quote.');
        if(result.state==='accepted'){
          if(result.hash&&!/^0x[0-9a-f]{64}$/i.test(result.hash))throw Error('The recovered transaction hash is unreadable. The saved purchase is unchanged.');
          journal.clear();onStatus({phase:'confirmed',hash:result.hash,message:'This batch was already accepted. No new transaction was sent.'});return {accepted:true,hash:result.hash};
        }
        if(result.hash&&/^0x[0-9a-f]{64}$/i.test(result.hash))hash=result.hash;
        else return {accepted:false,message:'No transaction hash is available yet. Check your wallet activity and paste its public hash here. An expired or unknown quote does not prove that no transaction was sent.'};
      }
      onStatus({phase:'chain',hash,message:'Checking the saved transaction only. No wallet payment is being requested.'});
      // A pasted hash is untrusted until the service binds its receipt to this exact
      // quote, wallet and calldata. It must not replace the saved wallet reference.
      let result;
      try{result=await recordBatchConfirmation(hash,record);}
      catch(error){
        // The saved transaction may have lost to another acceptance of the same authorization.
        // Only the service's own quote check may release this journal, never a pasted hash or a guess.
        if(error?.status!==409)throw error;
        const recovered=await api('/api/socks/quotes/'+encodeURIComponent(record.quoteId));
        sameBatchAccount(owner,session);
        if(recovered.quoteId?.toLowerCase()!==record.quoteId.toLowerCase()||recovered.state!=='accepted'||!/^0x[0-9a-f]{64}$/i.test(recovered.hash||''))throw error;
        journal.clear();onStatus({phase:'confirmed',hash:recovered.hash,message:'This batch was accepted in another transaction. No new transaction was sent.'});
        return {accepted:true,hash:recovered.hash};
      }
      if(result.reverted===true){
        sameBatchAccount(owner,session);
        if(!record.hash)throw Error('That pasted transaction reverted, but it does not prove that an earlier wallet request was never sent. Keep checking the original purchase or supply its accepted transaction hash.');
        journal.clear();return {accepted:false,reverted:true,hash,message:'The saved transaction reverted, confirmed after two more blocks. No socks were purchased by that transaction. Network fees may still have been paid. Review a new quote to retry.'};
      }
      sameBatchAccount(owner,session);journal.clear();
      onStatus({phase:'confirmed',hash,message:'Batch accepted. No new transaction was sent.'});return {accepted:true,hash};
    });
  }
  return {connect,transact,mintJournal,recoverMint,get address(){return address;},providers:()=>[...providers.values()].map(p=>({id:p.info.uuid,name:p.info.name})),disconnect:changed};
}
