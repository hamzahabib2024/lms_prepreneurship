import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";

/**
 * YOUR CLASS HAS STARTED — FR-LIV.
 *
 * The dashboard says when the next class IS, and then says nothing when it
 * begins. A student with the LMS open in a tab had no way of knowing a class
 * had started; the only way to find out was to go and look.
 *
 * That is worst for a class called on the spot, which by definition nobody had
 * in their timetable — the whole point of starting one is that people are meant
 * to come, and a room nobody knows about is an empty room.
 *
 * Deliberately app-wide rather than on the dashboard. A student reading an
 * announcement or working through a quiz is exactly the person who needs
 * telling; putting it on one screen would reach only the people already looking
 * at that screen.
 */

interface LiveNow {
  id: string;
  title: string;
  subject: string;
  hasStarted: boolean;
}

/** How often to ask. See the note on the interval below. */
const POLL_MS = 30_000;

export function LiveNowBanner() {
  const location = useLocation();
  const [rows, setRows] = useState<LiveNow[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const tick = () => {
      void api
        .get<LiveNow[]>("/me/live-now")
        .then((r) => {
          if (!cancelled) setRows(r);
        })
        .catch(() => {
          // Silent. This is a courtesy, not a feature anybody is waiting on,
          // and a red error over the whole application because one poll failed
          // would be far worse than not being told.
          if (!cancelled) setRows([]);
        });
    };

    tick();
    /*
     * THIRTY SECONDS, AND NOT A LIVE PUSH.
     *
     * A websocket would be exact and would also be a second connection per
     * signed-in user, held open all day, for a message that arrives a handful
     * of times a week. Half a minute late to a class that runs an hour is not a
     * cost anybody can measure; the query is scoped, indexed and small.
     */
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Not on the class page itself — telling somebody the class has started while
  // they are looking at it is noise, and it would sit over the video.
  if (location.pathname.startsWith("/classes/")) return null;

  const live = rows.find((r) => r.hasStarted && !dismissed.includes(r.id));
  if (!live) return null;

  return (
    /*
     * `role="status"`, not `alert`. A screen reader announces it at the next
     * natural pause instead of interrupting whatever the student is reading —
     * a class starting is worth knowing, not worth cutting somebody off for.
     */
    <div className="live-now-banner" role="status">
      <span className="live-dot" aria-hidden="true" />
      <span className="live-now-text">
        <strong>{live.subject}</strong> has started.
      </span>
      <Link className="btn btn-primary btn-sm" to={`/classes/${live.id}`}>
        Join now
      </Link>
      {/*
        Dismissible, because the alternative is a bar that pulses at somebody
        for the full hour of a class they have decided not to attend, or have
        already attended and left. It comes back for the next class.
      */}
      <button
        type="button"
        className="live-now-dismiss"
        aria-label="Hide this notice"
        onClick={() => setDismissed((d) => [...d, live.id])}
      >
        ×
      </button>
    </div>
  );
}
