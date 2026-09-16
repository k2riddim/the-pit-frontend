import test from 'node:test';
import assert from 'node:assert/strict';
import {landingView} from './landing-state.mjs';
import {entryReadiness} from './fighter-state.mjs';
import {launchCashCopy} from './launch-state.mjs';

test('automatic landing is sale first, then play only on verified readiness',()=>{
  assert.equal(landingView('',null),'launch');
  for(const ready of [false,undefined])assert.equal(landingView('',{launchGate:{required:true,ready}}),'launch');
  assert.equal(landingView('',{launchGate:{required:true,ready:true}}),'play');
  assert.equal(landingView('',{launchGate:{required:false,ready:true}}),'play');
});
test('explicit pages and recovery remain reachable before and after launch',()=>{
  for(const ready of [false,true])for(const route of ['play','fighter','socks','ladder','launch','rules','manifesto','admin'])
    assert.equal(landingView('#'+route+'?review=1',{launchGate:{required:true,ready}}),route);
  assert.equal(landingView('#not-a-page',{launchGate:{required:true,ready:false}}),'launch');
});
test('written or blank prompts, wallet and existing contracts cannot bypass a closed launch',()=>{
  const config={contracts:{arena:'deployed'},features:{arena:true},launchGate:{required:true,ready:false,message:'Sale first.'}};
  for(const address of [null,'connected'])for(const note of ['','get coins']) {
    const result=entryReadiness({address,profile:{note,policyId:'prepared'},config});
    assert.equal(result.ready,false);assert.equal(result.message,'Sale first.');
  }
  assert.equal(entryReadiness({address:'connected',profile:{note:''},config:{...config,launchGate:{required:true,ready:true}}}).ready,true);
});
test('funding copy describes only the verified protocol and never guesses new terms for old contracts',()=>{
  assert.match(launchCashCopy({protocol:'production-v2',cashSplitPercent:[100,0]}),/\$5,000 of liquidity/);
  assert.doesNotMatch(launchCashCopy({protocol:'production-v2',cashSplitPercent:[100,0]}),/60%|80%|20%|\$3,000|\$4,000/);
  assert.match(launchCashCopy({protocol:'legacy-v1',cashSplitPercent:[60,20,20]}),/60%/);
  for(const data of [null,{}, {protocol:'production-v2',cashSplitPercent:[60,20,20]},{protocol:'production-v1',cashSplitPercent:[80,20]},{protocol:'production-v2',cashSplitPercent:[80,20]}])assert.match(launchCashCopy(data),/unavailable/);
});
