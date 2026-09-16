// Direct injected interfaces, checked against the vendors' published APIs and Xverse SDK source.
// This module never creates a Bitcoin transaction or requests a private key.
const mainnet = value => typeof value === 'string' && /^(?:bc1[qp][a-z0-9]{20,85}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(value);
const fail = message => { throw new Error(message); };
function result(response) {
  if (response?.error) { const error = new Error(response.error.message || 'The Bitcoin wallet declined this request.'); error.code = response.error.code; throw error; }
  if (response?.jsonrpc !== '2.0' || response.result === undefined) fail('The Bitcoin wallet returned an unreadable answer. Update the wallet and try again.');
  return response.result;
}
function signature(value) {
  if (typeof value !== 'string' || value.length > 4096 || !/^(?:smp)?[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('The wallet did not return a supported message signature.');
  return value;
}
export function accountFromPath(path) {
  const match = typeof path === 'string' && /^m\/(?:84|86)'\/0'\/([0-9]+)'\//.exec(path);
  const account = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(account) || account < 0 || account >= 0x80000000) fail('Leather did not provide a supported mainnet account path.');
  return account;
}
export async function connectBitcoin(kind, scope = globalThis) {
  if (kind === 'unisat') {
    const provider = scope.unisat;
    if (!provider?.requestAccounts || !provider?.signMessage || !provider?.getNetwork) fail('Open or install UniSat to connect this Bitcoin address.');
    const accounts = await provider.requestAccounts();
    if (await provider.getNetwork() !== 'livenet') fail('Choose Bitcoin mainnet in UniSat. Your game wallet stays on its game network.');
    if (!Array.isArray(accounts)) fail('UniSat did not return Bitcoin addresses.');
    return accounts.filter(mainnet).map(address => ({ address, label: 'UniSat · ' + address,
      async sign(message) {
        // getAccounts is a read-only account check, not a second connection prompt.
        const current = await provider.getAccounts();
        if (!current.includes(address) || await provider.getNetwork() !== 'livenet') fail('The UniSat account changed. Connect the holding address again.');
        return signature(await provider.signMessage(message, 'bip322-simple'));
      } }));
  }
  if (kind === 'xverse') {
    // Do not choose generic BitcoinProvider: another installed wallet may own that alias.
    const provider = scope.XverseProviders?.BitcoinProvider;
    if (!provider?.request) fail('Open or install Xverse to connect this Bitcoin address.');
    const connected = result(await provider.request('wallet_connect', { addresses: ['ordinals', 'payment'], network: 'Mainnet', message: 'Choose the Bitcoin account holding your Pit picture.' }));
    if (connected.network?.bitcoin?.name !== 'Mainnet') fail('Choose Bitcoin mainnet in Xverse.');
    if (!Array.isArray(connected.addresses)) fail('Xverse did not return Bitcoin addresses.');
    return connected.addresses.filter(item => mainnet(item.address)).map(item => ({ address: item.address, label: 'Xverse ' + (item.purpose || 'Bitcoin') + ' · ' + item.address,
      async sign(message) {
        const signed = result(await provider.request('signMessage', { address: item.address, message, protocol: 'BIP322' }));
        if (signed.address !== item.address || (signed.protocol && signed.protocol !== 'BIP322')) fail('Xverse signed with a different address or format. Nothing was linked.');
        return signature(signed.signature);
      } }));
  }
  if (kind === 'leather') {
    const provider = scope.LeatherProvider;
    if (!provider?.request) fail('Open or install Leather to connect this Bitcoin address.');
    // Leather getAddresses opens the connection prompt. Call it once on this explicit click.
    const connected = result(await provider.request('getAddresses'));
    if (!Array.isArray(connected.addresses)) fail('Leather did not return Bitcoin addresses.');
    return connected.addresses.filter(item => ['p2tr', 'p2wpkh'].includes(item.type) && mainnet(item.address)).map(item => {
      const account = accountFromPath(item.derivationPath);
      return { address: item.address, label: 'Leather ' + item.type + ' · ' + item.address,
        async sign(message) {
          const signed = result(await provider.request('signMessage', { message, paymentType: item.type, network: 'mainnet', account }));
          if (signed.address !== item.address || signed.message !== message) fail('Leather signed another message or address. Nothing was linked.');
          return signature(signed.signature);
        } };
    });
  }
  fail('Choose Xverse, UniSat or Leather, or use an offline signature.');
}
export function validateOwnershipChallenge(challenge, expected) {
  if (!challenge || challenge.address !== expected.bitcoinAddress || challenge.evmAddress?.toLowerCase() !== expected.evmAddress?.toLowerCase() || challenge.chainId !== expected.chainId || challenge.origin !== expected.origin || !/^[0-9a-f]{64}$/.test(challenge.id)) fail('The ownership request does not match your wallets and this site. Nothing was signed.');
  const now = expected.now ?? Date.now();
  if (!Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= now || challenge.expiresAt > now + 11 * 60 * 1000) fail('Request a fresh ownership message before signing.');
  const known = ['THE PIT · Bitcoin picture ownership',
    'Purpose: link this Bitcoin address to my game wallet for avatar and collection eligibility.',
    'This signature cannot spend Bitcoin, move an NFT, or approve a transaction.',
    'The address-control link lasts 24 hours. Collection holdings are checked again when used.',
    'Site: ' + expected.origin, 'Bitcoin network: mainnet', 'Bitcoin address: ' + expected.bitcoinAddress,
    'Game chain ID: ' + expected.chainId, 'Game wallet: ' + challenge.evmAddress,
    'Nonce: ' + challenge.id, 'Expires: ' + new Date(challenge.expiresAt).toISOString()].join('\n');
  if (challenge.message !== known) fail('The ownership message does not match this game’s signing format. Nothing was signed.');
  return challenge;
}
