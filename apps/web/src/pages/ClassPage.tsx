import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { Icon } from "../components/Icon";

interface SessionSummary {
  id: string;
  title: string;
  subject: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  joinWindowOpensAt: string;
}

/**
 * What the server says about getting in — FR-LIV-007, ARC-025.
 *
 * The client branches on `kind` and NOTHING ELSE. It never inspects a URL,
 * never looks for a vendor's name in one, never decides for itself whether a
 * link is joinable. That is the whole point of the abstraction: replacing
 * Google Meet with a provider that embeds changes what arrives here, and not
 * one line of this page.
 */
type JoinRoute = { session: SessionSummary } & (
  | { kind: "EXTERNAL_REDIRECT"; url: string; opensInNewTab: boolean }
  | { kind: "EMBEDDED_ROUTE"; internalPath: string; token: string }
  | { kind: "UNAVAILABLE"; reasonCode: string; message: string; retryAfter?: string }
);

/**
 * One scheduled class, inside the LMS — FR-LIV-006/007/019.
 *
 * THE JOIN BUTTON DID NOTHING. The dashboard rendered "Join class" with no
 * click handler at all, and the join-route endpoint — the one the entire
 * provider abstraction exists to serve — had never been called by anything in
 * the web app. A student could see that a class existed and had no way in.
 *
 * WHY THE VIDEO IS NOT ON THIS PAGE, when the recordings are.
 *
 * A recording is bytes in a file: the server fetches them and re-serves them,
 * which is exactly what the watch page does. A live class is a WebRTC session
 * negotiated between the student's browser and Google, so there is nothing for
 * our server to fetch. Google settles it either way — meet.google.com answers
 * X-Frame-Options: SAMEORIGIN, so every browser refuses to display Meet inside
 * this page, whatever we build.
 *
 * So this page owns EVERYTHING EXCEPT THE VIDEO SURFACE: when the class is,
 * whether it has started, how long until it does, one press to get in,
 * attendance recorded at that moment, and the recording afterwards. The
 * student never navigates Google themselves and never hunts for a link in a
 * WhatsApp message.
 *
 * AND IT IS READY FOR THE OTHER ANSWER. EMBEDDED_ROUTE is handled below and
 * renders the class inside this page. Nothing here knows the difference, so
 * the day the Institute moves live classes to a provider that permits framing,
 * that branch starts being taken and this file does not change.
 */
