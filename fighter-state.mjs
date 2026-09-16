// Presentation only. The service still validates ownership, prepared notes and entry funds.
export function fighterDraft(profile = {}) {
  return { name: (profile.name || '').trim(), note: (profile.note || '').trim(),
    avatarId: profile.avatarId || profile.avatar?.id || 'sock:free', ultimateChoice: profile.ultimateChoice || 'auto' };
}

export function fighterChanges(profile, draft) {
  const saved = fighterDraft(profile), next = fighterDraft(draft);
  const other = ['name','note','avatarId'].some(key => saved[key] !== next[key]);
  const ultimate = saved.ultimateChoice !== next.ultimateChoice;
  return { dirty: other || ultimate, other, ultimate };
}

// Reads started before a save or in another wallet session must not replace newer state.
export function createProfileRequestGate() {
  let session = 0, read = 0;
  return {
    sessionChanged() { session++; read++; },
    captureSession(owner) { return { owner, session }; },
    beginSave(owner) { read++; return { owner, session }; },
    sameSession(token, owner) { return Boolean(owner) && token.owner === owner && token.session === session; },
    invalidateReads() { read++; },
    beginRead(owner) { return { owner, session, read: ++read }; },
    acceptRead(token, owner) { return Boolean(owner) && token.owner === owner && token.session === session && token.read === read; },
  };
}

export function entryReadiness({address,profile,config,dirty=false,preparation=null,busy=false}) {
  let message = 'Your wallet approves the exact PIT amount before entry.';
  let ready = true;
  if (config?.launchGate?.required && config.launchGate.ready!==true) { ready=false; message=config.launchGate.message||'New arenas open after the PIT launch is confirmed.'; }
  else if (!address) { ready=false; message='Connect your wallet to enter.'; }
  else if (!profile) { ready=false; message='Save your fighter first.'; }
  else if (!config?.contracts?.arena) { ready=false; message='The arena payment contract is not connected yet. No paid room can start.'; }
  else if (config?.features?.arena===false) { ready=false; message='New entries are paused. Existing room receipts remain available.'; }
  else if (dirty) { ready=false; message='Save your fighter changes before entering.'; }
  else if (profile.note?.trim()&&!profile.policyId) {
    ready=false;
    message=['queued','running'].includes(preparation?.status)
      ? 'Your note is being prepared. No room has been entered and no PIT has been spent.'
      : 'Prepare your saved note in My fighter, or save a blank note for a free random plan.';
  }
  return {ready:ready&&!busy,message};
}

export function preparationState(value) {
  if (!value||typeof value!=='object') return null;
  const jobId=typeof value.jobId==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value.jobId)?value.jobId:null;
  if (value.pending===true||['queued','running'].includes(value.status)) {
    if (!jobId) throw new Error('The brain request has no recovery reference. Check your saved fighter before trying again.');
    return {jobId,status:value.status==='running'?'running':'queued',message:value.message||'Your note is waiting for the test brain. No PIT has been charged.'};
  }
  if (['failed','cancelled','superseded'].includes(value.status)) return {jobId,status:'failed',message:value.message||'The note was not prepared. Retry explicitly or save a blank note for a free random plan.'};
  if (value.receipt||value.status==='completed'||value.status==='ready') return {jobId,status:'ready',message:value.message||(value.cached?'Your saved brain answer is ready to reuse.':'Answer ready. Your fighter can use its prepared plan.'),receipt:value.receipt||null};
  return null;
}

// The status line never calls a configured brain "ready" without a recent answer, and the
// request button closes when the house budget is paused or used up. The server enforces the
// same limits; this only keeps the page honest. A blank note always plays for free.
export function brainAvailability(inference) {
  const blank=' A blank note still gives a free random plan.';
  if (!inference||typeof inference!=='object'||!inference.configured) return {available:false,reason:'off',message:'The test brain is not connected.'+blank};
  const relay=inference.relay&&typeof inference.relay==='object'?inference.relay:null, provider=relay?.provider;
  if (relay?.paused===true||provider==='paused') return {available:false,reason:'paused',message:'House-paid brain answers are paused right now.'+blank};
  if (relay&&relay.dailyRemaining===0) return {available:false,reason:'budget',message:'Today\'s house-paid brain budget is used up. It resets at midnight UTC.'+blank};
  if (provider==='degraded') return {available:true,reason:'degraded',message:'The brain failed recently. A new request may be refused for a minute; failures are reported, not retried.'+blank};
  if (provider==='ready') return {available:true,reason:'ready',message:'The brain answered recently. Answers are paid by the house. Save your note, then ask the brain to read it.'};
  if (provider==='unverified') return {available:true,reason:'unverified',message:'The brain is configured, but no recent answer confirms it is reachable. Answers are paid by the house; a failure is reported, not retried.'};
  return {available:true,reason:'configured',message:inference.testOnly?'Test brain answers are paid by the house. Save your note, then ask the brain to read it.':'The brain is connected. Set your maximum spend before asking it to read your note.'};
}
