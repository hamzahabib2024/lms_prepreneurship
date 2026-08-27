import { useState } from "react";
import { ApiError, api } from "../api/client";
import { Icon } from "./Icon";
import { Field } from "./Field";

/**
 * Making a batch — the four questions an administrator can actually answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES. Putting a class into the System meant creating a term
 * under Structure, then a delivery group under Structure, then a section under
 * Sections, then offering subjects to it under Sections again. Four steps,
 * two screens, each refusing to begin until the one above it existed, and
 * nothing anywhere stating the order. An administrator who did not already
 * know the model could not finish, and the commonest outcome was a section
 * with no subjects — which looks created and does nothing.
 *
 * So the form asks: what is it called, how many seats, who is it for, and what
 * does it teach. The term and the delivery group are filled in by the server.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE SUBJECTS ARE ON THIS FORM AND NOT A LATER STEP, deliberately. A batch
 * with no subjects has no register, no attendance and nothing on a course
 * page; making it a second screen is how it stays empty. The form says so
 * rather than merely preventing it.
 */

export interface SubjectOption {
  id: string;
  code: string;
  name: string;
}

const SHIFTS = [
  ["MORNING", "Morning"],
  ["EVENING", "Evening"],
  ["WEEKEND", "Weekend"],
] as const;

/**
 * FR-CRS-009 is absolute and the wording says so.
 *
 * A gender restriction cannot be changed once students are admitted and there
 * is no override anywhere in the System. An administrator choosing it casually
 * on the assumption it can be fixed later is the person this note is for.
 */
const AUDIENCES = [
  ["MIXED", "Anyone", "Male and female students together."],
  ["FEMALE", "Female only", "Only female students may be admitted."],
  ["MALE", "Male only", "Only male students may be admitted."],
] as const;

export function BatchForm({
  programmeId,
  programmeName,
  subjects,
  /** Subjects already taught elsewhere in this course — ticked by default. */
  suggestedSubjectIds = [],
  onCreated,
  onCancel,
}: {
  programmeId: string;
  programmeName: string;
  subjects: SubjectOption[];
  suggestedSubjectIds?: string[];
  onCreated: (message: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("40");
  const [genderRestriction, setGenderRestriction] = useState<"MIXED" | "FEMALE" | "MALE">("MIXED");
  const [shift, setShift] = useState<"MORNING" | "EVENING" | "WEEKEND">("MORNING");
  const [chosen, setChosen] = useState<string[]>(suggestedSubjectIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ message: string }>("/course-batches", {
        programmeId,
        name: name.trim(),
        capacity: Number(capacity),
        genderRestriction,
        shift,
        subjectIds: chosen,
      });
      onCreated(r.message);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="course-form batch-form">
      <p className="muted small">
        Another batch of <strong>{programmeName}</strong> — same course, different group of
        students. Students are admitted into a batch, and the subjects below are what it teaches.
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

      {/* ---------------------------------------------------------- 1 name */}
      <Field label="What is this batch called?" required hint={<>The batch letter, or whatever staff and students call it —
          &ldquo;A&rdquo;, &ldquo;Batch B&rdquo;, &ldquo;Morning A (Female)&rdquo;,
          &ldquo;Batch 2&rdquo;. A short code is generated for you.</>}><input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Morning A (Female)"
          autoFocus
        />
      </Field>

      <div className="form-row">
        {/* ------------------------------------------------------ 2 seats */}
        <Field label="How many seats?" required hint={<>Admissions warn once this is full. It can be raised later.</>}><input
            type="number"
            min={1}
            max={500}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </Field>

        {/* ------------------------------------------------------ 3 shift */}
        <Field label="When does it run?" required><select value={shift} onChange={(e) => setShift(e.target.value as typeof shift)}>
            {SHIFTS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* ------------------------------------------------------ 4 audience */}
      <fieldset className="field batch-audience">
        <legend>Who may join it?</legend>
        {AUDIENCES.map(([value, label, note]) => (
          <label key={value} className="radio-row">
            <input
              type="radio"
              name="gender-restriction"
              checked={genderRestriction === value}
              onChange={() => setGenderRestriction(value)}
            />
            <span>
              <strong>{label}</strong>
              <span className="muted small">{note}</span>
            </span>
          </label>
        ))}
        {genderRestriction !== "MIXED" && (
          <p className="warn small">
            This cannot be changed once a student has been admitted, and there is no override.
            Choose carefully.
          </p>
        )}
      </fieldset>

      {/* ------------------------------------------------------ 5 subjects */}
      <fieldset className="field batch-subjects">
        <legend>What does it teach?</legend>
        {subjects.length === 0 ? (
          <p className="muted small">
            No subjects exist yet. Create one below first — a batch with no subjects has no
            register and nothing on its course page.
          </p>
        ) : (
          <>
            <div className="subject-picker">
              {subjects.map((s) => (
                <label
                  key={s.id}
                  className={chosen.includes(s.id) ? "subject-chip is-on" : "subject-chip"}
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(s.id)}
                    onChange={() => toggle(s.id)}
                  />
                  <span>
                    {s.name} <span className="muted small">{s.code}</span>
                  </span>
                </label>
              ))}
            </div>
            {/* Said rather than prevented: an administrator may genuinely want
                to add the subjects afterwards, and refusing would be wrong. */}
            {chosen.length === 0 && (
              <p className="warn small">
                Nothing selected. The batch will have no register and no course page until you add
                a subject to it.
              </p>
            )}
          </>
        )}
      </fieldset>

      <div className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy || !name.trim() || !capacity}
          onClick={() => void submit()}
        >
          <Icon name="check" />
          {busy ? "Creating…" : "Create this batch"}
        </button>
        <button className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>

      <p className="muted small">
        The term this runs in is set for you. Change it under <strong>Structure</strong> if the
        Institute keeps several terms open at once.
      </p>
    </div>
  );
}
