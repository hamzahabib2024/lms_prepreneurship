import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { SkeletonList } from "../components/Ui";
import { HowItWorks } from "../components/HowItWorks";
import { Icon } from "../components/Icon";

/**
 * SIGNING OFF THAT A STUDENT HAS FINISHED — FR-CRT, FR-PRG.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SCREEN IS AND WHY IT LOOKS LIKE THIS.
 *
 * The System already computes completion from attendance, work, marks and
 * lectures watched. That figure is EVIDENCE. This screen is where a person
 * makes the DECISION, because the arithmetic cannot know about a viva, a
 * made-up brief, or a term that lost two weeks — and cannot know that somebody
 * who scraped past every threshold by a point is not ready for a document with
 * the Institute's name on it.
 *
 * THREE BUTTONS, NOT A TICKBOX. A checkbox offers "complete" and "not yet"
 * with no way to say "finished, and did not pass" — so a student who sat the
 * term and failed looks identical to one still working. The three states are
 * shown side by side with the consequence of each written on them, because
 * what an author needs is the consequence BEFORE they choose, not after.
 *
 * THE ARITHMETIC IS SHOWN BESIDE EVERY ROW, and the row says plainly when the
 * choice disagrees with it. Overriding is allowed — it is the whole reason a
 * person is here — but it asks for a reason, and the reason is kept with the
 * decision. Six months later, when somebody asks why a certificate went to a
 * student whose attendance reads 61%, the answer is on the record.
 *
 * NOBODY ISSUES ANYTHING HERE. Signing off and issuing are deliberately
 * different people: a teacher signs off the class they taught, and the office
 * issues the certificate. The screen says so rather than leaving a teacher
 * hunting for a button that is not theirs.
 * ─────────────────────────────────────────────────────────────────────────────
 */

type Decision = "IN_PROGRESS" | "COMPLETED" | "NOT_COMPLETED";

interface Row {
  studentId: string;
  rollNo: number | null;
  registrationNo: string;
  name: string;
  computedPercent: number | null;
  criteriaMet: boolean;
  outstanding: string[];
  attendancePercent: number | null;
  decision: Decision;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  wasOverride: boolean;
}

interface Roster {
  sectionSubject: { id: string; subject: string; section: string; code: string };
  summary: {
    enrolled: number;
    completed: number;
    notCompleted: number;
    undecided: number;
    criteriaMet: number;
  };
  students: Row[];
}

/** The three states, with the consequence of each written on the control. */
const CHOICES: Array<{ key: Decision; label: string; means: string }> = [
  { key: "IN_PROGRESS", label: "Still going", means: "No decision yet" },
  { key: "COMPLETED", label: "Completed", means: "Can be issued a certificate" },
  { key: "NOT_COMPLETED", label: "Did not complete", means: "Finished without passing" },
];

export function CompletionPage() {
  const { sectionSubjectId = "" } = useParams();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Roster>(`/section-subjects/${sectionSubjectId}/completion`)
      .then(setRoster)
      .catch((e) => setError(e instanceof ApiError ? e.message : "That class could not be loaded."));
  }, [sectionSubjectId]);

  useEffect(load, [load]);

  if (error && !roster) {
    return (
      <div className="alert alert-error" role="alert">
        <strong>Could not load this class</strong>
        <p>{error}</p>
      </div>
    );
  }
  if (!roster) return <SkeletonList rows={6} />;

  const { summary: sum } = roster;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Who has finished</h1>
          <p className="muted small">
            {roster.sectionSubject.subject} · {roster.sectionSubject.code}
          </p>
        </div>
        <Link className="btn btn-quiet" to="/marking">
          Back
        </Link>
      </header>

      <HowItWorks
        id="completion"
        title="Deciding who has finished"
        intro="The figures are worked out for you. The decision is yours — the arithmetic cannot know what happened in the room."
        steps={[
          {
            icon: "chart",
            title: "Read the figures",
            body: "Each student's progress and attendance, and whether they meet the requirements as they stand.",
          },
          {
            icon: "check",
            title: "Choose for each student",
            body: "Still going, completed, or finished without passing. Nothing is decided until you choose.",
          },
          {
            icon: "pen",
            title: "Say why if you disagree",
            body: "Passing somebody short of the requirements, or failing somebody who meets them, needs a reason.",
          },
          {
            icon: "award",
            title: "The office issues",
            body: "Signing off does not print anything. The office issues certificates once every subject is signed off.",
          },
        ]}
        note="Your decision is recorded with your name and the figures as they stood when you made it — so an override is always explicable later, rather than a mark nobody can account for."
      />

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {saved && (
        <div className="alert alert-ok">
          <p>{saved}</p>
        </div>
      )}

      <section className="card">
        <ul className="list">
          <li>
            <span>Enrolled</span>
            <strong>{sum.enrolled}</strong>
          </li>
          <li>
            <span>Signed off as completed</span>
            <strong>{sum.completed}</strong>
          </li>
          <li>
            <span>Did not complete</span>
            <strong>{sum.notCompleted}</strong>
          </li>
          <li className={sum.undecided > 0 ? "warn" : ""}>
            <span>Still to decide</span>
            <strong>{sum.undecided}</strong>
          </li>
          <li>
            {/* Shown so a teacher can see at a glance whether their judgement
                and the System are far apart — which is worth noticing. */}
            <span>Meet the requirements on the figures alone</span>
            <strong>{sum.criteriaMet}</strong>
          </li>
        </ul>
      </section>

      <section className="card">
        <ul className="list completion-list">
          {roster.students.map((s) => (
            <CompletionRow
              key={s.studentId}
              row={s}
              sectionSubjectId={sectionSubjectId}
              onSaved={(m) => {
                setSaved(m);
                setError(null);
                load();
              }}
              onError={(m) => {
                setError(m);
                setSaved(null);
              }}
            />
          ))}
        </ul>
      </section>
    </>
  );
}

