import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { CertificatePanel } from "../components/CertificatePanel";
import { CourseCover } from "../components/CourseCover";
import { EmptyState, ProgressRing, SkeletonCards } from "../components/Ui";

/**
 * A student's subjects — SRS §13.5, FR-PRG-007.
 *
 * The entry point to everything a student actually came here to do. Progress
 * is computed on read (ARC-007), so the figure is never stale, but it is
 * stamped anyway because §13.4 asks every derived number to say when it was
 * worked out.
 *
 * NFR-USE-004: the outstanding requirements are shown as text next to the bar.
 * A student who is at 62 % needs to know what to DO about it, and a percentage
 * on its own does not say whether the gap is lectures, marks or attendance.
 */

interface SubjectProgress {
  sectionSubjectId: string;
  subject: { id: string; code: string; name: string };
  overallPercent: number;
  attendancePercent: number | null;
  completionMet: boolean;
  outstanding: string[];
}

interface MyProgress {
  overallPercent: number;
  subjectCount: number;
  completedCount: number;
  computedAt: string;
  subjects: SubjectProgress[];
}

export function MySubjectsPage() {
  const [data, setData] = useState<MyProgress | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .get<MyProgress>("/me/progress")
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e : null));
  }, []);

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <strong>Could not load your subjects</strong>
        <p>{error.message}</p>
      </div>
    );
  }

  // A block the shape of what is coming, so the page does not jump when it
  // lands and the reader does not lose their place.
  if (!data) return <SkeletonCards count={3} />;

  if (data.subjects.length === 0) {
    // NFR-USE-009 — say why it is empty. "No subjects" alone reads like a
    // fault, and a newly admitted student will see this before term starts.
    return (
      <>
        <header className="page-head">
          <h1>My subjects</h1>
        </header>
        <EmptyState icon="book" title="Nothing here yet">
          You are not enrolled in any subjects yet. They appear here as soon as your enrolment is
          confirmed — there is nothing you need to do.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>My subjects</h1>
          {/* ARC-048 — a derived figure carries when it was worked out. */}
          <p className="muted small">
            as at {new Date(data.computedAt).toLocaleTimeString()}
          </p>
        </div>
      </header>

      {/* The three figures a student actually wants before reading anything:
          how far through, how many finished, how many left. */}
      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Overall</span>
          <span className="kpi-value">{data.overallPercent}%</span>
          <span className="kpi-note">across every subject</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Complete</span>
          <span className="kpi-value">
            {data.completedCount} <span className="muted small">of {data.subjectCount}</span>
          </span>
          <span className="kpi-note">requirements met</span>
        </div>
        <div className={data.subjectCount - data.completedCount > 0 ? "kpi is-warn" : "kpi"}>
          <span className="kpi-label">Still to finish</span>
          <span className="kpi-value">{data.subjectCount - data.completedCount}</span>
          <span className="kpi-note">
            {data.subjectCount - data.completedCount === 0
              ? "nothing outstanding"
              : "shown below with what is left"}
          </span>
        </div>
      </div>

      <div className="grid">
        {data.subjects.map((s) => (
          <SubjectCard key={s.sectionSubjectId} s={s} />
        ))}
      </div>

      {/* Below the subjects: a certificate is the outcome of the work above,
          and renders nothing at all until one exists. */}
      <CertificatePanel />
    </>
  );
}

function SubjectCard({ s }: { s: SubjectProgress }) {
  return (
    <section className="card widget subject-card">
      <div className="subject-top">
        {/* The ring carries the figure; the bar underneath is gone, because two
            renderings of one number is one more than anybody reads. */}
        <ProgressRing
          percent={s.overallPercent}
          label={`${s.subject.name}: ${s.overallPercent}% complete`}
        />
        {/* The chip, not a full cover: the ring is the point of this card and
            the figure in it is what a student came to see. The chip is the
            same artwork the course carries on the landing page and the apply
            form, so it is recognised rather than decorative. */}
        <CourseCover code={s.subject.code} name={s.subject.name} size="chip" />
        <div className="subject-title">
          <h2>
            <Link to={`/subjects/${s.sectionSubjectId}`}>{s.subject.name}</Link>
          </h2>
          <p className="muted small">{s.subject.code}</p>
        </div>
      </div>

      <div className="subject-meta">
        {/* WCAG 2.1 AA (NFR-ACC-003): the state is a WORD, not a colour. */}
        {s.completionMet ? (
          <span className="pill pill-ok">Requirements met</span>
        ) : (
          <span className="pill pill-warn">
            {s.outstanding.length} outstanding
          </span>
        )}
        <span className="pill">
          Attendance{" "}
          {s.attendancePercent === null ? "not recorded" : `${s.attendancePercent}%`}
        </span>
      </div>

      {/* NFR-USE-004 — a percentage on its own does not say whether the gap is
          lectures, marks or attendance, and the student needs to know what to
          DO. Capped at three: a list of nine is a wall nobody reads. */}
      {!s.completionMet && s.outstanding.length > 0 && (
        <ul className="subject-todo">
          {s.outstanding.slice(0, 3).map((o) => (
            <li key={o}>{o}</li>
          ))}
          {s.outstanding.length > 3 && (
            <li>
              <Link to={`/subjects/${s.sectionSubjectId}`}>
                and {s.outstanding.length - 3} more
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
