import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { AtRiskPanel } from "../components/AtRiskPanel";

/**
 * A teacher's marking queue — SRS §13.6, FR-TCH-018.
 *
 * The dashboard already tells a teacher how many submissions are waiting
 * (FR-TCH-002). This is where that number becomes something they can act on:
 * every subject-section they teach, every assignment in it, and how much of
 * each is still unmarked.
 *
 * Sections come from the dashboard rather than a second endpoint, because the
 * server already decides which subject-sections this teacher may see and
 * asking twice invites the two answers to disagree.
 */

interface TeacherSection {
  sectionSubjectId: string;
  subject: { code: string; name: string };
  section: { code: string };
  enrolled: number;
}

interface TeacherQuiz {
  id: string;
  title: string;
  closesAt: string;
  totalMarks: number;
  publicationStatus: string;
  attemptCount: number;
  awaitingMarking: number;
  unreleased: number;
}

interface TeacherAssignment {
  id: string;
  title: string;
  dueAt: string;
  marksAvailable: number;
  publicationStatus: string;
  gradesReleased: boolean;
  submittedCount: number;
  gradedCount: number;
  ungradedCount: number;
}

export function MarkingPage() {
  const [sections, setSections] = useState<TeacherSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ widgets: { mySections?: TeacherSection[] } }>("/dashboards/me")
      .then((d) => setSections(d.widgets.mySections ?? []))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load your subjects."));
  }, []);

  if (error) {
    return (
      <div className="alert alert-error">
        <strong>Could not load your marking</strong>
        <p>{error}</p>
      </div>
    );
  }
  if (!sections) return <p className="muted">Loading…</p>;

  if (sections.length === 0) {
    return (
      <div className="card">
        <h1>Marking</h1>
        <p className="muted">
          You are not assigned to any subject-sections, so there is nothing to mark.
        </p>
      </div>
    );
  }

  return (
    <>
      <header className="page-head">
        <h1>Marking</h1>
        {/* The one thing a teacher comes here to START rather than finish. */}
        <span className="row-actions">
          <Link className="btn btn-quiet" to="/assignment-builder">
            New assignment
          </Link>
          <Link className="btn btn-quiet" to="/quiz-builder">
            New quiz
          </Link>
        </span>
      </header>
      {sections.map((s) => (
        <SectionAssignments key={s.sectionSubjectId} section={s} />
      ))}
    </>
  );
}

function SectionAssignments({ section }: { section: TeacherSection }) {
  const [items, setItems] = useState<TeacherAssignment[] | null>(null);
  const [quizzes, setQuizzes] = useState<TeacherQuiz[]>([]);

  useEffect(() => {
    api
      .get<TeacherAssignment[]>(`/section-subjects/${section.sectionSubjectId}/assignments`)
      .then(setItems)
      .catch(() => setItems([]));
    api
      .get<TeacherQuiz[]>(`/section-subjects/${section.sectionSubjectId}/quizzes`)
      .then(setQuizzes)
      .catch(() => setQuizzes([]));
  }, [section.sectionSubjectId]);

  return (
    <>
      {/* Above the marking. A student falling out of a course is more urgent
          than a stack of essays, and it is the thing a teacher is least likely
          to go looking for. */}
      <AtRiskPanel sectionSubjectId={section.sectionSubjectId} />

    <section className="card">
      <h2>
        {section.subject.name} <span className="muted small">{section.section.code}</span>
      </h2>

      {items === null ? (
        <p className="muted small">Loading…</p>
      ) : items.length === 0 ? (
        <p className="muted small">No assignments set for this subject yet.</p>
      ) : (
        <ul className="list">
          {items.map((a) => (
            <li key={a.id} className={a.ungradedCount > 0 ? "warn" : ""}>
              <span>
                <Link to={`/marking/${a.id}`}>{a.title}</Link>{" "}
                {a.publicationStatus !== "PUBLISHED" && (
                  <span className="muted small">({a.publicationStatus.toLowerCase()})</span>
                )}
                <span className="muted small">
                  {" "}
                  · due {new Date(a.dueAt).toLocaleDateString()}
                </span>
              </span>
              <span className="row-actions">
                {/* Every state is a word, never a colour alone (NFR-ACC-003). */}
                {a.ungradedCount > 0 ? (
                  <strong className="small">{a.ungradedCount} to mark</strong>
                ) : a.submittedCount === 0 ? (
                  <span className="muted small">No submissions</span>
                ) : a.gradesReleased ? (
                  <span className="small">✓ Released</span>
                ) : (
                  <span className="small">Marked, not released</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {quizzes.length > 0 && (
        <ul className="list">
          {quizzes.map((q) => (
            <li key={q.id} className={q.awaitingMarking > 0 ? "warn" : ""}>
              <span>
                <Link to={`/marking/quiz/${q.id}`}>{q.title}</Link>
                <span className="muted small"> · quiz · {q.attemptCount} attempts</span>
              </span>
              <span className="row-actions">
                {q.publicationStatus !== "PUBLISHED" && (
                  <Link className="btn btn-quiet" to={`/quiz-builder/${q.id}`}>
                    Edit
                  </Link>
                )}
                {q.awaitingMarking > 0 ? (
                  <strong className="small">{q.awaitingMarking} to mark</strong>
                ) : q.unreleased > 0 ? (
                  <span className="small">{q.unreleased} unreleased</span>
                ) : q.attemptCount === 0 ? (
                  <span className="muted small">No attempts</span>
                ) : (
                  <span className="small">✓ Released</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
    </>
  );
}
