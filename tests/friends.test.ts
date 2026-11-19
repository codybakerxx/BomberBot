/**
 * Checks of the notifications server (`Friends` in src/worker.ts), with its disk and the push services
 * made up here: sign-ups are checked, a Tell friends reaches every phone but the host's, each phone can
 * read its message, a phone that is gone is dropped, and a room cannot send again within the minute.
 * Run with: npm test
 */
import assert from 'node:assert';
import { b64url } from '../src/push';
import { Friends } from '../src/worker';

type B = Uint8Array<ArrayBuffer>;
const enc = { encode: (t: string) => new TextEncoder().encode(t) as B };
const hkdf = async (salt: B, ikm: B, info: B, n: number): Promise<B> =>
  new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));

/** A made-up phone: its keys, and how it opens a message (RFC 8291). */
async function phone(endpoint: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    sub: { endpoint, keys: { p256dh: b64url(pub), auth: b64url(auth) } },
    async open(body: B): Promise<string> {
      const salt = body.slice(0, 16);
      const n = body[20];
      const as = body.slice(21, 21 + n);
      const theirs = await crypto.subtle.importKey('raw', as, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, pair.privateKey, 256));
      const ikm = await hkdf(auth, shared, new Uint8Array([...enc.encode('WebPush: info\0'), ...pub, ...as]), 32);
      const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
      const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
      const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + n)));
      return new TextDecoder().decode(plain.slice(0, -1));
    },
  };
}

function disk() {
  const m = new Map<string, unknown>();
  return {
    m,
    get: async <T>(k: string) => structuredClone(m.get(k)) as T | undefined,
    put: async (k: string, v: unknown) => void m.set(k, structuredClone(v)),
    delete: async (k: string) => m.delete(k),
    list: async <T>(o: { prefix: string; limit?: number }) => new Map([...m].filter(([k]) => k.startsWith(o.prefix)).slice(0, o.limit) as [string, T][]),
  };
}

async function main(): Promise<void> {
  const storage = disk();
  const f = new Friends({ storage });
  const post = (path: string, body: unknown) => f.fetch(new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) }));

  // a sign-up for somewhere that is not a push service is turned away
  assert.strictEqual((await post('/api/push/subscribe', { sub: { endpoint: 'https://example.com/a', keys: { p256dh: 'x', auth: 'y' } } })).status, 400);
  const host = await phone('https://web.push.apple.com/host');
  const ann = await phone('https://web.push.apple.com/ann');
  const bo = await phone('https://fcm.googleapis.com/fcm/send/bo');
  const gone = await phone('https://fcm.googleapis.com/fcm/send/gone');
  for (const p of [host, ann, bo, gone]) assert.strictEqual((await post('/api/push/subscribe', { sub: p.sub })).status, 200);

  // Tell friends: the push services, made up
  const got = new Map<string, { body: B; headers: Headers }>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    got.set(url, { body: init.body as B, headers: new Headers(init.headers) });
    return new Response(null, { status: url.endsWith('gone') ? 410 : 201 });
  }) as typeof fetch;
  try {
    const r = (await (await post('/invite', { code: 'BKTW', name: 'Cody', me: host.sub.endpoint })).json()) as { why: string; bell: string; n: number };
    assert.strictEqual(r.why, 'Told 2 friends that room BKTW is open.');
    assert.strictEqual(r.bell, 'sent', 'the page is told how it went, to say it under the bell');
    assert.strictEqual(r.n, 2, 'and how many friends were rung');
    assert.ok(!got.has(host.sub.endpoint), 'not the host');
    for (const p of [ann, bo]) {
      const sent = got.get(p.sub.endpoint)!;
      assert.ok(sent, 'each friend');
      assert.strictEqual(sent.headers.get('Content-Encoding'), 'aes128gcm');
      assert.match(sent.headers.get('Authorization')!, /^vapid t=.+, k=.+$/);
      const n = JSON.parse(await p.open(sent.body));
      assert.strictEqual(n.title, 'Cody wants to play');
      assert.strictEqual(n.url, '/?room=BKTW');
    }
    assert.strictEqual((await storage.list({ prefix: 'f:' })).size, 3, 'the phone that is gone is dropped');
    const again = (await (await post('/invite', { code: 'BKTW', name: 'Cody' })).json()) as { why: string; bell: string };
    assert.match(again.why, /just told/, 'not twice in a minute');
    assert.strictEqual(again.bell, 'wait');
    // the key stays the same between calls
    const k1 = await (await f.fetch(new Request('https://x/api/push/key'))).json();
    const k2 = await (await f.fetch(new Request('https://x/api/push/key'))).json();
    assert.deepStrictEqual(k1, k2);
    // turning off takes a phone off the list
    await post('/api/push/unsubscribe', { endpoint: ann.sub.endpoint });
    assert.strictEqual((await storage.list({ prefix: 'f:' })).size, 2);
    // the host alone with invites on: nobody to ring (the bell never rings the phone it is tapped on), and saying
    // so does not use up the room's minute
    await post('/api/push/unsubscribe', { endpoint: bo.sub.endpoint });
    got.clear();
    const alone = (await (await post('/invite', { code: 'QZXV', name: 'Cody', me: host.sub.endpoint })).json()) as { why: string; bell: string; n: number };
    assert.strictEqual(alone.bell, 'none');
    assert.strictEqual(alone.n, 0);
    assert.strictEqual(got.size, 0, 'nothing sent, not even to the host');
    const twice = (await (await post('/invite', { code: 'QZXV', name: 'Cody', me: host.sub.endpoint })).json()) as { bell: string };
    assert.strictEqual(twice.bell, 'none', 'asking again straight away says the same');
    // no phone given (its worker was not running): the host's own phone is the only one on the list, so it is rung
    const blind = (await (await post('/invite', { code: 'QZXV', name: 'Cody' })).json()) as { bell: string; n: number };
    assert.strictEqual(blind.bell, 'sent');
    assert.ok(got.has(host.sub.endpoint));
  } finally {
    globalThis.fetch = realFetch;
  }
  console.log('friends checks passed');
}
await main();
