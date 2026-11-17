/**
 * The online server, on Cloudflare (docs/ONLINE.md). Not part of the game page: wrangler builds and uploads it
 * (wrangler.jsonc), with the game page (dist/index.html) as its static file.
 *
 * - Every request for the page itself is answered with the page (Cloudflare does that before this runs).
 * - /api/room/CODE is a WebSocket into room CODE: one Durable Object per room code (`RoomDO`), which keeps
 *   the room (room.ts) in memory, steps its rounds on a clock, and passes messages in and out.
 *
 * - /api/push/... is notifications (Settings › App): one Durable Object for the whole game (`Friends`) keeps
 *   the phones that said yes, and the room's host can tell them all that the room is open (Tell friends).
 *
 * A room lives as long as someone is connected to it (and a little after, so a dropped phone can come back).
 * Rooms are not saved anywhere: when the last person goes, the room goes too. `Friends` keeps its list on disk.
 */
import { Room, type Conn, type Member } from './room';
import { parseMsg, readCode, type ClientMsg } from './net';
import { encryptFor, makeVapidKeys, vapidHeader, type Notice, type VapidKeys } from './push';

// The few Cloudflare Workers pieces used here (their full types are not part of this project).
declare const WebSocketPair: { new (): { 0: WebSocket; 1: WebSocket } };
interface ServerSocket extends WebSocket {
  accept(): void;
}
interface Stub {
  fetch(req: Request): Promise<Response>;
}
interface Namespace {
  idFromName(name: string): unknown;
  get(id: unknown): Stub;
}
interface Env {
  ROOMS: Namespace;
  FRIENDS: Namespace;
  ASSETS: Stub;
}
/** A Durable Object's own disk (only the few calls used here). */
interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(o: { prefix: string; limit?: number }): Promise<Map<string, T>>;
}
interface DOState {
  storage: Storage;
}

/** How often the round's clock is looked at: each time, the round is stepped up to the time (60 ticks a second), so a tick goes out within this long of when it is due. */
const FAST_MS = 8;
/** How often a room tidies itself up (people gone too long, a host gone). */
const SLOW_MS = 4000;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/room\/([A-Za-z]+)$/);
    if (m) {
      const code = readCode(m[1]);
      if (!code) return new Response('No such room', { status: 404 });
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }
    if (url.pathname.startsWith('/api/push/')) return friends(env).fetch(req);
    return env.ASSETS.fetch(req);
  },
};

/** One room. Cloudflare makes one per room code, the first time someone connects to that code. */
export class RoomDO {
  private room: Room | null = null;
  private fast = 0;
  private slow = 0;

  constructor(
    _state: DOState,
    private env: Env,
  ) {}

  async fetch(req: Request): Promise<Response> {
    const code = readCode(new URL(req.url).pathname.split('/').pop());
    const pair = new WebSocketPair();
    const client = pair[0];
    const socket = pair[1] as ServerSocket;
    socket.accept();
    if (!this.room) this.room = new Room(code, random);
    const room = this.room;
    const conn: Conn = {
      send(text) {
        try {
          socket.send(text);
        } catch {
          /* closed meanwhile */
        }
      },
      close(c, why) {
        try {
          socket.close(c, why);
        } catch {
          /* already closed */
        }
      },
    };
    let member: Member | null = null;
    socket.addEventListener('message', (e: MessageEvent) => {
      const msg = parseMsg<ClientMsg>(e.data);
      if (!msg || this.room !== room) return;
      const now = Date.now();
      if (!member) {
        if (msg.t === 'hello') member = room.hello(conn, msg, now);
      } else if (msg.t === 'invite') void this.invite(member, msg.me, conn);
      else room.message(member, msg, now);
      this.clocks();
    });
    const gone = (): void => {
      if (member && this.room === room) room.disconnect(member, conn, Date.now());
      member = null;
      this.clocks();
    };
    socket.addEventListener('close', gone);
    socket.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
  }

  /** The host's Tell friends: a notification to every phone that said yes, through `Friends`. */
  private async invite(m: Member, me: string | undefined, conn: Conn): Promise<void> {
    const room = this.room;
    if (!room || m.id !== room.hostId || room.playing) return;
    let why: string;
    try {
      const r = await friends(this.env).fetch(
        new Request('https://friends/invite', { method: 'POST', body: JSON.stringify({ code: room.code, name: m.name, me: me ?? '' }) }),
      );
      why = ((await r.json()) as { why: string }).why;
    } catch {
      why = 'Could not send notifications just now.';
    }
    conn.send(JSON.stringify({ t: 'note', why }));
  }

  /** Start or stop the two clocks: the round's (while one is being played) and the tidying one. */
  private clocks(): void {
    const room = this.room;
    if (!room || room.empty()) {
      clearInterval(this.fast);
      clearInterval(this.slow);
      this.fast = this.slow = 0;
      this.room = null;
      return;
    }
    if (room.busy() && !this.fast) {
      this.fast = setInterval(() => {
        room.advance(Date.now());
        if (!room.busy()) {
          clearInterval(this.fast);
          this.fast = 0;
        }
      }, FAST_MS) as unknown as number;
    }
    if (!this.slow) {
      this.slow = setInterval(() => {
        room.housekeep(Date.now());
        this.clocks();
      }, SLOW_MS) as unknown as number;
    }
  }
}

