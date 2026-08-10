import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";

/**
 * Marking written quiz answers — SRS §13.6, FR-QIZ-021/031.
 *
 * Only the answers that need a human. An auto-marked answer already has its
 * verdict, and listing it would bury the handful needing judgement among dozens
 * that do not — the server filters to isCorrect === null for that reason.
 *
 * Answers are grouped BY QUESTION rather than by student, because marking the
 * same question across a cohort in one pass is how a consistent standard gets
 * applied. Switching question every row invites drift.
 */

interface MarkableAnswer {
  answerId: string;
  attemptId: string;
  studentName: string;
  rollNo: number | null;
  attemptNumber: number;
  questionId: string;
  stem: string;
  questionType: string;
  marksAvailable: number;
  response: unknown;
  marksAwarded: number | null;
  graderComment: string | null;
  isMarked: boolean;
}

interface MarkingQueue {
  quiz: { id: string; title: string; totalMarks: number };
  answers: MarkableAnswer[];
  remaining: number;
}

export function QuizMarkingPage() {
  const { quizId = "" } = useParams();
  const [queue, setQueue] = useState<MarkingQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [released, setReleased] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<MarkingQueue>(`/quizzes/${quizId}/marking`)
      .then(setQueue)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load this quiz."));
  }, [quizId]);

  useEffect(load, [load]);

  const release = async () => {
    setReleasing(true);
    setError(null);
    try {
      const result = await api.post<{ released: number; stillAwaitingMarking: number }>(
        `/quizzes/${quizId}/release-results`,
      );
      setReleased(
        result.stillAwaitingMarking > 0
          ? `Released ${result.released}. ${result.stillAwaitingMarking} attempt${
              result.stillAwaitingMarking === 1 ? " is" : "s are"
            } still unmarked and were not released.`
          : `Released ${result.released} result${result.released === 1 ? "" : "s"}.`,
      );
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Results could not be released.");
    } finally {
      setReleasing(false);
    }
  };

  if (error && !queue) {
    return (
      <div className="alert alert-error">
        <strong>Could not load this quiz</strong>
        <p>{error}</p>
      </div>
    );
  }
  if (!queue) return <p className="muted">Loading…</p>;

  // Group by question: one standard applied across the cohort in a single pass.
  const byQuestion = new Map<string, MarkableAnswer[]>();
  for (const a of queue.answers) {
    const list = byQuestion.get(a.questionId) ?? [];
    list.push(a);
    byQuestion.set(a.questionId, list);
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{queue.quiz.title}</h1>
          <p className="muted small">
            Out of {queue.quiz.totalMarks} ·{" "}
            {queue.remaining === 0
              ? "everything is marked"
              : `${queue.remaining} answer${queue.remaining === 1 ? "" : "s"} to mark`}
          </p>
        </div>
        <Link className="btn btn-quiet" to="/marking">
          Back
        </Link>
      </header>

      {error && (
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      )}

      <section className="card">
        <button
          className="btn btn-primary"
          onClick={() => void release()}
          disabled={releasing}
        >
          {releasing ? "Releasing…" : "Release results"}
        </button>
        {/* FR-QIZ-021 — the cohort goes together, and an unmarked attempt is
            skipped rather than released with a partial score. */}
        <p className="muted small">
          Students see nothing until you release. Attempts still awaiting marking are
          left out rather than released with part of a score.
        </p>
        {released && <p className="small">{released}</p>}
      </section>

      {queue.answers.length === 0 ? (
        <div className="card">
          <p className="muted">
            Nothing here needs marking by hand. Every answer in this quiz was marked
            automatically.
          </p>
        </div>
      ) : (
        [...byQuestion.entries()].map(([questionId, answers]) => (
          <section className="card" key={questionId}>
            <h2>{answers[0]?.stem}</h2>
            <p className="muted small">
              {answers[0]?.marksAvailable} marks · {answers.length} answer
              {answers.length === 1 ? "" : "s"}
            </p>
            <ul className="list">
              {answers.map((a) => (
                <AnswerRow key={a.answerId} answer={a} onMarked={load} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function AnswerRow({ answer: a, onMarked }: { answer: MarkableAnswer; onMarked: () => void }) {
  const [marks, setMarks] = useState(a.marksAwarded?.toString() ?? "");
  const [comment, setComment] = useState(a.graderComment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/quiz-answers/${a.answerId}/grade`, {
        marks: Number(marks),
        comment: comment || undefined,
      });
      onMarked();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That mark could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="assignment">
      <div className="assignment-head">
        <strong>
          {a.rollNo}. {a.studentName}
          {a.attemptNumber > 1 && (
            <span className="muted small"> · attempt {a.attemptNumber}</span>
          )}
        </strong>
        {/* A word, not only a colour (NFR-ACC-003). */}
        <span className="small">
          {a.isMarked ? `✓ ${a.marksAwarded}/${a.marksAvailable}` : "To mark"}
        </span>
      </div>

      <blockquote className="response">{textOf(a.response)}</blockquote>

      <div className="field-row">
        <label className="field">
          <span>Marks out of {a.marksAvailable}</span>
          <input
            type="number"
            min={0}
            max={a.marksAvailable}
            step="0.5"
            value={marks}
            onChange={(e) => setMarks(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Comment for the student</span>
          <input value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
      </div>

      {error && (
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      )}

      <button className="btn btn-quiet" onClick={() => void save()} disabled={busy || marks === ""}>
        {busy ? "Saving…" : a.isMarked ? "Update" : "Save mark"}
      </button>
    </li>
  );
}

/** A written response is `{ text }`; anything else is shown as-is for safety. */
function textOf(response: unknown): string {
  if (response && typeof response === "object" && "text" in response) {
    return String((response as { text: unknown }).text ?? "");
  }
  return response == null ? "(no answer given)" : JSON.stringify(response);
}
