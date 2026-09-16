export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export async function api(path, options = {}) {
  if (!path.startsWith('/api/')) throw new Error('The game API must use this site.');
  const controller = new AbortController();
  // Preparation can include a reasoning model; allow the bounded server call to finish.
  const preparingNote = path === '/api/fighter/compile';
  const timeout = setTimeout(() => controller.abort(), preparingNote ? 55000 : 30000);
  try {
    const response = await fetch(path, {
      ...options, credentials: 'same-origin', signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.body ? {'Content-Type': 'application/json'} : {}), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(payload?.message || payload?.error || 'The game could not complete that request.', response.status, payload?.code);
    if (!payload || typeof payload !== 'object') throw new ApiError('The game returned an unreadable answer.', response.status);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError(preparingNote
      ? 'The note took too long to prepare. Check your saved fighter before trying again.'
      : 'The game took too long to answer. Check the room before trying again.', 408);
    throw error;
  } finally { clearTimeout(timeout); }
}

export const post = (path, body = {}) => api(path, {method:'POST', body});
export const shortAddress = value => /^0x[0-9a-f]{40}$/i.test(value || '') ? value.slice(0,6) + '…' + value.slice(-4) : 'Not connected';
export function units(value, decimals = 18, digits = 4) {
  if (value === null || value === undefined) return 'Unavailable';
  try {
    const n = BigInt(value), negative = n < 0n, abs = negative ? -n : n;
    const divisor = 10n ** BigInt(decimals), whole = (abs / divisor).toString();
    const fraction = (abs % divisor).toString().padStart(decimals,'0').slice(0,digits).replace(/0+$/,'');
    return (negative ? '−' : '') + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? '.' + fraction : '');
  } catch { return 'Unavailable'; }
}

export function decimalWei(value) {
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text)) throw new Error('Use an ETH amount with up to 18 decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const wei = BigInt(whole) * 10n**18n + BigInt(fraction.padEnd(18,'0'));
  if (wei <= 0n) throw new Error('The amount must be greater than zero.');
  return wei.toString();
}

export function safeImage(value) {
  if (!value) return '';
  try {
    const u = new URL(value, location.origin);
    return u.origin === location.origin && ['http:','https:'].includes(u.protocol) ? u.href : '';
  } catch { return ''; }
}
