// Isolated browser fixture: source frontend + fake API/wallet, no live service.
// PIT_PLAYWRIGHT_MODULE may point to a locally installed Playwright index.mjs.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {encodeFunctionData} from 'viem';
import {batchMintEstimate,mintStorageKey} from './mint-state.mjs';

const app=path.resolve(fileURLToPath(new URL('./',import.meta.url))),engine=path.dirname(app),root=path.dirname(engine);
const output=path.join(root,'design/screenshots/mint-batch');
const moduleName=process.env.PIT_PLAYWRIGHT_MODULE;
const {chromium}=await import(moduleName?pathToFileURL(path.resolve(moduleName)).href:'playwright');
const {abi}=JSON.parse(await readFile(path.join(root,'contracts/out/PitSocksBatch.sol/PitSocksBatch.json'),'utf8'));
const owner='0x'+'a'.repeat(40),contract='0x'+'b'.repeat(40),legacy='0x'+'1'.repeat(40),nonce='0x'+'d'.repeat(64),hash='0x'+'c'.repeat(64);
const unit='2589999999999999',scope={address:owner,contract,chainId:46630};
let scenario='mixed';const requests=[];
function socks(){
  const data={protocol:'batch-v2',mintPriceWei:unit,maxBatch:10,lifetimeCap:null,maxSupply:10000,minted:1234,mintedBy:3,pending:0,freeRemaining:2,freeEligibility:'verified',mintOpen:true,requests:[],refundWei:'0',owned:[],example:{key:0},legacyRecovery:null};
  if(scenario==='legacy')return {protocol:'legacy-v1',maxSupply:10000,minted:22,mintedBy:1,cap:2,requests:[],refundWei:'0',owned:[],example:{key:0}};
  if(scenario==='unavailable'){data.freeEligibility='unavailable';data.freeRemaining=0;}
  if(scenario==='unlinked'){data.freeEligibility='unlinked';data.freeRemaining=0;}
  if(scenario==='relink'){data.freeEligibility='relink';data.freeRemaining=0;}
  if(scenario==='partial')Object.assign(data,{freeRemaining:1,pending:1,refundWei:unit,requests:[
    {id:'17',status:'fulfilled',tokenId:'1024',free:true,paymentWei:'0',batchNonce:nonce},
    {id:'18',status:'refunded',free:true,paymentWei:'0',batchNonce:nonce},
    {id:'19',status:'ready',free:false,paymentWei:unit,batchNonce:nonce},
    {id:'20',status:'refunded',free:false,paymentWei:unit,batchNonce:nonce},
  ],owned:[{key:0,tokenId:'1024'}],legacyRecovery:{contract:legacy,unavailable:true}});
  return data;
}
function quote(quantity){
  const expected=batchMintEstimate(socks(),quantity),expiresAt=(Math.floor(Date.now()/1000)+120)*1000;
  const data=encodeFunctionData({abi,functionName:'requestMint',args:[{wallet:owner,quantity,freeMints:expected.freeMints,eligibilityKey:nonce,affiliationVersion:nonce,nonce,deadline:BigInt(expiresAt/1000)},'0x'+'44'.repeat(65)]});
  return {kind:'mint-batch',quoteId:nonce,...expected,expiresAt,quote:{nonce,wallet:owner},transaction:{to:contract,chainId:46630,data,value:expected.ethWei},contractWalletWarning:false};
}
function config(){return {testnet:true,mintProtocol:scenario==='legacy'?'legacy-v1':'batch-v2',chain:{id:46630,name:'Local fixture testnet'},contracts:{socks:legacy,socksBatch:contract},features:{socks:true,arena:false,sale:false,bitcoinOwnership:true},inference:{configured:false,testOnly:true,models:[]},jackpot:{amountWei:'1000000'},launchGate:{required:false,ready:true}};}
const profile={id:'local-test',name:'TEST SOCK',note:'',avatarId:'sock:free',ultimateChoice:'auto',avatar:{id:'sock:free',key:0}};
const routes=[['/arena/',path.join(engine,'arena')],['/sock/',path.join(engine,'public/js')],['/fonts/',path.join(engine,'assets/fonts')],['/assets/',path.join(root,'design/sticker-yard/assets')],['/',app]];
const mime={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.bin':'font/ttf','.txt':'text/plain'};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1'),pathname=url.pathname;
    if(pathname.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
      requests.push({path:pathname,method:req.method,body});
      let data;
      if(pathname==='/api/config')data=config();
      else if(pathname==='/api/socks')data=socks();
      else if(pathname==='/api/me')data={address:owner,profile,avatars:[profile.avatar],balances:{pitWei:'0',ethWei:'1000000000000000000'}};
      else if(pathname==='/api/auth/challenge')data={message:'Sign in to the isolated The Pit fixture '+owner,nonce:'local-only'};
      else if(pathname==='/api/auth/verify')data={ok:true};
      else if(pathname==='/api/rooms')data={rooms:[]};
      else if(pathname==='/api/socks/quote')data=quote(body.quantity);
      else if(pathname==='/api/transactions')data={confirmed:true,hash:body.hash,quoteId:body.quoteId};
      else if(pathname.startsWith('/api/socks/quotes/'))data={state:'accepted',hash,quoteId:nonce};
      else throw Error('Unexpected fixture API '+pathname);
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));return;
    }
    if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const [prefix,base]=routes.find(([prefix])=>pathname.startsWith(prefix));
    const target=path.resolve(base,pathname=== '/'?'index.html':pathname.slice(prefix.length));
    if(!target.startsWith(base+path.sep))throw Error('Invalid fixture path');
    const content=await readFile(target);res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});res.end(content);
  }catch(error){res.writeHead(500,{'content-type':'text/plain'});res.end(error.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;const results=[];
try{
  await mkdir(output,{recursive:true});
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const viewport of [{width:1440,height:1080},{width:390,height:844}])for(const name of ['mixed','free','unlinked','unavailable','partial','recovery','unknown','legacy']){
    scenario=name;
    const context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const saved=['recovery','unknown'].includes(name)?{version:1,scope,phase:name==='recovery'?'sent':'submitting',requestId:'0x'+'e'.repeat(64),quoteId:nonce,quote:quote(3),expected:batchMintEstimate(socks(),3),...(name==='recovery'?{hash}:{})}:null;
    await context.addInitScript(({owner,hash,saved,key})=>{
      if(saved)localStorage.setItem(key,JSON.stringify(saved));
      window.__mintCalls=[];
      window.ethereum={on(){},removeListener(){},async request(input){
        window.__mintCalls.push(input.method);
        if(input.method==='eth_chainId')return '0xb626';
        if(input.method==='eth_requestAccounts'||input.method==='eth_accounts')return [owner];
        if(input.method==='personal_sign')return '0x'+'22'.repeat(65);
        if(input.method==='eth_sendTransaction')return hash;
        if(input.method==='eth_getTransactionReceipt')return {status:'0x1',transactionHash:hash};
        throw Error('Unexpected fixture wallet method '+input.method);
      }};
    },{owner,hash,saved,key:mintStorageKey(scope)});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const initial=await page.goto(origin+'/#socks');assert.equal(initial.status(),200,'fixture HTML must load');await page.locator('#connect').click();
    await page.waitForFunction(()=>document.querySelector('#connect').textContent.startsWith('0xaaaa'));
    await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
    const batch=name!=='legacy';
    if(batch&&!['recovery','unknown'].includes(name))await page.locator('#mint-quantity').fill(name==='free'?'2':'3');
    if(batch){
      assert.doesNotMatch(await page.locator('[data-view="socks"]').innerText(),/\b(?:USDG|SDG)\b|\$20|\$10|Two lifetime buys|2 total/i);
      assert.match(await page.locator('#mint-description').innerText(),/immutable ETH/);
    }else assert.match(await page.locator('#mint-price').innerText(),/\$20/);
    if(name==='free')assert.equal(await page.locator('#mint-total').innerText(),'0 ETH');
    if(name==='mixed')assert.equal(await page.locator('#mint-total').innerText(),'0.002589999999999999 ETH');
    if(name==='unlinked'){assert.equal(await page.locator('#mint-free-count').innerText(),'0');assert.match(await page.locator('#mint-allowance').innerText(),/fully paid/);}
    if(name==='unavailable'){assert.equal(await page.locator('#mint-sock').isDisabled(),true);assert.match(await page.locator('#mint-estimate-error').innerText(),/No paid substitute/);}
    if(name==='partial'){assert.equal(await page.locator('#mint-requests li').count(),4);assert.match(await page.locator('#mint-legacy-status').innerText(),/temporarily unavailable/);}
    if(['recovery','unknown'].includes(name)){
      assert.equal(await page.locator('#mint-pending').isVisible(),true);assert.equal(await page.locator('#mint-discard').isVisible(),false);assert.equal(await page.locator('#mint-sock').isDisabled(),true);
      assert.equal(await page.locator('#mint-quantity').inputValue(),'3');assert.equal(await page.locator('#mint-total').innerText(),'0.002589999999999999 ETH');
      assert.equal(await page.locator('#mint-hash-entry').isVisible(),name==='unknown');
    }
    await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'horizontal page overflow in '+name+' '+viewport.width);
    // Reset scroll so offscreen fixed accessibility links do not appear in
    // Chrome's full-page capture outside the viewport they were meant for.
    await page.evaluate(()=>window.scrollTo(0,0));
    const file=name+'-'+viewport.width+'.png';await page.screenshot({path:path.join(output,file),fullPage:true});
    await page.locator('.mint-desk').screenshot({path:path.join(output,name+'-'+viewport.width+'-desk.png')});
    if(name==='mixed'){
      await page.locator('#mint-sock').click();await page.locator('#quote-dialog').waitFor({state:'visible'});
      assert.match(await page.locator('#quote-detail').innerText(),/Free mints\n2[\s\S]*Paid mints\n1/);
      assert.match(await page.locator('#quote-detail').innerText(),/Network fees are separate/);
      await page.locator('#quote-dialog').screenshot({path:path.join(output,'quote-'+viewport.width+'.png')});
      await page.locator('#quote-dialog .dialog-close').click();
      await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
      assert.equal(await page.locator('#mint-pending').isVisible(),true);
      await page.reload();await page.locator('#connect').click();await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
      assert.equal(await page.locator('#mint-pending').isVisible(),true,'unsent quote survives reload');
      assert.equal((await page.evaluate(()=>window.__mintCalls)).filter(x=>x==='eth_sendTransaction').length,0);
      await page.locator('#mint-resume').click();await page.locator('#quote-dialog').waitFor({state:'visible'});
      await page.locator('#quote-dialog [value="confirm"]').click();await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
      assert.equal((await page.evaluate(()=>window.__mintCalls)).filter(x=>x==='eth_sendTransaction').length,1);
      assert.equal(await page.locator('#mint-pending').isVisible(),false);
    }
    if(['recovery','unknown'].includes(name)){
      await page.locator('#mint-resume').click();await page.waitForFunction(()=>!document.body.hasAttribute('aria-busy'));
      assert.equal((await page.evaluate(()=>window.__mintCalls)).filter(x=>x==='eth_sendTransaction').length,0);
      assert.equal(await page.locator('#mint-pending').isVisible(),false);
    }
    if(batch){
      await page.goto(origin+'/#rules');await page.waitForFunction(()=>document.querySelector('#socks-rules-price').textContent.includes('fixed in the contract'));
      const price=await page.locator('#socks-rules-price').innerText(),cap=await page.locator('#socks-rules-cap').innerText();
      assert.doesNotMatch(price+' '+cap,/\$20|\$10|USDG|SDG|Two lifetime buys|ten in total/i);
      assert.match(cap,/two free NFT mints in total/);
    }
    assert.deepEqual(errors,[],'browser JS errors');results.push({scenario:name,viewport,file,passed:true});
    await context.close();
  }
  await writeFile(path.join(output,'results.json'),JSON.stringify({mode:'isolated fake wallet and API; no deployment, chain or live service',results},null,2));
  console.log(JSON.stringify({screenshots:output,passed:results.length,externalRequests:'blocked'},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
