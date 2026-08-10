import { useState } from "react";
import { ApiError, api } from "../api/client";

/**
 * Writing a question — SRS §13.6, FR-QIZ-004..012.
 *
 * The form CHANGES WITH THE TYPE, because the eight types are answered in
 * genuinely different ways. Showing an options list next to an essay, greyed
 * out, would suggest an essay could have options; showing every field for every
 * type makes the teacher work out which ones apply.
 *
 * It does not try to validate. The server decides whether a question is
 * answerable and returns every problem at once, so the rule lives in one place
 * — a second copy here would drift, and the copy that drifts is the one people
 * trust because it answers faster.
 */

const TYPES = [
  { value: "MCQ_SINGLE", label: "Multiple choice — one answer" },
  { value: "MCQ_MULTI", label: "Multiple choice — several answers" },
  { value: "TRUE_FALSE", label: "True or false" },
  { value: "SHORT_ANSWER", label: "Short answer" },
  { value: "NUMERIC", label: "Numeric" },
  { value: "FILL_BLANK", label: "Fill in the blank" },
  { value: "ESSAY", label: "Essay — marked by you" },
] as const;

type QuestionType = (typeof TYPES)[number]["value"];

const OPTION_TYPES = new Set<QuestionType>(["MCQ_SINGLE", "MCQ_MULTI", "TRUE_FALSE"]);
const TYPED_TYPES = new Set<QuestionType>(["SHORT_ANSWER", "NUMERIC", "FILL_BLANK"]);

interface Option {
  optionText: string;
  isCorrect: boolean;
}

export function QuestionComposer({
  bankId,
  onAdded,
}: {
  bankId: string;
  onAdded: (question: { id: string; stem: string; defaultMarks: number }) => void;
}) {
  const [type, setType] = useState<QuestionType>("MCQ_SINGLE");
  const [stem, setStem] = useState("");
  const [marks, setMarks] = useState("2");
  const [options, setOptions] = useState<Option[]>([
    { optionText: "", isCorrect: false },
    { optionText: "", isCorrect: false },
  ]);
  const [answers, setAnswers] = useState("");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const changeType = (next: QuestionType) => {
    setType(next);
    setProblems([]);
    // True/false has fixed options; nobody should have to type them.
    if (next === "TRUE_FALSE") {
      setOptions([
        { optionText: "True", isCorrect: false },
        { optionText: "False", isCorrect: false },
      ]);
    } else if (OPTION_TYPES.has(next) && options.length < 2) {
      setOptions([
        { optionText: "", isCorrect: false },
        { optionText: "", isCorrect: false },
      ]);
    }
  };

  const setOption = (index: number, patch: Partial<Option>) => {
    setOptions((current) =>
      current.map((o, i) => {
        if (i !== index) {
          // Single-answer: choosing one clears the rest, because the form
          // should not let a teacher build a state the server will refuse.
          return type === "MCQ_SINGLE" || type === "TRUE_FALSE"
            ? { ...o, isCorrect: patch.isCorrect === true ? false : o.isCorrect }
            : o;
        }
        return { ...o, ...patch };
      }),
    );
  };

  const save = async () => {
    setBusy(true);
    setProblems([]);
    try {
      const question = await api.post<{ id: string; stem: string; defaultMarks: number }>(
        `/question-banks/${bankId}/questions`,
        {
          questionType: type,
          stem,
          defaultMarks: Number(marks),
          ...(OPTION_TYPES.has(type) ? { options } : {}),
          ...(TYPED_TYPES.has(type)
            ? {
                acceptedAnswers: answers
                  .split("\n")
                  .map((a) => a.trim())
                  .filter(Boolean)
                  .map((a) => (type === "NUMERIC" ? Number(a) : a)),
              }
            : {}),
        },
      );
      onAdded(question);
      setStem("");
      setAnswers("");
      setOptions([
        { optionText: "", isCorrect: false },
        { optionText: "", isCorrect: false },
      ]);
    } catch (e) {
      // The server returns EVERY problem at once. Showing them as a list is the
      // point — a teacher fixing one complaint at a time gives up.
      setProblems(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message) ?? [e.message])
          : ["That question could not be saved."],
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer">
      <label className="field">
        <span>Type</span>
        <select value={type} onChange={(e) => changeType(e.target.value as QuestionType)}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Question</span>
        <textarea rows={2} value={stem} onChange={(e) => setStem(e.target.value)} />
      </label>

      <label className="field">
        <span>Marks</span>
        <input
          type="number"
          min={0.5}
          step="0.5"
          value={marks}
          onChange={(e) => setMarks(e.target.value)}
        />
      </label>

      {OPTION_TYPES.has(type) && (
        <>
          <span className="field-label">
            Options — tick the correct {type === "MCQ_MULTI" ? "ones" : "one"}
          </span>
          {options.map((o, i) => (
            <label className="option" key={i}>
              <input
                type={type === "MCQ_MULTI" ? "checkbox" : "radio"}
                name="correct"
                checked={o.isCorrect}
                onChange={(e) => setOption(i, { isCorrect: e.target.checked })}
              />
              <input
                className="option-text"
                value={o.optionText}
                readOnly={type === "TRUE_FALSE"}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => setOption(i, { optionText: e.target.value })}
              />
              {type !== "TRUE_FALSE" && options.length > 2 && (
                <button
                  className="btn btn-quiet"
                  onClick={() => setOptions(options.filter((_, k) => k !== i))}
                  aria-label={`Remove option ${i + 1}`}
                >
                  ×
                </button>
              )}
            </label>
          ))}
          {type !== "TRUE_FALSE" && (
            <button
              className="btn btn-quiet"
              onClick={() => setOptions([...options, { optionText: "", isCorrect: false }])}
            >
              Add an option
            </button>
          )}
        </>
      )}

      {TYPED_TYPES.has(type) && (
        <label className="field">
          <span>Accepted answers — one per line</span>
          <textarea
            rows={3}
            value={answers}
            onChange={(e) => setAnswers(e.target.value)}
            placeholder={type === "NUMERIC" ? "42" : "CMYK\nC.M.Y.K"}
          />
          <span className="muted small">
            {type === "NUMERIC"
              ? "A number. Anything else is marked wrong."
              : "Any of these counts as correct, so include the spellings you would accept."}
          </span>
        </label>
      )}

      {type === "ESSAY" && (
        <p className="muted small">
          An essay has no answer key — it waits for you to mark it, and the quiz will
          not release results until you have.
        </p>
      )}

      {problems.length > 0 && (
        <div className="alert alert-error">
          <ul className="list small">
            {problems.map((p) => (
              <li key={p}>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
        {busy ? "Saving…" : "Add question"}
      </button>
    </div>
  );
}