export function ClassPage() {
  const { sessionId = "" } = useParams();
  const [route, setRoute] = useState<JoinRoute | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [joined, setJoined] = useState(false);
  /**
   * What the register did, in the server's own words.
   *
   * Not a boolean. A refusal here is usually not a failure at all: when the
   * class is marked by the teacher the server answers "Your teacher takes the
   * register for this class", and reporting that as "could not be recorded"
   * tells a student something is broken when nothing is. The server already
   * says the right thing; this repeats it rather than guessing.
   */
  const [attendance, setAttendance] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setRoute(await api.get<JoinRoute>(`/live-sessions/${sessionId}/join-route`));
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * A ticking clock, so "starts in 4 minutes" is still true a minute later.
   *
   * Without it a student sitting on the page watching the countdown sees it
   * frozen and has to guess when to reload — which is exactly the moment they
   * are most anxious about being late.
   */
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Ask the server again the moment the window is due to open. The decision is
  // the server's; this only stops the page showing a stale refusal.
  useEffect(() => {
    if (!route || route.kind !== "UNAVAILABLE" || route.reasonCode !== "WINDOW_NOT_OPEN") return;
    const wait = new Date(route.session.joinWindowOpensAt).getTime() - Date.now();
    if (wait <= 0 || wait > 6 * 60 * 60 * 1000) return;
    const id = window.setTimeout(() => void load(), wait + 1000);
    return () => window.clearTimeout(id);
  }, [route, load]);

  /**
   * Joining, and recording that it happened.
   *
   * THE WINDOW IS OPENED FIRST, from the click itself. A window opened after
   * an await is opened by a timer as far as the browser is concerned, and
   * every pop-up blocker stops it — the student presses Join and nothing
   * happens at all, which is the worst failure this page could have.
   *
   * Attendance is recorded afterwards and its failure is swallowed: a register
   * that did not save must never be the reason somebody misses their class.
   */
  const join = useCallback(async () => {
    if (route?.kind !== "EXTERNAL_REDIRECT") return;
    window.open(route.url, "_blank", "noopener,noreferrer");
    setJoined(true);
    try {
      await api.post(`/live-sessions/${sessionId}/check-in`);
      setAttendance("Your attendance has been recorded.");
    } catch (e) {
      // The server's message, whatever it is: policy, a closed window, or a
      // genuine fault. All three are things a student can act on, and none
      // of them is improved by this page inventing its own wording.
      setAttendance(
        e instanceof ApiError
          ? (e.details?.[0]?.message ?? e.message)
          : "Your attendance could not be recorded automatically — your teacher can mark it.",
      );
    }
  }, [route, sessionId]);

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <strong>Could not open this class</strong>
        <p>{error.message}</p>
        <Link className="btn" to="/timetable">
          Back to the timetable
        </Link>
      </div>
    );
  }
  if (!route) return <p className="muted">Loading…</p>;

  const s = route.session;
  const startsIn = new Date(s.scheduledStart).getTime() - now;
  const endsIn = new Date(s.scheduledEnd).getTime() - now;
  const live = startsIn <= 0 && endsIn > 0;

  return (
    <>
      <header className="page-head class-head">
        <div>
          <p className="muted small">
            <Link to="/timetable">Timetable</Link> · {s.subject}
          </p>
          <h1>{s.title}</h1>
          <p className="muted small">
            {new Date(s.scheduledStart).toLocaleString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" – "}
            {new Date(s.scheduledEnd).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        {live && (
          <span className="pill pill-live">
            <span className="live-dot" aria-hidden="true" /> live now
          </span>
        )}
      </header>

      <div className="class-stage">
        {route.kind === "EMBEDDED_ROUTE" ? (
          /* The class inside the page. Never reached with Google Meet, which
             forbids framing — this is the branch a provider that permits it
             would take, and it is here so that switching costs no interface
             work at all. */
          <iframe
            className="class-frame"
            title={s.title}
            src={`${route.internalPath}?t=${encodeURIComponent(route.token)}`}
            allow="camera; microphone; display-capture; fullscreen"
          />
        ) : route.kind === "UNAVAILABLE" ? (
          <div className="class-waiting">
            <Icon name="clock" />
            <p className="class-waiting-message">{route.message}</p>
            {route.reasonCode === "WINDOW_NOT_OPEN" && startsIn > 0 && (
              <p className="class-countdown">{formatCountdown(startsIn)}</p>
            )}
            <p className="muted small">
              You do not need to do anything — this page opens the class by itself when it is time.
            </p>
          </div>
        ) : joined ? (
          <div className="class-waiting">
            <Icon name="check" />
            <p className="class-waiting-message">You are in the class.</p>
            {attendance && <p className="muted small">{attendance}</p>}
            {/* The window can be closed by accident, or blocked. One press gets
                back in without starting the whole page again. */}
            <button className="btn" onClick={() => void join()}>
              Open the class again
            </button>
          </div>
        ) : (
          <div className="class-waiting">
            <Icon name="play" />
            <p className="class-waiting-message">
              {live ? "This class is running now." : "The class is ready for you to join."}
            </p>
            <button className="btn btn-primary btn-lg" onClick={() => void join()}>
              Join the class
            </button>
            {/* Said BEFORE they press it, not after. A video window appearing
                over the page is alarming when it is unexpected, and somebody on
                a phone needs to know to come back to this tab afterwards. */}
            <p className="muted small">
              The class opens in a new window. Come back here afterwards — the recording appears on
              this page once your teacher publishes it.
            </p>
          </div>
        )}
      </div>

      <section className="class-notes">
        <h2>While you are here</h2>
        <ul className="list small">
          <li>
            Your attendance is recorded when you press <strong>Join the class</strong>, so join
            from this page rather than from a link somebody sent you.
          </li>
          <li>
            If the class does not open, your browser may have blocked the window — allow pop-ups
            for this site and press Join again.
          </li>
          <li>Recordings appear under the class once your teacher publishes them.</li>
        </ul>
      </section>
    </>
  );
}

/** "4 minutes", "2 hours 10 minutes", "3 days" — and never "0 minutes". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `starts in ${days} day${days === 1 ? "" : "s"}`;
  if (hours > 0) {
    return `starts in ${hours} hour${hours === 1 ? "" : "s"}${
      minutes > 0 ? ` ${minutes} minute${minutes === 1 ? "" : "s"}` : ""
    }`;
  }
  if (minutes > 0) return `starts in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  // Under a minute counts down in seconds: "starts in 0 minutes" reads as a
  // fault, and this is precisely when somebody is staring at the page.
  return `starts in ${seconds} second${seconds === 1 ? "" : "s"}`;
}
