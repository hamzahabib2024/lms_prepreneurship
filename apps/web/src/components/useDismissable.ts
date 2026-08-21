import { useEffect, type RefObject } from "react";

/**
 * A panel that closes when you click away from it, or press Escape.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A HOOK RATHER THAN THREE COPIES.
 *
 * The account menu had this behaviour and the notification inbox did not — so
 * opening the inbox and then clicking anywhere else on the page left it hanging
 * over the content, and the only way to dismiss it was to find the Inbox button
 * again and press it a second time. Nothing about the panel said so; it simply
 * behaved differently from the menu six pixels to its right.
 *
 * That is the kind of inconsistency that appears when a behaviour lives inside
 * one component: the next panel gets written without it, and nobody notices
 * until somebody uses both in the same minute. Written once, a new panel gets
 * it by asking for it.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `mousedown` RATHER THAN `click`, and the difference is not cosmetic. A click
 * fires after the button is released, so a panel containing a link would close
 * on the way down and the link would never receive its own click. Listening on
 * the way down and checking containment first means a click INSIDE the panel is
 * left entirely alone.
 *
 * ESCAPE RETURNS FOCUS to whatever opened it. Without that, dismissing by
 * keyboard drops the caret at the top of the document and the next Tab starts
 * from the skip link — which is how a panel becomes a thing keyboard users stop
 * opening.
 */
export function useDismissable(
  open: boolean,
  close: () => void,
  refs: {
    /** The panel and its trigger — a click inside either is not "away". */
    wrap: RefObject<HTMLElement | null>;
    /** Focused again on Escape. */
    trigger?: RefObject<HTMLElement | null>;
  },
): void {
  useEffect(() => {
    // Nothing is listening while it is shut. A document-level listener per
    // closed panel is a listener per panel on every click in the application.
    if (!open) return;

    const onPointer = (e: MouseEvent) => {
      if (!refs.wrap.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      refs.trigger?.current?.focus();
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
    // `close` and the refs are stable for every caller here; `open` is the
    // only thing that should arm or disarm the listeners.
  }, [open, close, refs.wrap, refs.trigger]);
}
