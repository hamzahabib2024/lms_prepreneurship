import { Fragment, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, Skeleton, SkeletonTable, askPermanent } from "../components/Ui";
import { HowItWorks } from "../components/HowItWorks";
import { ClassRoom } from "../components/ClassRoom";
import { Field } from "../components/Field";

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
  /** FR-LIV — this class's standing room. One link, the same every week. */
  meetingUrl: string | null;
  meetingNote: string | null;
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
 * ARCHIVE AND DELETE ARE BOTH HERE, and they are not alternatives. FR-CRS-013
 * and BR-DAT-04: a section that has ever held an enrolment is ARCHIVED, because
 * its attendance and its marks outlive it and are somebody's evidence they
 * attended. A section created by mistake and never used has nothing to keep,
 * and living with it in every dropdown for a year is not a policy.
 *
 * The server decides which case a section is in, not this screen. Delete is
 * offered on every row and refused — by name, saying what is in the way — the
 * moment anything depends on it.
 */
export function SectionsPage() {
  const { hasRole } = useAuth();
  const mayEdit = hasRole("super_admin", "admin");
  /*
   * WHO MAY SET A CLASS'S MEETING LINK — a different question from who may
   * edit the section itself, and a wider answer.
   *
   * A teacher owns the room their class meets in; they hold live_session at
   * ASSIGNED scope and set it from the course screen already. Denying it here
   * would mean the same person can do the same thing on one screen and not on
   * another, which reads as a bug rather than as a rule.
   *
   * Safe because this list is scoped by the server (ARC-051): a teacher only
   * ever sees the sections they teach, and the route re-checks scope anyway.
   */
  const maySetRoom = hasRole("super_admin", "admin", "teacher");

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
  /*
   * WHICH SUBJECT ROW HAS ITS MEETING LINK OPEN.
   *
   * One at a time, and in a row of its own under the subject rather than in a
   * cell. A URL is 60 characters and a note is a sentence; both squeezed into
   * a table column would wrap the whole table into unreadability, and every
   * other column would grow to fit a field only one row is using.
   */
  const [roomFor, setRoomFor] = useState<string | null>(null);

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
      `Batch ${blank.code} created.`,
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
      "Batch updated.",
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

  /**
   * REMOVING WHAT WAS CREATED BY MISTAKE.
   *
   * The confirmation says what is about to go and, for a section, what the
   * difference is from archiving — because the two are genuinely different
   * and the wrong one is the one that loses a student's marks. The server
   * refuses anything that has been taught, so the worst a mis-click can do is
   * produce a message explaining why it will not happen.
   */
  async function removeSection(sec: Section) {
    if (
      !window.confirm(
        `Delete ${sec.code}?

Only possible while nothing depends on it — no students, ` +
          `no admissions, no subjects. If it has been taught, archive it instead: that ` +
          `takes it out of the lists and keeps the attendance and marks.`,
      )
    )
      return;
    const forever = askPermanent(sec.code);
    const ok = await run(
      () => api.del(`/sections/${sec.id}${forever ? "/permanent" : ""}`),
      forever ? `${sec.code} erased permanently.` : `${sec.code} deleted.`,
    );
    if (ok && openId === sec.id) {
      setOpenId(null);
      setOfferings(null);
    }
  }

  async function removeOffering(sectionId: string, o: Offering) {
    if (
      !window.confirm(
        `Take ${o.subject.code} off this batch?

Only possible while it has not been ` +
          `taught — no enrolments, no assignments, no register. The teacher's posting to ` +
          `it is removed with it.`,
      )
    )
      return;
    const forever = askPermanent(`${o.subject.code} on this batch`);
    const ok = await run(
      () => api.del(`/section-subjects/${o.id}${forever ? "/permanent" : ""}`),
      forever
        ? `${o.subject.code} erased permanently.`
        : `${o.subject.code} removed from the batch.`,
    );
    if (ok) setOfferings(await api.get<Offering[]>(`/sections/${sectionId}/subjects`));
  }

  async function addOffering(sectionId: string) {
    const ok = await run(
      () => api.post(`/sections/${sectionId}/subjects`, newOffering),
      "Subject added to the batch.",
    );
    if (ok) {
      setNewOffering({ subjectId: "", isCompulsory: true });
      setOfferings(await api.get<Offering[]>(`/sections/${sectionId}/subjects`));
    }
  }

  if (!rows) return <SkeletonTable rows={6} columns={5} />;

  const offeredIds = new Set((offerings ?? []).map((o) => o.subject.id));
  const addable = subjects.filter((s) => !offeredIds.has(s.id));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Batches</h1>
          <p className="muted small">
            A batch is a class group — one shift, one capacity, one register.
          </p>
        </div>
        <span className="muted small">{rows.length} visible to you</span>
      </header>

      <HowItWorks
        id="sections"
        title="What a batch is"
        intro="A batch is one group of students being taught together — a class. The course is what is taught; the batch is who is in the room."
        steps={[
          { icon: "layers", title: "Pick the course", body: "A batch always belongs to one course." },
          { icon: "users", title: "Name the group", body: "Morning A, Evening B. Whatever the office already calls it on paper." },
          { icon: "calendar", title: "Say when it runs", body: "The shift and the term. This is what an applicant chooses between." },
          { icon: "pen", title: "Give it a teacher", body: "A teacher only ever sees the batches they are assigned to." },
        ]}
        note="A batch with no teacher assigned is invisible to every teacher, so nobody takes the register. It is the most common thing to forget."
      />

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
          <h2>All batches</h2>
          <div className="row-actions">
            {batches.length > 0 && (
              <label className="field field-inline">
                <span>Intake</span>
                <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
                  <option value="">All intakes</option>
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
                {creating ? "Close" : "New batch"}
              </button>
            )}
          </div>
        </div>

        {mayEdit && creating && (
          <form className="inline-form" onSubmit={(e) => void createSection(e)}>
            <h3>New batch</h3>
            <div className="form-row">
              <Field label="Intake" required><select
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
              
              </Field>
              <Field label="Code" required hint={<>Letters, digits and hyphens. Must be unique.</>}><input
                  required
                  placeholder="SP26-GD-MOR-A"
                  value={blank.code}
                  onChange={(e) => setBlank((b) => ({ ...b, code: e.target.value.toUpperCase() }))}
                />
              
              </Field>
              <Field label="Name" required><input
                  required
                  minLength={3}
                  placeholder="Graphic Designing — Morning A"
                  value={blank.name}
                  onChange={(e) => setBlank((b) => ({ ...b, name: e.target.value }))}
                />
              
              </Field>
              <Field label="Capacity" required><input
                  type="number"
                  required
                  min={1}
                  max={500}
                  value={blank.capacity}
                  onChange={(e) => setBlank((b) => ({ ...b, capacity: e.target.value }))}
                />
              
              </Field>
              <Field label="Shift" required><select
                  value={blank.shift}
                  onChange={(e) => setBlank((b) => ({ ...b, shift: e.target.value }))}
                >
                  {SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {pretty(s)}
                    </option>
                  ))}
                </select>
              
              </Field>
              <Field label="Admits" hint={<>Cannot be relaxed once students are admitted.</>}><select
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
              </Field>
              <Field label="Delivery"><select
                  value={blank.deliveryMode}
                  onChange={(e) => setBlank((b) => ({ ...b, deliveryMode: e.target.value }))}
                >
                  {MODES.map((s) => (
                    <option key={s} value={s}>
                      {pretty(s)}
                    </option>
                  ))}
                </select>
              
              </Field>
            </div>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Working…" : "Create batch"}
            </button>
            {batches.length === 0 && (
              <p className="warn small">
                No intake exists yet. Create a term and an intake under Structure first — a batch
                has to belong to one.
              </p>
            )}
          </form>
        )}

        {rows.length === 0 ? (
          <EmptyState title={batchFilter ? "No batches in that intake" : "No batches yet"}>
            {mayEdit
              ? "A batch is a class group. Create one above, or clear the intake filter."
              : "If you are a teacher, you see only the batches you are assigned to."}
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
                              aria-label="Batch name"
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
                                {/* Delete sits BESIDE archive, not instead of
                                    it, because they answer different
                                    questions: archive is for a section that
                                    finished, delete is for one that should
                                    never have existed. The server refuses to
                                    delete anything that has been taught, so
                                    choosing wrong here costs a message rather
                                    than a student's marks. */}
                                <button
                                  className="btn btn-quiet btn-sm"
                                  disabled={busy}
                                  onClick={() => void removeSection(s)}
                                >
                                  Delete
                                </button>
                              </>
                            ))}
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={9} className="row-detail">
                            <h3>Subjects in {s.code}</h3>
                            {offerings === null ? (
                              <Skeleton lines={2} />
                            ) : offerings.length === 0 ? (
                              <p className="muted">
                                No subjects yet. A batch with no subjects has nothing to teach,
                                mark or attend.
                              </p>
                            ) : (
                              <table className="table">
                                <thead>
                                  <tr>
                                    <th>Subject</th>
                                    <th />
                                    <th>Required</th>
                                    <th>Teacher</th>
                                    <th>Meeting link</th>
                                    <th className="num">Enrolled</th>
                                    {mayEdit && <th />}
                                  </tr>
                                </thead>
                                <tbody>
                                  {offerings.map((o) => (
                                    <Fragment key={o.id}>
                                      <tr>
                                        <td>
                                          <code>{o.subject.code}</code> {o.subject.name}
                                        </td>
                                        <td>
                                          {/* Straight to the recordings for this
                                              class — where the folder is
                                              connected and drafts are published. */}
                                          <Link to={`/courses/${o.id}`}>Recordings</Link>
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
                                        {/* FR-LIV — the room this subject meets in,
                                            for THIS group. Its own teacher and its
                                            own link: the same subject taught to the
                                            evening class is a different row with a
                                            different one. */}
                                        <td>
                                          <button
                                            type="button"
                                            className="btn btn-quiet btn-sm"
                                            aria-expanded={roomFor === o.id}
                                            onClick={() =>
                                              setRoomFor(roomFor === o.id ? null : o.id)
                                            }
                                          >
                                            {o.meetingUrl ? shortLink(o.meetingUrl) : "not set"}
                                          </button>
                                        </td>
                                        <td className="num">{o._count.enrolments}</td>
                                        {mayEdit && (
                                          <td>
                                            <button
                                              type="button"
                                              className="btn btn-quiet btn-sm"
                                              disabled={busy}
                                              onClick={() => void removeOffering(s.id, o)}
                                            >
                                              Remove
                                            </button>
                                          </td>
                                        )}
                                      </tr>
                                      {roomFor === o.id && (
                                        <tr>
                                          <td colSpan={mayEdit ? 7 : 6}>
                                            {/* The same editor the course screen
                                                uses, so the rules, the refusals and
                                                the wording are written once. */}
                                            <ClassRoom
                                              sectionSubjectId={o.id}
                                              meetingUrl={o.meetingUrl}
                                              meetingNote={o.meetingNote}
                                              canManage={maySetRoom}
                                              onSaved={() => {
                                                void api
                                                  .get<Offering[]>(`/sections/${s.id}/subjects`)
                                                  .then(setOfferings)
                                                  .catch(() => undefined);
                                              }}
                                            />
                                          </td>
                                        </tr>
                                      )}
                                    </Fragment>
                                  ))}
                                </tbody>
                              </table>
                            )}

                            {mayEdit && (
                              <div className="form-row" style={{ marginTop: ".8rem" }}>
                                <Field label="Add a subject"><select
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
                                
                                </Field>
                                <Field label="Required"><select
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
                                
                                </Field>
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
                                Every subject is already offered in this batch.
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

/**
 * Enough of a meeting link to recognise in a table cell.
 *
 * A full Meet URL is around sixty characters and would set the width of the
 * whole column; the host and path are what tells an administrator whether the
 * class points at the room they meant.
 */
function shortLink(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}
