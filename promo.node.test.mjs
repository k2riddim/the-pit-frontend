import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PROMO_LIMITS,PROMO_MANIFEST_URL,promoRelease,fetchPromoRelease,revealPromo,setupPromo} from './promo.mjs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('./promo.mjs',import.meta.url),'utf8');
const valid=()=>({schema:'pit-promo-release-v1',cleared:true,video:'/promo/the-pit-promo.mp4',poster:'/promo/poster.jpg',videoBytes:7_000_000,posterBytes:120_000,sha256:'a'.repeat(64),posterSha256:'b'.repeat(64),durationSeconds:30.016});

class FakeElement{
  constructor(attributes={}){this.attributes=new Map(Object.entries(attributes));this.hidden=this.attributes.has('hidden');this.textContent='';}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.has(name)?this.attributes.get(name):null;}
  hasAttribute(name){return this.attributes.has(name);}
  removeAttribute(name){this.attributes.delete(name);}
}
function fakeRoot({launchHidden=true}={}){
  const elements={'promo-teaser':new FakeElement({hidden:''}),'promo-video':new FakeElement({controls:'',playsinline:'',preload:'none'}),'promo-link':new FakeElement({href:'#launch'}),'promo-seconds':new FakeElement()};
  const launch=new FakeElement(launchHidden?{hidden:''}:{});
  return {elements,launch,getElementById:id=>elements[id]||null,querySelector:selector=>selector==='[data-view="launch"]'?launch:null};
}
class FakeObserver{
  static instances=[];
  constructor(callback){this.callback=callback;this.observed=null;this.disconnected=false;FakeObserver.instances.push(this);}
  observe(target,options){this.observed={target,options};}
  disconnect(){this.disconnected=true;}
  trigger(){this.callback([]);}
}
function fetchSpy(responder){
  const calls=[];
  const fetchImpl=async(url,init)=>{calls.push({url,init});return responder(url,init);};
  return {calls,fetchImpl};
}
const jsonResponse=(body,init={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status:200,headers:{'content-type':'application/json'},...init});

test('promoRelease accepts only a cleared, bounded, same-origin release description',()=>{
  const release=promoRelease(valid());
  assert.deepEqual(release,{video:'/promo/the-pit-promo.mp4',poster:'/promo/poster.jpg',videoBytes:7_000_000,posterBytes:120_000,sha256:'a'.repeat(64),posterSha256:'b'.repeat(64),durationSeconds:30.016});
  const rejected=[
    null,undefined,[],'{}',{...valid(),cleared:false},{...valid(),cleared:'true'},{...valid(),cleared:1},
    {...valid(),video:'/other/the-pit-promo.mp4'},{...valid(),video:'/promo/../main.mjs'},{...valid(),video:'/promo/The-Pit.mp4'},
    {...valid(),video:'/promo/teaser.webm'},{...valid(),video:'https://example.test/promo/a.mp4'},{...valid(),video:'//example.test/promo/a.mp4'},
    {...valid(),poster:'/promo/poster.png'},{...valid(),poster:'/assets/poster.jpg'},
    {...valid(),videoBytes:PROMO_LIMITS.videoBytes+1},{...valid(),videoBytes:0},{...valid(),videoBytes:'7000000'},{...valid(),videoBytes:7000000.5},
    {...valid(),posterBytes:PROMO_LIMITS.posterBytes+1},{...valid(),posterBytes:-1},
    {...valid(),sha256:'A'.repeat(64)},{...valid(),sha256:'a'.repeat(63)},{...valid(),sha256:undefined},{...valid(),posterSha256:'zz'},
    {...valid(),durationSeconds:PROMO_LIMITS.minSeconds-1},{...valid(),durationSeconds:PROMO_LIMITS.maxSeconds+1},{...valid(),durationSeconds:'30'},{...valid(),durationSeconds:NaN},
  ];
  for(const manifest of rejected)assert.equal(promoRelease(manifest),null,JSON.stringify(manifest));
  assert.equal(promoRelease(valid(),{...PROMO_LIMITS,videoBytes:6_999_999}),null,'caps are enforced from the limits argument');
});

test('fetchPromoRelease reads one bounded same-origin manifest and never throws',async()=>{
  const cases=[
    ['not found',()=>new Response('',{status:404}),null],
    ['server error',()=>new Response('{}',{status:500}),null],
    ['invalid JSON',()=>jsonResponse('{not json'),null],
    ['uncleared',()=>jsonResponse({...valid(),cleared:false}),null],
    ['oversized body',()=>jsonResponse(JSON.stringify({...valid(),padding:'x'.repeat(PROMO_LIMITS.manifestBytes)})),null],
    ['declared oversized',()=>jsonResponse(valid(),{headers:{'content-length':String(PROMO_LIMITS.manifestBytes+1)}}),null],
    ['network failure',()=>{throw new Error('offline');},null],
    ['valid',()=>jsonResponse(valid()),promoRelease(valid())],
  ];
  for(const [name,responder,expected] of cases){
    const spy=fetchSpy(responder);
    assert.deepEqual(await fetchPromoRelease(spy.fetchImpl),expected,name);
    assert.equal(spy.calls.length,1,name);
    assert.equal(spy.calls[0].url,PROMO_MANIFEST_URL,name);
    assert.deepEqual(spy.calls[0].init,{cache:'no-store',credentials:'omit',redirect:'error'},name);
  }
  assert.equal(await fetchPromoRelease(undefined),null,'a missing fetch implementation resolves to null');
});

