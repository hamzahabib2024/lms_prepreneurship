import { Fragment, useEffect, useState, type FormEvent } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/Ui";

interface Section {
  id: string;
  code: string;
  name: string;
  capacity: number;
  enrolledCount: number;
  placesRemaining: number;
  isFull: boolean;
  shift: string;
  genderRestriction: string;
  deliveryMode: string;
  status: string;
  batchId: string;
  batch?: { name: string; academicSession: { code: string; name: string } };
  _count?: { sectionSubjects: number };
}

interface Batch {
  id: string;
  name: string;
  academicSession: { id: string; code: string; name: string; programme: { code: string } };
}

interface Subject {
  id: string;
  code: string;
  name: string;
}

interface Offering {
  id: string;
  isCompulsory: boolean;
  status: string;
  subject: Subject;
  hasTeacher: boolean;
  needsTeacher: boolean;
  assignments: { id: string; teacher: { user: { fullName: string } } }[];
  _count: { enrolments: number };
}

const SHIFTS = ["MORNING", "AFTERNOON", "EVENING", "WEEKEND"] as const;
const RESTRICTIONS = ["MIXED", "MALE", "FEMALE"] as const;
const MODES = ["ONLINE", "HYBRID", "ON_CAMPUS"] as const;
const STATUSES = ["PLANNED", "ACTIVE", "CLOSED_FOR_ADMISSION", "ARCHIVED"] as const;

const pretty = (s: string) => s.toLowerCase().replace(/_/g, " ");

/**
 * Sections — SRS §13.11.
 *
 * The list is already scoped by the server (ARC-051), so a teacher sees their
 * own sections here without this screen asking for a filter. That is the point
 * of the scope predicate: the client cannot widen what it is shown.
 *
 * MANAGEMENT LIVES HERE, next to the list, rather than behind a wizard. The
 * codes have to be unique and an administrator setting up a term is creating a
 * dozen of them in a row; seeing the ones that exist while typing the next is
 * how a collision gets noticed before it is saved rather than after.
 *
 * There is no delete. FR-CRS-013 and BR-DAT-04 — a section that has ever held
 * an enrolment is archived, never removed, because its attendance and its marks
 * outlive it. The server has no DELETE route to call even if this screen
 * offered one.
 */
