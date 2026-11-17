/**
 * Notifications on phones (Web Push): what the server needs to send one. Used by worker.ts; checked by
 * tests/push.test.ts. Only the standard Web Crypto of the browser and of Cloudflare: no libraries.
 *
 * Sending a notification to a phone goes through the phone maker's push service (Apple's for an iPhone,
 * Google's for Android Chrome) at the address the phone gave when the player said yes (`endpoint`). Two
 * standards make it work:
 *
 * - VAPID (RFC 8292): every send carries a short token signed with the game's own key, so the push service
 *   knows it comes from the server the player said yes to. The key is made by the server itself the first
 *   time it is needed, and kept there (worker.ts); its public half is given to phones when they sign up.
 * - Message encryption (RFC 8291, aes128gcm): the notification's words are locked with keys only that phone
 *   has, so the push service cannot read them.
 */

const enc = { encode: (t: string) => new TextEncoder().encode(t) as Uint8Array<ArrayBuffer> };

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The game's signing key, as kept on the server: both halves as JWK, and the public half as the phone wants it. */
export interface VapidKeys {
  privateJwk: JsonWebKey;
  /** the public key, uncompressed (65 bytes), base64url: given to phones as `applicationServerKey` */
  publicKey: string;
}

/** Make a new signing key (once, on the server). */
export async function makeVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  return { privateJwk, publicKey: b64url(raw) };
}

/** The Authorization header for a send to `endpoint`, good for 12 hours. `contact`: a URL or mailto: for the push service. */
export async function vapidHeader(endpoint: string, keys: VapidKeys, contact: string, nowSecs: number): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSecs + 12 * 3600, sub: contact })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // (Web Crypto gives the signature as r then s, 64 bytes, which is the form a JWT wants)
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/**
 * Lock `text` for one phone (RFC 8291, aes128gcm). `p256dh` and `auth` are the keys the phone gave when it
 * signed up (base64url). Returns the body to send.
 */
export async function encryptFor(p256dh: string, auth: string, text: string): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = unb64url(p256dh);
  const authSecret = unb64url(auth);
  // a key pair just for this message
  const mine = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', mine.publicKey));
  const theirs = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, mine.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // the words, then 2: the last (and only) record
  const plain = concat(enc.encode(text), new Uint8Array([2]));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const head = new Uint8Array(16 + 4 + 1);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPublic.length;
  return concat(head, asPublic, sealed);
}

/** What a notification says, as the phone's service worker shows it (src/sw.js). */
export interface Notice {
  title: string;
  body: string;
  /** the room it is about, and the address to open */
  code: string;
  url: string;
  at: number;
}
