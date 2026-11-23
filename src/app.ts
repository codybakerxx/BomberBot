/**
 * BomberBot as an app on the phone's home screen, and notifications (Settings › App).
 *
 * - Adding it: iPhones only add a website by hand (Share › Add to Home Screen); Android Chrome and computers
 *   can be asked to install it (`beforeinstallprompt`). `howToAdd` says which steps fit this device.
 * - Notifications (Web Push): this phone signs up with its push service, and the sign-up goes to the server
 *   (worker.ts, `Friends`), which sends "Cody wants to play: room BKTW" when a host taps Tell friends. An iPhone
 *   only allows them in the home-screen app (iOS 16.4 and newer), never in Safari itself.
 */

/** Opened from the home screen, as an app. */
export function isApp(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}
/** On the game's website (not a copy opened as a file). Notifications and the home screen need it. */
export function onWebsite(): boolean {
  return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}
/** An iPhone or iPad (an iPad asks for the computer version of pages, so it looks like a Mac with a touch screen). */
export function isApple(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

export type Where = 'app' | 'file' | 'apple' | 'android' | 'computer';
export function howToAdd(): Where {
  if (isApp()) return 'app';
  if (!onWebsite()) return 'file';
  if (isApple()) return 'apple';
  if (/Android/.test(navigator.userAgent)) return 'android';
  return 'computer';
}

// the browser's own install offer (Android Chrome, Chrome and Edge on a computer), kept for the Install button
interface InstallOffer extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let offer: InstallOffer | null = null;
let offerChanged: () => void = () => {};
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  offer = e as InstallOffer;
  offerChanged();
});
addEventListener('appinstalled', () => {
  offer = null;
  offerChanged();
});
/** The browser can install it with one button. `onChange` is called when that changes. */
export function canInstall(onChange?: () => void): boolean {
  if (onChange) offerChanged = onChange;
  return !!offer;
}
export async function install(): Promise<void> {
  if (!offer) return;
  const o = offer;
  offer = null;
  await o.prompt();
  await o.userChoice.catch(() => null);
  offerChanged();
}

// ---------------------------------------------------------------- notifications

export type PushState =
  /** this browser cannot (an iPhone outside the home-screen app, an old browser, a copy opened as a file) */
  | 'cannot'
  /** turned down for this game: only the phone's own settings can turn them back on */
  | 'blocked'
  | 'on'
  | 'off';

function supported(): boolean {
  // (an iPhone allows them only in the home-screen app, whatever Safari shows of the pieces)
  return onWebsite() && (isApp() || !isApple()) && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
/**
 * The service worker (src/sw.js), once it is running: null if this browser cannot have one, or if it is not
 * running within `ms`. (`ready` waits for ever when the worker never starts, and a button waiting on it would
 * look as if it did nothing.)
 */
async function registration(ms = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise<null>((done) => setTimeout(() => done(null), ms))]);
  } catch {
    return null;
  }
}
async function subscription(ms?: number): Promise<PushSubscription | null> {
  const reg = await registration(ms);
  try {
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}
/** This phone's sign-up address, kept beside the game so the bell does not have to wait for the worker to find it. */
const MINE = 'pushEndpoint';
function keepMine(endpoint: string | null): void {
  try {
    if (endpoint) localStorage.setItem(MINE, endpoint);
    else localStorage.removeItem(MINE);
  } catch {
    /* optional */
  }
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'cannot';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && (await subscription()) ? 'on' : 'off';
}

function keyBytes(s: string): Uint8Array<ArrayBuffer> {
  const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}

/** Turn notifications on: ask the phone, sign up, tell the server. Says what went wrong, or '' if it worked. */
export async function pushOn(): Promise<string> {
  const reg = await registration();
  if (!reg) return supported() ? 'BomberBot is still getting ready on this phone. Try again in a moment.' : 'This browser cannot show notifications.';
  const ok = await Notification.requestPermission();
  if (ok !== 'granted') return ok === 'denied' ? 'Notifications are blocked for BomberBot.' : '';
  try {
    const r = await fetch('/api/push/key', { cache: 'no-store' });
    const { key } = (await r.json()) as { key: string };
    let sub = await reg.pushManager.getSubscription();
    // signed up with an older key: start again
    if (sub && sub.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).join() !== keyBytes(key).join()) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    const s = await fetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ sub: sub.toJSON() }) });
    if (!s.ok) return ((await s.json().catch(() => null)) as { why?: string } | null)?.why ?? 'The server did not take it.';
    keepMine(sub.endpoint);
    return '';
  } catch {
    return 'Could not reach the server. Check your connection and try again.';
  }
}

/**
 * This phone's sign-up, made sure of: the phone's current one, signed up again if it has none or one made with
 * an older key, and sent to the server. Run every time the game opens with notifications allowed, and before a
 * test. An iPhone can replace or drop its sign-up on its own (after an update, or now and then), and the server
 * then held an address that no longer reached the phone, while the phone still showed invites as on: the likely
 * reason invites never arrived (the owner and a friend, November 2026). Says what went wrong, or ''.
 */
export async function pushRefresh(): Promise<string> {
  if (!supported() || Notification.permission !== 'granted') return 'Room invites are not on for this phone.';
  const reg = await registration();
  if (!reg) return 'BomberBot is still getting ready on this phone. Try again in a moment.';
  try {
    const r = await fetch('/api/push/key', { cache: 'no-store' });
    const { key } = (await r.json()) as { key: string };
    let sub = await reg.pushManager.getSubscription();
    if (sub && sub.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).join() !== keyBytes(key).join()) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    const old = (() => {
      try {
        return localStorage.getItem(MINE);
      } catch {
        return null;
      }
    })();
    const s = await fetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ sub: sub.toJSON() }) });
    if (!s.ok) return ((await s.json().catch(() => null)) as { why?: string } | null)?.why ?? 'The server did not take it.';
    // the phone's old address, if it changed: off the list, so nobody sends to it
    if (old && old !== sub.endpoint) await fetch('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: old }) }).catch(() => null);
    keepMine(sub.endpoint);
    return '';
  } catch {
    return 'Could not reach the server. Check your connection and try again.';
  }
}

/** A test notification to this phone (Settings › App). Says how it went, in the push service's words if it failed. */
export async function pushTest(): Promise<{ ok: boolean; why: string }> {
  const why = await pushRefresh();
  if (why) return { ok: false, why };
  const endpoint = (await subscription())?.endpoint;
  try {
    const r = await fetch('/api/push/test', { method: 'POST', body: JSON.stringify({ endpoint }) });
    return (await r.json()) as { ok: boolean; why: string };
  } catch {
    return { ok: false, why: 'Could not reach the server. Check your connection and try again.' };
  }
}

export async function pushOff(): Promise<void> {
  keepMine(null);
  const sub = await subscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  await fetch('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }).catch(() => null);
}

/**
 * This phone's own sign-up, so a host's Tell friends leaves it out. Never waits more than a moment for the
 * service worker (the bell must always answer); then the address kept when notifications were turned on.
 */
export async function myEndpoint(): Promise<string | undefined> {
  const live = (await subscription(1200))?.endpoint;
  if (live) return live;
  try {
    return localStorage.getItem(MINE) ?? undefined;
  } catch {
    return undefined;
  }
}
