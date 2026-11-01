import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import { StatusBar } from '@capacitor/status-bar';

// In the iOS app the game still reads and writes localStorage (it's synchronous and simple),
// but iOS can clear a web view's storage, so every save is mirrored to native storage
// and copied back in before the game starts.

const native = Capacitor.isNativePlatform();
const PREFIX = 'sling-plane:';

/** Before the game loads: refill localStorage from native storage, hide the status bar. */
export async function bootNative() {
  if (!native) return;
  StatusBar.hide().catch(() => {});
  try {
    const { keys } = await Preferences.keys();
    for (const key of keys) {
      if (!key.startsWith(PREFIX)) continue;
      const { value } = await Preferences.get({ key });
      if (value !== null) localStorage.setItem(key, value);
    }
  } catch {}
}

/** Mirror one save to native storage. */
export function persist(key: string, raw: string) {
  if (native) Preferences.set({ key: PREFIX + key, value: raw }).catch(() => {});
}

/** A buzz: real haptics in the app (iPhones ignore navigator.vibrate), vibration on Android web. */
export function buzz(ms: number) {
  if (native) Haptics.impact({ style: ms >= 50 ? ImpactStyle.Heavy : ms >= 25 ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {});
  else navigator.vibrate?.(ms);
}
