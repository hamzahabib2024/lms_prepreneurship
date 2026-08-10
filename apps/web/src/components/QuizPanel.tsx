import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api/client";

/**
 * Quizzes for one subject — SRS §5.10, §13.5, FR-QIZ-023..028.
 *
 * The clock is the thing that makes this different from every other screen. It
 * is computed by the server from a server-recorded start (BR-QIZ-04), and the
 * countdown here is a DISPLAY of that number, never the authority. A client
 * clock can be paused, skewed or edited; the server decides when time is up,
 * and this only asks it.
 */

interface StudentQuiz {
  id: string;
  title: string;
  instructions: string | null;
  totalMarks: number;
  passingMarks: number | null;
  opensAt: string;
  closesAt: string;
  timeLimitMinutes: number | null;
  maxAttempts: number;
  attemptsUsed: number;
  negativeMarking: string;
  isOpen: boolean;
  opensLater: boolean;
  hasClosed: boolean;
  canAttempt: boolean;
  inProgress: boolean;
  awaitingMarking: boolean;
  recordedScore: number | null;
  scorePolicy: string;
}

interface Question {
  questionId: string;
  questionVersion: number;
  displayOrder: number;
  type: string;
  stem: string;
  marks: number;
  options?: Array<{ optionId: string; text: string }>;
}

interface Attempt {
  attemptId: string;
  attemptNumber: number;
  resumed: boolean;
  expiresAt: string | null;
  remainingSeconds: number | null;
  maxAttempts: number;
  negativeMarking: unknown;
  presentation: string;
  allowBackwardNavigation: boolean;
  questions: Question[];
  savedAnswers: Record<string, unknown>;
}

