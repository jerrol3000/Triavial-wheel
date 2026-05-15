import React, { useEffect, useState } from "react";
import { load, save } from "../utils/storage";

// PWA install prompt — captures the `beforeinstallprompt` event and shows a
// small banner after the user has spun the wheel at least twice (so we're
// not nagging on first visit). Stays dismissed for 14 days after "Not now".
const DISMISS_KEY = "pwa_dismissed_until";
const SPINS_KEY = "pwa_spin_counter";

export default function InstallPrompt() {
  const [deferredEvt, setDeferredEvt] = useState(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredEvt(e);
      // Already installed? Most browsers don't fire `beforeinstallprompt` then,
      // but check via display-mode just in case.
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return;
      const dismissedUntil = load(DISMISS_KEY, 0);
      if (Date.now() < dismissedUntil) return;
      const spins = load(SPINS_KEY, 0);
      if (spins < 2) return; // wait until 2nd spin
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Track spins by listening on a global counter the Home component bumps.
    const onSpin = () => {
      const n = load(SPINS_KEY, 0) + 1;
      save(SPINS_KEY, n);
      if (n >= 2 && deferredEvt) {
        const dismissedUntil = load(DISMISS_KEY, 0);
        if (Date.now() > dismissedUntil) setShow(true);
      }
    };
    window.addEventListener("triviaspin", onSpin);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("triviaspin", onSpin);
    };
  }, [deferredEvt]);

  const install = async () => {
    if (!deferredEvt) return;
    deferredEvt.prompt();
    try {
      const result = await deferredEvt.userChoice;
      if (result.outcome !== "accepted") {
        save(DISMISS_KEY, Date.now() + 14 * 24 * 60 * 60 * 1000);
      }
    } catch (e) {}
    setShow(false);
    setDeferredEvt(null);
  };

  const dismiss = () => {
    save(DISMISS_KEY, Date.now() + 14 * 24 * 60 * 60 * 1000);
    setShow(false);
  };

  if (!show || !deferredEvt) return null;
  return (
    <div className="tw-install-prompt" role="dialog">
      <div className="tw-row" style={{ gap: 10 }}>
        <span style={{ fontSize: 28 }}>📲</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>Install Trivia Wheel</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Plays offline, opens like an app, no ads when Pro.</div>
        </div>
        <button className="tw-btn" onClick={install}>Install</button>
        <button className="tw-btn ghost sm" onClick={dismiss} title="Not now">×</button>
      </div>
    </div>
  );
}
