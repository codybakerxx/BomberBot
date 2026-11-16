/**
 * The online server, on Cloudflare (docs/ONLINE.md). Not part of the game page: wrangler builds and uploads it
 * (wrangler.jsonc), with the game page (dist/index.html) as its static file.
 *
 * - Every request for the page itself is answered with the page (Cloudflare does that before this runs).
 * - /api/room/CODE is a WebSocket into room CODE: one Durable Object per room code (`RoomDO`), which keeps
 *   the room (room.ts) in memory, steps its rounds on a clock, and passes messages in and out.
 *
 * A room lives as long as someone is connected to it (and a little after, so a dropped phone can come back).
 * Rooms are not saved anywhere: when the last person goes, the room goes too.
 */
import { Room, type Conn, type Member } from './room';
import { parseMsg, readCode, type ClientMsg } from './net';

// The few Cloudflare Workers pieces used here (their full types are not part of this project).
declare const WebSocketPair: { new (): { 0: WebSocket; 1: WebSocket } };
interface ServerSocket extends WebSocket {
  accept(): void;
}
interface Stub {
  fetch(req: Request): Promise<Response>;
}
interface Env {
  ROOMS: { idFromName(name: string): unknown; get(id: unknown): Stub };
  ASSETS: Stub;
}

/** How often the round's clock ticks over: the round is stepped up to the time each time (60 ticks a second). */
const FAST_MS = 16;
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
    return env.ASSETS.fetch(req);
  },
};

/** One room. Cloudflare makes one per room code, the first time someone connects to that code. */
export class RoomDO {
  private room: Room | null = null;
  private fast = 0;
  private slow = 0;

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
      } else room.message(member, msg, now);
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
