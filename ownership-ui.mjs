import { connectBitcoin, validateOwnershipChallenge } from './bitcoin-wallet.mjs';
import { api } from './api.mjs';
import {createAvatarPicture} from './avatar-image.mjs';

export function setupOwnership({ getContext, post, refreshMe, status, action }) {
  const note = document.getElementById('ownership-status');
  const controls = document.createElement('div'); controls.className = 'ownership-controls';
  controls.innerHTML = `<div id="bitcoin-choice" hidden><label for="bitcoin-address-choice">The address holding your picture</label><select id="bitcoin-address-choice"></select><button id="bitcoin-prove">Sign ownership message</button></div>
    <p class="small">Bitcoin mainnet pictures can join this testnet game. Sign a message only. No BTC or NFT moves. The link lasts 24 hours and holdings are checked again before a collection advantage is used.</p>
    <p class="small" id="approved-collections">Reading the approved collections…</p>
    <details><summary>Using a cold wallet or offline signer?</summary><p>Keep your NFT where it is. Your signer must support a single-key Bitcoin message proof. Multisig and script-path proofs are not supported. Never paste a seed phrase or private key.</p>
    <label for="offline-bitcoin-address">Bitcoin address holding the picture</label><input id="offline-bitcoin-address" maxlength="90" spellcheck="false" autocomplete="off" placeholder="bc1…"><button id="offline-challenge">Make my ownership message</button>
    <div id="offline-proof" hidden><label for="offline-message">Sign this exact message in your wallet</label><textarea id="offline-message" readonly rows="10" spellcheck="false"></textarea><p id="offline-expiry" class="small"></p><button id="offline-copy" class="quiet">Copy message</button><label for="offline-signature">Message signature, not a private key</label><textarea id="offline-signature" maxlength="4096" rows="3" spellcheck="false" autocomplete="off" placeholder="Paste the base64 signature"></textarea><button id="offline-verify">Check my proof</button></div></details>
    <div class="inline"><button id="ownership-refresh" class="quiet">Check my linked pictures again</button><button id="ownership-unlink" class="quiet">Unlink Bitcoin address</button></div>`;
  note.after(controls);
  api('/api/collections').then(({ collections }) => {
    document.getElementById('approved-collections').textContent = collections?.length ? 'Approved collections: ' + collections.map(c => c.name + (c.count ? ' (' + c.count.toLocaleString() + ')' : '')).join(' · ') + '.' : 'No collection is approved yet.';
  }).catch(() => { document.getElementById('approved-collections').textContent = 'The approved collection list could not be read.'; });
  const previews=document.createElement('div');previews.className='collection-grid ownership-pictures';previews.hidden=true;controls.append(previews);
  const $ = id => document.getElementById(id);
  let accounts = [], kind = null, offline = null;
  function context() {
    const current = getContext();
    if (!current.evmAddress) throw new Error('Connect your game wallet first.');
    if (!current.enabled) throw new Error('Bitcoin ownership checks are not connected yet. No ownership is assumed from an address alone.');
    return current;
  }
  async function challenge(bitcoinAddress, wallet) {
    const current = context();
    return validateOwnershipChallenge(await post('/api/ownership/challenge', { bitcoinAddress, wallet }), { ...current, bitcoinAddress });
  }
  let scanTimer = null, polls = 0;
  // The server reads a large address in bounded background steps. One timer follows it; a poll never starts a read.
  function follow(view) {
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (!view?.checking) { polls = 0; return; }
    if (view.error || polls++ >= 1200) return;
    scanTimer = setTimeout(async () => {
      scanTimer = null;
      let next;
      try { next = await api('/api/ownership'); } catch { follow(view); return; }
      describe(next);
      if (!next.checking) { try { await refreshMe(); } catch { /* the next page read shows the faces */ } status(note.textContent); }
    }, 3000);
  }
  function describe(view) {
    if (view?.checking) {
      note.textContent = 'Checking outputs: ' + view.checking.scanned + ' of ' + view.checking.total + '.' + (view.avatars?.length ? ' ' + view.avatars.length + ' pictures found.' : '') + (view.error ? ' ' + view.error : view.checking.retryAt ? ' Retrying.' : '');
      renderPreviews(view); follow(view); return;
    }
    follow(null);
    note.textContent = !view.address ? 'No Bitcoin address is linked.' : view.avatars?.length ? view.avatars.length + (view.truncated ? '+' : '') + ' approved pictures found. Choose a face above and save your fighter.' : 'Your address signature is verified, but no confirmed picture from an active collection was found. No collection advantage was granted.';
    if (view.checkedAt) note.textContent += ' Checked ' + new Date(view.checkedAt).toLocaleTimeString() + '.';
    renderPreviews(view);
  }
  function renderPreviews(view) {
    previews.replaceChildren();previews.hidden=!view.avatars?.length;
    for(const avatar of (view.avatars||[]).slice(0,24)){
      const tile=document.createElement('article'),title=document.createElement('h3');tile.className='collection-item';title.textContent=avatar.name||avatar.id;
      tile.append(createAvatarPicture(avatar.image,{label:avatar.name||avatar.id}),title);previews.append(tile);
    }
    if(view.avatars?.length){const message=document.createElement('p');message.className='small';message.textContent='A missing preview does not change verified ownership. Your collection picture stays selected, using a neutral sticker until its image is available.';previews.append(message);}
  }
  async function verify(challenge, signature) {
    validateOwnershipChallenge(challenge, { ...context(), bitcoinAddress: challenge.address });
    const view = await post('/api/ownership/verify', { challengeId: challenge.id, address: challenge.address, signature });
    describe(view); await refreshMe(); status(note.textContent);
  }
  for (const button of document.querySelectorAll('[data-bitcoin-wallet]')) button.addEventListener('click', () => action(async () => {
    context(); kind = button.dataset.bitcoinWallet; accounts = await connectBitcoin(kind);
    if (!accounts.length) throw new Error('This wallet did not offer a supported Bitcoin mainnet address.');
    $('bitcoin-address-choice').replaceChildren();
    for (const account of accounts) { const option = document.createElement('option'); option.value = account.address; option.textContent = account.label; $('bitcoin-address-choice').append(option); }
    $('bitcoin-choice').hidden = false; note.textContent = 'Choose the holding address, then sign its ownership message.';
  }));
  $('bitcoin-prove').addEventListener('click', () => action(async () => {
    const account = accounts.find(item => item.address === $('bitcoin-address-choice').value);
    if (!account || !kind) throw new Error('Connect a Bitcoin wallet first.');
    const request = await challenge(account.address, kind);
    await verify(request, await account.sign(request.message));
  }));
  $('offline-challenge').addEventListener('click', () => action(async () => {
    offline = await challenge($('offline-bitcoin-address').value.trim(), 'offline');
    $('offline-message').value = offline.message; $('offline-signature').value = ''; $('offline-proof').hidden = false;
    $('offline-expiry').textContent = 'Return this signature before ' + new Date(offline.expiresAt).toLocaleTimeString() + '. Changing the message invalidates it.';
  }));
  $('offline-copy').addEventListener('click', () => action(async () => { if (!offline) return; await navigator.clipboard.writeText(offline.message); status('Ownership message copied. Sign it in your Bitcoin wallet.'); }));
  $('offline-verify').addEventListener('click', () => action(async () => {
    if (!offline) throw new Error('Make a new ownership message first.');
    await verify(offline, $('offline-signature').value.trim()); offline = null; $('offline-signature').value = ''; $('offline-proof').hidden = true;
  }));
  $('ownership-refresh').addEventListener('click', () => action(async () => { context(); const view = await post('/api/ownership/refresh'); describe(view); await refreshMe(); status(note.textContent); }));
  $('ownership-unlink').addEventListener('click', () => action(async () => { context(); await post('/api/ownership/unlink'); accounts = []; kind = null; offline = null; $('bitcoin-choice').hidden = true; $('offline-proof').hidden = true; $('offline-signature').value = '';previews.replaceChildren();previews.hidden=true; await refreshMe(); note.textContent = 'Bitcoin address unlinked. Existing paid rooms keep their locked fighter.'; status(note.textContent); }));
}