export function QuizPanel({ sectionSubjectId }: { sectionSubjectId: string }) {
  const [items, setItems] = useState<StudentQuiz[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);

  const load = useCallback(() => {
    api
      .get<StudentQuiz[]>(`/section-subjects/${sectionSubjectId}/my-quizzes`)
      .then(setItems)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load quizzes."));
  }, [sectionSubjectId]);

  useEffect(load, [load]);

  const start = async (quizId: string) => {
    setError(null);
    try {
      setAttempt(await api.post<Attempt>(`/quizzes/${quizId}/attempts`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That quiz could not be started.");
    }
  };

  if (error && !items) {
    return (
      <section className="card">
        <h2>Quizzes</h2>
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      </section>
    );
  }
  if (!items) return null;

  return (
    <section className="card">
      <h2>Quizzes</h2>
      {error && (
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      )}

      {items.length === 0 ? (
        <p className="muted">No quizzes have been set for this subject yet.</p>
      ) : (
        <ul className="list">
          {items.map((q) => (
            <QuizRow key={q.id} quiz={q} onStart={() => void start(q.id)} />
          ))}
        </ul>
      )}

      {attempt && (
        <AttemptRunner
          attempt={attempt}
          onFinished={() => {
            setAttempt(null);
            load();
          }}
        />
      )}
    </section>
  );
}

function QuizRow({ quiz: q, onStart }: { quiz: StudentQuiz; onStart: () => void }) {
  return (
    <li>
      <span>
        {q.title}
        <span className="muted small">
          {" "}
          · {q.totalMarks} marks
          {q.timeLimitMinutes ? ` · ${q.timeLimitMinutes} min` : ""}
          {q.maxAttempts > 1 ? ` · ${q.attemptsUsed}/${q.maxAttempts} attempts` : ""}
        </span>
        <br />
        <span className="muted small">{deadlineText(q)}</span>
      </span>

      <span className="row-actions">
        {/* Every state spelled out, never colour alone (NFR-ACC-003). */}
        {q.recordedScore !== null ? (
          <strong className="small">
            {q.recordedScore}/{q.totalMarks}
          </strong>
        ) : q.awaitingMarking ? (
          <span className="small">Being marked</span>
        ) : q.attemptsUsed > 0 && !q.canAttempt ? (
          <span className="muted small">Submitted</span>
        ) : null}

        {q.canAttempt && (
          <button className="btn btn-primary" onClick={onStart}>
            {q.inProgress ? "Resume" : "Start"}
          </button>
        )}
      </span>
    </li>
  );
}

function AttemptRunner({
  attempt,
  onFinished,
}: {
  attempt: Attempt;
  onFinished: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(attempt.savedAnswers ?? {});
  const [remaining, setRemaining] = useState(attempt.remainingSeconds);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const expired = useRef(false);

  // A DISPLAY of the server's number. When it reaches zero the attempt is
  // submitted rather than the client deciding the score — FR-QIZ-028 puts the
  // decision on the server, which will auto-submit anyway if the browser is
  // gone.
  useEffect(() => {
    if (remaining === null) return;
    const id = window.setInterval(() => {
      setRemaining((r) => (r === null ? null : Math.max(0, r - 1)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [remaining === null]);

  const submit = useCallback(
    async (auto: boolean) => {
      if (expired.current) return;
      expired.current = true;
      setSubmitting(true);
      try {
        await api.post(`/attempts/${attempt.attemptId}/submit`);
      } catch (e) {
        // An expired attempt is submitted by the server anyway, so a failure
        // here is not something to alarm the student about.
        if (!auto) setError(e instanceof ApiError ? e.message : "That could not be submitted.");
      } finally {
        setSubmitting(false);
        onFinished();
      }
    },
    [attempt.attemptId, onFinished],
  );

  useEffect(() => {
    if (remaining === 0) void submit(true);
  }, [remaining, submit]);

  const save = async (questionId: string, response: unknown) => {
    setAnswers((a) => ({ ...a, [questionId]: response }));
    setSaving(questionId);
    try {
      // FR-QIZ-026 — saved as they go, so a dropped connection costs at most
      // the answer in progress.
      await api.patch(`/attempts/${attempt.attemptId}/answers`, { questionId, response });
    } catch {
      setError("An answer could not be saved. Check your connection.");
    } finally {
      setSaving(null);
    }
  };

  const answered = attempt.questions.filter((q) => answers[q.questionId] != null).length;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Quiz attempt">
      <div className="modal">
        <header className="modal-head">
          <h2>Attempt {attempt.attemptNumber}</h2>
          {remaining !== null && (
            <strong className={remaining < 60 ? "warn" : ""} aria-live="polite">
              {formatClock(remaining)} left
            </strong>
          )}
        </header>

        <p className="muted small">
          {answered} of {attempt.questions.length} answered · answers save as you go
        </p>

        {error && (
          <div className="alert alert-error">
            <p>{error}</p>
          </div>
        )}

        {attempt.questions.map((q) => (
          <fieldset className="question" key={q.questionId}>
            <legend>
              {q.displayOrder}. {q.stem}{" "}
              <span className="muted small">
                ({q.marks} mark{q.marks === 1 ? "" : "s"})
              </span>
            </legend>

            {q.options ? (
              q.options.map((o) => (
                <label className="option" key={o.optionId}>
                  <input
                    type={q.type === "MCQ_MULTI" ? "checkbox" : "radio"}
                    name={q.questionId}
                    checked={isChosen(answers[q.questionId], o.optionId)}
                    onChange={(e) =>
                      void save(
                        q.questionId,
                        nextSelection(
                          answers[q.questionId],
                          o.optionId,
                          q.type === "MCQ_MULTI",
                          e.target.checked,
                        ),
                      )
                    }
                  />
                  <span>{o.text}</span>
                </label>
              ))
            ) : (
              <textarea
                rows={4}
                defaultValue={textOf(answers[q.questionId])}
                onBlur={(e) => void save(q.questionId, { text: e.target.value })}
                aria-label={`Answer to question ${q.displayOrder}`}
              />
            )}

            {saving === q.questionId && <p className="muted small">Saving…</p>}
          </fieldset>
        ))}

        <button
          className="btn btn-primary"
          onClick={() => void submit(false)}
          disabled={submitting}
        >
          {submitting ? "Submitting…" : "Submit quiz"}
        </button>
        {answered < attempt.questions.length && (
          <p className="warn small">
            {attempt.questions.length - answered} question
            {attempt.questions.length - answered === 1 ? "" : "s"} unanswered.
          </p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- helpers -- */

function isChosen(response: unknown, optionId: string): boolean {
  const ids = (response as { selectedOptionIds?: string[] } | undefined)?.selectedOptionIds;
  return Array.isArray(ids) && ids.includes(optionId);
}

function nextSelection(
  response: unknown,
  optionId: string,
  multi: boolean,
  checked: boolean,
): { selectedOptionIds: string[] } {
  if (!multi) return { selectedOptionIds: [optionId] };
  const current = (response as { selectedOptionIds?: string[] } | undefined)?.selectedOptionIds ?? [];
  return {
    selectedOptionIds: checked
      ? [...new Set([...current, optionId])]
      : current.filter((id) => id !== optionId),
  };
}

function textOf(response: unknown): string {
  return (response as { text?: string } | undefined)?.text ?? "";
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function deadlineText(q: StudentQuiz): string {
  if (q.opensLater) return `Opens ${new Date(q.opensAt).toLocaleString()}`;
  if (q.hasClosed) return `Closed ${new Date(q.closesAt).toLocaleDateString()}`;
  const days = Math.round((new Date(q.closesAt).getTime() - Date.now()) / 86_400_000);
  const closing = days <= 0 ? "Closes today" : `Closes in ${days} day${days === 1 ? "" : "s"}`;
  // FR-QIZ-013 — a student deciding whether to guess needs to know this
  // BEFORE they start, not when they see the mark.
  return q.negativeMarking !== "NONE" ? `${closing} · wrong answers lose marks` : closing;
}
