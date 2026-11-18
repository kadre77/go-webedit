// The phone layout's plumbing: which layout the viewport gets, keeping the
// app inside the part of the screen the on-screen keyboard leaves visible,
// and the swipes that open and close the drawer.

import { type Accessor, createSignal, onCleanup } from "solid-js";
import { phoneQuery } from "./settings";

/** Whether the viewport is narrow enough for the phone layout, kept up to
 * date as the viewport changes. */
export function createIsPhone(): Accessor<boolean> {
  const query = matchMedia(phoneQuery);
  const [isPhone, setIsPhone] = createSignal(query.matches);
  const onChange = () => setIsPhone(query.matches);
  query.addEventListener("change", onChange);
  onCleanup(() => query.removeEventListener("change", onChange));
  return isPhone;
}

/** Sizes the app to the visual viewport, which shrinks when the on-screen
 * keyboard opens, so the phone toolbar stays above the keyboard. Chrome on
 * Android also resizes the page itself (interactive-widget=resizes-content
 * in index.html); Safari on iOS doesn't, and instead scrolls the page, so the
 * page is scrolled back to the top. */
export function useVisualViewportHeight() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const root = document.documentElement;
  const update = () => {
    root.style.setProperty("--app-height", `${viewport.height}px`);
    // Pinch-zoomed in, the Owner is panning around on purpose.
    if (window.scrollY !== 0 && viewport.scale <= 1) window.scrollTo(0, 0);
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  onCleanup(() => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    root.style.removeProperty("--app-height");
  });
}

/** How close to the left edge a swipe must start to open the drawer. */
const swipeEdge = 32;
/** How far a swipe must travel sideways, more than it travels up or down. */
const swipeDistance = 60;

/** Opens the drawer on a touch swipe in from the left edge of the screen and
 * closes it on a swipe to the left, while `enabled` says the phone layout is
 * showing. */
export function useDrawerSwipes(drawer: { enabled: Accessor<boolean>; isOpen: Accessor<boolean>; setOpen(open: boolean): void }) {
  let start: { x: number; y: number } | undefined;
  const onStart = (e: TouchEvent) => {
    const t = e.touches[0];
    start = e.touches.length === 1 && drawer.enabled() ? { x: t.clientX, y: t.clientY } : undefined;
    if (start && !drawer.isOpen() && start.x > swipeEdge) start = undefined;
  };
  const onMove = (e: TouchEvent) => {
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    if (Math.abs(dx) < swipeDistance || Math.abs(dx) < 2 * Math.abs(t.clientY - start.y)) return;
    if (dx > 0 && !drawer.isOpen()) drawer.setOpen(true);
    else if (dx < 0 && drawer.isOpen()) drawer.setOpen(false);
    start = undefined;
  };
  const onEnd = () => (start = undefined);
  window.addEventListener("touchstart", onStart, { passive: true });
  window.addEventListener("touchmove", onMove, { passive: true });
  window.addEventListener("touchend", onEnd, { passive: true });
  window.addEventListener("touchcancel", onEnd, { passive: true });
  onCleanup(() => {
    window.removeEventListener("touchstart", onStart);
    window.removeEventListener("touchmove", onMove);
    window.removeEventListener("touchend", onEnd);
    window.removeEventListener("touchcancel", onEnd);
  });
}
