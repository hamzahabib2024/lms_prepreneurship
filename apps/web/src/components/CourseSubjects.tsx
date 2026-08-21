import { useState } from "react";
import { ApiError, api } from "../api/client";
import { Icon } from "./Icon";

/**
 * Choosing what a course teaches — its syllabus.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FIXES. A subject could only ever be attached to a BATCH. There was
 * no way to say "the Diploma in Graphic Designing teaches Photoshop and
 * English" — only "batch A teaches them", said again for B, and again for C.
 *
 * A course with no batches yet therefore showed "Subjects: none yet", for a
 * course somebody had just finished defining. Creating the second batch meant
 * re-picking the same six subjects from memory. And two batches of one course
 * could quietly teach different things, which means one cohort gets less of the
 * course than the other and nothing anywhere says so.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * IT DOES NOT TOUCH A RUNNING BATCH, and the panel says so rather than leaving
 * it to be discovered. A batch's register, coursework and recordings hang off
 * its own rows; removing a subject from the syllabus must not delete a term's
 * work. Where the two have drifted apart, the difference is shown and the
 * office decides — the System does not quietly reconcile them.
 */

export interface SubjectRef {
  id: string;
  code: string;
  name: string;
}

/** A subject on the syllabus, and how many batches actually teach it. */
export interface CourseSubject extends SubjectRef {
  batches: number;
}

export function CourseSubjects({
  programmeId,
  programmeName,
  current,
  unlisted,
  batchCount,
  allSubjects,
  onSaved,
  onCancel,
}: {
  programmeId: string;
  programmeName: string;
  current: CourseSubject[];
  /** Taught by a batch but missing from the syllabus — the other half of drift. */
  unlisted: CourseSubject[];
  batchCount: number;
  allSubjects: SubjectRef[];
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>(current.map((s) => s.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.put<{ message: string }>(`/programmes/${programmeId}/subjects`, {
        subjectIds: chosen,
      });
      onSaved(r.message);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  };

  // Only worth warning about a subject that batches are actually teaching.
  const removing = current.filter((s) => !chosen.includes(s.id) && s.batches > 0);
  const partial = current.filter(
    (s) => chosen.includes(s.id) && s.batches > 0 && s.batches < batchCount,
  );

  return (
    <div className="course-form">
      <p className="muted small">
        The subjects that make up <strong>{programmeName}</strong>. This is what the course{" "}
        <em>is</em> — a new batch starts with exactly these.
      </p>

      {error && (
        <div className="alert alert-error" role="alert">
          <strong>{error.message}</strong>
          {error.details?.map((d, i) => (
            <p key={`${d.field}-${i}`} className="small">
              {d.message}
            </p>
          ))}
        </div>
      )}

      {allSubjects.length === 0 ? (
        <p className="muted small">
          No subjects exist yet. Create one under <strong>Subjects</strong> below, then come back
          and add it here.
        </p>
      ) : (
        <fieldset className="field batch-subjects">
          <legend>Which subjects does it teach?</legend>
          <div className="subject-picker">
            {allSubjects.map((s) => {
              const on = chosen.includes(s.id);
              const taught = current.find((c) => c.id === s.id)?.batches ?? 0;
              return (
                <label key={s.id} className={on ? "subject-chip is-on" : "subject-chip"}>
                  <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
                  <span>
                    {s.name} <span className="muted small">{s.code}</span>
                    {/* How far it has actually reached. A subject on the
                        syllabus that no batch teaches is not an error — a
                        course can be defined before it runs — but it is worth
                        being able to see. */}
                    {taught > 0 && (
                      <span className="muted small">
                        {" "}
                        · in {taught} batch{taught === 1 ? "" : "es"}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          {chosen.length === 0 && (
            <p className="warn small">
              Nothing selected. A course with no subjects has nothing to teach, and any batch
              created from it will have no register.
            </p>
          )}
        </fieldset>
      )}

      {/* ---------------------------------------------------- what drifts */}
      {removing.length > 0 && (
        <div className="alert alert-warn" role="status">
          <strong>Running batches keep teaching these.</strong>
          <p className="small">
            {removing.map((s) => `${s.name} (${s.code})`).join(", ")} —{" "}
            {removing.length === 1 ? "is" : "are"} taught by batches that already exist. Taking{" "}
            {removing.length === 1 ? "it" : "them"} off the syllabus stops NEW batches getting{" "}
            {removing.length === 1 ? "it" : "them"} and changes nothing for the ones running, so no
            register or coursework is lost. Change a running batch from its own card if you mean
            to.
          </p>
        </div>
      )}

      {partial.length > 0 && (
        <div className="alert alert-warn" role="status">
          <strong>Not every batch teaches the whole course.</strong>
          <p className="small">
            {partial
              .map((s) => `${s.name} is taught by ${s.batches} of ${batchCount} batches`)
              .join("; ")}
            . That may be deliberate — a subject dropped for one intake — but if it is not, one
            group is getting less of the course than the others.
          </p>
        </div>
      )}

      {unlisted.length > 0 && (
        <div className="alert alert-warn" role="status">
          <strong>Taught by a batch but not on the syllabus.</strong>
          <p className="small">
            {unlisted.map((s) => `${s.name} (${s.code})`).join(", ")}. Tick{" "}
            {unlisted.length === 1 ? "it" : "them"} above to make{" "}
            {unlisted.length === 1 ? "it" : "them"} part of the course, or leave{" "}
            {unlisted.length === 1 ? "it" : "them"} as something only that batch does.
          </p>
        </div>
      )}

      <div className="row-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          <Icon name="check" />
          {busy ? "Saving…" : "Save the syllabus"}
        </button>
        <button className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
