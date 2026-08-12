import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { QuestionComposer } from "../components/QuestionComposer";

/**
 * Building a quiz — SRS §13.6, FR-QIZ-001..020.
 *
 * Two phases, deliberately separated. Settings first — the window, the time
 * limit, whether wrong answers lose marks — then the paper. Mixing them would
 * put "does a wrong answer cost you" next to "add another option" and make
 * neither decision clearly.
 *
 * A published quiz is shown read-only. Somebody may be sitting it, and the
 * server refuses the edit anyway; offering a button that will be refused wastes
 * the teacher's time and teaches them to ignore errors.
 */

interface TeacherSection {
  sectionSubjectId: string;
  subject: { name: string };
  section: { code: string };
}

interface Bank {
  id: string;
  name: string;
  questionCount: number;
}

interface BankQuestion {
  id: string;
  questionType: string;
  stem: string;
  defaultMarks: number;
  isRetired: boolean;
}

interface QuizDetail {
  id: string;
  title: string;
  publicationStatus: string;
  totalMarks: number;
  passingMarks: number | null;
  opensAt: string;
  closesAt: string;
  timeLimitMinutes: number | null;
  maxAttempts: number;
  attemptCount: number;
  questions: Array<{
    questionId: string;
    displayOrder: number;
    marks: number;
    questionType: string;
    stem: string;
  }>;
}

export function QuizBuilderPage() {
  const { quizId } = useParams();
  return quizId ? <Paper quizId={quizId} /> : <NewQuiz />;
}

/* ------------------------------------------------------------- phase one -- */

