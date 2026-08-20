import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, ErrorState, SkeletonCards } from "../components/Ui";
import { CourseCover } from "../components/CourseCover";
import { Icon } from "../components/Icon";
import { money, whenDue, type Fee } from "../components/FeePanel";

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
  thumbnail: MediaRef | null;
  _count?: { sessions: number };
  /** Whether a price is actually live, and how many drafts are waiting. */
  fee?: { published: boolean; drafts: number };
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
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, s] = await Promise.all([
        api.get<Programme[]>("/programmes"),
        api.get<Subject[]>("/subjects"),
      ]);
      setProgrammes(p);
      setSubjects(s);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
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
            The programmes the Institute offers, the subjects taught in them, and what each one
            costs. A course needs a published fee before anybody can be told what to pay for it.
          </p>
        </div>
      </header>

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

      <ProgrammesPanel
        programmes={programmes}
        mayEdit={mayEdit}
        run={run}
        onChanged={() => void load()}
      />

      <SubjectsPanel subjects={subjects} mayEdit={mayEdit} run={run} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════ programmes ═══

function ProgrammesPanel({
  programmes,
  mayEdit,
  run,
  onChanged,
}: {
  programmes: Programme[] | null;
  mayEdit: boolean;
  run: (work: () => Promise<unknown>, ok: string) => Promise<boolean>;
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [pricing, setPricing] = useState<string | null>(null);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Programmes</h2>
        {mayEdit && (
          <button className="btn btn-primary" onClick={() => setCreating((c) => !c)}>
            {creating ? "Cancel" : "New programme"}
          </button>
        )}
      </div>

      {creating && (
        <ProgrammeForm
          onDone={async (body) => {
            const ok = await run(() => api.post("/programmes", body), "Programme created.");
            if (ok) setCreating(false);
            return ok;
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {!programmes ? (
        <SkeletonCards count={3} />
      ) : programmes.length === 0 ? (
        <EmptyState icon="book" title="No programmes yet">
          {mayEdit
            ? "A programme is the course a student applies to — a diploma, a short course. Create one, then give it a term and a section under Structure."
            : "The office has not set up any programmes yet."}
        </EmptyState>
      ) : (
        <ul className="course-grid">
          {programmes.map((p) => (
            <li key={p.id} className="course-card">
              <CourseCover
                code={p.code}
                name={p.name}
                thumbnailUrl={mediaUrl(p.thumbnailAssetId)}
              />
              <div className="course-card-body">
                <div className="course-card-head">
                  <div>
                    <strong>{p.name}</strong>
                    <span className="muted small"> {p.code}</span>
                  </div>
                  {!p.isActive && <span className="pill pill-warn">Not offered</span>}
                </div>

                {/*
                  WHETHER THIS COURSE HAS A PRICE, on the card rather than two
                  clicks inside it.

                  A programme on offer with no published fee is the failure this
                  whole page exists to prevent: the application form then tells
                  every applicant to telephone the office and ask what to pay,
                  and nothing anywhere says so. It has to be visible in the same
                  glance that shows the course exists.
                */}
                {p.fee &&
                  (p.fee.published ? (
                    <span className="pill pill-ok">Fee published</span>
                  ) : (
                    <span className="pill pill-warn">
                      {p.fee.drafts > 0
                        ? `No fee published — ${p.fee.drafts} draft${p.fee.drafts === 1 ? "" : "s"}`
                        : "No fee set"}
                    </span>
                  ))}

                {p.description && <p className="small muted">{p.description}</p>}
                <p className="muted small">
                  {p.durationWeeks ? `${p.durationWeeks} weeks` : "Duration not set"}
                  {p._count ? ` · ${p._count.sessions} term${p._count.sessions === 1 ? "" : "s"}` : ""}
                </p>

                {mayEdit && (
                  <div className="row-actions">
                    <button
                      className="btn btn-quiet"
                      onClick={() => setEditing(editing === p.id ? null : p.id)}
                    >
                      {editing === p.id ? "Close" : "Edit"}
                    </button>
                    <button
                      className="btn btn-quiet"
                      onClick={() => setPricing(pricing === p.id ? null : p.id)}
                    >
                      {pricing === p.id ? "Close fees" : "Fees"}
                    </button>
                  </div>
                )}
              </div>

              {editing === p.id && (
                <div className="course-card-editor">
                  <ProgrammeForm
                    initial={p}
                    onDone={async (body) => {
                      const ok = await run(
                        () => api.patch(`/programmes/${p.id}`, body),
                        `${p.name} updated.`,
                      );
                      if (ok) setEditing(null);
                      return ok;
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              )}

              {pricing === p.id && (
                <div className="course-card-editor">
                  <FeeStructures programme={p} run={run} onChanged={onChanged} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

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
 * The fee table editor.
 *
 * RUNNING TOTALS AS THEY TYPE, because the rule that decides whether this can
 * be published is "the lines add up to the total" and finding that out only on
 * publish means re-adding twelve numbers by hand to see which one is wrong.
 * The counters below say which way it is out and by how much, which is usually
 * enough to spot the line on sight.
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
  const [dueNow, setDueNow] = useState(initial ? String(initial.dueAtApplication) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<FeeLineDraft[]>(() => {
    if (!initial) {
      return [{ kind: "INSTALMENT", label: "Full fee", amount: "", dueAfterDays: "0" }];
    }
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

  const num = (v: string) => {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const totalNum = num(total);
  const componentSum = lines.filter((l) => l.kind === "COMPONENT").reduce((n, l) => n + num(l.amount), 0);
  const instalmentSum = lines.filter((l) => l.kind === "INSTALMENT").reduce((n, l) => n + num(l.amount), 0);
  const hasComponents = lines.some((l) => l.kind === "COMPONENT");

  const setLine = (i: number, patch: Partial<FeeLineDraft>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const addLine = (kind: FeeLineDraft["kind"]) =>
    setLines((ls) => [
      ...ls,
      {
        kind,
        label: kind === "COMPONENT" ? "" : `Instalment ${ls.filter((l) => l.kind === "INSTALMENT").length + 1}`,
        amount: "",
        dueAfterDays: kind === "INSTALMENT" ? "30" : "",
      },
    ]);

  const save = async () => {
    setBusy(true);
    const body = {
      programmeId,
      name: name.trim(),
      currency,
      totalAmount: totalNum,
      dueAtApplication: num(dueNow),
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
      initial ? "Fee structure saved." : "Fee structure created as a draft.",
    );
    setBusy(false);
    if (ok) await onSaved();
  };

  /** Which way the table is out. Says nothing at all when it is right. */
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

  return (
    <div className="course-form">
      <div className="form-row">
        <label className="field">
          <span>Name of this fee structure</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Spring 2026 fee"
          />
          <span className="muted small">
            For the office, not the applicant — something you will recognise next year.
          </span>
        </label>
      </div>

      <div className="form-row">
        <label className="field">
          <span>Total fee</span>
          <input
            inputMode="decimal"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="90000"
          />
        </label>
        <label className="field">
          <span>Payable to apply</span>
          <input
            inputMode="decimal"
            value={dueNow}
            onChange={(e) => setDueNow(e.target.value)}
            placeholder="30000"
          />
          <span className="muted small">
            What the applicant transfers before submitting the form. Must match the first
            instalment.
          </span>
        </label>
      </div>

      {/* ------------------------------------------------------ instalments */}
      <div className="fee-editor-block">
        <div className="card-head">
          <h4>Instalments — when it is paid</h4>
          <button className="btn btn-quiet" onClick={() => addLine("INSTALMENT")}>
            Add instalment
          </button>
        </div>
        {lines.map((l, i) =>
          l.kind !== "INSTALMENT" ? null : (
            <div key={`inst-${i}`} className="fee-editor-row">
              <input
                className="fee-editor-label"
                value={l.label}
                onChange={(e) => setLine(i, { label: e.target.value })}
                placeholder="First instalment"
                aria-label="Instalment name"
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
                  value={l.dueAfterDays}
                  onChange={(e) => setLine(i, { dueAfterDays: e.target.value })}
                  aria-label="Days after enrolling"
                />
                <span className="muted small">{whenDue(Number(l.dueAfterDays || "0"))}</span>
              </label>
              <button
                className="btn btn-quiet"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                aria-label={`Remove ${l.label || "instalment"}`}
              >
                ✕
              </button>
            </div>
          ),
        )}
        {balance(instalmentSum, "Instalments")}
      </div>

      {/* ------------------------------------------------------- components */}
      <div className="fee-editor-block">
        <div className="card-head">
          <h4>Breakdown — what the fee covers (optional)</h4>
          <button className="btn btn-quiet" onClick={() => addLine("COMPONENT")}>
            Add line
          </button>
        </div>
        <p className="muted small">
          Shown to applicants so the total is not a mystery figure. Leave it empty for a flat fee.
        </p>
        {lines.map((l, i) =>
          l.kind !== "COMPONENT" ? null : (
            <div key={`comp-${i}`} className="fee-editor-row">
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
                className="btn btn-quiet"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                aria-label={`Remove ${l.label || "line"}`}
              >
                ✕
              </button>
            </div>
          ),
        )}
        {hasComponents && balance(componentSum, "Breakdown")}
      </div>

      <label className="field">
        <span>Notes for the applicant</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Refund policy, what the fee includes, anything they should know before paying."
        />
      </label>

      <div className="row-actions">
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? "Saving…" : initial ? "Save draft" : "Create draft"}
        </button>
        <button className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
      <p className="muted small">
        Saved as a draft. Applicants see nothing until you publish it, and publishing checks that
        the figures add up.
      </p>
    </div>
  );
}
