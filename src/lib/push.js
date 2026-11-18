import { supabase } from './supabase';

// Public half of the push key pair (the private half lives only in the Supabase function secrets)
export const VAPID_PUBLIC_KEY = 'BNgju1XLLKxEA9HUmYbUWnSrwby-ZUpmKo7QXTZfNjhYQ4o1sh_r0cryaKczrlIbav2XJ9HayU2fK9fqMaSFyao';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// 'on' | 'off' | 'blocked' | 'ios-install' (iPhone: must add to Home Screen first) | 'unsupported'
export async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied'
    ? 'Notifications are blocked for this app. Allow them in your phone/browser settings, then try again.'
    : 'Notifications were not allowed.');
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  const j = sub.toJSON();
  const { data: { session } } = await supabase.auth.getSession();
  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
    user_id: session?.user?.id, user_agent: navigator.userAgent.slice(0, 200),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
}
