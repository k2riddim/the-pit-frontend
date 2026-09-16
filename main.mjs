import {api,post,units,decimalWei,shortAddress,safeImage} from './api.mjs';
import {createWallet} from './wallet.mjs';
import {createArenaPlayer} from './arena-player.mjs';
import {parseInscriptionList,importCollection} from './collection-import.mjs';
import {setupOwnership} from './ownership-ui.mjs';
import {mintProgress,mintProtocol,mintQuantity,batchMintEstimate,validateBatchMintQuote,mintRequestId,withMintLock} from './mint-state.mjs';
import {entryReadiness,preparationState,fighterDraft,fighterChanges,createProfileRequestGate} from './fighter-state.mjs';
import {ultimateChoiceOptions,ultimateChoicePresentation} from './fighter-view.mjs';
import {hasPendingJackpot} from './room-state.mjs';
import {launchActions,launchCashCopy} from './launch-state.mjs';
import {landingView} from './landing-state.mjs';
import {createAvatarPicture,setAvatarImage} from './avatar-image.mjs';
import {combatStats,describeEvent,phaseAt} from '/arena/readability.mjs';
import {ultimateStatus} from '/arena/ultimate-art.mjs';
import {HZ} from '/arena/core.mjs';
import {composeSock,isValidKey} from '/sock/sock-any.js';

