import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {landingView} from './landing-state.mjs';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const main=readFileSync(new URL('./main.mjs',import.meta.url),'utf8');
const review=readFileSync(new URL('../../docs/43-copy-and-manifesto-review.md',import.meta.url),'utf8');
const routes=[...html.matchAll(/<section\b[^>]*data-view="([^"]+)"/g)].map(match=>match[1]);
const manifesto=html.match(/<section data-view="manifesto"[\s\S]*?<\/section>/)?.[0];
assert.ok(manifesto,'The manifesto must be static HTML, not a wallet-gated response.');

function routingFixture({hash='#manifesto',configured=false}={}){
  const sections=routes.map(view=>({dataset:{view},hidden:view!=='play'}));
  const links=routes.map(view=>({hash:'#'+view,attributes:view==='play'?{'aria-current':'page'}:{},setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];}}));
  const state={view:'play',config:configured?{}:null,profile:{note:'Keep my note',ultimateChoice:'scrapfall'}};
  const events=[];
  const document={querySelectorAll(selector){if(selector==='[data-view]')return sections;if(selector==='.tabs a')return links;assert.fail('Unexpected selector '+selector);}};
  const source=main.slice(main.indexOf('function navigate('),main.indexOf('\n\n',main.indexOf('function navigate(')));
  const loadSource=main.slice(main.indexOf('async function loadView('),main.indexOf('\nfunction navigate('));
  const forbidden=()=>assert.fail('A manifesto read must not request a wallet, provider, payment or page data.');
  const loadView=new Function('refreshRooms','loadSocks','loadLadder','loadLaunch','loadAdmin','clearReadError','return ('+loadSource+');')(
    forbidden,forbidden,forbidden,forbidden,forbidden,view=>events.push(['clear-read-error',view]));
  const navigate=new Function('location','state','document','player','loadView','status','explain','landingView','return ('+source+');')(
    {hash},state,document,{pause:()=>events.push(['pause'])},loadView,forbidden,forbidden,landingView);
  return {state,sections,links,events,navigate};
}

test('Manifesto is a keyboard-native navigation and footer link with a labelled page',()=>{
  assert.match(html,/<nav[^>]*aria-label="Main navigation"[^>]*>[\s\S]*?<a href="#manifesto">Manifesto<\/a>[\s\S]*?<\/nav>/);
  assert.match(html,/<footer\b[\s\S]*?<a href="#manifesto">Manifesto<\/a>[\s\S]*?<\/footer>/);
  assert.match(manifesto,/aria-labelledby="manifesto-title"/);
  assert.match(manifesto,/<h1 id="manifesto-title">The manifesto\.<\/h1>/);
  assert.doesNotMatch(manifesto,/<form\b|<button\b|data-free-sock|data-bitcoin-wallet|aria-disabled/);
});

test('direct manifesto navigation works without config or a wallet and pauses replay',()=>{
  const f=routingFixture();const before=structuredClone(f.state.profile);f.navigate();
  assert.equal(f.state.view,'manifesto');
  assert.deepEqual(f.sections.filter(section=>!section.hidden).map(section=>section.dataset.view),['manifesto']);
  assert.deepEqual(f.links.filter(link=>link.attributes['aria-current']==='page').map(link=>link.hash),['#manifesto']);
  assert.deepEqual(f.events,[['pause']]);assert.deepEqual(f.state.profile,before);
});

test('manifesto stays local with configured service and does not call inference or payments',async()=>{
  const f=routingFixture({configured:true,hash:'#manifesto?review=copy'});f.navigate();await Promise.resolve();
  assert.equal(f.state.view,'manifesto');
  assert.deepEqual(f.events,[['pause'],['clear-read-error','manifesto']]);
});

test('the added route preserves all existing routes and unknown-route fallback',()=>{
  for(const route of routes){
    const f=routingFixture({hash:'#'+route});f.navigate();assert.equal(f.state.view,route);
    assert.deepEqual(f.sections.filter(section=>!section.hidden).map(section=>section.dataset.view),[route]);
  }
  for(const hash of ['','#unknown','#manifesto-not-a-route']){
    const f=routingFixture({hash});f.navigate();assert.equal(f.state.view,'launch');
  }
});