test('revealPromo hides the block without a release and reveals a validated one without autoplay or loop',()=>{
  const hidden=fakeRoot();
  assert.equal(revealPromo(null,hidden),false);
  assert.equal(hidden.elements['promo-teaser'].hidden,true);
  assert.equal(hidden.elements['promo-video'].getAttribute('src'),null,'no media source is set without a release');
  const root=fakeRoot();
  root.elements['promo-video'].setAttribute('autoplay','');root.elements['promo-video'].setAttribute('loop','');
  assert.equal(revealPromo(promoRelease(valid()),root),true);
  const video=root.elements['promo-video'];
  assert.equal(root.elements['promo-teaser'].hidden,false);
  assert.equal(video.getAttribute('src'),'/promo/the-pit-promo.mp4');
  assert.equal(video.getAttribute('poster'),'/promo/poster.jpg');
  assert.equal(video.getAttribute('preload'),'none');
  assert.equal(video.hasAttribute('autoplay'),false);assert.equal(video.hasAttribute('loop'),false);
  assert.equal(video.hasAttribute('controls'),true);assert.equal(video.hasAttribute('playsinline'),true);
  assert.equal(root.elements['promo-link'].getAttribute('href'),'/promo/the-pit-promo.mp4');
  assert.equal(root.elements['promo-seconds'].textContent,'30');
  const missing={getElementById:()=>null,querySelector:()=>null};
  assert.equal(revealPromo(promoRelease(valid()),missing),false,'a page without the block is left alone');
});

test('setupPromo requests nothing while the launch view is hidden, then exactly the manifest once',async()=>{
  FakeObserver.instances=[];
  const spy=fetchSpy(()=>jsonResponse(valid()));
  const root=fakeRoot({launchHidden:true});
  const promo=setupPromo({root,fetchImpl:spy.fetchImpl,Observer:FakeObserver});
  assert.ok(promo);assert.equal(promo.started(),false);
  assert.equal(spy.calls.length,0,'no request before the launch view appears');
  assert.equal(root.elements['promo-teaser'].hidden,true);
  const [observer]=FakeObserver.instances;
  assert.equal(observer.observed.target,root.launch);
  assert.deepEqual(observer.observed.options,{attributes:true,attributeFilter:['hidden']});
  observer.trigger();
  assert.equal(spy.calls.length,0,'a mutation that keeps the view hidden requests nothing');
  root.launch.hidden=false;observer.trigger();
  await promo.start();
  assert.equal(spy.calls.length,1);assert.equal(spy.calls[0].url,PROMO_MANIFEST_URL);
  assert.equal(observer.disconnected,true);
  assert.equal(root.elements['promo-teaser'].hidden,false);
  observer.trigger();await promo.start();
  assert.equal(spy.calls.length,1,'the manifest is read once per page; the video itself is never fetched by this module');
  const visible=fetchSpy(()=>jsonResponse(valid()));
  const shown=setupPromo({root:fakeRoot({launchHidden:false}),fetchImpl:visible.fetchImpl,Observer:FakeObserver});
  await shown.start();assert.equal(visible.calls.length,1,'an already visible launch view loads immediately');
  const none=fetchSpy(()=>jsonResponse(valid()));
  assert.equal(setupPromo({root:{getElementById:()=>null,querySelector:()=>null},fetchImpl:none.fetchImpl,Observer:FakeObserver}),null);
  assert.equal(setupPromo({root:fakeRoot(),fetchImpl:null,Observer:FakeObserver}),null,'no usable fetch means no block');
  assert.equal(none.calls.length,0);
});

test('the launch page holds one hidden teaser block with an inert video element and an optional playback caption',()=>{
  const launch=html.match(/<section data-view="launch"[\s\S]*?<\/section>/)?.[0];
  assert.ok(launch,'launch view present');
  const figure=launch.match(/<figure id="promo-teaser"[^>]*>[\s\S]*?<\/figure>/)?.[0];
  assert.ok(figure,'teaser figure present inside the launch view');
  assert.ok(launch.indexOf('<figure id="promo-teaser"')<launch.indexOf('<div class="two-column">'),'the teaser sits above the sale columns');
  assert.match(figure,/<figure id="promo-teaser" class="paper promo-teaser" hidden>/);
  const video=figure.match(/<video[^>]*>/)[0];
  for(const attribute of ['controls','playsinline','preload="none"','poster','id="promo-video"'])assert.ok(video.includes(attribute)||attribute==='poster','video has '+attribute);
  assert.doesNotMatch(video,/\bautoplay\b|\bloop\b|\bmuted\b|\bsrc=|\bposter=/,'nothing is referenced until the manifest is accepted');
  assert.match(figure,/30<\/span>-second gameplay teaser/);
  assert.match(figure,/Playback is optional/);
  assert.match(figure,/<a id="promo-link" href="#launch">/);
  assert.equal((html.match(/id="promo-teaser"/g)||[]).length,1);
  assert.match(html,/<script type="module" src="\/promo\.mjs"><\/script>/);
  assert.doesNotMatch(html,/<figure id="promo-teaser"[^>]*>[\s\S]*?<\/figure>[\s\S]*?<\/section>[\s\S]*<figure id="promo-teaser"/,'a single block only');
});

test('the promo module is self-contained, same-origin only and does not boot outside a browser',()=>{
  assert.doesNotMatch(source,/^\s*import\s/m,'no imports: the module cannot pull other code into the page');
  assert.doesNotMatch(source,/https?:\/\//,'no external hosts');
  assert.doesNotMatch(source,/—/,'no em dashes');
  assert.match(source,/typeof document!=='undefined'&&typeof fetch==='function'\)setupPromo\(\)/);
  assert.match(source,/cache:'no-store',credentials:'omit',redirect:'error'/);
});
