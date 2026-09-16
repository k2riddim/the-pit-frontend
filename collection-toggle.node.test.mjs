import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('./main.mjs',import.meta.url),'utf8');
const toggleSource=source.slice(source.indexOf('async function toggleCollectionState('),source.indexOf('async function loadAdmin('));
function fixture(error){
  const calls=[],messages=[];let loads=0;
  const toggle=new Function('post','loadAdmin','status','return ('+toggleSource+');')(
    async(path,body)=>{calls.push({path,body});if(error)throw error;return {collection:{id:'puppets',enabled:false,version:8}};},async()=>{loads++;},message=>messages.push(message));
  return {toggle,calls,messages,get loads(){return loads;}};
}
const collection={id:'puppets',name:'Bitcoin Puppets',kind:'bitcoin-inscriptions',enabled:true,version:7,inscriptionIds:Array.from({length:10001},(_,i)=>'not-sent-'+i)};

test('pausing a large Bitcoin collection sends only desired state and expected version',async()=>{
  const f=fixture();await f.toggle(collection);
  assert.deepEqual(f.calls,[{path:'/api/admin/collections/puppets/state',body:{enabled:false,expectedVersion:7}}]);
  assert.ok(JSON.stringify(f.calls[0].body).length<100);assert.equal(f.loads,1);assert.equal(f.messages.length,1);
});

test('activating a collection keeps the same bounded endpoint for EVM collections',async()=>{
  const f=fixture();await f.toggle({...collection,id:'evm-collection',kind:'erc721',enabled:false,inscriptionIds:undefined});
  assert.deepEqual(f.calls[0],{path:'/api/admin/collections/evm-collection/state',body:{enabled:true,expectedVersion:7}});
});

test('a stale state reloads current collections and never retries or reuploads membership',async()=>{
  const f=fixture(Object.assign(Error('stale'),{status:409}));
  await assert.rejects(f.toggle(collection),/latest state is shown/);
  assert.equal(f.calls.length,1);assert.equal(f.loads,1);assert.equal(f.messages.length,0);
});

test('unknown versions and failed writes cannot report a successful change',async()=>{
  for(const version of [undefined,0,-1,'7',7.5]){
    const f=fixture();await assert.rejects(f.toggle({...collection,version}),/Refresh/);assert.equal(f.calls.length,0);
  }
  const f=fixture(Error('unavailable'));await assert.rejects(f.toggle(collection),/unavailable/);assert.equal(f.messages.length,0);assert.equal(f.loads,0);
});

test('only new collection creation still imports a full checked membership list',()=>{
  assert.doesNotMatch(source.slice(source.indexOf('async function toggleCollectionState('),source.indexOf('async function loadView(')),/importCollection\(/);
  assert.match(source,/collection-form'\)\.addEventListener\('submit',[\s\S]*?if\(bitcoin\)await importCollection\(collection,post/);
});
