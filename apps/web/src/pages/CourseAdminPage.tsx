import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorState, SkeletonCards } from "../components/Ui";
import { CourseCover } from "../components/CourseCover";
import { Icon } from "../components/Icon";
import { money, whenDue, type Fee } from "../components/FeePanel";
import { CourseHierarchy } from "../components/CourseHierarchy";
import { BatchForm } from "../components/BatchForm";

/**
 * Courses — creating them, illustrating them, and pricing them (FR-CRS-004,
 * FR-CRS-015, FR-PAY-033).
 *
 * THIS PAGE EXISTS BECAUSE THE ENDPOINTS BEHIND IT COULD NOT BE REACHED. The
 * same fault StructurePage was built to fix, one level up: `POST /programmes`
 * and `POST /subjects` have always been there, correctly guarded, and nothing
 * in the running System could call either. The only programmes that ever
 * existed were the four the seed script wrote, so an Institute adding a course
 * had to have somebody edit a seed file and redeploy.
 *
 * `Subject.thumbnailUrl` has been in the schema since the beginning and
 * NOTHING HAS EVER WRITTEN TO IT — every card on the landing page fell back to
 * generated artwork, and there was no way for the Institute to change that.
 *
 * And the price: fees existed only as charges raised against students who were
 * ALREADY enrolled, so the application form asked applicants for "the amount
 * you paid" without anybody having told them what it was.
 *
 * ONE PAGE FOR ALL THREE, and that is a deliberate choice rather than a
 * convenience. Creating a course, giving it a picture and setting its price
 * are one job done in one sitting — split across three screens, the third gets
 * forgotten, and a course goes on sale with no fee. The order down the page is
 * the order of the work.
 */

interface MediaRef {
  id: string;
}

interface Programme {
  id: string;
  name: string;
  code: string;
  description: string | null;
  durationWeeks: number | null;
  isActive: boolean;
  thumbnailAssetId: string | null;
  thumbnail?: MediaRef | null;
  _count?: { sessions: number };
  /** Whether a price is actually live, and how many drafts are waiting. */
  fee?: { published: boolean; drafts: number };
}

/** One group of students. What an administrator calls a batch. */
interface Batch {
  id: string;
  code: string;
  name: string;
  status: string;
  capacity: number;
  enrolled: number;
  genderRestriction: string;
  shift: string;
  subjects: Array<{ sectionSubjectId: string; id: string; code: string; name: string }>;
  term: { id: string; code: string; name: string };
}

/**
 * A course as the screen shows it — the System's five levels flattened to the
 * three an administrator thinks in. Built by /course-tree; see the service for
 * why the middle two are folded away rather than dropped.
 */
interface CourseNode extends Programme {
  terms: Array<{ id: string; code: string; name: string; status: string }>;
  subjects: Array<{ id: string; code: string; name: string; batches: number }>;
  batches: Batch[];
  totals: { batches: number; seats: number; enrolled: number };
}

interface Subject {
  id: string;
  name: string;
  code: string;
  description: string | null;
  credits: number | null;
  isActive: boolean;
  thumbnailAssetId: string | null;
  thumbnailUrl: string | null;
  thumbnail: MediaRef | null;
}

interface FeeLineDraft {
  kind: "COMPONENT" | "INSTALMENT";
  label: string;
  amount: string;
  dueAfterDays: string;
}

interface FeeStructure extends Fee {
  id: string;
  programmeId: string;
  academicSessionId: string | null;
  academicSession: { id: string; code: string; name: string } | null;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  supersededAt: string | null;
}

const mediaUrl = (assetId: string | null | undefined) =>
  assetId ? `/api/v1/public/course-media/${assetId}` : null;

