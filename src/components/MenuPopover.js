import React, { useEffect, useRef, useState } from "react";

// Generic popover anchor + content container with two responsibilities
// the inline popovers in FriendsPanel kept getting wrong:
//   1. Click-outside / Escape / scroll-away dismissal
//   2. Avoiding off-screen positioning on narrow viewports
//
// Behavior:
//   - Desktop (≥ MOBILE_BREAK): renders the trigger inline and floats
//     the content directly below it (`top: 100%`), but clamps the
//     horizontal position so the menu never spills past the viewport.
//     Closes on outside click, Escape, or page scroll.
//   - Mobile (< MOBILE_BREAK): renders the trigger inline and shows
//     the content as a bottom sheet (full-width, anchored to the
//     bottom of the viewport, respects safe-area-inset-bottom). Same
//     dismissal triggers + tap-on-backdrop.
//
// The component takes `trigger` (the button you press) and `children`
// (the menu content). Both must be a single ReactNode.

const MOBILE_BREAK = 640;
const PANEL_BG = "#1a1530";
const PANEL_BORDER = "rgba(124,58,237,0.45)";

export default function MenuPopover({ trigger, children, label, align = "right" }) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia(`(max-width: ${MOBILE_BREAK}px)`).matches
  );
  // Desktop popover flip direction. After the panel mounts we measure
  // the trigger's position; if there isn't enough room below to fit
  // the menu, render above the trigger instead. Without this, the
  // gift / play menu on the friends panel could vanish below the
  // viewport when the friend row was near the bottom of the card.
  const [flipUp, setFlipUp] = useState(false);
  const anchorRef = useRef(null);
  const panelRef = useRef(null);

  // Track viewport size so a phone-rotated-to-landscape flip switches
  // between bottom-sheet and popover layouts mid-session.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAK}px)`);
    const onChange = (e) => setIsMobile(e.matches);
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener(onChange);
    };
  }, []);

  // After the desktop popover renders, measure its actual size + the
  // trigger's viewport position. If the menu would extend past the
  // bottom of the viewport, flip it above the trigger. Runs once per
  // open so closing + reopening at a different scroll position will
  // re-evaluate the direction.
  useEffect(() => {
    if (!open || isMobile) { setFlipUp(false); return; }
    // Defer one frame so the panel has been laid out and we can read
    // its actual height (it's display:flex with content).
    const id = requestAnimationFrame(() => {
      if (!anchorRef.current || !panelRef.current) return;
      const anchorRect = anchorRef.current.getBoundingClientRect();
      const panelHeight = panelRef.current.offsetHeight;
      const spaceBelow = window.innerHeight - anchorRect.bottom;
      const spaceAbove = anchorRect.top;
      // Flip up only when there's clearly not enough room below AND
      // there's more room above. Avoids unnecessary flips when the
      // menu fits below.
      if (spaceBelow < panelHeight + 12 && spaceAbove > spaceBelow) {
        setFlipUp(true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [open, isMobile]);

  // Dismiss on outside click / Escape / scroll-away. Mobile sheet
  // also intercepts backdrop taps (rendered below).
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    // Only desktop popover dismisses on scroll — mobile sheet stays
    // open during in-sheet scrolling.
    if (!isMobile) window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      if (!isMobile) window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, isMobile]);

  const toggle = (e) => {
    e.stopPropagation();
    setOpen((v) => !v);
  };

  // Renders the children + auto-closes on any click inside that
  // matches a <button> (typical menu-item interaction). Avoids each
  // caller having to remember to setOpen(false) per item.
  const close = () => setOpen(false);
  const wrappedChildren = (
    <div
      onClick={(e) => {
        // Close on item button clicks but NOT on label/heading clicks.
        let el = e.target;
        while (el && el !== e.currentTarget) {
          if (el.tagName === "BUTTON") { close(); break; }
          el = el.parentElement;
        }
      }}
    >
      {children}
    </div>
  );

  return (
    <span ref={anchorRef} style={{ position: "relative", display: "inline-flex" }}>
      {React.cloneElement(trigger, {
        onClick: (e) => {
          if (trigger.props.onClick) trigger.props.onClick(e);
          toggle(e);
        },
        "aria-expanded": open,
        "aria-haspopup": "menu",
      })}

      {open && !isMobile && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          style={{
            position: "absolute",
            // flipUp anchors the panel ABOVE the trigger using bottom;
            // default anchors BELOW with top. Visibility:hidden during
            // the first frame avoids a flicker as we measure and
            // potentially flip.
            ...(flipUp
              ? { bottom: "calc(100% + 4px)" }
              : { top: "calc(100% + 4px)" }),
            [align]: 0,
            // Cap to viewport on BOTH axes so the menu never extends
            // off the visible area.
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "calc(100vh - 24px)",
            overflowY: "auto",
            minWidth: 180,
            background: PANEL_BG,
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 10,
            padding: 8,
            boxShadow: flipUp
              ? "0 -12px 28px rgba(0,0,0,0.5)"
              : "0 12px 28px rgba(0,0,0,0.5)",
            zIndex: 50,
          }}
        >
          {wrappedChildren}
        </div>
      )}

      {open && isMobile && (
        <>
          <div
            onClick={close}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.55)",
              zIndex: 80,
              animation: "fadeIn 0.18s ease",
            }}
          />
          <div
            ref={panelRef}
            role="menu"
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: 12, right: 12,
              bottom: "calc(12px + env(safe-area-inset-bottom))",
              background: PANEL_BG,
              border: `1px solid ${PANEL_BORDER}`,
              borderRadius: 16,
              padding: 14,
              boxShadow: "0 -12px 36px rgba(0,0,0,0.5)",
              zIndex: 90,
              maxHeight: "70vh",
              overflowY: "auto",
              animation: "fadeIn 0.22s ease",
            }}
          >
            {wrappedChildren}
          </div>
        </>
      )}
    </span>
  );
}
