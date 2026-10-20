// Haptisches Feedback.
// iOS-App (Capacitor): echte Taptic-Engine · Android/Chrome: Vibration · Safari/PWA auf dem iPhone (ab iOS 18):
// das Umschalten eines unsichtbaren <input switch> löst dort ein kurzes Haptik-Signal aus.
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

let sw = null;
function iosSwitch() {
  if (!sw) {
    sw = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    sw.append(input);
    sw.setAttribute('aria-hidden', 'true');
    sw.style.cssText = 'position:fixed;left:-200px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.append(sw);
  }
  sw.click();
}

// kind: 'tick' (leicht) | 'medium' | 'strong'
export function haptic(kind = 'tick') {
  try {
    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: kind === 'strong' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
      return;
    }
    if (navigator.vibrate) { navigator.vibrate(kind === 'strong' ? 40 : kind === 'medium' ? 22 : 10); return; }
    iosSwitch();
  } catch { /* kein Haptik-Feedback verfügbar */ }
}
