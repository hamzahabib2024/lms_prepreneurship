import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { LecturePlayer } from "../components/LecturePlayer";
import { AssignmentPanel } from "../components/AssignmentPanel";
import { QuizPanel } from "../components/QuizPanel";

/**
 * One subject — SRS §13.5, §5.6, §5.7.
 *
 * Modules, the lessons inside them and the recorded lectures attached to each,
 * in teaching order. BR-CNT-01 keeps draft material out of this entirely, and
 * that filtering happens on the server (ARC-051): nothing here checks a
 * publication status, because a client that did would be a second, weaker copy
 * of the rule.
 */

export interface WatchState {
  watchedPercent: number;
  lastPositionSeconds: number;
  isComplete: boolean;
}

export interface Lecture {
  id: string;
  title: string;
  durationSeconds: number | null;
  recordedOn: string;
  availabilityStatus: string;
  watch: WatchState | null;
}

interface Lesson {
  id: string;
  title: string;
  description: string | null;
  estimatedMinutes: number | null;
  lectures: Lecture[];
}

interface Module {
  id: string;
  title: string;
  description: string | null;
  lessons: Lesson[];
}

interface SubjectProgress {
  sectionSubjectId: string;
  subject: { id: string; code: string; name: string };
  overallPercent: number;
  components: Array<{ key: string; completed: number; total: number; percent: number }>;
  attendance: { percentage: number | null; sessionsInDenominator: number };
  completionCriteria: { met: boolean; outstanding: string[] };
}