const $=id=>document.getElementById(id);
const state={config:null,me:null,rooms:[],room:null,launch:null,socks:null,mintDraft:null,mintRecoveryError:null,view:'play',busy:false,polling:false,replayRoom:null,renderedTick:-1,profileDirty:false,profileSaveUncertain:false,profileDraftRevision:0,preparation:null,preparationChecks:0};
const profileRequests=createProfileRequestGate();
const avatarUrls=new Map();
const node=(tag,content,className)=>{const el=document.createElement(tag);if(content!==undefined)el.textContent=String(content);if(className)el.className=className;return el;};
const pit=n=>units(n)+' PIT';
const exactPit=n=>units(n,18,18)+' PIT';
const stamp=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(Math.floor(n%60)).padStart(2,'0');
let readErrorView=null;
function status(message,error=false,view=null){readErrorView=error?view:null;$('status').textContent=message;$('status').classList.toggle('error',error);}
function clearReadError(view){if(readErrorView===view)status('');}
function explain(error){return error?.code===4001||error?.code==='ACTION_REJECTED'?'You closed the wallet request. Check your activity if an earlier step was already sent.':error?.message||'That did not work. No new action was started.';}
async function action(work){if(state.busy)return;state.busy=true;document.body.setAttribute('aria-busy','true');updateEntry();try{await work();}catch(error){status(explain(error),true);}finally{state.busy=false;document.body.removeAttribute('aria-busy');updateEntry();}}
function option(select,value,label){const o=node('option',label);o.value=value;select.append(o);}
function img(src,alt=''){return createAvatarPicture(src,{label:alt});}
const focusPicture=node('span',undefined,'avatar-picture'),focusPictureNote=node('small',undefined,'avatar-picture-note');
const focusFace=$('focus-face');focusFace.replaceWith(focusPicture);focusPicture.append(focusFace,focusPictureNote);focusPictureNote.hidden=true;
function avatarSource(avatar){
  const a=avatar?.avatar||avatar||{};if(a.image)return safeImage(a.image);
  if(!isValidKey(a.key))return '';
  const key=String(a.key);if(!avatarUrls.has(key))avatarUrls.set(key,URL.createObjectURL(new Blob([composeSock(a.key,{size:'l',idPrefix:'pit-face-'+key})],{type:'image/svg+xml'})));
  return avatarUrls.get(key);
}
const profiles=()=>state.me?.fighters || (state.me?.profile?[state.me.profile]:[]);
const chosenFighter=()=>profiles().find(p=>String(p.id)===$('play-fighter').value)||profiles()[0];
const roomPlayers=room=>room?.roster||room?.players||[];
const wallet=createWallet(()=>state.config,address=>{
  profileRequests.sessionChanged();
  state.socks=null;state.mintDraft=null;state.mintRecoveryError=null;
  $('connect').textContent=address?shortAddress(address):'Connect wallet';
  if(!address||state.me?.address?.toLowerCase()!==address){state.me=null;state.profileDirty=false;state.profileSaveUncertain=false;state.profileDraftRevision++;state.preparation=null;state.preparationChecks=0;$('save-status').textContent='';renderMe();if(!address)status('The wallet changed. Connect again before a new action.');}
});
for(const id of ['play-ultimate','fighter-ultimate']){$(id).replaceChildren();for(const choice of ultimateChoiceOptions)option($(id),choice.id,choice.name);}
function readFighterDraft(){return fighterDraft({name:$('fighter-name').value,note:$('fighter-note').value,avatarId:$('fighter-avatar').value,ultimateChoice:$('fighter-ultimate').value});}
function renderUltimateChoices(){
  const profile=state.me?.profile,chosen=chosenFighter(),editable=Boolean(profile&&chosen&&String(chosen.id)===String(profile.id));
  const choice=editable?$('fighter-ultimate').value:chosen?.ultimateChoice||'auto';
  $('play-ultimate').value=choice;
  $('play-ultimate').disabled=!wallet.address||!editable||state.busy;
  $('fighter-ultimate').disabled=!wallet.address||!profile||state.busy;
  for(const prefix of ['play','fighter'])$(prefix+'-ultimate-detail').textContent=ultimateChoicePresentation($(prefix+'-ultimate').value||'auto').detail;
  const changes=fighterChanges(profile||{},readFighterDraft());
  $('save-ultimate').hidden=!editable||!state.profileDirty||changes.other||state.profileSaveUncertain;
  $('save-ultimate').disabled=!wallet.address||state.busy||!changes.ultimate;
  $('review-fighter-draft').hidden=!editable||!state.profileDirty||!changes.other&&!state.profileSaveUncertain;
  $('play-ultimate-state').textContent=!wallet.address?'Connect to save a spell.':!editable?'Edit this fighter in My fighter.':
    state.profileSaveUncertain?'The save could not be confirmed. Review and save your fighter before entering.':state.profileDirty?(changes.other?'Your name, note or face also has unsaved changes. Review and save them in My fighter.':'Unsaved choice. Save it before entering.'):
    'Saved for your next entry. Already joined rooms keep their original spell.';
}
function editFighterDraft(){
  state.profileDraftRevision++;if(!state.saving)$('save-fighter').textContent=SAVE_LABEL;
  state.profileDirty=state.profileSaveUncertain||!state.me?.profile||fighterChanges(state.me.profile,readFighterDraft()).dirty;
  updateEntry();
}
function selectUltimate(source){
  const choice=$(source).value;ultimateChoicePresentation(choice);
  $('fighter-ultimate').value=choice;$('play-ultimate').value=choice;
  editFighterDraft();
}
function transactionStatus(info){
  $('transaction').hidden=false;$('transaction-message').textContent=info.message;
  const base=state.config?.chain?.explorerUrl;
  $('transaction-link').hidden=!info.hash||!base;
  if(info.hash&&base)$('transaction-link').href=base.replace(/\/$/,'')+'/tx/'+info.hash;
}
function quoteDetails(quote,title){
  $('quote-title').textContent=title;const box=$('quote-detail');box.replaceChildren();
  const batch=quote.kind==='mint-batch';
  const fields=batch?[['Surprise socks',quote.quantity],['Free mints',quote.freeMints],['Paid mints',quote.paidMints],['Each paid sock',units(quote.mintPriceWei,18,18)+' ETH'],['Exact mint total',units(quote.ethWei,18,18)+' ETH']]:[['Cost',quote.costWei!==undefined?exactPit(quote.costWei):quote.stakeWei!==undefined?exactPit(quote.stakeWei):quote.room?.stakeWei!==undefined?exactPit(quote.room.stakeWei):null],['ETH',quote.ethWei!==undefined?units(quote.ethWei,18,18)+' ETH':quote.transaction?.value&&BigInt(quote.transaction.value)>0n?units(quote.transaction.value,18,18)+' ETH':null],['You receive',quote.pitWei!==undefined?exactPit(quote.pitWei):null]];
  fields.push(['Good until',quote.expiresAt?new Date(Number(quote.expiresAt)*(Number(quote.expiresAt)<1e12?1000:1)).toLocaleString():null]);
  for(const [name,value] of fields){if(value===null)continue;const row=node('div',undefined,'quote-line');row.append(node('span',name),node('strong',value));box.append(row);}
  if(batch){
    box.append(node('p','Network fees are separate, even when the mint total is 0 ETH. Two free mints total belong to the verified Bitcoin wallet, not to each collection or each linked game wallet.','small'));
    box.append(node('p','Each sock has its own delivery record. A refunded paid sock credits its mint ETH; an undelivered free sock restores its free allowance, not an ETH payment.','small'));
    if(quote.contractWalletWarning)box.append(node('p',typeof quote.contractWalletWarning==='string'?quote.contractWalletWarning:'The NFTs go directly to this contract wallet without a receiver callback. Check that the wallet can transfer ERC-721 tokens before confirming.','notice'));
  }
  if(quote.ultimateChoice!==undefined){const row=node('div',undefined,'quote-line');row.append(node('span','Ultimate for this room'),node('strong',ultimateChoicePresentation(quote.ultimateChoice).name));box.append(row,node('p','This spell is locked for this entry. Later fighter edits only affect new entries.','small'));}
  if(quote.message)box.append(node('p',quote.message,'small'));
  if(state.config?.testnet)box.append(node('p',batch?'Testnet ETH only. This mint has a fixed ETH price.':$('pricing-note').textContent||'Testnet coins only. Dollar labels are test references, not cash values.','small'));
  if(!box.childNodes.length)box.append(node('p','Check the action and amount in your wallet before signing.'));
}
async function confirmQuote(quote,title,{beforePayment}={}){
  quoteDetails(quote,title);const dialog=$('quote-dialog');dialog.returnValue='cancel';dialog.showModal();
  const accepted=await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));
  if(!accepted)return false;
  beforePayment?.();
  await wallet.transact(quote,transactionStatus);await refreshMe();return true;
}
function updateEntry(){
  const entry=entryReadiness({address:wallet.address,profile:chosenFighter(),config:state.config,dirty:state.profileDirty,preparation:state.preparation,busy:state.busy});
  $('enter').disabled=!entry.ready;$('join-room').disabled=!entry.ready;
  $('entry-note').textContent=entry.message;
  for(const button of document.querySelectorAll('[data-free-sock]'))button.disabled=state.busy||!state.config;
  renderMintDesk();
  const launch=launchActions(state.launch,{connected:Boolean(wallet.address),configured:Boolean(state.config?.contracts?.sale)&&state.config?.features?.sale!==false,busy:state.busy});
  $('buy-pit').disabled=!launch.buy;
  for(const [id,capability] of [['launch-collect','collect'],['launch-refund','refund'],['launch-excess','excess'],['launch-graduate','graduate']]){$(id).hidden=!launchActions(state.launch,{connected:Boolean(wallet.address),configured:Boolean(state.config?.contracts?.sale)&&state.config?.features?.sale!==false})[capability];$(id).disabled=!launch[capability];}
  $('save-fighter').disabled=!wallet.address||state.busy||state.saving;
  renderUltimateChoices();
}
function showPreparation(value,{resume=false}={}){
  const next=preparationState(value);if(!next)return;
  if(next.jobId!==state.preparation?.jobId||resume)state.preparationChecks=0;
  state.preparation=next;
  // Everything the brain does stays behind the save button: one short line says where the save stands.
  $('save-status').textContent=['queued','running'].includes(next.status)?SAVING_MESSAGE:next.status==='ready'?'Saved.':'Saved, but your note could not be prepared: '+next.message+' Save again in a moment, or leave the note blank.';
  updateEntry();
}
async function checkPreparation({manual=false}={}){
  const job=state.preparation;if(!wallet.address||!job?.jobId||!['queued','running'].includes(job.status))return;
  if(manual)state.preparationChecks=0;
  if(state.preparationChecks>=60){$('save-status').textContent='Still saving in the background. You can leave this page and come back later.';return;}
  state.preparationChecks++;
  const response=await api('/api/fighter/compile/'+encodeURIComponent(job.jobId));
  if(state.preparation?.jobId!==job.jobId)return;
  showPreparation(response);
  if(state.preparation?.status==='ready'||state.preparation?.status==='failed')await refreshMe();
}
function renderMe(){
  const me=state.me;
  // The prepared plan read back in one plain sentence, then the warnings the compiler gave. No labels, no numbers.
  $('wallet-balance').textContent=me?pit(me.balances?.pitWei)+' · '+units(me.balances?.ethWei,18,5)+' ETH':'Your wallet holds your coins.';
  $('admin-link').hidden=!me?.admin;$('admin-denied').hidden=Boolean(me?.admin);$('admin-panel').hidden=!me?.admin;
  const old=$('play-fighter').value;$('play-fighter').replaceChildren();
  for(const fighter of profiles())option($('play-fighter'),fighter.id,fighter.name+(fighter.avatarId==='sock:free'?' · Free sock':''));
  if(!profiles().length)option($('play-fighter'),'','Connect for your free sock');
  if([...$('play-fighter').options].some(o=>o.value===old))$('play-fighter').value=old;
  if(!state.profileDirty){
    const profile=me?.profile;$('fighter-name').value=profile?.name||'';$('fighter-note').value=profile?.note||'';$('fighter-ultimate').value=profile?.ultimateChoice||'auto';
    $('fighter-avatar').replaceChildren();
    const avatars=me?.avatars||[];
    for(const a of avatars)option($('fighter-avatar'),a.id,a.id==='sock:free'?'Free sock · no NFT needed':a.name||a.id);
    if(!avatars.length&&profile?.avatar){option($('fighter-avatar'),profile.avatarId||profile.avatar.id||'current',profile.avatar.name||'Current verified face');}
    if(!avatars.length&&!profile?.avatar)option($('fighter-avatar'),'sock:free','Free sock · no NFT needed');
    if(profile?.avatarId)$('fighter-avatar').value=profile.avatarId;
  }
  $('collect').hidden=!me||BigInt(me.balances?.claimableWei||0)<=0n;
  $('wallet-collect').hidden=$('collect').hidden;
  $('faucet').hidden=!wallet.address||state.config?.features?.faucet!==true;
  const freeAvatar=me?.avatars?.find(a=>a.id==='sock:free')||{key:0};
  if($('free-sock-preview').dataset.key!==String(freeAvatar.key)){
    $('free-sock-preview').replaceChildren(img(avatarSource(freeAvatar),me?'Your free sock avatar':'Example free sock avatar'));
    $('free-sock-preview').dataset.key=String(freeAvatar.key);
  }
  if(!$('collect').hidden)$('collect').textContent='COLLECT '+pit(me.balances.claimableWei)+' ↗';
  updateEntry();
}
async function refreshMe(){
  if(!wallet.address)return false;
  const read=profileRequests.beginRead(wallet.address);
  const response=await api('/api/me');
  if(!profileRequests.acceptRead(read,wallet.address))return false;
  if(response.address?.toLowerCase()!==wallet.address){wallet.disconnect();throw new Error('The game sign-in does not match your connected wallet. Reconnect.');}
  state.me=response;
  if(state.profileSaveUncertain){state.profileSaveUncertain=false;state.profileDirty=fighterChanges(response.profile,readFighterDraft()).dirty;}
  renderMe();
  if(response.preparation)showPreparation(response.preparation);
  else if(response.profile?.preparation)showPreparation(response.profile.preparation);
  return true;
}
async function saveFighter({choiceOnly=false}={}){
  if(!wallet.address||!state.me?.profile)throw new Error('Connect and load your fighter before saving.');
  const draft=readFighterDraft(),previous=state.me.profile;
  const changes=fighterChanges(previous,draft);
  if(choiceOnly&&changes.other)throw new Error('Review your unsaved name, note or face in My fighter before saving.');
  if(choiceOnly&&!changes.ultimate)return false;
  if(!$('fighter-form').reportValidity())return false;
  const session=profileRequests.beginSave(wallet.address),revision=state.profileDraftRevision;
  // The button greys out and says so until the save and its background preparation are done: no second click, no doubt.
  state.profileDirty=true;state.saving=true;$('save-fighter').textContent='SAVING…';$('save-status').textContent=SAVING_MESSAGE;updateEntry();
  let response,saved=false;
  try{
    try { response=await post('/api/fighter',choiceOnly?{name:previous.name,note:previous.note,avatarId:previous.avatarId,ultimateChoice:draft.ultimateChoice}:draft); }
    catch(error){if(profileRequests.sameSession(session,wallet.address)){state.profileSaveUncertain=true;state.profileDirty=true;}throw error;}
    if(!profileRequests.sameSession(session,wallet.address))return false;
    profileRequests.invalidateReads();
    if(!response.profile||String(response.profile.id)!==String(previous.id)){state.profileSaveUncertain=true;state.profileDirty=true;throw new Error('The saved fighter could not be verified. Your draft is kept. Reload your fighter before entering.');}
    const profile=response.profile,newerEdits=revision!==state.profileDraftRevision;
    state.me={...state.me,profile,...(state.me.fighters?{fighters:state.me.fighters.map(f=>String(f.id)===String(profile.id)?profile:f)}:{})};
    state.profileSaveUncertain=false;state.profileDirty=newerEdits&&fighterChanges(profile,readFighterDraft()).dirty;
    if(fighterDraft(previous).note!==fighterDraft(profile).note){state.preparation=null;state.preparationChecks=0;}
    renderMe();
    if(response.preparation)showPreparation(response.preparation,{resume:true});
    await followPreparation();
    saved=true;
    status(state.profileDirty?'Saved. Your newer edits still need saving.':choiceOnly?'Ultimate saved.':'Saved.');
    return true;
  } finally {
    state.saving=false;
    $('save-fighter').textContent=saved&&!state.profileDirty?'SAVED ✓':SAVE_LABEL;
    if(!saved)$('save-status').textContent='';
    updateEntry();
  }
}
/** Follows a preparation started by the save for up to a minute; the page keeps polling after that. */
async function followPreparation(){
  for(let i=0;i<30&&['queued','running'].includes(state.preparation?.status);i++){
    await new Promise(resolve=>setTimeout(resolve,2000));
    await checkPreparation({manual:true});
  }
  const pending=['queued','running'].includes(state.preparation?.status),profile=state.me?.profile;
  if(pending)$('save-status').textContent='Still saving in the background. You can leave this page and come back later.';
  else if(state.preparation?.status==='failed')$('save-status').textContent='Saved, but your note could not be prepared: '+state.preparation.message+' Save again in a moment, or leave the note blank.';
  else if(profile?.note?.trim()&&!profile.policyId)$('save-status').textContent='Saved, but your note is not prepared yet. Save again in a moment, or leave the note blank.';
  else $('save-status').textContent='Saved.';
}
const SAVE_LABEL='SAVE MY LITTLE WEIRDO ↗',SAVING_MESSAGE='Hang on, your weirdo is being saved.';
async function connect(){await wallet.connect($('wallet-choice').value||undefined);await refreshMe();status('Connected. Your sign-in note moved no coins.');await loadView(state.view);}
async function useFreeSock(){
  if(!wallet.address)await connect();
  const profile=state.me?.profile;
  if(!profile)throw new Error('Your fighter could not load. Reconnect before selecting an avatar.');
  // An avatar choice must not discard an unsaved name/note or cancel a prepared plan.
  if(state.profileDirty){
    if(![...$('fighter-avatar').options].some(o=>o.value==='sock:free'))option($('fighter-avatar'),'sock:free','Free sock · no NFT needed');
    $('fighter-avatar').value='sock:free';
    location.hash='#fighter';
    status('Free sock selected in your draft. Your name and note are unchanged. Save your fighter to use it.');
    updateEntry();return;
  }
  if(profile.avatarId!=='sock:free'){
    await post('/api/fighter',{name:profile.name,note:profile.note,avatarId:'sock:free'});
    await refreshMe();
  }
  player.pause();state.room=null;$('room-view').hidden=true;$('lobby').hidden=false;
  location.hash='#play';
  status(profile.note?.trim()&&!profile.policyId
    ? 'Free sock selected. Your note is not prepared yet: save your fighter again, or leave the note blank for a random plan.'
    : 'Free sock selected. No mint or Bitcoin wallet needed. Choose a room, then LET ME IN. The PIT entry is a separate approval.');
  updateEntry();
}
function renderRooms(){
  const target=$('rooms');target.replaceChildren();
  if(!state.rooms.length){target.append(node('p','Nobody in the yard yet. Start the first room.','empty'));return;}
  for(const room of state.rooms.slice(0,12)){
    const funded=room.status==='waiting'?(room.humans??roomPlayers(room).filter(p=>p.address||p.funded===true).length):6;
    const card=node('article',undefined,'room-card'),intro=node('div');intro.append(node('h3','$'+room.tierUsd+' pit'),node('p',room.status==='waiting'?funded+' of 6 places funded':room.status==='settled'?'Finished. Full receipt ready.':room.status==='refunded'?'PIT returned.':room.status==='settling'?'Result ready. Chain confirmation pending.':'Trouble in progress.'));
    const button=node('button',room.status==='waiting'?'Open room':'Watch');button.addEventListener('click',()=>action(()=>openRoom(room.id,{reveal:true})));card.append(intro,button);target.append(card);
  }
}
let renderedRooms=null;
async function refreshRooms(){const data=await api('/api/rooms');state.rooms=data.rooms||[];const next=JSON.stringify(state.rooms);if(next!==renderedRooms){renderedRooms=next;renderRooms();}}
function payoutFor(id){const values=state.room?.payouts;return Array.isArray(values)?values.find(p=>p.id===id||p.seat===id):values?.[id];}
function renderResults(images){
  const room=state.room,replay=room?.replay;if(!replay)return;
  const rows=$('results-body');rows.replaceChildren();
  const roster=roomPlayers(room),ranked=[...replay.ranking].sort((a,b)=>a.rank-b.rank);
  $('winner').textContent=(roster[ranked[0].id]?.name||'One little weirdo').toLowerCase()+' made it.';
  const confirmed=room.status==='settled',jackpotPending=hasPendingJackpot(room);
  $('result-state').textContent=confirmed?(jackpotPending?'Arena payments are confirmed. The jackpot check is still pending.':'The result is confirmed on the chain.'):room.status==='refunded'?'This room was refunded. The animation is not a payment receipt.':'The fight has a result. PIT payments are still waiting for chain confirmation.';
  for(const rank of ranked){
    const fighter=roster[rank.id]||{},payout=payoutFor(rank.id),row=node('tr');if(fighter.address?.toLowerCase()===wallet.address)row.className='your-result';
    const name=node('td');name.append(img(images?.[rank.id]||avatarSource(fighter)),node('span',fighter.name||'Fighter '+(rank.id+1)),node('small',rank.hp>0?rank.hp+' health, last one standing':'K-hole at '+stamp(rank.outAt/HZ)));
    const amount=field=>jackpotPending&&['jackpotWei','totalWei'].includes(field)?'Pending':payout?.[field]!==undefined?units(payout[field],18,18):'Pending';
    row.append(node('td',rank.rank),name,node('td',amount('pickupWei')),node('td',amount('podiumWei')),node('td',amount('jackpotWei')),node('td',amount('totalWei')));rows.append(row);
  }
  $('results-note').textContent=confirmed?(jackpotPending?'Pickups and podium amounts are confirmed. Full totals stay pending until the jackpot check finishes. You can collect already available PIT.':'Amounts above are from this room’s confirmed payment record. Collecting moves available PIT to your wallet.'):room.payouts?'Amounts shown are planned amounts, not confirmed payments.':'The game will show exact PIT amounts when its payment record is available. Pickups are not assumed to equal one PIT each.';
  renderMe();
}
let previousHistory='',frameUpdate=-1;
const player=createArenaPlayer($('arena'),data=>{
  if(!state.room?.replay)return;
  const {frame,feedback,seconds,selected,running,duration,roster,images}=data;
  $('scrub').max=String(duration);$('scrub').value=String(seconds);$('elapsed').textContent=stamp(seconds);
  $('pause').textContent=running?'Pause':seconds>=duration?'Replay':'Play';$('survivors').textContent=phaseAt(state.room.replay,seconds).label+' · '+frame.fighters.filter(f=>f.hp>0).length+' still up';
  $('result').hidden=seconds<duration;
  const key=frame.tick+':'+selected;if(frameUpdate===key)return;frameUpdate=key;
  const f=frame.fighters[selected],stats=combatStats(f);
  setAvatarImage($('focus-face'),images[selected],{label:roster[selected].name,caption:focusPictureNote});$('focus-name').textContent=roster[selected].name;$('focus-health').value=f.hp;$('focus-hp').textContent=f.hp;$('focus-power').value=stats.maxPower;$('focus-power-value').textContent=stats.minPower+'–'+stats.maxPower;
  $('focus-gear').textContent=f.hp<=0?'K-hole':f.shield+' protection · '+(f.equipment==='wheels'?'Wheels':f.equipment==='mallet'?'Armed':'No gear');
  const ultimate=ultimateStatus(f,frame.tick);$('focus-ultimate').hidden=!ultimate;
  if(ultimate){$('focus-ultimate-text').textContent=ultimate.name+' · '+(f.hp<=0?'K-hole':f.ultimatePhase==='charging'?'Charging':f.ultimatePhase==='spent'?'Used':ultimate.phase);$('focus-ultimate-text').title=ultimate.text;$('focus-ultimate-meter').value=ultimate.charge;$('focus-ultimate-meter').setAttribute('aria-valuetext',ultimate.text);}
  $('note-owner').textContent=roster[selected].name+"'S NOTE";$('note').textContent=roster[selected].note||'No note. Going with the moment.';
  for(const fighter of frame.fighters){const row=$('roster').children[fighter.id];if(!row)continue;row.setAttribute('aria-pressed',String(fighter.id===selected));row.dataset.out=String(fighter.hp<=0);row.querySelector('i').style.width=fighter.hp+'%';row.querySelector('.fighter-stats').textContent=fighter.hp<=0?'K-hole':fighter.hp+' HP';const spell=ultimateStatus(fighter,frame.tick),line=row.querySelector('.fighter-ultimate');line.hidden=!spell;line.textContent=spell?'✦':'';line.dataset.phase=fighter.hp<=0?'out':fighter.ultimatePhase||'charging';line.title=spell?.text||'';line.setAttribute('aria-label',spell?.text||'');row.setAttribute('aria-label','Follow '+roster[fighter.id].name+', '+fighter.hp+' health, '+fighter.coins+' pickups'+(spell?', '+spell.text:''));}
  const historyKey=selected+':'+feedback.history.map(e=>e.id).join(',');
  if(historyKey!==previousHistory){previousHistory=historyKey;$('history').replaceChildren();for(const e of feedback.history.slice(0,8)){const li=node('li'),button=node('button');const description=describeEvent(e,state.room.replay);button.append(node('time',stamp(e.tick/HZ)),node('strong',description?.title||e.type.toUpperCase()),node('span',description?.detail||e.value?.text||'Watch this moment again.'));button.addEventListener('click',()=>{player.seek(Math.max(0,e.tick/HZ-.4));player.play();});li.append(button);$('history').append(li);}}
},item=>{$('object-card').hidden=false;$('object-tag').textContent=item.tag;$('object-name').textContent=item.name;$('object-detail').textContent=item.detail;$('object-used').textContent=item.used?'Your followed fighter has used this. Other fighters still can.':'Tap a fighter to follow their next find.';});
async function renderRoom(){
  const room=state.room;$('lobby').hidden=true;$('room-view').hidden=false;
  $('room-id').textContent='ROOM '+room.id;$('room-title').textContent='$'+room.tierUsd+' pit';
  $('room-state').textContent=room.status==='waiting'?'Waiting for six funded places.':room.status==='settled'?'Finished. Chain payment record confirmed.':room.status==='refunded'?'This room was refunded.':room.status==='settling'?'Fight calculated. Chain payment confirmation pending.':'The plans are locked. Let the trouble unfold.';
  const hasReplay=Boolean(room.replay?.frames?.length);$('waiting-room').hidden=hasReplay;$('replay-layout').hidden=!hasReplay;
  const participant=roomPlayers(room).some(f=>f.address?.toLowerCase()===wallet.address);
  $('room-refund').hidden=!wallet.address||room.canRefund!==true;
  $('leave-room').hidden=!wallet.address||!participant||room.status!=='waiting';
  if(!hasReplay){
    player.pause();
    $('waiting-players').replaceChildren();for(let i=0;i<6;i++){const seat=roomPlayers(room)[i];$('waiting-players').append(node('li',seat?.address||seat?.funded===true?seat.name:'Waiting for a funded fighter'));}
    $('waiting-note').textContent=room.message||'The room starts when all six places are paid. If the house cannot fund a bot, the place waits for another player.';
    $('join-room').hidden=room.status!=='waiting'||!wallet.address||roomPlayers(room).some(f=>f.address?.toLowerCase()===wallet.address);return;
  }
  if(state.replayRoom!==room.id){
    const roster=roomPlayers(room).map((f,i)=>({...f,id:i}));
    await player.load(room.replay,roster);state.replayRoom=room.id;frameUpdate=-1;previousHistory='';$('roster').replaceChildren();
    for(const fighter of roster){const row=node('button',undefined,'fighter-row');row.style.setProperty('--seat',['#cf3634','#a43287','#2968b6','#387746','#9c7020','#486266'][fighter.id]);row.setAttribute('aria-pressed','false');row.setAttribute('aria-label','Follow '+fighter.name);const detail=node('span');detail.append(node('strong',fighter.name));const hp=node('span',undefined,'hp');hp.append(node('i'));const ultimate=node('small','','fighter-ultimate');ultimate.hidden=true;detail.append(hp,node('small','100 HP','fighter-stats'),ultimate);row.append(node('span',fighter.id+1),img(avatarSource(fighter),fighter.name),detail);row.addEventListener('click',()=>player.select(fighter.id));$('roster').append(row);}
    renderResults();player.play();
  }else renderResults();
}
async function openRoom(id,{reveal=false}={}){
  state.room=await api('/api/rooms/'+encodeURIComponent(id));if(state.room.room)state.room=state.room.room;await renderRoom();
  // Only the explicit Open/Watch action moves the page. Live updates keep the reader's position.
  if(reveal&&state.view==='play'&&state.room?.id===id)$('room-view').querySelector('.room-heading').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
}
async function enterRoom(id){
  const readiness=entryReadiness({address:wallet.address,profile:chosenFighter(),config:state.config,dirty:state.profileDirty,preparation:state.preparation});
  if(!readiness.ready)throw new Error(readiness.message);
  const fighter=chosenFighter();if(!fighter)throw new Error('Save a fighter first.');
  const session=profileRequests.captureSession(wallet.address),revision=state.profileDraftRevision;
  const snapshot=JSON.stringify({...fighterDraft(fighter),id:fighter.id,policyId:fighter.policyId});
  const beforePayment=()=>{
    const current=chosenFighter();
    if(!profileRequests.sameSession(session,wallet.address)||state.profileDirty||revision!==state.profileDraftRevision||!current||snapshot!==JSON.stringify({...fighterDraft(current),id:current.id,policyId:current.policyId}))
      throw new Error('Your fighter or wallet changed while the quote was open. No entry was approved. Review your fighter and request a fresh quote.');
  };
  const quote=await post(id?'/api/rooms/'+encodeURIComponent(id)+'/join':'/api/rooms',{tierUsd:Number(document.querySelector('[name=tier]:checked').value),fighterId:fighter.id,policyId:fighter.policyId});
  beforePayment();
  if(quote.room&&quote.transaction===undefined&&quote.transactions===undefined){state.room=quote.room;await renderRoom();status(quote.message||'Room created. Waiting for the payment quote.');return;}
  if(await confirmQuote(quote,'Your place in the pit',{beforePayment}))await openRoom(quote.roomId||quote.room?.id||id);
}
function renderMintRules(protocol,data){
  $('socks-rules-price').textContent=protocol==='batch-v2'
    ?'The ETH price per paid sock is fixed in the contract and does not change with dollar prices. '+(data?.mintPriceWei?units(data.mintPriceWei,18,18)+' ETH per paid sock. ':'')+'Final pictures arrive after their draw, with no later reveal. Network fees are extra.'
    :'A surprise sock costs $20 paid in ETH. Review the exact ETH quote before paying. The finished picture arrives automatically after its draw, with no later reveal.';
  $('socks-rules-cap').textContent=protocol==='batch-v2'
    ?'Mint 1 to 10 socks in one transaction, with no lifetime wallet mint cap. Verified affiliated Bitcoin wallets get two free NFT mints in total, shared across collections and linked game wallets. Free mints still need network fees.'
    :'Two lifetime buys per wallet, or ten in total with a proven approved collection. Sending socks away does not reset your count.';
}
function syncMintPending(){
  state.mintDraft=null;state.mintRecoveryError=null;
  if(state.config?.mintProtocol!=='batch-v2'||!wallet.address)return;
  try{state.mintDraft=wallet.mintJournal().get();}catch(error){state.mintRecoveryError=explain(error);}
}
function renderMintPending(){
  const draft=state.mintDraft,error=state.mintRecoveryError,submitted=['submitting','sent'].includes(draft?.phase);
  $('mint-pending').hidden=!draft&&!error;
  $('mint-pending-title').textContent=error?'Your saved purchase needs checking.':submitted?'One purchase to check.':'Your unsent quote is saved.';
  $('mint-pending-message').textContent=error||(!draft?'':draft.phase==='quoting'?'The quote request is saved. Resume this same request; no wallet transaction has been requested.':draft.phase==='quoted'?'Review this saved quote to continue. Nothing is sent automatically. If it expires, discard this unsent quote before asking for a new one.':draft.hash?'Check this saved transaction for confirmation. This does not request another payment.':'A wallet request may have been submitted. Check wallet activity before doing anything else. This site will not resend it, even if the quote expires.');
  $('mint-pending-reference').textContent=draft?(draft.hash?'Transaction: '+draft.hash:draft.quoteId?'Quote: '+draft.quoteId:'Request: '+draft.requestId):'';
  $('mint-hash-entry').hidden=!submitted||Boolean(draft.hash);
  $('mint-resume').hidden=!draft;
  $('mint-resume').textContent=draft?.phase==='quoting'?'Resume this quote request':draft?.phase==='quoted'?'Review this saved quote':'Check this purchase';
  $('mint-discard').hidden=!draft||submitted;
  $('mint-discard').disabled=state.busy;
}
function renderMintDesk(){
  syncMintPending();renderMintPending();
  let protocol;try{protocol=mintProtocol(state.config,state.socks);}catch(error){$('mint-price').textContent='Mint unavailable.';$('mint-description').textContent=explain(error);$('mint-sock').disabled=true;return;}
  const batch=protocol==='batch-v2',data=state.socks;
  $('mint-batch-controls').hidden=!batch;
  $('mint-price').textContent=!data?'Checking the mint.':batch?'One fixed ETH price.':'$20, paid in ETH.';
  $('mint-description').textContent=!data?'The exact terms must load before a wallet request can start.':batch
    ?'Every paid sock uses the same immutable ETH price. No dollar conversion is made at purchase. Your final socks arrive separately after their draws, without another payment or signature.'
    :'Your wallet shows the exact ETH amount before you pay. The final sock arrives after its draw. No second signature. No later reveal.';
  $('sock-cap-label').textContent=batch?'Per transaction':'Your limit';
  $('sock-cap').textContent=batch?'1 to 10; no lifetime cap':data?.cap===undefined?'Checking…':data.cap+' total';
  if(state.config)renderMintRules(protocol,data);
  let estimate=null;
  $('mint-estimate-error').textContent='';
  if(batch){
    if(state.mintDraft)$('mint-quantity').value=String(state.mintDraft.expected.quantity);
    $('mint-estimate-context').hidden=!state.mintDraft;
    $('mint-allowance').textContent=!wallet.address?'Connect your game wallet to check your allowance.':!data?'Checking your allowance.':data.freeEligibility==='verified'
      ?data.freeRemaining+' of 2 free mints available for your verified Bitcoin wallet. Pending free mints already count against this allowance.'
      :data.freeEligibility==='unlinked'?'No affiliated Bitcoin wallet is verified for this session. This quote is fully paid. Verify ownership first if you want to use an available free allowance.'
      :data.freeEligibility==='checking'?'Check in progress'+(data.checking?': '+data.checking.scanned+' of '+data.checking.total+' outputs':'')+'. The free allowance appears when it completes.'
      :data.freeEligibility==='relink'?'Your Bitcoin link has expired or changed. Verify it again, or unlink it, in My fighter before this mint is priced. Nothing is charged meanwhile.'
      :'Ownership checks are unavailable. The site will not replace free mints with paid ones.';
    $('mint-verify-btc').hidden=data?.freeEligibility==='verified';
    try{estimate=state.mintDraft?.expected||batchMintEstimate(data,$('mint-quantity').value);}catch(error){if(data)$('mint-estimate-error').textContent=explain(error);}
    $('mint-free-count').textContent=estimate?String(estimate.freeMints):'Unavailable';
    $('mint-paid-count').textContent=estimate?String(estimate.paidMints):'Unavailable';
    $('mint-unit-price').textContent=estimate?units(estimate.mintPriceWei,18,18)+' ETH':'Unavailable';
    $('mint-total').textContent=estimate?units(estimate.ethWei,18,18)+' ETH':'Unavailable';
  }
  $('mint-quantity').disabled=state.busy||Boolean(state.mintDraft)||!data;
  const contract=batch?state.config?.contracts?.socksBatch:state.config?.contracts?.socks;
  $('mint-sock').disabled=!wallet.address||!contract||!data||data.mintOpen===false||state.config?.features?.socks===false||state.busy||Boolean(state.mintDraft)||Boolean(state.mintRecoveryError)||batch&&!estimate;
  $('mint-sock').textContent=batch?'REVIEW '+(estimate?.quantity||'MY')+' SOCK'+(estimate?.quantity===1?'':'S')+' ↗':'FIND MY SOCK ↗';
  $('mint-resume').disabled=state.busy||!wallet.address;
  $('mint-refund').disabled=state.busy||!wallet.address;
  $('mint-legacy-refund').disabled=state.busy||!wallet.address;
}
function requireBatchMint({purchase=true}={}){
  if(mintProtocol(state.config,purchase?state.socks:undefined)!=='batch-v2'||purchase&&(state.config?.features?.socks===false||state.socks?.mintOpen===false))
    throw Error('Batch minting is not available. Refresh before reviewing a purchase.');
  return wallet.mintJournal();
}
async function requestSavedMintQuote(journal){
  return withMintLock(journal.scope,async()=>{
    const saved=journal.get();
    if(!saved||saved.phase!=='quoting')throw Error('This quote changed in another tab. Check the saved purchase before continuing.');
    const quote=await post('/api/socks/quote',{quantity:saved.expected.quantity,requestId:saved.requestId});
    if(wallet.mintJournal().key!==journal.key)throw Error('The wallet changed. Your original wallet keeps its saved quote request.');
    validateBatchMintQuote(quote,saved.expected,journal.scope);
    const current=journal.get();
    if(current?.requestId!==saved.requestId||current.phase!=='quoting')throw Error('The saved purchase changed. No wallet transaction was requested.');
    return journal.save({...saved,phase:'quoted',quoteId:quote.quoteId,quote});
  });
}
async function reviewSavedMint(journal){
  const saved=journal.get();
  if(!saved||saved.phase!=='quoted')throw Error('Check your existing purchase before opening another wallet request.');
  validateBatchMintQuote(saved.quote,saved.expected,journal.scope);
  if(await confirmQuote(saved.quote,saved.expected.quantity+' surprise sock'+(saved.expected.quantity===1?'':'s'),{beforePayment:()=>{
    if(requireBatchMint().key!==journal.key)throw Error('The wallet or mint configuration changed. Review from the original wallet.');
    validateBatchMintQuote(saved.quote,saved.expected,journal.scope);
  }})){
    status('Batch accepted. Each sock delivery is tracked separately below. No second mint payment is needed.');
    await loadSocks();
  }
}
async function startBatchMint(){
  const journal=requireBatchMint();
  try{
    await withMintLock(journal.scope,async()=>{
      if(journal.get())throw Error('One purchase is already saved. Resume or check it before starting another.');
      const expected=batchMintEstimate(state.socks,mintQuantity($('mint-quantity').value));
      journal.save({phase:'quoting',requestId:mintRequestId(),expected});
    });
    renderMintDesk();
    await requestSavedMintQuote(journal);renderMintDesk();
    await reviewSavedMint(journal);
  }finally{renderMintDesk();}
}
async function resumeBatchMint(){
  const journal=requireBatchMint({purchase:false});
  try{
    let saved=journal.get();
    if(!saved)throw Error('No saved purchase was found for this wallet.');
    if(['submitting','sent'].includes(saved.phase)){
      const result=await wallet.recoverMint(transactionStatus,$('mint-transaction-hash').value.trim());
      if(result.accepted||result.reverted){$('mint-transaction-hash').value='';await loadSocks();}
      if(!result.accepted)status(result.message,true);
      return;
    }
    if(saved.phase==='quoting'){requireBatchMint();saved=await requestSavedMintQuote(journal);}
    renderMintDesk();await reviewSavedMint(journal);
  }finally{renderMintDesk();}
}
async function discardUnsentMint(){
  const journal=requireBatchMint({purchase:false});
  try{
    await withMintLock(journal.scope,async()=>{
      const saved=journal.get();
      if(!saved||!['quoting','quoted'].includes(saved.phase))throw Error('A possibly submitted purchase cannot be discarded. Check its saved transaction.');
      journal.clear();
    });
    status('Unsent quote discarded. Review a fresh quote before any wallet payment.');
    await loadSocks();
  }finally{renderMintDesk();}
}
async function loadSocks(){
  const owner=wallet.address;
  let data;try{data=await api('/api/socks');}catch(error){if(owner===wallet.address){state.socks=null;renderMintDesk();}throw error;}
  if(owner!==wallet.address)return;
  try{mintProtocol(state.config,data);}catch(error){state.socks=null;renderMintDesk();throw error;}state.socks=data;
  $('sock-supply').textContent=data.minted===undefined?'Not available':data.minted+' / '+(data.maxSupply||10000);$('sock-minted').textContent=!owner?'Connect your wallet':data.mintedBy===undefined?'Not available':String(data.mintedBy);
  const progress=mintProgress(data);$('mint-status').textContent=progress.message;
  $('mint-refund').hidden=!wallet.address||progress.refund<=0n;
  $('mint-refund').textContent='RECOVER '+units(progress.refund,18,18)+' ETH ↗';
  const requestRow=request=>{const row=node('li',request.label);if(request.batchId){const reference=String(request.batchId),batch=node('small',' · Batch '+(reference.length>24?reference.slice(0,10)+'…'+reference.slice(-6):reference));batch.title=reference;batch.setAttribute('aria-label','Batch '+reference);row.append(batch);}if(request.paymentWei!==undefined&&!request.free)row.append(node('small',' · '+units(request.paymentWei,18,18)+' ETH accepted'));return row;};
  $('mint-requests').replaceChildren(...progress.requests.map(requestRow));
  const legacy=data.legacyRecovery,legacyProgress=legacy&&!legacy.unavailable?mintProgress(legacy):null;
  $('mint-legacy-recovery').hidden=!owner||!legacy||!legacy.unavailable&&!legacyProgress.requests.length&&legacyProgress.refund<=0n;
  $('mint-legacy-status').textContent=legacy?.unavailable?'Earlier purchase records are temporarily unavailable. Their delivery status and refund balance have not been assumed empty. Check again before taking action.':'These purchases keep their own delivery and recovery records.';
  $('mint-legacy-requests').replaceChildren(...(legacyProgress?.requests||[]).map(requestRow));
  $('mint-legacy-refund').hidden=!owner||!legacyProgress||legacyProgress.refund<=0n;
  $('mint-legacy-refund').textContent='RECOVER '+units(legacyProgress?.refund||0n,18,18)+' ETH ↗';
  const gallery=$('owned-socks');gallery.replaceChildren();
  for(const [socks,label] of [[data.owned||[],'SOCK #'],[legacy?.owned||[],'EARLIER SOCK #']])for(const sock of socks){const tile=node('article',undefined,'collection-item');tile.append(img(avatarSource(sock),label+sock.tokenId),node('h3',label+sock.tokenId));gallery.append(tile);}
  if(!gallery.childNodes.length)gallery.append(node('p',!wallet.address?'Connect your wallet to see your socks.':legacy?.unavailable?'Current mint inventory is empty; earlier socks could not be checked yet.':'No socks found in this wallet yet.'));
  $('sock-preview').replaceChildren(img(avatarSource(data.example||{key:0}),'Example sock, not a choice of mint result'));
  renderMintDesk();
}
async function loadLadder(){const data=await api('/api/ladder');$('ladder-body').replaceChildren();const rows=data.players||data.fighters||data.rows||[];$('ladder-empty').hidden=rows.length>0;$('ladder-empty').textContent='The ladder begins with the first finished room.';for(const [index,p] of rows.entries()){const row=node('tr');row.append(node('td',index+1),node('td',p.name),node('td',Number(p.iq||0).toFixed(2)),node('td',p.games||0),node('td',p.wins||0),node('td',units(p.earnedWei)));$('ladder-body').append(row);}}
async function loadLaunch(){
  const data=await api('/api/launch');state.launch=data;
  $('launch-cash-split').textContent=launchCashCopy(data);
  const date=value=>value?new Date(Number(value)*(Number(value)<1e12?1000:1)).toLocaleString():'Not opened';
  $('launch-raised').textContent=data.raisedWei!==undefined?units(data.raisedWei,18,18)+' ETH':'Not opened';
  $('launch-deadline').textContent=date(data.deadline||data.closesAt);
  $('launch-position').textContent=wallet.address&&data.purchasedPitWei!==undefined?exactPit(data.purchasedPitWei):'Connect your wallet';
  $('launch-contribution').textContent=wallet.address&&data.contributionWei!==undefined?units(data.contributionWei,18,18)+' ETH':'Connect your wallet';
  $('launch-excess-note').textContent=wallet.address&&data.canWithdrawExcess?'Unaccepted ETH waiting to recover: '+units(data.excessWei,18,18)+' ETH. This is separate from a failed-sale refund.':'';
  $('launch-status').textContent=data.message||({pending:'The sale has not opened yet.',active:data.canBuy?'The sale is open. Check the exact test ETH and reserved PIT before signing.':'Purchases are closed. The sale is awaiting its next contract step.',graduated:'The launch succeeded. Buyers can collect their purchased PIT.',failed:'The launch did not complete. Buyers can recover their accepted ETH.'}[data.status]||'The sale is not open.');
  $('launch-lock').textContent=data.unlockAt&&data.lpLock?'Locked until '+date(data.unlockAt)+'. Only the founder can recover this initial LP position afterward.':'The 18-month lock begins only when the initial pool is created at a successful launch.';
  $('launch-pool').textContent=data.pair&&/^0x[0-9a-f]{40}$/i.test(data.pair)?data.pair:'The initial pool has not been created.';
  updateEntry();
}
function mediaSummary(media){
  const head=media.paused?'Picture ingestion is paused: no daily fetch cap is configured. Pictures still load from the provider on demand.':media.storage==='unavailable'?'Picture storage is not connected. Pictures still load from the provider on demand.':'Picture ingestion is active. Stored originals are served before the provider.';
  return head+' Today: '+media.dailyUsed+' of '+media.dailyCap+' fetches used.'+(media.lastSafeError?' Last issue: '+media.lastSafeError+'.':'')+(media.nextRunAt?' Next run '+new Date(media.nextRunAt).toLocaleTimeString()+'.':'');
}
async function toggleCollectionState(collection){
  if(!Number.isSafeInteger(collection.version)||collection.version<1)throw Error('Refresh the collection list before changing its state.');
  try{
    await post('/api/admin/collections/'+encodeURIComponent(collection.id)+'/state',{enabled:!collection.enabled,expectedVersion:collection.version});
  }catch(error){
    if(error.status===409){await loadAdmin();throw Error('This collection changed in another session. The latest state is shown; review it before clicking again.');}
    throw error;
  }
  await loadAdmin();status('Collection updated for new checks. Its membership list was not re-uploaded.');
}
async function loadAdmin(){
  if(!state.me?.admin)return;
  const [data,media]=await Promise.all([api('/api/admin/collections'),api('/api/admin/media').catch(error=>({error:explain(error)}))]);
  $('admin-collections').replaceChildren();
  $('admin-media').textContent=media.error?'Picture ingestion status is unavailable: '+media.error:mediaSummary(media);
  for(const collection of data.collections||[]){
    const card=node('article',undefined,'admin-collection');
    card.append(node('strong',collection.name),node('code',collection.contract||collection.id+' · '+(collection.inscriptionCount??collection.inscriptionIds?.length??0)+' canonical pictures'),node('p',collection.enabled?'Active for new checks':'Not active','small'));
    const toggle=node('button',collection.enabled?'Pause new checks':'Activate new checks');
    toggle.disabled=!Number.isSafeInteger(collection.version)||collection.version<1;
    toggle.addEventListener('click',()=>action(()=>toggleCollectionState(collection)));
    card.append(toggle);
    const ingest=media.collections?.find(entry=>entry.id===collection.id);
    if(ingest){
      const c=ingest.counts;
      card.append(node('p','Pictures: '+c.ready+' ready · '+(c.pending+c.failed)+' waiting · '+c.unsupported+' unsupported · '+c.dead+' failed'+(c.conflict?' · '+c.conflict+' conflicting':'')+' · list revision '+ingest.version,'small'));
      if(c.dead+c.failed>0){const retry=node('button','Retry failed pictures');retry.addEventListener('click',()=>action(async()=>{await post('/api/admin/media/retry',{collectionId:collection.id});await loadAdmin();status('Failed pictures are queued again. Unsupported pictures stay unsupported.');}));card.append(retry);}
    }else if(collection.kind==='bitcoin-inscriptions'&&!media.error)card.append(node('p','Pictures: not queued yet. The next scheduled check queues this list.','small'));
    $('admin-collections').append(card);
  }
}
async function loadView(view){if(view==='play')await refreshRooms();if(view==='socks'||view==='rules')await loadSocks();if(view==='ladder')await loadLadder();if(view==='launch')await loadLaunch();if(view==='admin')await loadAdmin();clearReadError(view);}
function navigate(load=true){state.view=landingView(location.hash,state.config);for(const section of document.querySelectorAll('[data-view]'))section.hidden=section.dataset.view!==state.view;for(const link of document.querySelectorAll('.tabs a')){if(link.hash==='#'+state.view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}if(state.view!=='play')player.pause();if(state.config&&load){const view=state.view;loadView(view).catch(error=>{if(state.view===view)status(explain(error),true,view);});}}

$('connect').addEventListener('click',()=>action(connect));
for(const button of document.querySelectorAll('[data-free-sock]'))button.addEventListener('click',()=>action(useFreeSock));
$('enter').addEventListener('click',()=>action(()=>enterRoom()));
$('join-room').addEventListener('click',()=>action(()=>enterRoom(state.room.id)));
$('refresh-rooms').addEventListener('click',()=>action(refreshRooms));
$('back-lobby').addEventListener('click',()=>{player.pause();state.room=null;$('room-view').hidden=true;$('lobby').hidden=false;action(refreshRooms);});
$('pause').addEventListener('click',()=>{$('pause').textContent==='Pause'?player.pause():player.play();});
$('replay').addEventListener('click',()=>{player.seek(0);player.play();});
$('scrub').addEventListener('input',event=>{const targetTime=event.target.value;player.pause();player.seek(targetTime);});
$('speed').addEventListener('change',event=>player.speed(event.target.value));
$('follow').addEventListener('change',event=>player.follow(event.target.checked));
$('calm').checked=matchMedia('(prefers-reduced-motion: reduce)').matches;$('calm').addEventListener('change',event=>player.calm(event.target.checked));
$('close-object').addEventListener('click',()=>{$('object-card').hidden=true;});
$('play-fighter').addEventListener('change',updateEntry);
$('play-ultimate').addEventListener('change',()=>selectUltimate('play-ultimate'));
$('fighter-ultimate').addEventListener('change',()=>selectUltimate('fighter-ultimate'));
$('save-ultimate').addEventListener('click',()=>action(()=>saveFighter({choiceOnly:true})));
$('fighter-form').addEventListener('input',editFighterDraft);
$('fighter-form').addEventListener('submit',event=>{event.preventDefault();action(()=>saveFighter());});
$('mint-quantity').addEventListener('input',renderMintDesk);
$('mint-resume').addEventListener('click',()=>action(resumeBatchMint));
$('mint-discard').addEventListener('click',()=>action(discardUnsentMint));
$('mint-legacy-refund').addEventListener('click',()=>action(async()=>{const quote=await post('/api/socks/legacy/refund');if(await confirmQuote(quote,'Recover your earlier mint ETH')){status('Earlier mint refund confirmed.');await loadSocks();}}));
$('mint-sock').addEventListener('click',()=>action(async()=>{if(mintProtocol(state.config,state.socks)==='batch-v2')return startBatchMint();const quote=await post('/api/socks/quote');if(await confirmQuote(quote,'One surprise sock')){status('Purchase confirmed. Your final sock will arrive automatically after the draw.');await loadSocks();}}));
$('launch-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const quote=await post('/api/launch/quote',{ethWei:decimalWei($('launch-amount').value)});if(await confirmQuote(quote,'Your PIT launch purchase')){status('Purchase recorded. Your PIT is reserved until the launch succeeds.');await loadLaunch();}});});
for(const [id,path,title] of [['mint-refund','/api/socks/refund','Recover your mint ETH'],['launch-collect','/api/launch/collect','Collect your purchased PIT'],['launch-refund','/api/launch/refund','Return your accepted ETH'],['launch-excess','/api/launch/excess','Recover unaccepted launch ETH'],['launch-graduate','/api/launch/graduate','Create and lock the initial PIT pool'],['collect','/api/collect','Collect your available PIT'],['wallet-collect','/api/collect','Collect your available PIT'],['faucet','/api/faucet','Get test PIT']])$(id).addEventListener('click',()=>action(async()=>{const quote=await post(path);if(await confirmQuote(quote,title)){status('Confirmed. Your wallet balance will update after the chain check.');await loadView(state.view);}}));
for(const [id,method,title] of [['leave-room','leave','Leave this waiting room'],['refund-room','refund','Return this room’s deposited PIT']])$(id).addEventListener('click',()=>action(async()=>{const roomId=state.room.id,quote=await post('/api/rooms/'+encodeURIComponent(roomId)+'/'+method);if(await confirmQuote(quote,title)){await openRoom(roomId);status('Confirmed. Returned PIT is available to collect.');}}));
$('collection-kind').addEventListener('change',()=>{const bitcoin=$('collection-kind').value==='bitcoin-inscriptions';$('collection-bitcoin').hidden=!bitcoin;$('collection-evm').hidden=bitcoin;});
$('collection-file').addEventListener('change',()=>action(async()=>{const file=$('collection-file').files?.[0];if(!file)return;if(file.size>1500000)throw new Error('Use a collection list smaller than 1.5 MB.');const ids=parseInscriptionList(await file.text());$('collection-inscriptions').value=ids.join('\n');status(ids.length+' unique inscription IDs loaded. Review the collection before saving.');}));
$('collection-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const bitcoin=$('collection-kind').value==='bitcoin-inscriptions';const collection={id:$('collection-id').value,name:$('collection-name').value.trim(),kind:$('collection-kind').value,contract:bitcoin?undefined:$('collection-identity').value.trim(),inscriptionIds:bitcoin?parseInscriptionList($('collection-inscriptions').value):undefined,chainId:bitcoin?undefined:Number($('collection-chain').value),enabled:$('collection-active').checked};if(bitcoin)await importCollection(collection,post,(done,total)=>status('Checking collection '+done+' / '+total+'. It activates only after the full list is checked.'));else await post('/api/admin/collections',collection);await loadAdmin();status('Collection saved. New ownership checks use the updated list.');});});
setupOwnership({getContext:()=>({evmAddress:wallet.address,chainId:state.config?.chain?.id,origin:location.origin,enabled:state.config?.features?.bitcoinOwnership}),post,refreshMe,status,action});
window.addEventListener('hashchange',navigate);
window.addEventListener('storage',event=>{if(event.key===null||event.key?.startsWith('the-pit.mint-batch.v2:'))renderMintDesk();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)player.pause();});

// Landing hero: rotating slogans, real composed socks and a smooth scroll down to the sale.
{const slogans=['Let it out.','Six in. One still up.','No two bad ideas alike.','Welcome to the pit.'];let shown=0;
 if(!matchMedia('(prefers-reduced-motion: reduce)').matches)setInterval(()=>{if(!document.hidden){shown=(shown+1)%slogans.length;$('hero-slogan').textContent=slogans[shown];}},2600);
 for(const key of [2,2000000000,0])$('hero-socks').append(img(avatarSource({key})));}
$('hero-cta').addEventListener('click',()=>$('launch-sale').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}));