export function SectionsPage() {
  const { hasRole } = useAuth();
  const mayEdit = hasRole("super_admin", "admin");

  const [rows, setRows] = useState<Section[] | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [batchFilter, setBatchFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  /** Which section's subjects are open, and what has been loaded for it. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [offerings, setOfferings] = useState<Offering[] | null>(null);
  const [newOffering, setNewOffering] = useState({ subjectId: "", isCompulsory: true });

  const [creating, setCreating] = useState(false);
  const [blank, setBlank] = useState({
    batchId: "",
    code: "",
    name: "",
    capacity: "30",
    shift: "MORNING",
    genderRestriction: "MIXED",
    deliveryMode: "ONLINE",
  });

  async function load() {
    setError(null);
    try {
      const r = await api.list<Section>(
        `/sections${batchFilter ? `?batchId=${batchFilter}` : ""}`,
      );
      setRows(r.data);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }

  // Re-reads when the batch filter changes; the server does the filtering, so
  // this is the whole of it.
  useEffect(() => {
    void load();
  }, [batchFilter]);

  useEffect(() => {
    // Both are only needed for the forms. A teacher holds neither grant, so a
    // refusal here leaves the pickers empty rather than breaking the list.
    api.get<Batch[]>("/batches").then(setBatches).catch(() => setBatches([]));
    api.get<Subject[]>("/subjects").then(setSubjects).catch(() => setSubjects([]));
  }, []);

  async function run(work: () => Promise<unknown>, said: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await work();
      setNote(said);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function openSubjects(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setOfferings(null);
    setNewOffering({ subjectId: "", isCompulsory: true });
    try {
      setOfferings(await api.get<Offering[]>(`/sections/${id}/subjects`));
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      setOfferings([]);
    }
  }

  async function createSection(e: FormEvent) {
    e.preventDefault();
    const ok = await run(
      () => api.post("/sections", { ...blank, capacity: Number(blank.capacity) }),
      `Section ${blank.code} created.`,
    );
    if (ok) {
      setCreating(false);
      setBlank({ ...blank, code: "", name: "" });
    }
  }

  async function saveSection(id: string) {
    const ok = await run(
      () =>
        api.patch(`/sections/${id}`, {
          ...(draft["name"] ? { name: draft["name"] } : {}),
          ...(draft["capacity"] ? { capacity: Number(draft["capacity"]) } : {}),
          ...(draft["status"] ? { status: draft["status"] } : {}),
          ...(draft["shift"] ? { shift: draft["shift"] } : {}),
        }),
      "Section updated.",
    );
    if (ok) {
      setEditing(null);
      setDraft({});
    }
  }

  async function archive(s: Section) {
    if (
      !window.confirm(
        `Archive ${s.code}?\n\nIt stops accepting enrolments and leaves the active lists. ` +
          `Nothing is deleted — its attendance, marks and fees stay readable.`,
      )
    )
      return;
    await run(() => api.post(`/sections/${s.id}/archive`), `${s.code} archived.`);
  }

  async function addOffering(sectionId: string) {
    const ok = await run(
      () => api.post(`/sections/${sectionId}/subjects`, newOffering),
      "Subject added to the section.",
    );
    if (ok) {
      setNewOffering({ subjectId: "", isCompulsory: true });
      setOfferings(await api.get<Offering[]>(`/sections/${sectionId}/subjects`));
    }
  }

  if (!rows) return <p className="muted">Loading…</p>;

  const offeredIds = new Set((offerings ?? []).map((o) => o.subject.id));
  const addable = subjects.filter((s) => !offeredIds.has(s.id));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Sections</h1>
          <p className="muted small">
            A section is a class group — one shift, one capacity, one register.
          </p>
        </div>
        <span className="muted small">{rows.length} visible to you</span>
      </header>

      {error && (
        <div className="alert alert-error" role="alert">
          <strong>That did not work</strong>
          <p>{error.details?.map((d) => d.message).join(" ") ?? error.message}</p>
          {error.reference && <p className="muted small">Reference: {error.reference}</p>}
        </div>
      )}
      {note && (
        <div className="alert alert-ok" role="status">
          <p>{note}</p>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h2>All sections</h2>
          <div className="row-actions">
            {batches.length > 0 && (
              <label className="field field-inline">
                <span>Batch</span>
                <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
                  <option value="">All batches</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.academicSession.code} · {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mayEdit && (
              <button className="btn btn-primary" onClick={() => setCreating((c) => !c)}>
                {creating ? "Close" : "New section"}
              </button>
            )}
          </div>
        </div>

        {mayEdit && creating && (
          <form className="inline-form" onSubmit={(e) => void createSection(e)}>
            <h3>New section</h3>
            <div className="form-row">
              <label className="field">
                <span>Batch</span>
                <select
                  required
                  value={blank.batchId}
                  onChange={(e) => setBlank((b) => ({ ...b, batchId: e.target.value }))}
                >
                  <option value="">Choose one</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.academicSession.programme.code} · {b.academicSession.code} · {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Code</span>
                <input
                  required
                  placeholder="SP26-GD-MOR-A"
                  value={blank.code}
                  onChange={(e) => setBlank((b) => ({ ...b, code: e.target.value.toUpperCase() }))}
                />
                <span className="muted small">Letters, digits and hyphens. Must be unique.</span>
              </label>
              <label className="field">
                <span>Name</span>
                <input
                  required
                  minLength={3}
                  placeholder="Graphic Designing — Morning A"
                  value={blank.name}
                  onChange={(e) => setBlank((b) => ({ ...b, name: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Capacity</span>
                <input
                  type="number"
                  required
                  min={1}
                  max={500}
                  value={blank.capacity}
                  onChange={(e) => setBlank((b) => ({ ...b, capacity: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Shift</span>
                <select
                  value={blank.shift}
                  onChange={(e) => setBlank((b) => ({ ...b, shift: e.target.value }))}
                >
                  {SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {pretty(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Admits</span>
                <select
                  value={blank.genderRestriction}
                  onChange={(e) =>
                    setBlank((b) => ({ ...b, genderRestriction: e.target.value }))
                  }
                >
                  {RESTRICTIONS.map((s) => (
                    <option key={s} value={s}>
                      {pretty(s)}
                    </option>
                  ))}
                </select>
                {/* FR-CRS-009 — absolute once students are admitted, and there
                    is no override anywhere in the System. Said before the
                    choice is made, not after. */}
                <span className="warn small">
                  Cannot be relaxed once students are admitted.
                </span>
              </label>
              <label className="field">
                <span>Delivery</span>
                <select
                  value={blank.deliveryMode}
                  onChange={(e) => setBlank((b) => ({ ...b, deliveryMode: e.target.value }))}
                >
                  {MODES.map((s) => (
                    <option key={s} value={s}>
                      {pretty(s)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Working…" : "Create section"}
            </button>
            {batches.length === 0 && (
              <p className="warn small">
                No batch exists yet. Create a term and a batch under Structure first — a section
                has to belong to one.
              </p>
            )}
          </form>
        )}

        {rows.length === 0 ? (
          <EmptyState title={batchFilter ? "No sections in that batch" : "No sections yet"}>
            {mayEdit
              ? "A section is a class group. Create one above, or clear the batch filter."
              : "If you are a teacher, you see only the sections you are assigned to."}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Shift</th>
                  <th>Admits</th>
                  <th className="num">Enrolled</th>
                  <th className="num">Capacity</th>
                  <th>Places</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const isEditing = editing === s.id;
                  const isOpen = openId === s.id;
                  return (
                    // The key belongs on the fragment: a section renders two
                    // sibling rows when its subjects are open, and keying the
                    // inner <tr> instead leaves the pair unidentified.
                    <Fragment key={s.id}>
                      <tr className={s.status === "ARCHIVED" ? "row-muted" : ""}>
                        <td>
                          <code>{s.code}</code>
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              aria-label="Section name"
                              value={draft["name"] ?? s.name}
                              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                            />
                          ) : (
                            <>
                              {s.name}
                              {s.batch && (
                                <div className="muted small">
                                  {s.batch.academicSession.code} · {s.batch.name}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <select
                              aria-label="Shift"
                              value={draft["shift"] ?? s.shift}
                              onChange={(e) => setDraft((d) => ({ ...d, shift: e.target.value }))}
                            >
                              {SHIFTS.map((x) => (
                                <option key={x} value={x}>
                                  {pretty(x)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            pretty(s.shift)
                          )}
                        </td>
                        {/* Never editable. FR-CRS-009 is absolute, so it is not
                            offered as a field somebody has to be refused. */}
                        <td>{pretty(s.genderRestriction)}</td>
                        <td className={`num ${s.isFull ? "warn" : ""}`}>{s.enrolledCount}</td>
                        <td className="num">
                          {isEditing ? (
                            <input
                              type="number"
                              aria-label="Capacity"
                              min={s.enrolledCount || 1}
                              max={500}
                              value={draft["capacity"] ?? String(s.capacity)}
                              onChange={(e) =>
                                setDraft((d) => ({ ...d, capacity: e.target.value }))
                              }
                            />
                          ) : (
                            s.capacity
                          )}
                        </td>
                        <td>
                          {/* FR-CRS-010 — occupancy wherever a section appears,
                              so nobody has to do the subtraction themselves. */}
                          {s.isFull ? (
                            <span className="pill pill-warn">full</span>
                          ) : (
                            <span className="pill">{s.placesRemaining} free</span>
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <select
                              aria-label="Status"
                              value={draft["status"] ?? s.status}
                              onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                            >
                              {STATUSES.map((x) => (
                                <option key={x} value={x}>
                                  {pretty(x)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className={`pill ${s.status === "ACTIVE" ? "pill-ok" : ""}`}>
                              {pretty(s.status)}
                            </span>
                          )}
                        </td>
                        <td className="row-actions">
                          <button
                            className="btn btn-quiet btn-sm"
                            aria-expanded={isOpen}
                            onClick={() => void openSubjects(s.id)}
                          >
                            Subjects{s._count ? ` (${s._count.sectionSubjects})` : ""}
                          </button>
                          {mayEdit &&
                            (isEditing ? (
                              <>
                                <button
                                  className="btn btn-primary btn-sm"
                                  disabled={busy}
                                  onClick={() => void saveSection(s.id)}
                                >
                                  Save
                                </button>
                                <button
                                  className="btn btn-quiet btn-sm"
                                  onClick={() => {
                                    setEditing(null);
                                    setDraft({});
                                  }}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="btn btn-quiet btn-sm"
                                  onClick={() => {
                                    setEditing(s.id);
                                    setDraft({});
                                  }}
                                >
                                  Edit
                                </button>
                                {s.status !== "ARCHIVED" && (
                                  <button
                                    className="btn btn-quiet btn-sm"
                                    disabled={busy}
                                    onClick={() => void archive(s)}
                                  >
                                    Archive
                                  </button>
                                )}
                              </>
                            ))}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={9} className="row-detail">
                            <h3>Subjects in {s.code}</h3>
                            {offerings === null ? (
                              <p className="muted">Loading…</p>
                            ) : offerings.length === 0 ? (
                              <p className="muted">
                                No subjects yet. A section with no subjects has nothing to teach,
                                mark or attend.
                              </p>
                            ) : (
                              <table className="table">
                                <thead>
                                  <tr>
                                    <th>Subject</th>
                                    <th>Required</th>
                                    <th>Teacher</th>
                                    <th className="num">Enrolled</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {offerings.map((o) => (
                                    <tr key={o.id}>
                                      <td>
                                        <code>{o.subject.code}</code> {o.subject.name}
                                      </td>
                                      <td>{o.isCompulsory ? "compulsory" : "elective"}</td>
                                      <td>
                                        {/* FR-CRS-026 — an uncovered class
                                            should be noticed by the Institute
                                            rather than by its students. */}
                                        {o.hasTeacher ? (
                                          o.assignments
                                            .map((a) => a.teacher.user.fullName)
                                            .join(", ")
                                        ) : (
                                          <span className="pill pill-warn">no teacher</span>
                                        )}
                                      </td>
                                      <td className="num">{o._count.enrolments}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}

                            {mayEdit && (
                              <div className="form-row" style={{ marginTop: ".8rem" }}>
                                <label className="field">
                                  <span>Add a subject</span>
                                  <select
                                    value={newOffering.subjectId}
                                    onChange={(e) =>
                                      setNewOffering((n) => ({ ...n, subjectId: e.target.value }))
                                    }
                                  >
                                    <option value="">Choose one</option>
                                    {addable.map((sub) => (
                                      <option key={sub.id} value={sub.id}>
                                        {sub.code} — {sub.name}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="field">
                                  <span>Required</span>
                                  <select
                                    value={newOffering.isCompulsory ? "yes" : "no"}
                                    onChange={(e) =>
                                      setNewOffering((n) => ({
                                        ...n,
                                        isCompulsory: e.target.value === "yes",
                                      }))
                                    }
                                  >
                                    <option value="yes">Compulsory</option>
                                    <option value="no">Elective</option>
                                  </select>
                                </label>
                                <div className="field">
                                  <span>&nbsp;</span>
                                  <button
                                    className="btn"
                                    disabled={busy || !newOffering.subjectId}
                                    onClick={() => void addOffering(s.id)}
                                  >
                                    Add
                                  </button>
                                </div>
                              </div>
                            )}
                            {mayEdit && addable.length === 0 && subjects.length > 0 && (
                              <p className="muted small">
                                Every subject is already offered in this section.
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