export function SubjectPage() {
  const { sectionSubjectId = "" } = useParams();
  const [progress, setProgress] = useState<SubjectProgress | null>(null);
  const [modules, setModules] = useState<Module[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [playing, setPlaying] = useState<Lecture | null>(null);

  const loadContent = useCallback(async (subjectId: string) => {
    setModules(await api.get<Module[]>(`/subjects/${subjectId}/content`));
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Sequential on purpose: the content tree is keyed by SUBJECT, and only
    // the progress response knows which subject this offering teaches.
    api
      .get<SubjectProgress>(`/me/progress/${sectionSubjectId}`)
      .then(async (p) => {
        if (cancelled) return;
        setProgress(p);
        await loadContent(p.subject.id);
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e : null));

    return () => {
      cancelled = true;
    };
  }, [sectionSubjectId, loadContent]);

  // After watching, the percentage on every bar is stale. Refetching both is
  // cheaper to reason about than patching the tree in place, and progress is
  // computed on read anyway.
  const refresh = useCallback(() => {
    if (!progress) return;
    void api
      .get<SubjectProgress>(`/me/progress/${sectionSubjectId}`)
      .then(setProgress)
      .catch(() => undefined);
    void loadContent(progress.subject.id).catch(() => undefined);
  }, [progress, sectionSubjectId, loadContent]);

  if (error) {
    return (
      <div className="alert alert-error">
        <strong>Could not load this subject</strong>
        <p>{error.message}</p>
        <Link className="btn" to="/subjects">
          Back to my subjects
        </Link>
      </div>
    );
  }

  if (!progress || !modules) return <p className="muted">Loading…</p>;

  const video = progress.components.find((c) => c.key === "video");

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{progress.subject.name}</h1>
          <p className="muted small">{progress.subject.code}</p>
        </div>
        <Link className="btn btn-quiet" to="/subjects">
          All subjects
        </Link>
      </header>

      <section className="card">
        <div className="bar">
          <div
            className="bar-fill"
            style={{ width: `${Math.min(100, progress.overallPercent)}%` }}
          />
        </div>
        <p className="muted small">
          {progress.overallPercent}% overall
          {video ? ` · ${video.completed} of ${video.total} lectures watched` : ""}
          {progress.attendance.percentage !== null
            ? ` · ${progress.attendance.percentage}% attendance`
            : " · attendance not recorded yet"}
        </p>
        {!progress.completionCriteria.met && progress.completionCriteria.outstanding.length > 0 && (
          <ul className="list small">
            {progress.completionCriteria.outstanding.map((o) => (
              <li key={o}>
                <span className="muted">{o}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Above the lectures: what is DUE is more urgent than what is available
          to watch, and a deadline the student scrolls past is a deadline
          missed. */}
      <AssignmentPanel sectionSubjectId={sectionSubjectId} />
      <QuizPanel sectionSubjectId={sectionSubjectId} />

      {modules.length === 0 && (
        <div className="card">
          <p className="muted">
            No material has been published for this subject yet. It appears here
            as your teacher releases it.
          </p>
        </div>
      )}

      {modules.map((m) => (
        <section className="card" key={m.id}>
          <h2>{m.title}</h2>
          {m.description && <p className="muted small">{m.description}</p>}

          {m.lessons.map((l) => (
            <div className="lesson" key={l.id}>
              <h3>
                {l.title}
                {l.estimatedMinutes ? (
                  <span className="muted small"> · about {l.estimatedMinutes} min</span>
                ) : null}
              </h3>
              {l.lectures.length === 0 ? (
                <p className="muted small">No recording for this lesson.</p>
              ) : (
                <ul className="list">
                  {l.lectures.map((lec) => (
                    <LectureRow key={lec.id} lecture={lec} onPlay={() => setPlaying(lec)} />
                  ))}
                </ul>
              )}
              {/* FR-CRS-035 — the handouts. Only ones the teacher has
                  published, inside a published lesson: the server decides, and
                  a lesson with none renders nothing at all rather than an
                  empty heading. */}
              <LessonHandouts lessonId={l.id} />
            </div>
          ))}
        </section>
      ))}

      {playing && (
        <LecturePlayer
          lecture={playing}
          onClose={() => {
            setPlaying(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

function LectureRow({ lecture, onPlay }: { lecture: Lecture; onPlay: () => void }) {
  const watched = lecture.watch?.watchedPercent ?? 0;
  const resumeAt = lecture.watch?.lastPositionSeconds ?? 0;
  // ARC-045 — a lecture whose file has gone missing must say so rather than
  // opening a player that fails.
  const unavailable = lecture.availabilityStatus !== "AVAILABLE";

  return (
    <li>
      <span>
        {lecture.title}
        {/* Never colour alone (NFR-ACC-003): the state is spelled out. */}
        {lecture.watch?.isComplete && <span className="small"> · ✓ watched</span>}
        {!lecture.watch?.isComplete && watched > 0 && (
          <span className="muted small"> · {Math.round(watched)}% watched</span>
        )}
      </span>

      <span className="row-actions">
        <span className="muted small">{formatLength(lecture.durationSeconds)}</span>
        <button
          className="btn btn-quiet"
          onClick={onPlay}
          disabled={unavailable}
          title={unavailable ? "This recording is temporarily unavailable." : undefined}
        >
          {unavailable ? "Unavailable" : resumeAt > 0 && !lecture.watch?.isComplete ? "Resume" : "Watch"}
        </button>
      </span>
    </li>
  );
}

function formatLength(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

interface Handout {
  id: string;
  title: string;
  filename: string;
  sizeBytes: number;
}

/**
 * The files that go with a lesson.
 *
 * DOWNLOADED THROUGH THE API, not from a link. The storage location never
 * reaches the browser (ARC-041), so the bytes come back on an authenticated
 * request and are handed to the browser as a blob. A URL a student could
 * forward would be a URL that outlives their enrolment.
 */
function LessonHandouts({ lessonId }: { lessonId: string }) {
  const [handouts, setHandouts] = useState<Handout[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Handout[]>(`/lessons/${lessonId}/resources`)
      .then(setHandouts)
      .catch(() => setHandouts([]));
  }, [lessonId]);

  // Nothing published means nothing to say. An empty "Handouts" heading on
  // every lesson is noise on the screen a student reads most.
  if (!handouts || handouts.length === 0) return null;

  const download = async (h: Handout) => {
    setBusy(h.id);
    setError(null);
    try {
      const blob = await api.download(`/lesson-resources/${h.id}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = h.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ARC-045 — a missing file is the Institute's problem, said plainly.
      setError("That file could not be downloaded. Please tell your teacher.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="list small">
      {handouts.map((h) => (
        <li key={h.id}>
          <span>
            {h.title}
            <br />
            <span className="muted small">
              {h.filename} · {Math.max(1, Math.round(h.sizeBytes / 1024))} KB
            </span>
          </span>
          <button className="btn btn-quiet" disabled={busy === h.id} onClick={() => void download(h)}>
            {busy === h.id ? "Downloading…" : "Download"}
          </button>
        </li>
      ))}
      {error && (
        <li>
          <span className="warn small">{error}</span>
        </li>
      )}
    </ul>
  );
}
