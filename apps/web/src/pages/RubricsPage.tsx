import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * Rubrics — SRS §13.6, FR-ASG-012..018.
 *
 * A rubric is a document, so it is edited as one: the whole thing at once, with
 * the criteria as rows you can add, reorder and remove. Patching one criterion
 * at a time would match the database better and match how a teacher thinks
 * considerably worse.
 *
 * THE RUNNING TOTAL IS THE POINT OF THE SCREEN. A rubric that awards 23 marks
 * for a 25-mark assignment is the single most common mistake, and it is
 * invisible until somebody adds the column up by hand. It is shown constantly,
 * and it moves as you type.
 *
 * Internal criteria (FR-ASG-014) are marked plainly rather than hidden behind a
 * checkbox label nobody reads, because a teacher ticking that box is deciding
 * their student will never see the row.
 */

interface RubricSummary {
  id: string;
  name: string;
  description: string | null;
  isShared: boolean;
  isMine: boolean;
  criteriaCount: number;
  totalMarks: number;
  usedByAssignments: number;
}

interface CriterionRow {
  name: string;
  description: string;
  maxMarks: string;
  isInternal: boolean;
}

const emptyRow = (): CriterionRow => ({ name: "", description: "", maxMarks: "", isInternal: false });

export function RubricsPage() {
  const { hasRole } = useAuth();
  const [rubrics, setRubrics] = useState<RubricSummary[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<RubricSummary[]>("/rubrics")
      .then(setRubrics)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load rubrics."));
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Rubrics</h1>
          <p className="muted small">
            A marking scheme you can reuse. Attach one to an assignment when you set it.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({ id: null })}>
          New rubric
        </button>
      </header>

      {error && (
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      )}

      {editing && (
        <RubricEditor
          rubricId={editing.id}
          canShare={hasRole("super_admin", "admin")}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {!rubrics ? (
        <p className="muted">Loading…</p>
      ) : rubrics.length === 0 ? (
        <div className="card">
          <p className="muted">
            No rubrics yet. One is worth writing when you would otherwise explain the same
            marks twice.
          </p>
        </div>
      ) : (
        <section className="card">
          <ul className="list">
            {rubrics.map((r) => (
              <li key={r.id} className="assignment">
                <div className="assignment-head">
                  <span>
                    <button className="link-button" onClick={() => setEditing({ id: r.id })}>
                      {r.name}
                    </button>
                    <br />
                    <span className="muted small">
                      {r.criteriaCount} {r.criteriaCount === 1 ? "criterion" : "criteria"} ·{" "}
                      {r.totalMarks} marks
                      {r.usedByAssignments > 0 &&
                        ` · used by ${r.usedByAssignments} ${r.usedByAssignments === 1 ? "assignment" : "assignments"}`}
                    </span>
                  </span>
                  <span className="row-actions">
                    {/* Whose it is decides whether it can be edited, so it is
                        stated on the row rather than discovered on save. */}
                    {r.isShared ? (
                      <span className="pill">Institute-wide</span>
                    ) : r.isMine ? (
                      <span className="pill">Mine</span>
                    ) : (
                      <span className="muted small">Another teacher's</span>
                    )}
                  </span>
                </div>
                {r.description && <p className="muted small">{r.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function RubricEditor({
  rubricId,
  canShare,
  onClose,
  onSaved,
}: {
  rubricId: string | null;
  canShare: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shareInstituteWide, setShare] = useState(false);
  const [rows, setRows] = useState<CriterionRow[]>([emptyRow()]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [loading, setLoading] = useState(rubricId != null);

  useEffect(() => {
    if (!rubricId) return;
    api
      .get<{
        name: string;
        description: string | null;
        isShared: boolean;
        canEdit: boolean;
        criteria: Array<{
          name: string;
          description: string | null;
          maxMarks: number;
          isInternal?: boolean;
        }>;
      }>(`/rubrics/${rubricId}`)
      .then((r) => {
        setName(r.name);
        setDescription(r.description ?? "");
        setShare(r.isShared);
        setReadOnly(!r.canEdit);
        setRows(
          r.criteria.map((c) => ({
            name: c.name,
            description: c.description ?? "",
            maxMarks: String(c.maxMarks),
            isInternal: c.isInternal ?? false,
          })),
        );
      })
      .catch((e) => setProblems([e instanceof ApiError ? e.message : "Could not load it."]))
      .finally(() => setLoading(false));
  }, [rubricId]);

  const total = rows.reduce((sum, r) => sum + (Number(r.maxMarks) || 0), 0);
  const visibleTotal = rows
    .filter((r) => !r.isInternal)
    .reduce((sum, r) => sum + (Number(r.maxMarks) || 0), 0);

  const setRow = (index: number, patch: Partial<CriterionRow>) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const move = (index: number, by: number) => {
    const next = [...rows];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    setRows(next);
  };

  const save = async () => {
    setBusy(true);
    setProblems([]);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      ...(canShare ? { shareInstituteWide } : {}),
      criteria: rows
        .filter((r) => r.name.trim() !== "")
        .map((r) => ({
          name: r.name.trim(),
          description: r.description.trim() || null,
          maxMarks: Number(r.maxMarks),
          isInternal: r.isInternal,
        })),
    };
    try {
      if (rubricId) await api.patch(`/rubrics/${rubricId}`, payload);
      else await api.post("/rubrics", payload);
      onSaved();
    } catch (e) {
      // The server validates the same rules and its messages name the criterion,
      // so they are shown as written rather than replaced with a generic one.
      setProblems(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message) ?? [e.message])
          : ["Could not save it."],
      );
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!rubricId) return;
    setBusy(true);
    try {
      await api.del(`/rubrics/${rubricId}`);
      onSaved();
    } catch (e) {
      setProblems([e instanceof ApiError ? e.message : "Could not withdraw it."]);
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section className="card">
        <p className="muted">Loading…</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="modal-head">
        <h2>{rubricId ? "Edit rubric" : "New rubric"}</h2>
        <button className="btn btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>

      {readOnly && (
        <div className="alert alert-warn">
          <p>
            {shareInstituteWide
              ? "This rubric is shared with the whole Institute. Only an administrator can change it."
              : "This rubric belongs to another teacher."}{" "}
            You can read it and copy the criteria into one of your own.
          </p>
        </div>
      )}

      {problems.length > 0 && (
        <div className="alert alert-error">
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <label className="field">
        <span>Name</span>
        <input
          value={name}
          disabled={readOnly}
          onChange={(e) => setName(e.target.value)}
          placeholder="Argumentative essay"
        />
      </label>

      <label className="field">
        <span>What it is for</span>
        <input
          value={description}
          disabled={readOnly}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional."
        />
      </label>

      {canShare && (
        <label className="inline-field">
          <input
            type="checkbox"
            checked={shareInstituteWide}
            disabled={readOnly}
            onChange={(e) => setShare(e.target.checked)}
          />
          <span>
            Share with the whole Institute
            <br />
            <span className="muted small">
              Every teacher can use it; only an administrator can edit it afterwards.
            </span>
          </span>
        </label>
      )}

      <h3>Criteria</h3>
      <ul className="list">
        {rows.map((row, index) => (
          <li key={index} className="question">
            <div className="field-row">
              <label className="field">
                <span>Criterion</span>
                <input
                  value={row.name}
                  disabled={readOnly}
                  onChange={(e) => setRow(index, { name: e.target.value })}
                  placeholder="Argument"
                />
              </label>
              <label className="field">
                <span>Marks</span>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={row.maxMarks}
                  disabled={readOnly}
                  onChange={(e) => setRow(index, { maxMarks: e.target.value })}
                />
              </label>
            </div>

            <label className="field">
              <span>What earns them</span>
              <input
                value={row.description}
                disabled={readOnly}
                onChange={(e) => setRow(index, { description: e.target.value })}
                placeholder="Is the claim supported throughout? Optional, but the student reads it."
              />
            </label>

            <div className="row-actions">
              <label className="inline-field">
                <input
                  type="checkbox"
                  checked={row.isInternal}
                  disabled={readOnly}
                  onChange={(e) => setRow(index, { isInternal: e.target.checked })}
                />
                {/* Said in full, because ticking it decides that a student will
                    never see this row — not the marks, not the name, not that
                    it exists (FR-ASG-014). */}
                <span>
                  Internal
                  <br />
                  <span className="muted small">
                    Counts towards the mark. The student never sees this row.
                  </span>
                </span>
              </label>
              <span className="row-actions">
                <button
                  className="btn btn-quiet"
                  disabled={readOnly || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move ${row.name || "criterion"} up`}
                >
                  ↑
                </button>
                <button
                  className="btn btn-quiet"
                  disabled={readOnly || index === rows.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move ${row.name || "criterion"} down`}
                >
                  ↓
                </button>
                <button
                  className="btn btn-quiet"
                  disabled={readOnly || rows.length === 1}
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>

      {!readOnly && (
        <button className="btn btn-quiet" onClick={() => setRows([...rows, emptyRow()])}>
          Add a criterion
        </button>
      )}

      {/* The running total, always visible. A rubric awarding 23 marks for a
          25-mark assignment is the commonest mistake there is, and it cannot be
          seen without adding the column up. */}
      <div className="facts">
        <span className="stat">
          <strong>{total}</strong> marks in total
        </span>
        {visibleTotal !== total && (
          <span className="stat muted">
            <strong>{visibleTotal}</strong> of them visible to the student
          </span>
        )}
      </div>

      {!readOnly && (
        <div className="row-actions">
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : rubricId ? "Save changes" : "Create rubric"}
          </button>
          {rubricId && (
            <button className="btn btn-quiet" onClick={() => void withdraw()} disabled={busy}>
              Withdraw
            </button>
          )}
        </div>
      )}
    </section>
  );
}
