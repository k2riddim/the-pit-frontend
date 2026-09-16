import test from 'node:test';
import assert from 'node:assert/strict';
import {brainAvailability} from './fighter-state.mjs';

const relay=(overrides={})=>({configured:true,testOnly:true,relay:{online:false,configured:true,sponsored:true,paused:false,provider:'unverified',queued:0,dailyCap:100,dailyRemaining:100,lastSuccessAt:null,lastFailureAt:null,cooldownUntil:null,...overrides}});

test('a missing or unconfigured brain is closed and still offers the blank note',()=>{
  for(const value of [undefined,null,{},{configured:false},{configured:true,relay:null,paused:true}]){
    const result=brainAvailability(value);
    if(value&&value.configured)continue;
    assert.equal(result.available,false);assert.equal(result.reason,'off');assert.match(result.message,/blank note/);
  }
});
test('a paused or exhausted house budget closes the request button',()=>{
  assert.deepEqual(brainAvailability(relay({paused:true})).available,false);
  assert.equal(brainAvailability(relay({paused:true})).reason,'paused');
  assert.equal(brainAvailability(relay({provider:'paused'})).reason,'paused');
  const budget=brainAvailability(relay({dailyRemaining:0}));
  assert.equal(budget.available,false);assert.equal(budget.reason,'budget');assert.match(budget.message,/midnight UTC/);
});
test('configuration alone is never described as a reachable brain',()=>{
  const unverified=brainAvailability(relay());
  assert.equal(unverified.available,true);assert.equal(unverified.reason,'unverified');
  assert.match(unverified.message,/no recent answer/);assert.doesNotMatch(unverified.message,/answered recently/);
  const ready=brainAvailability(relay({provider:'ready',online:true}));
  assert.equal(ready.reason,'ready');assert.match(ready.message,/answered recently/);
  const degraded=brainAvailability(relay({provider:'degraded',cooldownUntil:Date.now()+60000}));
  assert.equal(degraded.available,true);assert.equal(degraded.reason,'degraded');assert.match(degraded.message,/not retried/);
});
test('a picker-only configuration keeps the historical wording',()=>{
  assert.equal(brainAvailability({configured:true,testOnly:true,relay:null}).reason,'configured');
  assert.match(brainAvailability({configured:true,testOnly:false,relay:null}).message,/maximum spend/);
  for(const value of [relay(),relay({provider:'ready'}),relay({paused:true}),{configured:true,testOnly:true}])assert.doesNotMatch(brainAvailability(value).message,/\u2014/);
});
