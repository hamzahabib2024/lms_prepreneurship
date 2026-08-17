import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { LecturePlayer } from "../components/LecturePlayer";
import { LectureThumb, formatDuration } from "../components/LectureThumb";
import { Icon } from "../components/Icon";
import type { Lecture as PlayableLecture } from "./SubjectPage";

interface WatchState {
  watchedPercent: number;
  lastPositionSeconds: number;
  isComplete: boolean;
}

interface Lecture {
  id: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  recordedOn: string;
  publicationStatus: "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "SCHEDULED";
  availabilityStatus: "AVAILABLE" | "MISSING" | "CHECKING";
  watch: WatchState | null;
}

interface CourseLectures {
  subject: { id: string; code: string; name: string };
  section: { code: string; name: string };
  canManage: boolean;
  lectures: Lecture[];
}

/**
 * Watching one recording — FR-VID-005/008/009/010.
 *
 * THE SHAPE EVERYBODY ALREADY KNOWS. Video large on the left, the rest of the
 * class stacked down the right, what happens next at the top of that stack.
 * Students arrive at this having spent years on YouTube, and matching that
 * layout is not decoration: it means nobody has to be taught where the next
 * lecture is.
 *
 * WHAT IS DELIBERATELY NOT YOUTUBE. No autoplay — a recording that starts
 * talking on its own, in a shared room or a class, is the single most
 * complained-about behaviour on the web. No recommendations from other
 * classes; the list on the right is this class, in order, and nothing else.
 * No view counts, because a class of thirty is not an audience and the number
 * would only ever be discouraging.
 *
 * ARC-041 STILL HOLDS. Nothing here knows where the file is. The player asks
 * for a short-lived, user-bound ticket; the storage reference is never in the
 * markup, the URL, or any state this page holds.
 */
export function WatchPage() {
  const { sectionSubjectId = "", lectureId = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<CourseLectures | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<CourseLectures>(`/section-subjects/${sectionSubjectId}/lectures`));
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }, [sectionSubjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back to the top of the page on every change of lecture. Without this,
  // choosing something from halfway down the list leaves the reader looking at
  // the list while a different video plays off-screen above them.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [lectureId]);

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <strong>Could not open this recording</strong>
        <p>{error.message}</p>
        <Link className="btn" to={`/courses/${sectionSubjectId}`}>
          Back to the class
        </Link>
      </div>
    );
  }
  if (!data) return <p className="muted">Loading…</p>;

  const playable = data.lectures.filter((l) => l.availabilityStatus === "AVAILABLE");
  const current = data.lectures.find((l) => l.id === lectureId);
  const index = playable.findIndex((l) => l.id === lectureId);
  const next = index >= 0 ? playable[index + 1] : undefined;

  if (!current) {
    return (
      <div className="alert alert-warn" role="alert">
        <strong>That recording is not in this class</strong>
        <p>It may have been removed since the link was made.</p>
        <Link className="btn" to={`/courses/${sectionSubjectId}`}>
          See what is here
        </Link>
      </div>
    );
  }

  return (
    <div className="watch">
      <div className="watch-main">
        <nav className="watch-crumbs">
          <Link to={`/courses/${sectionSubjectId}`}>
            <Icon name="chevron-left" /> {data.subject.name}
          </Link>
          <span className="muted small">{data.section.name}</span>
        </nav>

        {current.availabilityStatus === "AVAILABLE" ? (
          <LecturePlayer
            key={current.id}
            variant="inline"
            lecture={current as unknown as PlayableLecture}
            onClose={() => navigate(`/courses/${sectionSubjectId}`)}
          />
        ) : (
          <div className="player-stage player-missing">
            <Icon name="alert" />
            <p>
              This recording is not available at the moment. It may have been moved in the shared
              folder. Please tell your teacher.
            </p>
          </div>
        )}

        <header className="watch-head">
          <h1>{current.title}</h1>
          <div className="watch-meta">
            <span>{formatDate(current.recordedOn)}</span>
            {current.durationSeconds ? <span>{formatDuration(current.durationSeconds)}</span> : null}
            {current.publicationStatus !== "PUBLISHED" && (
              <span className="pill pill-warn">{current.publicationStatus.toLowerCase()}</span>
            )}
            {current.watch?.isComplete && (
              <span className="pill pill-ok">
                <Icon name="check" /> watched
              </span>
            )}
          </div>
        </header>

        {current.description && <p className="watch-description">{current.description}</p>}

        {/* What comes next, where a phone reader will actually meet it —
            above the fold on a narrow screen, where the sidebar is not. */}
        {next && (
          <Link className="watch-next" to={`/courses/${sectionSubjectId}/watch/${next.id}`}>
            <span className="watch-next-label">Next in this class</span>
            <span className="watch-next-title">{next.title}</span>
            <Icon name="chevron-right" />
          </Link>
        )}
      </div>

      <aside className="watch-list" aria-label={`All recordings for ${data.subject.name}`}>
        <h2 className="watch-list-head">
          {data.subject.name}
          <span className="muted small">
            {playable.length} recording{playable.length === 1 ? "" : "s"}
          </span>
        </h2>

        <ol className="watch-queue">
          {data.lectures.map((lecture, i) => (
            <li key={lecture.id}>
              <Link
                className={`watch-row${lecture.id === current.id ? " is-current" : ""}`}
                to={`/courses/${sectionSubjectId}/watch/${lecture.id}`}
                aria-current={lecture.id === current.id ? "true" : undefined}
              >
                <span className="watch-row-index" aria-hidden="true">
                  {lecture.id === current.id ? <Icon name="play" /> : i + 1}
                </span>
                <LectureThumb
                  title={lecture.title}
                  durationSeconds={lecture.durationSeconds}
                  watchedPercent={lecture.watch?.watchedPercent ?? 0}
                  size="row"
                />
                <span className="watch-row-text">
                  <span className="watch-row-title">{lecture.title}</span>
                  <span className="muted small">
                    {formatDate(lecture.recordedOn)}
                    {lecture.publicationStatus !== "PUBLISHED" && " · draft"}
                    {lecture.availabilityStatus !== "AVAILABLE" && " · unavailable"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

/** "13 August 2026" — the day the class happened, not a timestamp. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
