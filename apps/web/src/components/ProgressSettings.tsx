import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";

/**
 * WHAT PROGRESS IS MADE OF, IN THIS CLASS — FR-PRG.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The four numbers behind every progress bar in the System, and until now
 * nobody could see them, let alone change them. The columns existed; there was
 * no route and no screen, so every class in the Institute's history has been
 * measured by the same weighting whether it was a practical workshop or a
 * lecture course with no coursework at all.
 *
 * IT SHOWS WHERE EACH NUMBER CAME FROM, not only what it is. "40%" means
 * different things depending on whether this class decided it or the Institute
 * did — one is a conversation with yourself, the other is a conversation with
 * the office — so the panel says which, and offers the way back.
 *
 * THE TOTAL IS SHOWN AS YOU TYPE. The server refuses anything that is not 100
 * and explains why, but discovering that on save is worse than seeing it while
 * you make the mistake.
 * ─────────────────────────────────────────────────────────────────────────────
 */

type Key = "video" | "assignment" | "quiz" | "attendance";

const PARTS: Array<{ key: Key; label: string; means: string }> = [
  { key: "video", label: "Recordings watched", means: "How much of the lectures they have played" },
  { key: "assignment", label: "Work handed in", means: "Assignments submitted, marked or not" },
  { key: "quiz", label: "Quizzes sat", means: "Quizzes attempted, however they scored" },
  { key: "attendance", label: "Attendance", means: "Classes present or late, out of those held" },
];

const THRESHOLDS: Array<{ key: ThresholdKey; label: string; means: string }> = [
  { key: "minProgressPercent", label: "Progress needed", means: "Of the four parts above, combined" },
  { key: "minAttendancePercent", label: "Attendance needed", means: "Separately from the weighting" },
  { key: "minAverageGradePercent", label: "Average mark needed", means: "Across released marks" },
];

type ThresholdKey = "minProgressPercent" | "minAttendancePercent" | "minAverageGradePercent";

interface Settings {
  weights: {
    inForce: Record<Key, number>;
    institute: Record<Key, number>;
    ownedByThisClass: boolean;
  };
  criteria: {
    inForce: Record<ThresholdKey, number>;
    institute: Record<ThresholdKey, number>;
    ownedByThisClass: boolean;
  };
}

export function ProgressSettings({
  sectionSubjectId,
  onChanged,
}: {
  sectionSubjectId: string;
  onChanged?: () => void;
}) {
  const [s, setS] = useState<Settings | null>(null);
  const [open, setOpen] = useState(false);
  const [weights, setWeights] = useState<Record<Key, string>>({
    video: "", assignment: "", quiz: "", attendance: "",
  });
  const [criteria, setCriteria] = useState<Record<ThresholdKey, string>>({
    minProgressPercent: "", minAttendancePercent: "", minAverageGradePercent: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .get<Settings>(`/section-subjects/${sectionSubjectId}/progress-settings`)
      .then((v) => {
        setS(v);
        setWeights({
          video: String(v.weights.inForce.video),
          assignment: String(v.weights.inForce.assignment),
          quiz: String(v.weights.inForce.quiz),
          attendance: String(v.weights.inForce.attendance),
        });
        setCriteria({
          minProgressPercent: String(v.criteria.inForce.minProgressPercent),
          minAttendancePercent: String(v.criteria.inForce.minAttendancePercent),
          minAverageGradePercent: String(v.criteria.inForce.minAverageGradePercent),
        });
      })
      .catch(() => setS(null));
  }, [sectionSubjectId]);

  useEffect(load, [load]);

  if (!s) return null;

  const total = PARTS.reduce((a, p) => a + (Number(weights[p.key]) || 0), 0);
  const totals100 = Math.abs(total - 100) < 0.01;

  const save = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api.put(`/section-subjects/${sectionSubjectId}/progress-settings`, {
        weights: {
          video: Number(weights.video) || 0,
          assignment: Number(weights.assignment) || 0,
          quiz: Number(weights.quiz) || 0,
          attendance: Number(weights.attendance) || 0,
        },
        criteria: {
          minProgressPercent: Number(criteria.minProgressPercent) || 0,
          minAttendancePercent: Number(criteria.minAttendancePercent) || 0,
          minAverageGradePercent: Number(criteria.minAverageGradePercent) || 0,
        },
      });
      setNote("Saved. Every figure on this class is measured this way from now on.");
      load();
      onChanged?.();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const followInstitute = async () => {
    if (
      !window.confirm(
        "Go back to the Institute's settings?\n\nThis class stops having its own weighting. " +
          "Every student's progress figure is recalculated the moment you do it.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      // An empty body IS the instruction: sending neither half clears both.
      await api.put(`/section-subjects/${sectionSubjectId}/progress-settings`, {});
      setNote("This class follows the Institute again.");
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That could not be changed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>How progress is measured here</h2>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Change it"}
        </button>
      </div>

      {/* The summary reads without opening anything, because most of the time
          the answer to "why is she at 41%?" is in this one line. */}
      <p className="muted small">
        {PARTS.map((p) => `${p.label} ${s.weights.inForce[p.key]}%`).join(" · ")}
      </p>
      <p className="muted small">
        Complete at {s.criteria.inForce.minProgressPercent}% progress,{" "}
        {s.criteria.inForce.minAttendancePercent}% attendance and{" "}
        {s.criteria.inForce.minAverageGradePercent}% average mark.{" "}
        {s.weights.ownedByThisClass || s.criteria.ownedByThisClass
          ? "Set for this batch."
          : "Following the Institute's settings."}
      </p>

      {open && (
        <div className="progress-settings">
          <h3>The four parts</h3>
          <p className="muted small">
            They must add up to 100. Set one to 0 for a class it does not apply to — a subject
            with no quizzes should not be judged on quizzes.
          </p>
          <div className="progress-parts">
            {PARTS.map((p) => (
              <label className="field" key={p.key}>
                <span>{p.label}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={weights[p.key]}
                  onChange={(e) => setWeights((w) => ({ ...w, [p.key]: e.target.value }))}
                />
                <span className="muted small">{p.means}</span>
              </label>
            ))}
          </div>
          {/* Never colour alone — the number and the word both say it
              (NFR-ACC-003). */}
          <p className={totals100 ? "small" : "warn small"}>
            They add up to {Math.round(total * 100) / 100}
            {totals100 ? " — that is right." : ". They must add up to 100 before this can be saved."}
          </p>

          <h3>What counts as complete</h3>
          <div className="progress-parts">
            {THRESHOLDS.map((t) => (
              <label className="field" key={t.key}>
                <span>{t.label}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={criteria[t.key]}
                  onChange={(e) => setCriteria((c) => ({ ...c, [t.key]: e.target.value }))}
                />
                <span className="muted small">{t.means}</span>
              </label>
            ))}
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              <p>{error}</p>
            </div>
          )}
          {note && (
            <div className="alert alert-ok" role="status">
              <p>{note}</p>
            </div>
          )}

          <div className="row-actions">
            <button
              className="btn btn-primary"
              disabled={busy || !totals100}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {(s.weights.ownedByThisClass || s.criteria.ownedByThisClass) && (
              <button className="btn btn-quiet" disabled={busy} onClick={() => void followInstitute()}>
                Follow the Institute instead
              </button>
            )}
          </div>

          <p className="muted small">
            Changing this changes every student&rsquo;s figure on this batch at once. It does not
            change their marks, and it does not undo a completion you have already decided.
          </p>
        </div>
      )}
    </section>
  );
}
