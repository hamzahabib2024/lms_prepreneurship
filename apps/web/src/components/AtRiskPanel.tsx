import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";

/**
 * Students at risk on attendance — SRS §13.6, FR-ATT-020/022.
 *
 * The point of an early-warning signal is that somebody acts on it, so this
 * puts the warnings where a teacher already goes rather than on a page they
 * would have to remember to visit.
 *
 * Unacknowledged first, then worst, then longest-standing: a critical warning
 * raised three weeks ago that nobody has touched is the one that matters, and
 * any ordering that buries it defeats the purpose.
 */

interface AtRiskStudent {
  warningId: string;
  studentId: string;
  rollNo: number | null;
  name: string;
  severity: "WARNING" | "CRITICAL";
  percentage: number;
  thresholdApplied: number;
  raisedAt: string;
  acknowledgedAt: string | null;
}

interface AtRisk {
  sectionSubjectId: string;
  critical: number;
  warning: number;
  unacknowledged: number;
  students: AtRiskStudent[];
}

export function AtRiskPanel({ sectionSubjectId }: { sectionSubjectId: string }) {
  const [data, setData] = useState<AtRisk | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<AtRisk>(`/section-subjects/${sectionSubjectId}/at-risk`)
      .then(setData)
      // A teacher who cannot see this panel is not blocked from marking; the
      // register is why they are here.
      .catch((e) => setError(e instanceof ApiError ? e.message : null));
  }, [sectionSubjectId]);

  useEffect(load, [load]);

  if (error || !data) return null;

  // Nothing to show is the good case, and an empty panel on every screen is
  // noise. It appears only when there is something to act on.
  if (data.students.length === 0) return null;

  const ordered = [...data.students].sort(
    (a, b) =>
      Number(a.acknowledgedAt !== null) - Number(b.acknowledgedAt !== null) ||
      (a.severity === b.severity ? 0 : a.severity === "CRITICAL" ? -1 : 1) ||
      new Date(a.raisedAt).getTime() - new Date(b.raisedAt).getTime(),
  );

  return (
    <section className="card">
      <h2>Attendance — students at risk</h2>
      <p className="muted small">
        {data.critical > 0 && `${data.critical} critical`}
        {data.critical > 0 && data.warning > 0 && " · "}
        {data.warning > 0 && `${data.warning} below the requirement`}
        {data.unacknowledged > 0 && ` · ${data.unacknowledged} not yet actioned`}
      </p>

      <ul className="list">
        {ordered.map((s) => (
          <AtRiskRow key={s.warningId} student={s} onAcknowledged={load} />
        ))}
      </ul>
    </section>
  );
}

function AtRiskRow({
  student: s,
  onAcknowledged,
}: {
  student: AtRiskStudent;
  onAcknowledged: () => void;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acknowledge = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/attendance-warnings/${s.warningId}/acknowledge`, {
        note: note.trim() || undefined,
      });
      setOpen(false);
      onAcknowledged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That could not be recorded.");
    } finally {
      setBusy(false);
    }
  };

  const daysAgo = Math.floor((Date.now() - new Date(s.raisedAt).getTime()) / 86_400_000);

  return (
    <li className="assignment">
      <div className="assignment-head">
        <span>
          {s.rollNo}. {s.name}
          {/* The severity is a word, never a colour alone (NFR-ACC-003). */}
          <span className={s.severity === "CRITICAL" ? "warn small" : "small"}>
            {" "}
            · {s.severity === "CRITICAL" ? "Critical" : "Below requirement"}
          </span>
          <br />
          <span className="muted small">
            {s.percentage}% against {s.thresholdApplied}% required · flagged{" "}
            {daysAgo === 0 ? "today" : `${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`}
          </span>
        </span>

        <span className="row-actions">
          {s.acknowledgedAt ? (
            // Deliberately not "resolved". The student is still below the
            // threshold; what happened is that somebody spoke to them.
            <span className="small">✓ Actioned</span>
          ) : (
            <button className="btn btn-quiet" onClick={() => setOpen(!open)}>
              Record action
            </button>
          )}
        </span>
      </div>

      {open && (
        <div className="assignment-body">
          <label className="field">
            <span>What did you do?</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Spoke to her after class; she has been unwell."
            />
          </label>
          <p className="muted small">
            This records that somebody has acted. It does not clear the warning —
            that happens when their attendance recovers.
          </p>
          {error && (
            <div className="alert alert-error">
              <p>{error}</p>
            </div>
          )}
          <button className="btn btn-primary" onClick={() => void acknowledge()} disabled={busy}>
            {busy ? "Saving…" : "Record"}
          </button>
        </div>
      )}
    </li>
  );
}