function CompletionRow({
  row,
  sectionSubjectId,
  onSaved,
  onError,
}: {
  row: Row;
  sectionSubjectId: string;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [choice, setChoice] = useState<Decision>(row.decision);
  const [note, setNote] = useState(row.note ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChoice(row.decision);
    setNote(row.note ?? "");
  }, [row.decision, row.note]);

  /*
   * Whether THIS choice disagrees with the arithmetic — recomputed as the
   * teacher clicks, so the reason box appears at the moment it becomes
   * necessary rather than after a refused save.
   */
  const disagrees = row.criteriaMet !== (choice === "COMPLETED");
  const dirty = choice !== row.decision || note.trim() !== (row.note ?? "");
  const needsReason = disagrees && note.trim().length < 10;

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/section-subjects/${sectionSubjectId}/completion/${row.studentId}`, {
        decision: choice,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onSaved(`${row.name} — saved.`);
    } catch (e) {
      onError(
        e instanceof ApiError
          ? (e.details?.[0]?.message ?? e.message)
          : "That decision could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="completion-row">
      <div className="completion-who">
        <div>
          <strong>
            {row.rollNo ? `${row.rollNo}. ` : ""}
            {row.name}
          </strong>
          <br />
          <span className="muted small">{row.registrationNo}</span>
        </div>
        <div className="completion-figures">
          <span className="muted small">
            Progress{" "}
            <strong>
              {row.computedPercent === null ? "—" : `${Math.round(row.computedPercent)}%`}
            </strong>
          </span>
          <span className="muted small">
            Attendance{" "}
            <strong>
              {row.attendancePercent === null ? "—" : `${Math.round(row.attendancePercent)}%`}
            </strong>
          </span>
          {/* A word as well as a colour (NFR-ACC-007). */}
          <span className={row.criteriaMet ? "pill pill-ok" : "pill"}>
            {row.criteriaMet ? "Meets the requirements" : "Does not yet meet them"}
          </span>
        </div>
      </div>

      {row.outstanding.length > 0 && (
        <p className="muted small completion-outstanding">
          Outstanding: {row.outstanding.join(" · ")}
        </p>
      )}

      {/*
        THE DECISION. A radio group, so a screen reader announces it as one
        choice of three rather than three unrelated buttons — and so that only
        one can be chosen, which a row of buttons does not guarantee.
      */}
      <fieldset className="completion-choice">
        <legend className="visually-hidden">Has {row.name} finished?</legend>
        {CHOICES.map((c) => (
          <label
            key={c.key}
            className={
              choice === c.key
                ? `completion-option is-on completion-${c.key.toLowerCase()}`
                : "completion-option"
            }
          >
            <input
              type="radio"
              name={`decision-${row.studentId}`}
              value={c.key}
              checked={choice === c.key}
              onChange={() => setChoice(c.key)}
            />
            <span className="completion-option-label">{c.label}</span>
            <span className="muted small">{c.means}</span>
          </label>
        ))}
      </fieldset>

      {disagrees && (
        <div className="completion-reason">
          <p className="small">
            <Icon name="alert" />{" "}
            {row.criteriaMet
              ? "This student meets the requirements. Say why you are not passing them."
              : "This student does not yet meet the requirements. Say what they did that the figures do not show."}
          </p>
          <label className="field">
            <span className="visually-hidden">Reason</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Sat a viva on 20 August and made up the missed brief."
            />
          </label>
        </div>
      )}

      {row.decidedBy && (
        <p className="muted small">
          {row.wasOverride ? "Overridden" : "Decided"} by {row.decidedBy}
          {row.decidedAt ? ` on ${new Date(row.decidedAt).toLocaleDateString()}` : ""}
          {row.note ? ` — “${row.note}”` : ""}
        </p>
      )}

      <div className="row-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || !dirty || needsReason}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {needsReason && (
          <span className="muted small">A reason of at least ten characters is needed.</span>
        )}
      </div>
    </li>
  );
}
