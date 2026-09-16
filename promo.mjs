// Optional gameplay teaser on the launch page. When the launch view first appears,
// one small same-origin manifest is read. Nothing else is requested until the
// viewer presses play: the video element keeps preload="none", never autoplays and
// never loops. A missing, invalid, uncleared or oversized manifest leaves the block
// hidden. Release media reaches the build only after a rights review (see
// docs/52-promo-web-integration.md); this module cannot reveal what was not built.
export const PROMO_MANIFEST_URL='/promo/release.json';
export const PROMO_LIMITS=Object.freeze({videoBytes:12_000_000,posterBytes:300_000,manifestBytes:4096,minSeconds:5,maxSeconds:90});
const VIDEO=/^\/promo\/[a-z0-9][a-z0-9-]{0,62}\.mp4$/,POSTER=/^\/promo\/[a-z0-9][a-z0-9-]{0,62}\.jpg$/,SHA256=/^[0-9a-f]{64}$/;
const size=(value,cap)=>Number.isInteger(value)&&value>0&&value<=cap;

/** The validated release description, or null. Never throws and never trusts extra fields. */
export function promoRelease(manifest,limits=PROMO_LIMITS){
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))return null;
  const {cleared,video,poster,videoBytes,posterBytes,sha256,posterSha256,durationSeconds}=manifest;
  if(cleared!==true||typeof video!=='string'||!VIDEO.test(video)||typeof poster!=='string'||!POSTER.test(poster))return null;
  if(!size(videoBytes,limits.videoBytes)||!size(posterBytes,limits.posterBytes))return null;
  if(typeof sha256!=='string'||!SHA256.test(sha256)||typeof posterSha256!=='string'||!SHA256.test(posterSha256))return null;
  if(typeof durationSeconds!=='number'||!Number.isFinite(durationSeconds)||durationSeconds<limits.minSeconds||durationSeconds>limits.maxSeconds)return null;
  return {video,poster,videoBytes,posterBytes,sha256,posterSha256,durationSeconds};
}

async function boundedText(response,limit){
  const reader=response.body?.getReader?.();
  if(!reader){const text=await response.text();return text.length>limit?null:text;}
  const chunks=[];let length=0;
  for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    length+=value.byteLength;
    if(length>limit){await reader.cancel();return null;}
    chunks.push(value);
  }
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder().decode(bytes);
}

/** Reads and validates the manifest. Resolves to the release or null; never rejects. */
export async function fetchPromoRelease(fetchImpl=globalThis.fetch,limits=PROMO_LIMITS){
  try{
    const response=await fetchImpl(PROMO_MANIFEST_URL,{cache:'no-store',credentials:'omit',redirect:'error'});
    if(!response?.ok)return null;
    const declared=Number(response.headers?.get?.('content-length'));
    if(Number.isFinite(declared)&&declared>limits.manifestBytes)return null;
    const text=await boundedText(response,limits.manifestBytes);
    return text===null?null:promoRelease(JSON.parse(text),limits);
  }catch{return null;}
}

/** Shows the teaser block for a validated release; hides it otherwise. */
export function revealPromo(release,root=globalThis.document){
  const figure=root.getElementById('promo-teaser'),video=root.getElementById('promo-video'),link=root.getElementById('promo-link'),seconds=root.getElementById('promo-seconds');
  if(!figure||!video||!link)return false;
  if(!release){figure.hidden=true;return false;}
  video.setAttribute('preload','none');video.removeAttribute('autoplay');video.removeAttribute('loop');
  video.setAttribute('poster',release.poster);video.setAttribute('src',release.video);
  link.setAttribute('href',release.video);
  if(seconds)seconds.textContent=String(Math.round(release.durationSeconds));
  figure.hidden=false;
  return true;
}

/** Waits for the launch view to be shown, then reads the manifest exactly once. */
export function setupPromo({root=globalThis.document,fetchImpl=globalThis.fetch,Observer=globalThis.MutationObserver}={}){
  const section=root.querySelector?.('[data-view="launch"]');
  if(!section||!root.getElementById('promo-teaser')||typeof fetchImpl!=='function')return null;
  let pending=null;
  const observer=typeof Observer==='function'?new Observer(()=>{if(!section.hidden)start();}):null;
  const start=()=>{
    if(pending)return pending;
    observer?.disconnect();
    pending=fetchPromoRelease(fetchImpl).then(release=>revealPromo(release,root));
    return pending;
  };
  observer?.observe(section,{attributes:true,attributeFilter:['hidden']});
  if(!section.hidden)start();
  return {start,started:()=>pending!==null};
}

if(typeof document!=='undefined'&&typeof fetch==='function')setupPromo();
