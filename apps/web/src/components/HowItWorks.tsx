import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * WHAT THIS SCREEN IS FOR, DRAWN AS THE SEQUENCE IT ACTUALLY IS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM IT SOLVES. Every screen in this System is legible once you know
 * what it is for, and opaque until then. A teacher opening "Marking" for the
 * first time sees a list of section names; nothing on it says that marking
 * happens one submission at a time, that marks are entered raw and the penalty
 * is computed, or that grades stay hidden until the whole class is released.
 * Those are the three facts that make the screen make sense, and they were
 * written down only in the source code.
 *
 * WHY A STRIP OF STEPS RATHER THAN A PICTURE. A drawn diagram would be an
 * image: it cannot be read aloud, it does not reflow on a phone, it is
 * invisible to a search, and it goes stale the moment the screen changes
 * because nobody edits an SVG to match a renamed button. These steps are
 * ordinary markup — numbered, connected by an arrow that is decoration only,
 * and readable in order by a screen reader as the list of instructions they
 * are. On a narrow screen the row becomes a column and the arrows turn to
 * point downwards, which is the same diagram in the shape that fits.
 *
 * WHY IT IS DISMISSIBLE AND WHY IT COMES BACK. Guidance that cannot be shut up
 * is guidance people learn to scroll past, and by the fourth week it is a band
 * of noise above the work. It collapses to a single quiet line, remembers that
 * per screen, and the line stays — so somebody who dismissed it in March can
 * still find it in June. Remembered in localStorage rather than on the server
 * because it is a preference of this person at this desk, not a fact about
 * them worth storing in the Institute's records.
 *
 * IT IS NEVER THE ONLY EXPLANATION. Anything a user MUST know to avoid a
 * mistake belongs next to the control that makes it, not in a panel they may
 * have collapsed. This is orientation — the shape of the task — and the
 * screens still have to work for somebody who never opens it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface Step {
  /** An Icon name. A step without a picture is still a step. */
  icon: string;
  title: string;
  body: string;
}

const KEY = (id: string) => `lms.howitworks.${id}`;

export function HowItWorks({
  id,
  title,
  intro,
  steps,
  /** Shown under the steps: the one thing people get wrong here. */
  note,
}: {
  /** Stable per screen — it is the memory key. Renaming it re-shows the panel. */
  id: string;
  title: string;
  intro?: string;
  steps: Step[];
  note?: string;
}) {
  /*
   * OPEN THE FIRST TIME, and this starts as `null` rather than `true` so the
   * first paint does not flash the panel open for somebody who dismissed it
   * months ago. Nothing renders until the stored answer has been read.
   */
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(KEY(id)) !== "collapsed");
    } catch {
      // Private browsing, or storage disabled. Showing it is the safer default:
      // guidance nobody asked for beats a screen nobody understands.
      setOpen(true);
    }
  }, [id]);

  const remember = useCallback(
    (next: boolean) => {
      setOpen(next);
      try {
        window.localStorage.setItem(KEY(id), next ? "open" : "collapsed");
      } catch {
        // The panel still works this session; only the memory is lost.
      }
    },
    [id],
  );

  if (open === null) return null;

  if (!open) {
    return (
      <div className="howto howto-collapsed">
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => remember(true)}>
          <Icon name="alert" />
          {title}
        </button>
      </div>
    );
  }

  return (
    <section className="howto" aria-labelledby={`howto-${id}`}>
      <header className="howto-head">
        <h2 id={`howto-${id}`} className="howto-title">
          {title}
        </h2>
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          onClick={() => remember(false)}
          aria-label={`Hide ${title}`}
        >
          Hide
        </button>
      </header>

      {intro && <p className="howto-intro">{intro}</p>}

      {/*
        An ordered list, because that is what it is. The arrows between the
        steps are drawn by CSS and marked decorative — a screen reader gets
        "1, 2, 3" from the list itself, which is the same information without
        the noise.
      */}
      <ol className="howto-steps">
        {steps.map((s, i) => (
          <li className="howto-step" key={s.title}>
            <span className="howto-step-mark" aria-hidden="true">
              <Icon name={s.icon} />
              <span className="howto-step-n">{i + 1}</span>
            </span>
            <span className="howto-step-body">
              <strong>{s.title}</strong>
              <span className="muted small">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>

      {note && (
        <p className="howto-note">
          <Icon name="alert" />
          <span>{note}</span>
        </p>
      )}
    </section>
  );
}