/** A random number in [0, 1) from the server's secure source (room codes are made on the page; seeds here). */
function random(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

// ---------------------------------------------------------------- notifications

const friends = (env: Env): Stub => env.FRIENDS.get(env.FRIENDS.idFromName('all'));

/** Where the push services of phones and browsers are: a sign-up naming anywhere else is turned away. */
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
/** Who the push services can contact about these notifications (they ask for an address). */
const CONTACT = 'https://bomberbot.bomberbot.workers.dev';
/** At most this many phones on the list, and a notification goes to at most this many (a Worker's limit on requests). */
const MAX_FRIENDS = 400;
const SEND_TO = 45;
/** One Tell friends per room this often, and this many in an hour for the whole game. */
const ROOM_GAP_MS = 60_000;
const HOURLY = 30;
/** A notification still worth showing this long after it was sent (seconds). */
const TTL = 900;

interface Friend {
  endpoint: string;
  p256dh: string;
  auth: string;
  at: number;
}

/** A short name for a phone's sign-up, to keep it under on disk. */
async function keyOf(endpoint: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return 'f:' + [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
/** A sign-up as a browser sends it (`PushSubscription.toJSON()`), checked. */
function readFriend(x: unknown): Friend | null {
  const s = x as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(s.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !PUSH_HOSTS.some((h) => h.test(url.hostname))) return null;
  const p = s.keys?.p256dh;
  const a = s.keys?.auth;
  if (typeof p !== 'string' || typeof a !== 'string' || p.length > 200 || a.length > 100) return null;
  return { endpoint: s.endpoint, p256dh: p, auth: a, at: Date.now() };
}

/**
 * The phones that turned notifications on, for the whole game (one object, named 'all'). Its signing key
 * (push.ts) is made here the first time it is needed and kept on its disk, so nothing secret has to be set up.
 */
export class Friends {
  constructor(private state: DOState) {}

  private async keys(): Promise<VapidKeys> {
    let k = await this.state.storage.get<VapidKeys>('vapid');
    if (!k) {
      k = await makeVapidKeys();
      await this.state.storage.put('vapid', k);
    }
    return k;
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    const store = this.state.storage;
    if (path === '/api/push/key') return reply({ key: (await this.keys()).publicKey });
    if (req.method !== 'POST') return reply({ why: 'Expected POST' }, 405);
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return reply({ why: 'Bad request' }, 400);
    }
    if (path === '/api/push/subscribe') {
      const f = readFriend(body.sub);
      if (!f) return reply({ why: 'That is not a sign-up this game can use.' }, 400);
      const key = await keyOf(f.endpoint);
      if (!(await store.get(key)) && (await store.list({ prefix: 'f:', limit: MAX_FRIENDS })).size >= MAX_FRIENDS)
        return reply({ why: 'The list is full.' }, 507);
      await store.put(key, f);
      return reply({ ok: true });
    }
    if (path === '/api/push/unsubscribe') {
      if (typeof body.endpoint === 'string') await store.delete(await keyOf(body.endpoint));
      return reply({ ok: true });
    }
    if (path === '/invite') return reply({ why: await this.invite(body) });
    return reply({ why: 'Not found' }, 404);
  }

  /** Tell everyone on the list (but the host) that a room is open. Says how it went, in a line for the host. */
  private async invite(body: Record<string, unknown>): Promise<string> {
    const store = this.state.storage;
    const code = readCode(typeof body.code === 'string' ? body.code : '');
    if (!code) return 'No room to tell anyone about.';
    const now = Date.now();
    const last = (await store.get<number>('room:' + code)) ?? 0;
    if (now - last < ROOM_GAP_MS) return 'Friends were just told. Try again in a minute.';
    const hour = ((await store.get<number[]>('sent')) ?? []).filter((t) => now - t < 3_600_000);
    if (hour.length >= HOURLY) return 'Lots of notifications have gone out this hour. Try again later.';
    const me = typeof body.me === 'string' && body.me ? await keyOf(body.me) : '';
    const list = [...(await store.list<Friend>({ prefix: 'f:', limit: MAX_FRIENDS })).entries()].filter(([k]) => k !== me);
    if (!list.length) return 'Nobody else has notifications on yet (Settings › App).';
    // the newest sign-ups first, if there are more than one notification can reach
    list.sort((a, b) => b[1].at - a[1].at);
    await store.put('room:' + code, now);
    await store.put('sent', [...hour, now]);
    const name = (typeof body.name === 'string' && body.name.trim().slice(0, 12)) || 'A friend';
    const notice: Notice = { title: `${name} wants to play`, body: `Room ${code} is open. Tap to join.`, code, url: `/?room=${code}`, at: now };
    const text = JSON.stringify(notice);
    const keys = await this.keys();
    const secs = Math.floor(now / 1000);
    const results = await Promise.all(
      list.slice(0, SEND_TO).map(async ([key, f]) => {
        try {
          const r = await fetch(f.endpoint, {
            method: 'POST',
            headers: {
              Authorization: await vapidHeader(f.endpoint, keys, CONTACT, secs),
              'Content-Encoding': 'aes128gcm',
              'Content-Type': 'application/octet-stream',
              TTL: String(TTL),
              Urgency: 'high',
              Topic: `room-${code}`,
            },
            body: await encryptFor(f.p256dh, f.auth, text),
          });
          // gone: the phone turned them off or the app was removed
          if (r.status === 404 || r.status === 410) await store.delete(key);
          return r.ok;
        } catch {
          return false;
        }
      }),
    );
    const n = results.filter(Boolean).length;
    return n ? `Told ${n} friend${n === 1 ? '' : 's'} that room ${code} is open.` : 'The notifications did not go through. Try again in a minute.';
  }
}
