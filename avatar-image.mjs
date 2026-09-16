import {safeImage} from './api.mjs';

export const AVATAR_PLACEHOLDER='/avatar-unavailable.svg';
export const PICTURE_UNAVAILABLE='Picture unavailable';
const failed=new Set(),bound=new WeakMap();

// NFT URLs must already use the same-origin raster proxy. Blob URLs are only
// the app's own on-chain sock SVGs; remote/data/document URLs are never embedded.
export function avatarImageSource(source,allowGeneratedBlob=false){
  if(allowGeneratedBlob&&typeof source==='string'&&source.startsWith('blob:'+location.origin+'/'))return source;
  return safeImage(source)||AVATAR_PLACEHOLDER;
}
function unavailable(source){return !source||source===AVATAR_PLACEHOLDER||source===safeImage(AVATAR_PLACEHOLDER)||failed.has(source);}

export async function loadAvatarImage(source,load){
  const accepted=avatarImageSource(source,true);
  if(!unavailable(accepted)){
    try{return {image:await load(accepted),source:accepted,unavailable:false};}
    catch{failed.add(accepted);}
  }
  return {image:await load(AVATAR_PLACEHOLDER),source:AVATAR_PLACEHOLDER,unavailable:true};
}

export function setAvatarImage(image,source,{label='',caption}={}){
  const accepted=avatarImageSource(source,true),prior=bound.get(image);
  const state=prior?.source===accepted?prior:{source:accepted,unavailable:unavailable(accepted),fallbackFailed:false};
  state.label=label;state.caption=caption;
  function describe(){
    image.alt=state.unavailable?(state.label?state.label+' · ':'')+PICTURE_UNAVAILABLE:state.label;
    image.title=state.unavailable?'Neutral placeholder. Verified ownership and the fighter stay unchanged.':'';
    if(state.caption){state.caption.textContent=PICTURE_UNAVAILABLE;state.caption.hidden=!state.unavailable;}
  }
  if(prior===state){describe();return image;}
  bound.set(image,state);image.hidden=false;
  image.onload=()=>{if(bound.get(image)!==state)return;describe();};
  image.onerror=()=>{
    if(bound.get(image)!==state)return;
    if(state.unavailable){state.fallbackFailed=true;image.hidden=true;describe();return;}
    failed.add(accepted);state.unavailable=true;describe();image.src=AVATAR_PLACEHOLDER;
  };
  describe();image.src=state.unavailable?AVATAR_PLACEHOLDER:accepted;return image;
}

export function createAvatarPicture(source,{label=''}={}){
  const wrapper=document.createElement('span'),image=document.createElement('img'),caption=document.createElement('small');
  wrapper.className='avatar-picture';caption.className='avatar-picture-note';caption.hidden=true;
  wrapper.append(image,caption);setAvatarImage(image,source,{label,caption});return wrapper;
}
