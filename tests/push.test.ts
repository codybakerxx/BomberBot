/**
 * Checks of what the server sends to phones for notifications (src/push.ts): the signed VAPID token checks
 * out against the public key, and a locked message opens again with the phone's keys (RFC 8291), worked
 * through here the way a phone does it.
 * Run with: npm test
 */
import assert from 'node:assert';
import { b64url, encryptFor, makeVapidKeys, unb64url, vapidHeader } from '../src/push';

const enc = { encode: (t: string) => new TextEncoder().encode(t) as Uint8Array<ArrayBuffer> };
type B = Uint8Array<ArrayBuffer>;
const hkdf = async (salt: B, ikm: B, info: B, n: number): Promise<B> =>
  new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));

async function main(): Promise<void> {
  // VAPID: the token's signature checks out with the public key the phone is given
  const keys = await makeVapidKeys();
  assert.strictEqual(unb64url(keys.publicKey).length, 65, 'the public key is 65 bytes, uncompressed');
  const h = await vapidHeader('https://web.push.apple.com/abc/def', keys, 'https://bomberbot.bomberbot.workers.dev', 1_800_000_000);
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, 'the header has the token and the key');
  const claims = JSON.parse(new TextDecoder().decode(unb64url(m![2])));
  assert.strictEqual(claims.aud, 'https://web.push.apple.com', 'for the push service the phone uses');
  assert.strictEqual(claims.exp, 1_800_000_000 + 12 * 3600);
  const pub = await crypto.subtle.importKey('raw', unb64url(m![4]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64url(m![3]), enc.encode(`${m![1]}.${m![2]}`)), 'the signature is good');

  // the message: lock it for a made-up phone, then open it as the phone would
  const phone = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', phone.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const text = JSON.stringify({ title: 'Cody wants to play', body: 'Room BKTW is open. Tap to join.' });
  const body = await encryptFor(b64url(uaPublic), b64url(auth), text);
  const salt = body.slice(0, 16);
  assert.strictEqual(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  const theirs = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, phone.privateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), sealed));
  assert.strictEqual(plain[plain.length - 1], 2, 'one record, marked as the last');
  assert.strictEqual(new TextDecoder().decode(plain.slice(0, -1)), text, 'the phone reads the message back');
  console.log('push checks passed');
}
await main();