test('manifesto states total-loss risk, no promises and truthful version flexibility',()=>{
  assert.match(manifesto,/sock, an arena or PIT as money you may never see again/);
  assert.match(manifesto,/Never put in money you cannot afford to lose/);
  assert.match(manifesto,/No guaranteed value\. No promised return/);
  assert.match(manifesto,/No promised updates, bug fixes, support or next season/);
  assert.match(manifesto,/Gameplay may change for future matches/);
  assert.match(manifesto,/Already locked matches keep their version/);
  assert.match(manifesto,/Don't trust\. Verify\./);
  assert.match(manifesto,/this version still trusts that server/);
  assert.doesNotMatch(manifesto,/guaranteed safe|risk.free|cannot lose|will never change|legally exempt/i);
});

test('manifesto does not mislicense third-party works or invent model attributions',()=>{
  assert.match(manifesto,/Our original code and artwork are released under the/);
  assert.match(manifesto,/href="\/LICENSE\.txt">Viral Public License<\/a>/);
  assert.match(manifesto,/Keep the entire license with redistributions and anything made using this work/);
  assert.match(manifesto,/Add no further restrictions/);
  assert.match(manifesto,/Third-party code, fonts and collection artwork keep their own licenses and required notices/);
  assert.match(manifesto,/href="\/LICENSE-SCOPE\.txt"/);
  assert.match(manifesto,/href="\/THIRD-PARTY-NOTICES\.txt"/);
  assert.match(manifesto,/We cannot give away somebody else's rights/);
  assert.match(manifesto,/Built with AI and a lot of burned tokens/);
  assert.doesNotMatch(manifesto,/Fable|Astra|GPT|migration|pending license|everything is VPL|all dependencies are VPL/i);
});

test('the manifesto ends exactly with World Peace and keeps stable copy anchors',()=>{
  assert.match(manifesto,/<p id="manifesto-signoff" class="paper">World Peace<\/p>\s*<\/section>$/);
  assert.doesNotMatch(manifesto,/\u2014/);
  const ids=[...manifesto.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  for(const id of ids)assert.ok(review.includes('`#'+id+'`'),'Review index missing '+id);
});

test('the copy review indexes every application route and scopes the confirmed VPL grant',()=>{
  for(const route of routes)assert.ok(review.includes('`#'+route+'`'),'Review index missing route '+route);
  for(const state of ['ROOM.WAIT','ROOM.RESULT','ROOM.RECOVERY','FIGHTER.OFFLINE','SOCKS.DELIVERY','LAUNCH.ACTIONS','ADMIN','QUOTE','LAB.LOG'])assert.ok(review.includes(state));
  assert.match(review,/Benjamin a confirmé « tout VPL »/);
  assert.match(review,/`LICENSE` et `contracts\/LICENSE` contiennent le texte VPL canonique intégral/);
  assert.match(review,/F06 reste ouvert pour les droits des images de collections/);
  assert.match(review,/https:\/\/viralpubliclicense\.org\/VPL\.txt/);
  assert.match(review,/F08 n'est donc pas terminé/);
});

test('project licenses reproduce canonical VPL and metadata does not relicense dependencies',()=>{
  const canonical='VIRAL PUBLIC LICENSE\nCopyleft (ɔ) All Rights Reversed\n\n'+
    'This WORK is hereby relinquished of all associated ownership, attribution and copy\n'+
    'rights, and redistribution or use of any kind, with or without modification, is\n'+
    'permitted without restriction subject to the following conditions:\n'+
    '1.\tRedistributions of this WORK, or ANY work that makes use of ANY of the\n'+
    '\tcontents of this WORK by ANY kind of copying, dependency, linkage, or ANY\n'+
    '\tother possible form of DERIVATION or COMBINATION, must retain the ENTIRETY\n'+
    '\tof this license.\n2.\tNo further restrictions of ANY kind may be applied.\n';
  const read=path=>readFileSync(new URL(path,import.meta.url),'utf8').replace(/\r\n/g,'\n');
  assert.equal(read('../../LICENSE'),canonical);
  assert.equal(read('../../contracts/LICENSE'),canonical);
  const pkg=JSON.parse(read('../package.json')),lock=JSON.parse(read('../package-lock.json'));
  assert.equal(pkg.license,'SEE LICENSE IN ../LICENSE');
  assert.equal(lock.packages[''].license,pkg.license);
  assert.equal(lock.packages['node_modules/viem'].license,'MIT');
  assert.equal(lock.packages['node_modules/@resvg/resvg-wasm'].license,'MPL-2.0');
  const scope=read('../../LICENSE-SCOPE.md'),notices=read('../../THIRD-PARTY-NOTICES.md');
  assert.match(scope,/does not revoke those prior permissions/);
  assert.match(scope,/additional\ngrant/);
  assert.match(scope,/ISC License[\s\S]*Copyright \(c\) 2026 The Puppet Pit contributors/);
  assert.match(scope,/MIT License[\s\S]*Copyright \(c\) 2026 The Puppet Pit contributors/);
  assert.match(scope,/not automatically licensed under VPL/);
  assert.match(notices,/not a substitute for their full text/);
  assert.match(notices,/Nothing here claims that VPL compatibility of the whole dapp is resolved/);
});
