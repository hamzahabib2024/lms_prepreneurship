import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { CertificatePanel } from "../components/CertificatePanel";

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
      <div className="alert alert-error">
        <strong>Could not load your subjects</strong>
        <p>{error.message}</p>
      </div>
    );
  }

  if (!data) return <p className="muted">Loading…</p>;

  if (data.subjects.length === 0) {
    // NFR-USE-009 — say why it is empty. "No subjects" alone reads like a
    // fault, and a newly admitted student will see this before term starts.
    return (
      <div className="card">
        <h1>My subjects</h1>
        <p className="muted">
          You are not enrolled in any subjects yet. They appear here once your
          enrolment is confirmed.
        </p>
      </div>
    );
  }

  return (
    <>
      <header className="page-head">
        <h1>My subjects</h1>
        <span className="muted small">
          {data.completedCount} of {data.subjectCount} complete · as at{" "}
          {new Date(data.computedAt).toLocaleTimeString()}
        </span>
      </header>

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
    <section className="card widget">
      <h2>
        <Link to={`/subjects/${s.sectionSubjectId}`}>{s.subject.name}</Link>
      </h2>
      <p className="muted small">{s.subject.code}</p>

      <p className="stat">{s.overallPercent}%</p>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${Math.min(100, s.overallPercent)}%` }} />
      </div>

      {s.completionMet ? (
        // WCAG 2.1 AA (NFR-ACC-003): the tick is accompanied by a word.
        // Colour alone would carry the whole meaning otherwise.
        <p className="small">✓ Requirements met</p>
      ) : (
        <ul className="list small">
          {s.outstanding.map((o) => (
            <li key={o}>
              <span className="muted">{o}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="muted small">
        Attendance{" "}
        {s.attendancePercent === null ? "not recorded yet" : `${s.attendancePercent}%`}
      </p>
    </section>
  );
}
