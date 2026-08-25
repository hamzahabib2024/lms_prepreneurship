import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { EmptyState, Skeleton, SkeletonCards } from "../components/Ui";
import { AtRiskPanel } from "../components/AtRiskPanel";
import { HowItWorks } from "../components/HowItWorks";
import { Icon } from "../components/Icon";

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
      <div className="alert alert-error" role="alert">
        <strong>Could not load your marking</strong>
        <p>{error}</p>
      </div>
    );
  }
  if (!sections) return <SkeletonCards count={2} />;

  if (sections.length === 0) {
    return (
      <>
        <header className="page-head">
          <h1>Marking</h1>
        </header>
        <EmptyState icon="pen" title="Nothing assigned to you">
          You are not teaching any subject-sections yet, so there is nothing to mark. It appears
          here as soon as the office assigns you one.
        </EmptyState>
      </>
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
      <HowItWorks
        id="marking-queue"
        title="How marking works"
        intro="This page is the queue. Open an assignment to mark the work in it, one student at a time."
        steps={[
          {
            icon: "clipboard",
            title: "Pick an assignment",
            body: "The count beside each one is how many submissions are still waiting for you.",
          },
          {
            icon: "pen",
            title: "Mark one at a time",
            body: "The work, the marking guide and the mark box sit on one screen. Save and it moves you to the next.",
          },
          {
            icon: "money",
            title: "Enter the raw mark",
            body: "Mark what the work is worth. Any late penalty is worked out for you — do not deduct it yourself.",
          },
          {
            icon: "megaphone",
            title: "Release the class together",
            body: "Nothing is visible to any student until you release it. Then the whole class sees theirs at once.",
          },
        ]}
        note="Marking every student's answer to the same question in one pass gives a more consistent standard than working through one student at a time."
      />
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

      {/* FR-CRT — the end-of-term act, reached from the class it belongs to.
          Kept out of the sidebar because it is done once a term, and a
          destination used twice a year buries the ones used daily. */}
      <div className="row-actions">
        <Link className="btn btn-quiet btn-sm" to={`/completion/${section.sectionSubjectId}`}>
          <Icon name="award" />
          Who has finished
        </Link>
      </div>

      {items === null ? (
        <Skeleton lines={2} />
      ) : items.length === 0 ? (
        <p className="muted small">No assignments set for this subject yet.</p>
      ) : (
        <ul className="list">
          {items.map((a) => (
            <li key={a.id} className="work-row">
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
                {/* Every state is a WORD; the colour is a second signal for
                    somebody scanning a long list (NFR-ACC-003). */}
                {a.ungradedCount > 0 ? (
                  <span className="pill pill-warn">{a.ungradedCount} to mark</span>
                ) : a.submittedCount === 0 ? (
                  <span className="pill">No submissions</span>
                ) : a.gradesReleased ? (
                  <span className="pill pill-ok">Released</span>
                ) : (
                  // The state a teacher forgets. Marked work nobody can see is
                  // work the student is still waiting for.
                  <span className="pill pill-warn">Marked, not released</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {quizzes.length > 0 && (
        <ul className="list">
          {quizzes.map((q) => (
            <li key={q.id} className="work-row">
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