async function boot(){
  navigate(false);state.config=await api('/api/config');const cfg=state.config;navigate(false);if(cfg.paused)status(cfg.pausedMessage,true);
  $('network').textContent=(cfg.chain?.name||'Game network')+' · TESTNET';$('footer-network').textContent='Testnet only. Test coins, not real-money prizes.';
  if(cfg.pricing){$('pricing-note').hidden=false;$('pricing-note').textContent=cfg.pricing.source?.startsWith('Fixed test')?'Fixed test prices: $'+units(cfg.pricing.pitUsdE18,18,6)+' per test PIT and $'+units(cfg.pricing.ethUsdE18,18,6)+' per test ETH. These numbers are not live prices or cash values.':'Testnet only. Dollar labels are reference prices, not a cash value for these coins.';}
  $('jackpot-amount').textContent=cfg.jackpot?.amountWei!==undefined&&cfg.jackpot?.amountWei!==null?pit(cfg.jackpot.amountWei):'Temporarily unavailable';$('jackpot-detail').textContent=cfg.jackpot?.message||'1 in 200 completed paid rooms. One human winner.';
  const found=wallet.providers();$('wallet-choice').hidden=found.length<2;for(const p of found)option($('wallet-choice'),p.id,p.name);
  renderMe();const initialView=state.view;
  try{await loadView(initialView);status('Six fighters. One survivor. Testnet coins only.');}
  catch(error){if(state.view===initialView)status('This page could not refresh: '+explain(error),true,initialView);}
  let preparationPolling=false;
  setInterval(async()=>{
    if(document.hidden||state.busy||preparationPolling||state.preparationChecks>=60||!['queued','running'].includes(state.preparation?.status))return;
    preparationPolling=true;
    try{await checkPreparation();}catch(error){state.preparationChecks=60;$('save-status').textContent='Still saving in the background: '+explain(error);}finally{preparationPolling=false;}
  },5000);
  setInterval(async()=>{
    if(document.hidden||state.busy||state.polling)return;state.polling=true;const pollView=state.view;
    try{
      if(state.view==='socks')await loadSocks();
      else if(state.view==='launch')await loadLaunch();
      else if(state.view==='play'&&state.room){
        const id=state.room.id,hasReplay=Boolean(state.room.replay?.frames?.length);
        const response=await api('/api/rooms/'+encodeURIComponent(id)+(hasReplay?'?replay=0':'')),next=response.room||response;
        if(state.room?.id===id){
          const paymentChanged=next.status!==state.room.status||hasPendingJackpot(next)!==hasPendingJackpot(state.room);
          state.room={...state.room,...next,replay:next.status==='refunded'?null:next.replay??state.room.replay};
          if(paymentChanged&&['settled','refunded'].includes(next.status))await refreshMe();
          await renderRoom();
        }
      }else if(state.view==='play')await refreshRooms();
      clearReadError(pollView);
    }catch(error){if(state.view===pollView)status('Live updates paused: '+explain(error),true,pollView);}finally{state.polling=false;}
  },5000);
  let configPolling=false;
  setInterval(async()=>{
    if(document.hidden||state.busy||configPolling)return;configPolling=true;
    try{const latest=await api('/api/config');state.config={...state.config,...latest};if(latest.paused)status(latest.pausedMessage,true);$('jackpot-amount').textContent=latest.jackpot?.amountWei!==undefined&&latest.jackpot?.amountWei!==null?pit(latest.jackpot.amountWei):'Temporarily unavailable';$('jackpot-detail').textContent=latest.jackpot?.message||'1 in 200 completed paid rooms. One human winner.';if(landingView(location.hash,state.config)!==state.view)navigate();updateEntry();}
    catch{$('jackpot-detail').textContent='Showing the last checked jackpot. Refresh before making a new entry.';if(state.config?.launchGate?.required){state.config.launchGate={...state.config.launchGate,ready:false,message:'Launch verification is unavailable. Refresh before making a new entry.'};updateEntry();}}
    finally{configPolling=false;}
  },30000);
}
boot().catch(error=>{status('The yard could not connect: '+explain(error),true);updateEntry();});