export function CourseAdminPage() {
  const { hasRole } = useAuth();
  const mayEdit = hasRole("super_admin", "admin");

  const [programmes, setProgrammes] = useState<Programme[] | null>(null);
  const [courses, setCourses] = useState<CourseNode[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // ONE request for the whole hierarchy rather than one per level. A
      // screen built level by level ends up making a request per course for
      // its terms, per term for its groups and per group for its batches,
      // which is slow in exactly the case that matters — a real institute.
      const [c, s] = await Promise.all([
        api.get<CourseNode[]>("/course-tree"),
        api.get<Subject[]>("/subjects"),
      ]);
      setCourses(c);
      setProgrammes(c);
      setSubjects(s);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      setCourses([]);
      setProgrammes([]);
      setSubjects([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // One place, so every panel reports success and refusal the same way.
  const run = useCallback(
    async (work: () => Promise<unknown>, ok: string) => {
      setError(null);
      setNote(null);
      try {
        await work();
        setNote(ok);
        await load();
        return true;
      } catch (e) {
        setError(e instanceof ApiError ? e : null);
        return false;
      }
    },
    [load],
  );

  if (error && !programmes) {
    return <ErrorState message={error.message} onRetry={() => void load()} />;
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Courses</h1>
          <p className="muted">
            Everything the Institute teaches, and who it teaches it to.
          </p>
        </div>
      </header>

      {/* Shown at the top, once, because the order is the thing an
          inexperienced administrator does not have and cannot guess. */}
      <CourseHierarchy />

      {note && (
        <div className="alert alert-ok" role="status">
          <p>{note}</p>
        </div>
      )}

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

      {/* The order down the page is the order of the work: courses first,
          because that is what somebody came to make, and the subject library
          under it because it is a store to draw from rather than a step. */}
      <CoursesPanel
        courses={courses}
        subjects={subjects ?? []}
        mayEdit={mayEdit}
        run={run}
        onChanged={() => void load()}
      />

      <SubjectsPanel subjects={subjects} mayEdit={mayEdit} run={run} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════ programmes ═══

/**
 * The courses, each showing what it teaches and who it teaches it to.
 *
 * A CARD IS A WHOLE COURSE rather than a row in a table, because a course is
 * not one fact — it is a picture, a fee, a set of subjects and a set of
 * batches, and the question an administrator arrives with is almost always
 * "what state is this course in", which no single column answers.
 *
 * THE THREE THINGS THAT CAN BE MISSING ARE SAID ON THE CARD: no fee, no
 * subjects, no batches. Each is a course that looks finished and does nothing
 * — applicants are told to telephone for a price, students have no register,
 * or there is nowhere to admit anybody. They are the whole reason this screen
 * exists, so they are not two clicks inside it.
 */
function CoursesPanel({
  courses,
  subjects,
  mayEdit,
  run,
  onChanged,
}: {
  courses: CourseNode[] | null;
  subjects: Subject[];
  mayEdit: boolean;
  run: (work: () => Promise<unknown>, ok: string) => Promise<boolean>;
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ id: string; panel: "edit" | "fees" | "batch" } | null>(null);

  const close = () => setOpen(null);
  const toggle = (id: string, panel: "edit" | "fees" | "batch") =>
    setOpen((o) => (o && o.id === id && o.panel === panel ? null : { id, panel }));

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Courses</h2>
          <p className="muted small">What a student applies for.</p>
        </div>
        {mayEdit && (
          <button className="btn btn-primary" onClick={() => setCreating((c) => !c)}>
            {creating ? "Cancel" : "New course"}
          </button>
        )}
      </div>

      {creating && (
        <ProgrammeForm
          onDone={async (body) => {
            const ok = await run(() => api.post("/programmes", body), "Course created.");
            if (ok) setCreating(false);
            return ok;
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {!courses ? (
        <SkeletonCards count={3} />
      ) : courses.length === 0 ? (
        <EmptyState icon="layers" title="No courses yet">
          {mayEdit
            ? "A course is what a student applies for — a diploma, a short course. Create one, then add the batches that actually run it."
            : "The office has not set up any courses yet."}
        </EmptyState>
      ) : (
        <ul className="course-grid">
          {courses.map((c) => {
            const isOpen = open?.id === c.id;
            return (
              <li key={c.id} className="course-card">
                <CourseCover code={c.code} name={c.name} thumbnailUrl={mediaUrl(c.thumbnailAssetId)} />

                <div className="course-card-body">
                  <div className="course-card-head">
                    <div>
                      <strong>{c.name}</strong>
                      <span className="muted small"> {c.code}</span>
                    </div>
                    {!c.isActive && <span className="pill pill-warn">Not offered</span>}
                  </div>

                  {c.description && <p className="small muted">{c.description}</p>}

                  {/* ---- what it teaches ------------------------------- */}
                  <div className="course-facet">
                    <span className="course-facet-label">
                      <Icon name="book" /> Subjects
                    </span>
                    {c.subjects.length === 0 ? (
                      <span className="pill pill-warn">None yet</span>
                    ) : (
                      <span className="course-facet-values">
                        {c.subjects.map((s) => (
                          <span key={s.id} className="pill" title={s.name}>
                            {s.code}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>

                  {/* ---- who it teaches -------------------------------- */}
                  <div className="course-facet">
                    <span className="course-facet-label">
                      <Icon name="users" /> Batches
                    </span>
                    {c.batches.length === 0 ? (
                      <span className="pill pill-warn">None yet</span>
                    ) : (
                      <span className="muted small">
                        {c.totals.batches} · {c.totals.enrolled} of {c.totals.seats} seats taken
                      </span>
                    )}
                  </div>

                  {/* ---- what it costs --------------------------------- */}
                  <div className="course-facet">
                    <span className="course-facet-label">
                      <Icon name="money" /> Fee
                    </span>
                    {c.fee?.published ? (
                      <span className="pill pill-ok">Published</span>
                    ) : (
                      <span className="pill pill-warn">
                        {c.fee && c.fee.drafts > 0
                          ? `Not published — ${c.fee.drafts} draft${c.fee.drafts === 1 ? "" : "s"}`
                          : "Not set"}
                      </span>
                    )}
                  </div>

                  {/* The batches themselves, listed rather than counted: the
                      names ARE the answer to "is the female batch set up". */}
                  {c.batches.length > 0 && (
                    <ul className="batch-list">
                      {c.batches.map((b) => (
                        <li key={b.id} className="batch-row">
                          {/*
                            STRAIGHT TO THE CLASS, when there is one to go to.
                            A batch has no page of its own — its register, its
                            recordings and its timetable all hang off a SUBJECT
                            being taught to it, so the first offering is the
                            nearest real destination. A batch with no subjects
                            has nowhere to go, and is rendered as plain text
                            rather than a link that lands on nothing.
                          */}
                          <BatchRowBody batch={b} />
                        </li>
                      ))}
                    </ul>
                  )}

                  {mayEdit && (
                    <div className="row-actions">
                      <button className="btn btn-primary" onClick={() => toggle(c.id, "batch")}>
                        {isOpen && open.panel === "batch" ? "Close" : "Add a batch"}
                      </button>
                      <button className="btn btn-quiet" onClick={() => toggle(c.id, "fees")}>
                        {isOpen && open.panel === "fees" ? "Close" : "Fees"}
                      </button>
                      <button className="btn btn-quiet" onClick={() => toggle(c.id, "edit")}>
                        {isOpen && open.panel === "edit" ? "Close" : "Edit course"}
                      </button>
                    </div>
                  )}
                </div>

                {isOpen && open.panel === "edit" && (
                  <div className="course-card-editor">
                    <ProgrammeForm
                      initial={c}
                      onDone={async (body) => {
                        const ok = await run(
                          () => api.patch(`/programmes/${c.id}`, body),
                          `${c.name} updated.`,
                        );
                        if (ok) close();
                        return ok;
                      }}
                      onCancel={close}
                    />
                  </div>
                )}

                {isOpen && open.panel === "batch" && (
                  <div className="course-card-editor">
                    <h3>Add a batch to {c.name}</h3>
                    <BatchForm
                      programmeId={c.id}
                      programmeName={c.name}
                      subjects={subjects.filter((s) => s.isActive !== false)}
                      // The subjects this course already teaches elsewhere.
                      // A second batch of the same course almost always
                      // teaches the same things, and starting from blank makes
                      // somebody re-pick six subjects they just picked.
                      suggestedSubjectIds={c.subjects.map((s) => s.id)}
                      onCreated={(message) => {
                        close();
                        void run(() => Promise.resolve(), message).then(() => onChanged());
                      }}
                      onCancel={close}
                    />
                  </div>
                )}

                {isOpen && open.panel === "fees" && (
                  <div className="course-card-editor">
                    <FeeStructures programme={c} run={run} onChanged={onChanged} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * One batch in the list on a course card.
 *
 * A LINK ONLY WHEN THERE IS SOMEWHERE TO GO. A batch has no page of its own;
 * its register, recordings and timetable hang off a subject being taught to
 * it. So the first subject offering is the real destination, and a batch with
 * no subjects — which is the state this screen is trying to make visible — is
 * plain text rather than a link that lands nowhere.
 */
function BatchRowBody({ batch }: { batch: Batch }) {
  const body = (
    <>
      <span className="batch-row-main">
        <strong>{batch.name}</strong>
        <span className="muted small">
          {AUDIENCE_LABEL[batch.genderRestriction] ?? batch.genderRestriction} ·{" "}
          {batch.shift.toLowerCase()} · {batch.term.name}
        </span>
        {batch.subjects.length === 0 ? (
          <span className="warn small">No subjects — this batch has no register</span>
        ) : (
          <span className="muted small">{batch.subjects.map((s) => s.code).join(", ")}</span>
        )}
      </span>
      <span className="batch-seats">
        <strong>{batch.enrolled}</strong>
        <span className="muted small">of {batch.capacity}</span>
      </span>
    </>
  );

  const first = batch.subjects[0];
  if (!first) return <span className="row-link is-flat">{body}</span>;

  return (
    <Link className="row-link" to={`/courses/${first.sectionSubjectId}`}>
      {body}
    </Link>
  );
}

/** FR-CRS-009 in the words a reader uses, not the enum's. */
const AUDIENCE_LABEL: Record<string, string> = {
  MIXED: "Anyone",
  FEMALE: "Female only",
  MALE: "Male only",
};

/**
 * One form for creating and for editing.
 *
 * THE CODE IS NOT EDITABLE ONCE SET, and the field says why rather than simply
 * being disabled. A programme code is baked into every registration number
 * issued against it (Appendix B), several of which are printed on certificates
 * in people's hands — so this is not a restriction anybody can lift later, and
 * an administrator who does not know that will try.
 */
function ProgrammeForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: Programme;
  onDone: (body: Record<string, unknown>) => Promise<boolean>;
  onCancel: () => void;
}) {
  const editing = !!initial;
  const [f, setF] = useState({
    name: initial?.name ?? "",
    code: initial?.code ?? "",
    description: initial?.description ?? "",
    durationWeeks: initial?.durationWeeks ? String(initial.durationWeeks) : "",
  });
  const [assetId, setAssetId] = useState<string | null>(initial?.thumbnailAssetId ?? null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setBusy(true);
    const body: Record<string, unknown> = {
      name: f.name.trim(),
      ...(editing ? {} : { code: f.code.trim().toUpperCase() }),
      description: f.description.trim() || null,
      durationWeeks: f.durationWeeks ? Number(f.durationWeeks) : null,
      thumbnailAssetId: assetId,
    };
    await onDone(body);
    setBusy(false);
  };

  return (
    <div className="course-form">
      <div className="form-row">
        <label className="field">
          <span>Name</span>
          <input
            value={f.name}
            onChange={(e) => set("name")(e.target.value)}
            placeholder="Diploma in Graphic Designing"
          />
        </label>
        <label className="field">
          <span>Code</span>
          <input
            value={f.code}
            onChange={(e) => set("code")(e.target.value.toUpperCase())}
            placeholder="GD"
            disabled={editing}
            maxLength={10}
          />
          <span className="muted small">
            {editing
              ? "Cannot be changed — it is part of every registration number already issued."
              : "2–10 letters or digits. It becomes part of every student's registration number, so it cannot be changed afterwards."}
          </span>
        </label>
      </div>

      <label className="field">
        <span>Description</span>
        <textarea
          value={f.description}
          onChange={(e) => set("description")(e.target.value)}
          placeholder="What the course covers, in a sentence or two. This appears on the public page."
        />
      </label>

      <div className="form-row">
        <label className="field">
          <span>Length in weeks</span>
          <input
            type="number"
            min={1}
            max={520}
            value={f.durationWeeks}
            onChange={(e) => set("durationWeeks")(e.target.value)}
            placeholder="26"
          />
        </label>
      </div>

      <ThumbnailField
        assetId={assetId}
        onChange={setAssetId}
        hint="Shown on the landing page and the application form. A wide picture works best — the card crops to a banner."
      />

      <div className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy || !f.name.trim() || (!editing && !f.code.trim())}
          onClick={() => void submit()}
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Create programme"}
        </button>
        <button className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════ subjects ═══

function SubjectsPanel({
  subjects,
  mayEdit,
  run,
}: {
  subjects: Subject[] | null;
  mayEdit: boolean;
  run: (work: () => Promise<unknown>, ok: string) => Promise<boolean>;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Subjects</h2>
        {mayEdit && (
          <button className="btn btn-primary" onClick={() => setCreating((c) => !c)}>
            {creating ? "Cancel" : "New subject"}
          </button>
        )}
      </div>
      <p className="muted small">
        A subject is taught within a programme. Offer it to a section under Sections — a subject
        that is not offered anywhere has no students and no register.
      </p>

      {creating && (
        <SubjectForm
          onDone={async (body) => {
            const ok = await run(() => api.post("/subjects", body), "Subject created.");
            if (ok) setCreating(false);
            return ok;
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {!subjects ? (
        <SkeletonCards count={3} />
      ) : subjects.length === 0 ? (
        <EmptyState icon="book" title="No subjects yet">
          {mayEdit
            ? "Create the subjects taught in your programmes, then offer them to a section."
            : "The office has not set up any subjects yet."}
        </EmptyState>
      ) : (
        <ul className="course-grid">
          {subjects.map((s) => (
            <li key={s.id} className="course-card">
              <CourseCover
                code={s.code}
                name={s.name}
                thumbnailUrl={mediaUrl(s.thumbnailAssetId) ?? s.thumbnailUrl}
              />
              <div className="course-card-body">
                <div className="course-card-head">
                  <div>
                    <strong>{s.name}</strong>
                    <span className="muted small"> {s.code}</span>
                  </div>
                  {!s.isActive && <span className="pill pill-warn">Inactive</span>}
                </div>
                {s.description && <p className="small muted">{s.description}</p>}
                {mayEdit && (
                  <div className="row-actions">
                    <button
                      className="btn btn-quiet"
                      onClick={() => setEditing(editing === s.id ? null : s.id)}
                    >
                      {editing === s.id ? "Close" : "Edit"}
                    </button>
                  </div>
                )}
              </div>

              {editing === s.id && (
                <div className="course-card-editor">
                  <SubjectForm
                    initial={s}
                    onDone={async (body) => {
                      const ok = await run(
                        () => api.patch(`/subjects/${s.id}`, body),
                        `${s.name} updated.`,
                      );
                      if (ok) setEditing(null);
                      return ok;
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SubjectForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: Subject;
  onDone: (body: Record<string, unknown>) => Promise<boolean>;
  onCancel: () => void;
}) {
  const editing = !!initial;
  const [f, setF] = useState({
    name: initial?.name ?? "",
    code: initial?.code ?? "",
    description: initial?.description ?? "",
    credits: initial?.credits ? String(initial.credits) : "",
  });
  const [assetId, setAssetId] = useState<string | null>(initial?.thumbnailAssetId ?? null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setBusy(true);
    await onDone({
      name: f.name.trim(),
      ...(editing ? {} : { code: f.code.trim().toUpperCase() }),
      description: f.description.trim() || null,
      credits: f.credits ? Number(f.credits) : null,
      thumbnailAssetId: assetId,
    });
    setBusy(false);
  };

  return (
    <div className="course-form">
      <div className="form-row">
        <label className="field">
          <span>Name</span>
          <input
            value={f.name}
            onChange={(e) => set("name")(e.target.value)}
            placeholder="Adobe Photoshop"
          />
        </label>
        <label className="field">
          <span>Code</span>
          <input
            value={f.code}
            onChange={(e) => set("code")(e.target.value.toUpperCase())}
            placeholder="PS101"
            disabled={editing}
            maxLength={10}
          />
          <span className="muted small">
            {editing ? "Cannot be changed — it appears on transcripts already issued." : "2–10 letters or digits."}
          </span>
        </label>
      </div>

      <label className="field">
        <span>Description</span>
        <textarea
          value={f.description}
          onChange={(e) => set("description")(e.target.value)}
          placeholder="What students learn in this subject."
        />
      </label>

      <ThumbnailField
        assetId={assetId}
        onChange={setAssetId}
        hint="Shown on the course card. Optional — without one the System draws a cover from the subject code."
      />

      <div className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy || !f.name.trim() || (!editing && !f.code.trim())}
          onClick={() => void submit()}
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Create subject"}
        </button>
        <button className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════ thumbnail ═══

/**
 * Choose a picture, and see it immediately.
 *
 * THE PREVIEW IS THE POINT. An upload field that reports "uploaded" and shows
 * nothing leaves the administrator to save, navigate to the public page and
 * look — three steps to find out they picked the wrong file. It uploads on
 * selection and shows the result at the size it will actually appear.
 */
function ThumbnailField({
  assetId,
  onChange,
  hint,
}: {
  assetId: string | null;
  onChange: (id: string | null) => void;
  hint: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const pick = async (file: File) => {
    setBusy(true);
    setProblem(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.upload<{ id: string; deduplicated: boolean }>("/course-media", form);
      onChange(r.id);
    } catch (e) {
      // The server's own words. It knows why — too large, not an image, an SVG
      // — and each of those has a different thing to do about it.
      setProblem(
        e instanceof ApiError
          ? (e.details?.[0]?.message ?? e.message)
          : "That picture could not be uploaded.",
      );
    } finally {
      setBusy(false);
      // So choosing the SAME file again after a failure still fires onChange.
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="field thumb-field">
      <span>Picture</span>

      <div className="thumb-row">
        <div className="thumb-preview">
          {assetId ? (
            <img src={`/api/v1/public/course-media/${assetId}`} alt="" />
          ) : (
            <span className="muted small">No picture</span>
          )}
        </div>

        <div className="thumb-actions">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file);
            }}
          />
          <div className="row-actions">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Icon name="upload" />
              {busy ? "Uploading…" : assetId ? "Replace" : "Choose a picture"}
            </button>
            {assetId && (
              <button type="button" className="btn btn-quiet" onClick={() => onChange(null)}>
                Remove
              </button>
            )}
          </div>
          <span className="muted small">{hint}</span>
          <span className="muted small">JPEG, PNG or WebP, up to 3 MB.</span>
        </div>
      </div>

      {problem && (
        <div className="alert alert-error" role="alert">
          <p className="small">{problem}</p>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════ fee structures ═══

/**
 * What the course costs.
 *
 * THE ARITHMETIC IS CHECKED ON PUBLISH, NOT ON SAVE, and this panel is built
 * around that. A half-typed table is unfinished rather than wrong, so a draft
 * saves without complaint; the running totals below tell the administrator
 * where they are as they go, and the server refuses to publish anything that
 * does not add up. An editor that argues with every keystroke is one nobody
 * can use.
 */
function FeeStructures({
  programme,
  run,
  onChanged,
}: {
  programme: Programme;
  run: (work: () => Promise<unknown>, ok: string) => Promise<boolean>;
  onChanged: () => void;
}) {
  const [structures, setStructures] = useState<FeeStructure[] | null>(null);
  const [editing, setEditing] = useState<FeeStructure | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setStructures(await api.get<FeeStructure[]>(`/programmes/${programme.id}/fee-structures`));
    } catch {
      setStructures([]);
    }
  }, [programme.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const after = async () => {
    await load();
    onChanged();
  };

  return (
    <div className="fee-admin">
      <div className="card-head">
        <h3>Fees for {programme.name}</h3>
        {editing === null && (
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            New fee structure
          </button>
        )}
      </div>

      {editing !== null ? (
        <FeeStructureForm
          programmeId={programme.id}
          initial={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await after();
          }}
          run={run}
        />
      ) : !structures ? (
        <SkeletonCards count={1} />
      ) : structures.length === 0 ? (
        <EmptyState icon="money" title="No fee set for this course">
          Until a fee is published, the application form tells applicants to ask the office what to
          pay. Create one, check the totals, then publish it.
        </EmptyState>
      ) : (
        <ul className="fee-structure-list">
          {structures.map((st) => (
            <li key={st.id} className={`fee-structure fee-structure-${st.status.toLowerCase()}`}>
              <div className="fee-structure-head">
                <div>
                  <strong>{st.name}</strong>
                  <br />
                  <span className="muted small">
                    {st.academicSession
                      ? `${st.academicSession.name} only`
                      : "Applies to every term without its own"}
                  </span>
                </div>
                <span
                  className={
                    st.status === "PUBLISHED"
                      ? "pill pill-ok"
                      : st.status === "DRAFT"
                        ? "pill pill-warn"
                        : "pill"
                  }
                >
                  {st.status === "PUBLISHED"
                    ? "Live"
                    : st.status === "DRAFT"
                      ? "Draft"
                      : "Superseded"}
                </span>
              </div>

              <p className="fee-structure-summary">
                <strong>{money(st.totalAmount, st.currency)}</strong> in total ·{" "}
                {money(st.dueAtApplication, st.currency)} to apply ·{" "}
                {st.instalments.length} instalment{st.instalments.length === 1 ? "" : "s"}
              </p>

              <div className="row-actions">
                {st.status === "DRAFT" && (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={() =>
                        void run(
                          () => api.post(`/fee-structures/${st.id}/publish`),
                          `${st.name} is now the published fee for ${programme.name}.`,
                        ).then((ok) => {
                            if (ok) void after();
                          })
                      }
                    >
                      Publish
                    </button>
                    <button className="btn btn-quiet" onClick={() => setEditing(st)}>
                      Edit
                    </button>
                    <button
                      className="btn btn-quiet"
                      onClick={() =>
                        void run(
                          () => api.del(`/fee-structures/${st.id}`),
                          `${st.name} deleted.`,
                        ).then((ok) => {
                            if (ok) void after();
                          })
                      }
                    >
                      Delete
                    </button>
                  </>
                )}
                {st.status === "PUBLISHED" && (
                  <button
                    className="btn btn-quiet"
                    onClick={() =>
                      void run(
                        () => api.post(`/fee-structures/${st.id}/archive`),
                        `${st.name} withdrawn. Applicants are no longer quoted it.`,
                      ).then((ok) => {
                            if (ok) void after();
                          })
                    }
                  >
                    Withdraw
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The fee table, for somebody who has not built one before.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG WITH THE PREVIOUS FORM. It asked for a total, then for a list
 * of instalments, and refused to publish unless they added up — with no help
 * whatsoever in making them add up. An administrator entering a 90,000 fee in
 * three parts had to divide it themselves, and an administrator entering
 * 100,000 in three had to work out that one instalment must carry the extra
 * paisa or the table would be a rupee short. It also asked separately for "the
 * amount payable to apply" and then refused any value that was not exactly the
 * first instalment, which is a question with one correct answer that the form
 * already knew.
 *
 * So: the arithmetic is offered rather than demanded. Choose how many parts and
 * how far apart, and the rows are generated exactly — remainder included. Every
 * row stays editable afterwards, because an institute with a large first
 * payment and two smaller ones is normal and a wizard that cannot express it is
 * worse than none.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function FeeStructureForm({
  programmeId,
  initial,
  onCancel,
  onSaved,
  run,
}: {
  programmeId: string;
  initial?: FeeStructure;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  run: (work: () => Promise<unknown>, ok: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [currency] = useState(initial?.currency ?? "PKR");
  const [total, setTotal] = useState(initial ? String(initial.totalAmount) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<FeeLineDraft[]>(() => {
    if (!initial) return [];
    return [
      ...initial.components.map((c) => ({
        kind: "COMPONENT" as const,
        label: c.label,
        amount: String(c.amount),
        dueAfterDays: "",
      })),
      ...initial.instalments.map((i) => ({
        kind: "INSTALMENT" as const,
        label: i.label,
        amount: String(i.amount),
        dueAfterDays: String(i.dueAfterDays),
      })),
    ];
  });
  const [busy, setBusy] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(
    (initial?.components.length ?? 0) > 0,
  );

  const num = (v: string) => {
    const n = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const totalNum = num(total);
  const instalments = lines.filter((l) => l.kind === "INSTALMENT");
  const components = lines.filter((l) => l.kind === "COMPONENT");
  const instalmentSum = instalments.reduce((n, l) => n + num(l.amount), 0);
  const componentSum = components.reduce((n, l) => n + num(l.amount), 0);

  /*
   * WHAT THE APPLICANT PAYS TO APPLY IS THE FIRST INSTALMENT. It is not a
   * separate decision, and asking for it as one produced a form where the only
   * accepted answer was already on screen. It is shown, not asked.
   */
  const dueNow = instalments.length > 0 ? num(instalments[0]!.amount) : 0;

  const setLine = (i: number, patch: Partial<FeeLineDraft>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /**
   * SPLIT IT, EXACTLY — the helper that does the arithmetic nobody should be
   * doing by hand.
   *
   * IN PAISA, AS INTEGERS, and the remainder goes to the FIRST instalment.
   * 100,000 in three is 33,333.34 + 33,333.33 + 33,333.33, and three
   * independently-rounded thirds are 99,999.99 — the Institute a rupee short,
   * discovered when a student with a zero balance is still shown as owing.
   * Giving the odd paisa to the first payment rather than the last also means
   * the amount somebody transfers today is never the one that looks wrong.
   */
  const split = (count: number, gapMonths: number) => {
    const paisa = Math.round(totalNum * 100);
    if (paisa <= 0 || count < 1) return;

    const each = Math.floor(paisa / count);
    const remainder = paisa - each * count;

    setLines((ls) => [
      ...ls.filter((l) => l.kind === "COMPONENT"),
      ...Array.from({ length: count }, (_, i) => ({
        kind: "INSTALMENT" as const,
        label:
          count === 1
            ? "Full fee"
            : `${ORDINAL[i] ?? `${i + 1}th`} instalment`,
        amount: ((each + (i === 0 ? remainder : 0)) / 100).toFixed(2).replace(/\.00$/, ""),
        // The first is due on admission; the rest at even intervals after it.
        dueAfterDays: String(i * gapMonths * 30),
      })),
    ]);
  };

  const addInstalment = () =>
    setLines((ls) => [
      ...ls,
      {
        kind: "INSTALMENT",
        label: `${ORDINAL[instalments.length] ?? `${instalments.length + 1}th`} instalment`,
        amount: "",
        dueAfterDays: String((instalments.length || 1) * 30),
      },
    ]);

  const save = async () => {
    setBusy(true);
    const body = {
      programmeId,
      name: name.trim(),
      currency,
      totalAmount: totalNum,
      dueAtApplication: dueNow,
      notes: notes.trim() || null,
      lines: lines
        .filter((l) => l.label.trim() !== "" || l.amount !== "")
        .map((l, i) => ({
          kind: l.kind,
          label: l.label.trim(),
          amount: num(l.amount),
          ...(l.kind === "INSTALMENT" ? { dueAfterDays: Number(l.dueAfterDays || "0") } : {}),
          sortOrder: i,
        })),
    };
    const ok = await run(
      () =>
        initial
          ? api.patch(`/fee-structures/${initial.id}`, body)
          : api.post("/fee-structures", body),
      initial ? "Fee saved as a draft." : "Fee created as a draft.",
    );
    setBusy(false);
    if (ok) await onSaved();
  };

  /** Which way a set of lines is out. Silent when it is right. */
  const balance = (sum: number, label: string) => {
    if (totalNum <= 0) return null;
    const diff = Math.round((sum - totalNum) * 100) / 100;
    if (diff === 0) {
      return (
        <span className="fee-balance is-ok">
          ✓ {label} add up to {money(totalNum, currency)}
        </span>
      );
    }
    return (
      <span className="fee-balance is-off">
        {label} come to {money(sum, currency)} —{" "}
        {diff < 0 ? `${money(Math.abs(diff), currency)} short` : `${money(diff, currency)} over`}
      </span>
    );
  };

  const readyToPublish = totalNum > 0 && instalments.length > 0 && instalmentSum === totalNum;

  return (
    <div className="course-form fee-form">
      {/* ─────────────────────────────────────────────── 1. what it costs */}
      <div className="fee-step">
        <h4>
          <span className="fee-step-num">1</span> What does the course cost?
        </h4>
        <div className="form-row">
          <label className="field">
            <span>Name of this fee</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Spring 2026 fee"
            />
            <span className="muted small">
              For the office. Something you will recognise next year.
            </span>
          </label>
          <label className="field">
            <span>Total fee</span>
            <input
              inputMode="decimal"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder="90000"
            />
            <span className="muted small">The whole cost, in {currency}.</span>
          </label>
        </div>
      </div>

      {/* ─────────────────────────────────────────────── 2. how it is paid */}
      <div className="fee-step">
        <h4>
          <span className="fee-step-num">2</span> How is it paid?
        </h4>

        {totalNum <= 0 ? (
          <p className="muted small">Enter the total above first.</p>
        ) : (
          <>
            {/* THE HELPER. One click does the division, the remainder and the
                due dates — the arithmetic an administrator should not be
                doing by hand at all. */}
            <div className="fee-split">
              <span className="muted small">Split it evenly into</span>
              {[1, 2, 3, 4, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="btn btn-sm"
                  onClick={() => split(n, n === 1 ? 0 : 1)}
                >
                  {n === 1 ? "one payment" : `${n} parts`}
                </button>
              ))}
              <span className="muted small">— then adjust any row.</span>
            </div>

            {instalments.length === 0 ? (
              <p className="warn small">
                No payments set yet. Choose a split above, or add one by hand.
              </p>
            ) : (
              <ul className="fee-rows">
                {lines.map((l, i) =>
                  l.kind !== "INSTALMENT" ? null : (
                    <li key={`inst-${i}`} className="fee-row">
                      <span className="fee-row-n">{instalments.indexOf(l) + 1}</span>
                      <input
                        className="fee-editor-label"
                        value={l.label}
                        onChange={(e) => setLine(i, { label: e.target.value })}
                        placeholder="First instalment"
                        aria-label="What this payment is called"
                      />
                      <input
                        className="fee-editor-amount"
                        inputMode="decimal"
                        value={l.amount}
                        onChange={(e) => setLine(i, { amount: e.target.value })}
                        placeholder="30000"
                        aria-label="Amount"
                      />
                      <label className="fee-editor-due">
                        <input
                          type="number"
                          min={0}
                          step={30}
                          value={l.dueAfterDays}
                          onChange={(e) => setLine(i, { dueAfterDays: e.target.value })}
                          aria-label="Days after enrolling"
                        />
                        <span className="muted small">{whenDue(Number(l.dueAfterDays || "0"))}</span>
                      </label>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                        aria-label={`Remove ${l.label || "this payment"}`}
                      >
                        ✕
                      </button>
                    </li>
                  ),
                )}
              </ul>
            )}

            <div className="row-actions">
              <button type="button" className="btn btn-quiet btn-sm" onClick={addInstalment}>
                Add another payment
              </button>
              {balance(instalmentSum, "The payments")}
            </div>
          </>
        )}
      </div>

      {/* ─────────────────────────────────────── 3. the breakdown, optional */}
      <div className="fee-step">
        <h4>
          <span className="fee-step-num">3</span> What does the fee cover?{" "}
          <span className="muted small">optional</span>
        </h4>
        {!showBreakdown ? (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              setShowBreakdown(true);
              if (components.length === 0) {
                setLines((ls) => [
                  { kind: "COMPONENT", label: "Tuition", amount: "", dueAfterDays: "" },
                  ...ls,
                ]);
              }
            }}
          >
            Itemise it
          </button>
        ) : (
          <>
            <p className="muted small">
              Shown to applicants so the total is not a mystery figure. Leave it out for a flat
              fee.
            </p>
            <ul className="fee-rows">
              {lines.map((l, i) =>
                l.kind !== "COMPONENT" ? null : (
                  <li key={`comp-${i}`} className="fee-row">
                    <input
                      className="fee-editor-label"
                      value={l.label}
                      onChange={(e) => setLine(i, { label: e.target.value })}
                      placeholder="Tuition"
                      aria-label="What this covers"
                    />
                    <input
                      className="fee-editor-amount"
                      inputMode="decimal"
                      value={l.amount}
                      onChange={(e) => setLine(i, { amount: e.target.value })}
                      placeholder="80000"
                      aria-label="Amount"
                    />
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      aria-label={`Remove ${l.label || "this line"}`}
                    >
                      ✕
                    </button>
                  </li>
                ),
              )}
            </ul>
            <div className="row-actions">
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() =>
                  setLines((ls) => [
                    { kind: "COMPONENT", label: "", amount: "", dueAfterDays: "" },
                    ...ls,
                  ])
                }
              >
                Add a line
              </button>
              {components.length > 0 && balance(componentSum, "The breakdown")}
            </div>
          </>
        )}
      </div>

      <label className="field">
        <span>Anything the applicant should know</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Refund policy, what the fee includes, when late payment is charged."
        />
      </label>

      {/*
        WHAT THE APPLICANT WILL ACTUALLY SEE. The form is a table of numbers;
        this is the sentence they read on the apply page, and showing it here
        is what turns "does this add up" into a question somebody can answer by
        looking rather than by publishing and checking.
      */}
      {totalNum > 0 && instalments.length > 0 && (
        <div className={readyToPublish ? "fee-preview is-ready" : "fee-preview"}>
          <span className="fee-preview-label">The applicant will see</span>
          <p>
            <strong>{money(dueNow, currency)}</strong> to apply
            {dueNow < totalNum && <> · {money(totalNum, currency)} in total</>}
            {instalments.length > 1 && <> · {instalments.length} payments</>}
          </p>
          {!readyToPublish && (
            <p className="warn small">
              The payments do not add up to the total yet, so this cannot be published.
            </p>
          )}
        </div>
      )}

      <div className="row-actions">
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? "Saving…" : initial ? "Save draft" : "Create draft"}
        </button>
        <button className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>

      <p className="muted small">
        Saved as a draft — applicants see nothing until you publish it, and publishing checks the
        figures once more.
      </p>
    </div>
  );
}

/** Read aloud by the office, so words rather than "Instalment 1". */
const ORDINAL = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"];
