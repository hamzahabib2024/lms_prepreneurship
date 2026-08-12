import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Something that advances on its own, and stops the moment anybody engages.
 *
 * AUTO-ROTATION IS USUALLY A MISTAKE, and it is worth writing down why this one
 * is allowed. A carousel that moves while somebody is reading takes the thing
 * they were reading away, and one that cannot be stopped is unusable for anyone
 * who reads slowly, uses a keyboard, or has a vestibular disorder. So:
 *
 *   · it stops on hover, and on FOCUS — a keyboard user tabbing into a control
 *     inside the panel would otherwise have it slide away under them;
 *   · it stops while the tab is in the background, which also stops a laptop
 *     animating a page nobody is looking at;
 *   · it never starts at all if the reader asked their system to reduce motion
 *     (NFR-ACC-009), and it listens for that CHANGING rather than reading it
 *     once at mount;
 *   · and every rotator that uses it exposes manual controls, so the automatic
 *     part is a convenience rather than the only way through.
 */
export function useAutoRotate(count: number, intervalMs = 6000) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const timer = useRef<number | null>(null);

  // Read the preference, and keep reading it — somebody can turn it on while
  // the page is open, and a page that only checked at mount would ignore them.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    // One item is not a rotation, and zero would divide by zero below.
    if (reduced || paused || count < 2) return;
    timer.current = window.setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, intervalMs);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [reduced, paused, count, intervalMs]);

  // If the list shrinks — a photo failed to load and removed itself — the
  // index can be left pointing past the end.
  useEffect(() => {
    if (index >= count && count > 0) setIndex(0);
  }, [count, index]);

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  return {
    index,
    go,
    next: useCallback(() => go(index + 1), [go, index]),
    previous: useCallback(() => go(index - 1), [go, index]),
    /** Spread onto the panel: hover and keyboard focus both hold it still. */
    holdProps: {
      onMouseEnter: () => setPaused(true),
      onMouseLeave: () => setPaused(false),
      onFocus: () => setPaused(true),
      onBlur: () => setPaused(false),
    },
    /** True when nothing is moving, so a caption can say so honestly. */
    isStill: reduced || paused || count < 2,
    reduced,
  };
}
