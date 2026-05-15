// Light haptic-feedback helper. navigator.vibrate is a no-op on devices
// without a vibration motor (most desktops, iOS Safari), so calls are safe
// to fire unconditionally.
export const haptic = {
  light:   () => safeVibrate(15),
  medium:  () => safeVibrate(35),
  heavy:   () => safeVibrate([40, 20, 40]),
  success: () => safeVibrate([20, 30, 20]),
  fail:    () => safeVibrate([60, 40, 60]),
  win:     () => safeVibrate([30, 50, 30, 50, 80]),
};

function safeVibrate(pattern) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch (e) { /* ignore */ }
}
