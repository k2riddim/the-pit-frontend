// Isolated browser fixture for the landing home: source frontend + fake API, no live service,
// no wallet connection. Serves the cleared promo release from design/promo/release so the teaser
// reveal is exercised exactly as the built site serves it. PIT_PLAYWRIGHT_MODULE may point to a
// locally installed Playwright index.mjs.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const app=path.resolve(fileURLToPath(new URL('./',import.meta.url))),engine=path.dirname(app),root=path.dirname(engine);
const output=path.join(root,'design/screenshots/home');
const moduleName=process.env.PIT_PLAYWRIGHT_MODULE;
const {chromium}=await import(moduleName?pathToFileURL(path.resolve(moduleName)).href:'playwright');

const config={testnet:true,mintProtocol:'batch-v2',chain:{id:46630,name:'Local fixture testnet'},
  contracts:{sale:'0x'+'c'.repeat(40)},features:{arena:true,socks:true,sale:true,bitcoinOwnership:true,faucet:false},
  inference:{configured:false,testOnly:true,models:[]},jackpot:{amountWei:'1000000000000000000000000'},
  launchGate:{required:true,ready:false,message:'Sale first.'}};
const launch={status:'active',canBuy:true,protocol:'production-v2',cashSplitPercent:[100,0],
  raisedWei:'2500000000000000',deadline:Math.floor(Date.now()/1000)+40*86400,
  message:'The sale is open. Check the exact test ETH and reserved PIT before signing.'};

const routes=[['/arena/',path.join(engine,'arena')],['/sock/',path.join(engine,'public/js')],['/fonts/',path.join(engine,'assets/fonts')],['/assets/',path.join(root,'design/sticker-yard/assets')],['/promo/',path.join(root,'design/promo/release')],['/',app]];
const mime={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.bin':'font/ttf','.txt':'text/plain','.json':'application/json','.mp4':'video/mp4'};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1'),pathname=url.pathname;
    if(pathname.startsWith('/api/')){
      let data;
      if(pathname==='/api/config')data=config;
      else if(pathname==='/api/launch')data=launch;
      else if(pathname==='/api/rooms')data={rooms:[]};
      else throw Error('Unexpected fixture API '+pathname);
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));return;
    }
    if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const [prefix,base]=routes.find(([prefix])=>pathname.startsWith(prefix));
    const target=path.resolve(base,pathname==='/'?'index.html':pathname.slice(prefix.length));
    if(!target.startsWith(base+path.sep))throw Error('Invalid fixture path');
    const content=await readFile(target);res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});res.end(content);
  }catch(error){res.writeHead(500,{'content-type':'text/plain'});res.end(error.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;

let browser;const results=[];
try{
  await mkdir(output,{recursive:true});
  try{browser=await chromium.launch({channel:'chrome',headless:true});}
  catch{browser=await chromium.launch({headless:true});}
  for(const viewport of [{name:'desktop',width:1440,height:1080},{name:'mobile',width:390,height:844}]){
    const context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    const initial=await page.goto(origin+'/');assert.equal(initial.status(),200,'fixture HTML must load');

    // The launch gate makes the landing the home view; the cleared release reveals the teaser.
    await page.waitForFunction(()=>!document.querySelector('[data-view="launch"]').hidden);
    await page.waitForFunction(()=>!document.getElementById('promo-teaser').hidden);
    const video=page.locator('#promo-video');
    assert.match(await video.getAttribute('src'),/^\/promo\/the-pit-promo\.mp4$/,'same-origin teaser source');
    assert.match(await video.getAttribute('poster'),/^\/promo\/poster\.jpg$/);
    assert.equal(await video.getAttribute('preload'),'none');
    assert.equal(await video.getAttribute('autoplay'),null,'playback is never imposed');
    assert.match(await page.locator('.hero-copy h1').innerText(),/Welcome to the pit\./);
    assert.ok((await page.locator('#hero-slogan').innerText()).length>3,'rotating slogan present');
    assert.equal(await page.locator('#hero-socks img').count(),3,'three real composed socks decorate the hero');
    for(const src of await page.locator('#hero-socks img').evaluateAll(imgs=>imgs.map(i=>i.getAttribute('src'))))assert.match(src,/^blob:/,'sock art is composed locally');
    assert.match(await page.locator('.ticker').innerText(),/WORLD PEACE/);
    assert.match(await page.locator('#launch-sale').innerText(),/Put PIT in the pit\./);
    assert.match(await page.locator('#launch-raised').innerText(),/ETH/,'live sale figures load');

    // The GET PIT button scrolls to the sale instead of navigating away.
    await page.locator('#hero-cta').click();
    await page.waitForFunction(()=>window.scrollY>0);
    assert.equal(await page.evaluate(()=>!document.querySelector('[data-view="launch"]').hidden),true,'still on the landing');

    await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'horizontal page overflow at '+viewport.width);
    // Reset scroll so offscreen fixed accessibility links do not appear in Chrome's full-page capture.
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(output,'home-'+viewport.name+'-'+viewport.width+'.png'),fullPage:true});
    await page.locator('.hero').screenshot({path:path.join(output,'home-hero-'+viewport.name+'-'+viewport.width+'.png')});
    assert.deepEqual(errors,[],'browser JS errors');
    results.push({viewport:viewport.name,width:viewport.width,passed:true});
    await context.close();
  }
  await writeFile(path.join(output,'results.json'),JSON.stringify({mode:'isolated fake API; no deployment, chain, wallet or live service',results},null,2));
  console.log(JSON.stringify({screenshots:output,passed:results.length,externalRequests:'blocked'},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