function NewQuiz() {
  const navigate = useNavigate();
  const [sections, setSections] = useState<TeacherSection[]>([]);
  const [form, setForm] = useState({
    sectionSubjectId: "",
    title: "",
    opensAt: "",
    closesAt: "",
    timeLimitMinutes: "15",
    maxAttempts: "1",
    negativeMarking: "NONE",
    resultReleasePolicy: "AFTER_CLOSE",
  });
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    api
      .get<{ widgets: { mySections?: TeacherSection[] } }>("/dashboards/me")
      .then((d) => setSections(d.widgets.mySections ?? []))
      .catch(() => setSections([]));
  }, []);

  const create = async () => {
    setBusy(true);
    setProblems([]);
    try {
      const quiz = await api.post<{ id: string }>("/quizzes", {
        sectionSubjectId: form.sectionSubjectId,
        title: form.title,
        opensAt: new Date(form.opensAt).toISOString(),
        closesAt: new Date(form.closesAt).toISOString(),
        timeLimitMinutes: form.timeLimitMinutes ? Number(form.timeLimitMinutes) : null,
        maxAttempts: Number(form.maxAttempts),
        negativeMarking: form.negativeMarking,
        resultReleasePolicy: form.resultReleasePolicy,
      });
      navigate(`/quiz-builder/${quiz.id}`);
    } catch (e) {
      setProblems(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message) ?? [e.message])
          : ["That quiz could not be created."],
      );
    } finally {
      setBusy(false);
    }
  };

  const ready =
    form.sectionSubjectId && form.title.trim() && form.opensAt && form.closesAt;

  return (
    <>
      <header className="page-head">
        <h1>New quiz</h1>
        <Link className="btn btn-quiet" to="/marking">
          Back to marking
        </Link>
      </header>

      <section className="card">
        <div className="field-row">
          <label className="field">
            <span>Subject</span>
            <select
              value={form.sectionSubjectId}
              onChange={(e) => setForm({ ...form, sectionSubjectId: e.target.value })}
            >
              <option value="">Choose…</option>
              {sections.map((s) => (
                <option key={s.sectionSubjectId} value={s.sectionSubjectId}>
                  {s.subject.name} — {s.section.code}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Title</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Opens</span>
            <input
              type="datetime-local"
              value={form.opensAt}
              onChange={(e) => setForm({ ...form, opensAt: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Closes</span>
            <input
              type="datetime-local"
              value={form.closesAt}
              onChange={(e) => setForm({ ...form, closesAt: e.target.value })}
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Time limit in minutes</span>
            <input
              type="number"
              min={1}
              value={form.timeLimitMinutes}
              onChange={(e) => setForm({ ...form, timeLimitMinutes: e.target.value })}
            />
            <span className="muted small">Leave empty for no limit.</span>
          </label>

          <label className="field">
            <span>Attempts allowed</span>
            <input
              type="number"
              min={1}
              max={10}
              value={form.maxAttempts}
              onChange={(e) => setForm({ ...form, maxAttempts: e.target.value })}
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Wrong answers</span>
            <select
              value={form.negativeMarking}
              onChange={(e) => setForm({ ...form, negativeMarking: e.target.value })}
            >
              <option value="NONE">Cost nothing</option>
              <option value="FIXED">Lose a fixed amount</option>
              <option value="PROPORTIONAL">Lose a proportion of the marks</option>
            </select>
            {/* FR-QIZ-013 — students are told this before they start, so the
                teacher should know that choosing it changes their paper. */}
            {form.negativeMarking !== "NONE" && (
              <span className="muted small">Students are told this before they begin.</span>
            )}
          </label>

          <label className="field">
            <span>Show results</span>
            <select
              value={form.resultReleasePolicy}
              onChange={(e) => setForm({ ...form, resultReleasePolicy: e.target.value })}
            >
              <option value="AFTER_CLOSE">When the quiz closes</option>
              <option value="IMMEDIATE">As soon as it is marked</option>
              <option value="AFTER_GRADING">When marking is finished</option>
              <option value="MANUAL">Only when I release them</option>
            </select>
          </label>
        </div>

        {problems.length > 0 && (
          <div className="alert alert-error" role="alert">
            <ul className="list small">
              {problems.map((p) => (
                <li key={p}>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button className="btn btn-primary" onClick={() => void create()} disabled={busy || !ready}>
          {busy ? "Creating…" : "Create and add questions"}
        </button>
        <p className="muted small">
          It is created as a draft. Nothing is visible to students until you publish.
        </p>
      </section>
    </>
  );
}

/* ------------------------------------------------------------- phase two -- */

function Paper({ quizId }: { quizId: string }) {
  const [quiz, setQuiz] = useState<QuizDetail | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState("");
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [newBankName, setNewBankName] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [published, setPublished] = useState(false);

  const loadQuiz = useCallback(() => {
    api
      .get<QuizDetail>(`/quizzes/${quizId}/detail`)
      .then(setQuiz)
      .catch((e) => setProblems([e instanceof ApiError ? e.message : "Could not load."]));
  }, [quizId]);

  const loadBanks = useCallback(() => {
    api.get<Bank[]>("/question-banks").then(setBanks).catch(() => setBanks([]));
  }, []);

  const loadQuestions = useCallback(() => {
    if (!bankId) return setQuestions([]);
    api
      .get<BankQuestion[]>(`/question-banks/${bankId}/questions`)
      .then(setQuestions)
      .catch(() => setQuestions([]));
  }, [bankId]);

  useEffect(loadQuiz, [loadQuiz]);
  useEffect(loadBanks, [loadBanks]);
  useEffect(loadQuestions, [loadQuestions]);

  if (!quiz) return <p className="muted">Loading…</p>;

  const locked = quiz.publicationStatus === "PUBLISHED";
  const onPaper = new Set(quiz.questions.map((q) => q.questionId));

  const act = async (fn: () => Promise<unknown>) => {
    setProblems([]);
    try {
      await fn();
      loadQuiz();
    } catch (e) {
      setProblems(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message) ?? [e.message])
          : ["That did not work."],
      );
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{quiz.title}</h1>
          <p className="muted small">
            {quiz.questions.length} question{quiz.questions.length === 1 ? "" : "s"} ·{" "}
            {quiz.totalMarks} marks ·{" "}
            {locked ? "Published" : "Draft — not visible to students"}
          </p>
        </div>
        <Link className="btn btn-quiet" to="/marking">
          Back to marking
        </Link>
      </header>

      {problems.length > 0 && (
        <div className="alert alert-error" role="alert">
          <ul className="list small">
            {problems.map((p) => (
              <li key={p}>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {published && (
        <div className="alert alert-warn">
          <p>Published. Students can sit this now.</p>
        </div>
      )}

      <section className="card">
        <h2>The paper</h2>
        {quiz.questions.length === 0 ? (
          <p className="muted">
            Nothing on it yet. Add questions from a bank below, or write new ones.
          </p>
        ) : (
          <ul className="list">
            {quiz.questions.map((q) => (
              <li key={q.questionId}>
                <span>
                  {q.displayOrder}. {q.stem}
                  <span className="muted small"> · {q.questionType.replace(/_/g, " ").toLowerCase()}</span>
                </span>
                <span className="row-actions">
                  <span className="muted small">{q.marks} marks</span>
                  {!locked && (
                    <button
                      className="btn btn-quiet"
                      onClick={() =>
                        void act(() => api.del(`/quizzes/${quizId}/questions/${q.questionId}`))
                      }
                    >
                      Remove
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {!locked && (
          <>
            <button
              className="btn btn-primary"
              disabled={quiz.questions.length === 0}
              onClick={() =>
                void act(async () => {
                  await api.post(`/quizzes/${quizId}/publish`);
                  setPublished(true);
                })
              }
            >
              Publish
            </button>
            <p className="muted small">
              Once published the paper cannot be changed — somebody may be sitting it.
            </p>
          </>
        )}
        {locked && quiz.attemptCount > 0 && (
          <p className="muted small">
            {quiz.attemptCount} attempt{quiz.attemptCount === 1 ? "" : "s"} so far.
          </p>
        )}
      </section>

      {!locked && (
        <section className="card">
          <h2>Questions</h2>

          <div className="field-row">
            <label className="field">
              <span>Bank</span>
              <select value={bankId} onChange={(e) => setBankId(e.target.value)}>
                <option value="">Choose a bank…</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.questionCount})
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Or start a new one</span>
              <input
                value={newBankName}
                onChange={(e) => setNewBankName(e.target.value)}
                placeholder="Graphic Designing — core"
              />
              <button
                className="btn btn-quiet"
                disabled={newBankName.trim().length < 2}
                onClick={() =>
                  void act(async () => {
                    const bank = await api.post<Bank>("/question-banks", { name: newBankName });
                    setNewBankName("");
                    loadBanks();
                    setBankId(bank.id);
                  })
                }
              >
                Create bank
              </button>
            </label>
          </div>

          {bankId && (
            <>
              {questions.length > 0 && (
                <ul className="list">
                  {questions.map((q) => (
                    <li key={q.id} className={onPaper.has(q.id) ? "done" : ""}>
                      <span>
                        {q.stem}
                        <span className="muted small">
                          {" "}
                          · {q.questionType.replace(/_/g, " ").toLowerCase()} · {q.defaultMarks} marks
                        </span>
                      </span>
                      <span className="row-actions">
                        {onPaper.has(q.id) ? (
                          <span className="muted small">On the paper</span>
                        ) : (
                          <button
                            className="btn btn-quiet"
                            onClick={() =>
                              void act(() =>
                                api.post(`/quizzes/${quizId}/questions`, { questionId: q.id }),
                              )
                            }
                          >
                            Add
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <h3>Write a new question</h3>
              <QuestionComposer
                bankId={bankId}
                onAdded={() => {
                  loadQuestions();
                  loadBanks();
                }}
              />
            </>
          )}
        </section>
      )}
    </>
  );
}
