import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";

/**
 * The frame every "make one of these" screen shares.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE ARE PAGES NOW AND NOT PANELS INSIDE A CARD.
 *
 * Creating a course, a subject or a batch was a panel that opened inside its
 * card on the Courses screen, and every problem with that was structural
 * rather than cosmetic:
 *
 *   THE CARD HAD TO SWALLOW THE WHOLE ROW to give the form any width, which
 *   shoved every other course off the screen — so the thing you were working
 *   on destroyed the context you were working in.
 *
 *   THERE WAS NO ADDRESS. You could not send somebody "here, edit this
 *   course", could not bookmark it, and refreshing the page threw the form
 *   away. A form with no URL is a form you can only reach by remembering the
 *   route through the interface.
 *
 *   ONLY ONE COULD BE OPEN, so comparing two batches meant closing one.
 *
 *   AND THERE WAS NO ROOM, which is the reason the forms stayed thin. A fee
 *   table, a subject picker and a teacher list do not fit in a card, so they
 *   were not offered — which is how a batch ended up being created with no
 *   teacher twenty times out of twenty-four.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ONE FRAME FOR ALL THREE, so the three screens are recognisably the same act.
 * The back link is a real link rather than `history.back()`: somebody who
 * arrived from a bookmark has no history to go back to, and the button would
 * take them out of the application entirely.
 */
export function EditorPage({
  title,
  subtitle,
  backTo = "/courses-admin",
  backLabel = "Courses",
  /** What this is, in one line, for somebody who has not made one before. */
  intro,
  /** Shown to the right of the title — a status, a warning, a count. */
  aside,
  children,
  /** Pinned at the foot: the save and the cancel. */
  actions,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  backLabel?: string;
  intro?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="editor-page">
      <Link className="editor-back" to={backTo}>
        <Icon name="chevron-left" />
        {backLabel}
      </Link>

      <header className="page-head editor-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {aside}
      </header>

      {intro && <div className="editor-intro">{intro}</div>}

      <div className="editor-body">{children}</div>

      {/*
        THE ACTIONS STAY IN VIEW. These forms are long enough to scroll, and a
        save button that has scrolled off the bottom is one people hunt for —
        or worse, assume is not there and leave the page without saving.
      */}
      {actions && <div className="editor-actions">{actions}</div>}
    </div>
  );
}

/**
 * A titled group of fields, with a sentence saying why the group exists.
 *
 * The sentence is the part that matters for somebody making their first
 * course: a heading called "Publishing" tells them nothing, and "who can see
 * this and where it appears" tells them whether to read on.
 */
export function EditorSection({
  step,
  title,
  hint,
  children,
}: {
  /** A number when the order matters, omitted when it does not. */
  step?: number;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card editor-section">
      <div className="editor-section-head">
        <h2>
          {step !== undefined && <span className="editor-step">{step}</span>}
          {title}
        </h2>
        {hint && <p className="muted small">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
