import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api/client";
import type { Lecture } from "../pages/SubjectPage";

/**
 * The lecture player — SRS §5.7, FR-VID-008/009/010, ARC-039/040/041.
 *
 * The browser never sees a storage identifier. It asks for a ticket, and the
 * ticket yields a System URL that redirects to a short-lived signed link
 * (ARC-052). Bytes travel storage → browser directly; nothing streams through
 * the application tier.
 *
 * Watch reporting is the part with a rule behind it. FR-VID-010 computes
 * progress from DISTINCT intervals, so this records WHICH seconds were played
 * rather than a running total — otherwise looping the opening thirty seconds
 * would earn a completion. The server merges and recomputes regardless, since
 * the percentage is the one number a student has an incentive to inflate; what
 * happens here is only about sending an accurate report.
 */

interface Ticket {
  ticketId: string;
  streamUrl: string;
  expiresAt: string;
  durationSeconds: number | null;
  resumePositionSeconds: number;
  watchedPercent: number;
  /** False for staff: watch_progress:update is a student-only grant (BR-PRG-02). */
  recordsProgress?: boolean;
}

/** How often the played range is flushed to the server. */
const REPORT_EVERY_MS = 15_000;

/** Ignore a jump larger than this: it is a seek, not viewing. */
const MAX_CONTIGUOUS_JUMP_SECONDS = 3;

export function LecturePlayer({
  lecture,
  onClose,
  /**
   * "modal" is the original: a dialog over whatever page opened it, used from
   * the subject tree where a lecture is one row among many.
   *
   * "inline" is the watch page, where the video IS the page. The difference is
   * only the frame — the ticket, the reporting and the resume behaviour are
   * identical, deliberately, so there are not two playback implementations
   * that can drift apart on the one number a student can gain by inflating.
   */
  variant = "modal",
}: {
  lecture: Lecture;
  onClose: () => void;
  variant?: "modal" | "inline";
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  // Intervals played since the last flush, and the open one being extended.
  const pending = useRef<Array<[number, number]>>([]);
  const openStart = useRef<number | null>(null);
  const lastTime = useRef(0);
  const resumed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api
      .post<Ticket>(`/recorded-lectures/${lecture.id}/playback-ticket`)
      .then((t) => !cancelled && setTicket(t))
      .catch((e) =>
        !cancelled &&
        setError(
          e instanceof ApiError ? e.message : "Could not start this lecture. Please try again.",
        ),
      );
    return () => {
      cancelled = true;
    };
  }, [lecture.id]);

  /** Closes the open interval and returns everything not yet reported. */
  const drain = useCallback((): Array<[number, number]> => {
    if (openStart.current !== null && lastTime.current > openStart.current) {
      pending.current.push([openStart.current, lastTime.current]);
    }
    openStart.current = lastTime.current;
    const out = pending.current;
    pending.current = [];
    return out;
  }, []);

  const report = useCallback(async () => {
    // Nothing to report for staff, and reporting anyway is not harmless: the
    // server refuses it (student-only grant), the catch below puts the
    // intervals back, and a teacher watching a lecture would loop a 403 every
    // fifteen seconds while the pending list grew for as long as they watched.
    if (ticket && ticket.recordsProgress === false) return;
    const intervals = drain();
    if (intervals.length === 0) return;
    try {
      const result = await api.patch<{ watchedPercent: number }>(
        `/recorded-lectures/${lecture.id}/progress`,
        { positionSeconds: Math.floor(lastTime.current), watchedIntervals: intervals },
      );
      setSaved(result.watchedPercent);
    } catch {
      // Put them back. A dropped connection must not silently cost a student
      // the minutes they actually watched; the next flush retries them.
      pending.current = [...intervals, ...pending.current];
    }
  }, [drain, lecture.id, ticket]);

  useEffect(() => {
    if (!ticket) return;
    const id = window.setInterval(() => void report(), REPORT_EVERY_MS);
    return () => window.clearInterval(id);
  }, [ticket, report]);

  // A student who closes the tab mid-lecture should not lose the last stretch.
  useEffect(() => {
    const flush = () => void report();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      void report();
    };
  }, [report]);

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const now = video.currentTime;

    if (openStart.current === null) {
      openStart.current = now;
    } else if (now < lastTime.current || now - lastTime.current > MAX_CONTIGUOUS_JUMP_SECONDS) {
      // A seek. Close what was genuinely watched and start a new run at the
      // new position — without this, skipping to the end would record the
      // whole gap as viewed.
      if (lastTime.current > openStart.current) {
        pending.current.push([openStart.current, lastTime.current]);
      }
      openStart.current = now;
    }
    lastTime.current = now;
  };

  const onLoaded = () => {
    const video = videoRef.current;
    if (!video || !ticket || resumed.current) return;
    resumed.current = true;
    // FR-VID-008. Only when there is somewhere meaningful to resume to, and
    // never at the very end, where it would look like a broken player.
    const resume = ticket.resumePositionSeconds;
    if (resume > 5 && (!video.duration || resume < video.duration - 10)) {
      video.currentTime = resume;
    }
  };

  const close = () => {
    void report();
    onClose();
  };

  const body = (
    <>
      {error && (
          <div className="alert alert-error" role="alert">
            <p>{error}</p>
          </div>
        )}

        {!ticket && !error && <p className="muted">Preparing the lecture…</p>}

        {ticket && (
          <>
            <video
              ref={videoRef}
              className="player"
              src={ticket.streamUrl}
              controls
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onLoaded}
              onError={() =>
                // FR-VID-022 — say so plainly. A dead <video> element with no
                // explanation is the worst possible outcome here.
                setError(
                  "This recording could not be played. It may have been moved. Please tell your teacher.",
                )
              }
            >
              Your browser cannot play this video.
            </video>

            <p className="muted small">
              {ticket.recordsProgress === false
                ? // Staff. Saying "your progress saves automatically" to a
                  // teacher checking their own recording would be a plain
                  // untruth — nothing is saved, deliberately (BR-PRG-02).
                  "You are watching as staff. Nothing here is recorded against anyone's progress."
                : saved !== null
                  ? `Progress saved — ${Math.round(saved)}% watched.`
                  : ticket.watchedPercent > 0
                    ? `${Math.round(ticket.watchedPercent)}% watched previously.`
                    : "Your progress saves automatically."}
            </p>
          </>
        )}
    </>
  );

  // The video is the page: no dialog, no backdrop, nothing to dismiss. The
  // page's own heading names the lecture, so a second <h2> here would read it
  // out twice to a screen reader.
  if (variant === "inline") return <div className="player-stage">{body}</div>;

  return (
    // NFR-ACC-002 — a modal announces itself and can be dismissed from the
    // keyboard alone.
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={lecture.title}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <div className="modal">
        <header className="modal-head">
          <h2>{lecture.title}</h2>
          <button className="btn btn-quiet" onClick={close} autoFocus>
            Close
          </button>
        </header>
        {body}
      </div>
    </div>
  );
}
