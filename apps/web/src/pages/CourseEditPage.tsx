import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { EditorPage, EditorSection } from "../components/EditorPage";
import { ThumbnailField } from "../components/ThumbnailField";
import { CourseCover } from "../components/CourseCover";
import { Icon } from "../components/Icon";
import { Skeleton } from "../components/Ui";

/**
 * One course, and everything that decides whether it can actually take a
 * student — FR-CRS-004.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS THAT MAKE A COURSE REAL used to live on three different
 * panels, opened one at a time inside a card: its details, its syllabus, and
 * its fee. So a course could be "finished" with no subjects and no price, and
 * the only sign was a warning pill somebody had to notice on a list.
 *
 * They are on one page now, in the order the work happens, and the page says at
 * the top what is still missing. That is the whole point of a screen per thing:
 * there is room to show the state, and an address to send somebody to.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE SYLLABUS IS EDITED HERE; THE FEE IS LINKED TO. A fee structure is a table
 * with its own arithmetic and its own draft/published life, and squeezing it in
 * beside these fields would make this the long form the old panel already was.
 * What belongs here is whether one exists.
 */

interface SubjectRef {
  id: string;
  code: string;
  name: string;
  isActive?: boolean;
}

interface CourseNode {
  id: string;
  code: string;
  name: string;
  description: string | null;
  durationWeeks: number | null;
  isActive: boolean;
  thumbnailAssetId: string | null;
  subjects: Array<{ id: string; code: string; name: string; batches: number }>;
  unlistedSubjects: Array<{ id: string; code: string; name: string }>;
  batches: Array<{ id: string; name: string; enrolled: number; capacity: number }>;
  totals: { batches: number; seats: number; enrolled: number };
  fee: { published: boolean; drafts: number };
}

export function CourseEditPage() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const creating = !courseId || courseId === "new";

  const [loaded, setLoaded] = useState(creating);
  const [course, setCourse] = useState<CourseNode | null>(null);
  const [allSubjects, setAllSubjects] = useState<SubjectRef[]>([]);
  const [f, setF] = useState({ name: "", code: "", description: "", durationWeeks: "" });
  const [assetId, setAssetId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    try {
      const subjects = await api.get<SubjectRef[]>("/subjects");
      setAllSubjects(subjects.filter((s) => s.isActive !== false));

      if (creating) return;
      const tree = await api.get<CourseNode[]>(`/course-tree?programmeId=${courseId}`);
      const found = tree[0];
      if (!found) {
        setError(
          new ApiError(404, { code: "RESOURCE_NOT_FOUND", message: "That course no longer exists." }),
        );
        return;
      }
      setCourse(found);
      setF({
        name: found.name,
        code: found.code,
        description: found.description ?? "",
        durationWeeks: found.durationWeeks ? String(found.durationWeeks) : "",
      });
      setAssetId(found.thumbnailAssetId);
      setIsActive(found.isActive);
      setChosen(found.subjects.map((s) => s.id));
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setLoaded(true);
    }
  }, [creating, courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      name: f.name.trim(),
      ...(creating ? { code: f.code.trim().toUpperCase() } : {}),
      description: f.description.trim() || null,
      /*
       * OPTIONAL MEANS ABSENT, NOT NULL. The create schema coerces, so a null
       * becomes 0 and fails `.positive()` — the form is refused for leaving an
       * optional box empty, and the message names no field. Update takes null
       * because clearing a duration has to be expressible. See SubjectEditPage,
       * where credits has exactly this shape.
       */
      ...(f.durationWeeks.trim()
        ? { durationWeeks: Number(f.durationWeeks) }
        : creating
          ? {}
          : { durationWeeks: null }),
      thumbnailAssetId: assetId,
      ...(creating ? {} : { isActive }),
    };
    try {
      const id = creating
        ? (await api.post<{ id: string }>("/programmes", body)).id
        : (courseId as string);
      if (!creating) await api.patch(`/programmes/${id}`, body);
      // The syllabus is a separate call because it is a separate decision, and
      // it is made here so that one press does the whole job.
      await api.put(`/programmes/${id}/subjects`, { subjectIds: chosen });
      navigate(creating ? `/courses-admin/course/${id}` : "/courses-admin");
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <EditorPage title="Course" backLabel="Courses">
        <Skeleton lines={6} />
      </EditorPage>
    );
  }

  /*
   * WHAT IS STILL MISSING, at the top, where it can be acted on. A course with
   * no subjects has nothing to teach; with no fee, applicants are told to
   * telephone the office for a price; with no batch, there is nowhere to admit
   * anybody. All three are states a course can sit in looking finished.
   */
  const gaps: Array<{ text: string; to?: string; cta?: string }> = [];
  if (chosen.length === 0) gaps.push({ text: "no subjects, so it has nothing to teach" });
  if (course && !course.fee.published) {
    gaps.push({
      text:
        course.fee.drafts > 0
          ? `no published fee (${course.fee.drafts} draft), so applicants are told to ask the office`
          : "no fee, so applicants are told to ask the office",
      to: "/courses-admin",
      cta: "Set the fee",
    });
  }
  if (course && course.totals.batches === 0) {
    gaps.push({
      text: "no batches, so nobody can be admitted",
      to: `/courses-admin/batch/new?courseId=${course.id}`,
      cta: "Add a batch",
    });
  }

  return (
    <EditorPage
      title={creating ? "New course" : f.name || "Course"}
      subtitle={
        creating
          ? "Two or more subjects taught together. This is what a student applies for."
          : `${f.code} · what a student applies for`
      }
      aside={
        !creating && (
          <span className={isActive ? "pill pill-ok" : "pill pill-warn"}>
            {isActive ? "On offer" : "Not offered"}
          </span>
        )
      }
      intro={
        creating ? (
          <p className="small">
            A course is <strong>two or more subjects taught together</strong> — the{" "}
            <em>Diploma in Graphic Designing</em>. It carries the fee and the public page. It then
            runs as one or more <strong>batches</strong> — Batch A, Batch B — and students are
            admitted into a batch, never into the course itself.
          </p>
        ) : (
          gaps.length > 0 && (
            <div className="alert alert-warn" role="status">
              <strong>This course is not ready yet.</strong>
              <p className="small">It has {gaps.map((g) => g.text).join("; ")}.</p>
              <div className="row-actions">
                {gaps
                  .filter((g) => g.to)
                  .map((g) => (
                    <Link key={g.cta} className="btn btn-sm" to={g.to as string}>
                      {g.cta}
                    </Link>
                  ))}
              </div>
            </div>
          )
        )
      }
      actions={
        <>
          <button
            className="btn btn-primary"
            disabled={busy || !f.name.trim() || (creating && !f.code.trim())}
            onClick={() => void save()}
          >
            <Icon name="check" />
            {busy ? "Saving…" : creating ? "Create course" : "Save changes"}
          </button>
          <button className="btn btn-quiet" onClick={() => navigate("/courses-admin")} disabled={busy}>
            Cancel
          </button>
        </>
      }
    >
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

      <EditorSection step={1} title="What it is called" hint="What appears on the public page.">
        <div className="form-row">
          <label className="field">
            <span>Name</span>
            <input
              value={f.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="Diploma in Graphic Designing"
              autoFocus={creating}
            />
          </label>
          <label className="field">
            <span>Code</span>
            <input
              value={f.code}
              onChange={(e) => set("code")(e.target.value.toUpperCase())}
              placeholder="GD"
              disabled={!creating}
              maxLength={10}
            />
            <span className="muted small">
              {creating
                ? "2–10 letters or digits. It becomes part of every student's registration number, so it cannot be changed afterwards."
                : "Cannot be changed — it is part of every registration number already issued."}
            </span>
          </label>
        </div>

        <label className="field">
          <span>What the course is</span>
          <textarea
            rows={4}
            value={f.description}
            onChange={(e) => set("description")(e.target.value)}
            placeholder="A six-month practical diploma covering design software, brand systems and a portfolio project."
          />
          <span className="muted small">
            An applicant reads this before deciding. Two or three sentences.
          </span>
        </label>

        <div className="form-row">
          <label className="field">
            <span>How long it runs</span>
            <input
              type="number"
              min={1}
              max={520}
              value={f.durationWeeks}
              onChange={(e) => set("durationWeeks")(e.target.value)}
              placeholder="26"
            />
            <span className="muted small">In weeks. Shown on the public page.</span>
          </label>
        </div>
      </EditorSection>

      <EditorSection
        step={2}
        title="What it teaches"
        hint="Its syllabus. A new batch of this course starts with exactly these subjects."
      >
        {allSubjects.length === 0 ? (
          <p className="muted small">
            No subjects exist yet. <Link to="/courses-admin/subject/new">Create one first</Link> —
            a course with no subjects has nothing to teach.
          </p>
        ) : (
          <>
            <div className="subject-picker">
              {allSubjects.map((s) => {
                const on = chosen.includes(s.id);
                const taught = course?.subjects.find((c) => c.id === s.id)?.batches ?? 0;
                return (
                  <label key={s.id} className={on ? "subject-chip is-on" : "subject-chip"}>
                    <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
                    <span>
                      {s.name} <span className="muted small">{s.code}</span>
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
            <p className="muted small">
              {chosen.length === 0
                ? "Nothing selected. Any batch made from this course will have no register."
                : `${chosen.length} subject${chosen.length === 1 ? "" : "s"} selected.`}
            </p>

            {/* Changing a syllabus never touches a batch that is already
                running — its register and coursework hang off its own rows. */}
            {course && course.totals.batches > 0 && (
              <p className="muted small">
                Batches already running keep teaching what they teach. This decides what a{" "}
                <strong>new</strong> batch starts with.
              </p>
            )}
          </>
        )}
      </EditorSection>

      <EditorSection
        step={3}
        title="How it looks"
        hint="The picture on the landing page and the application form."
      >
        <div className="editor-preview-row">
          <ThumbnailField
            assetId={assetId}
            onChange={setAssetId}
            hint="A wide picture works best — the card crops it to a banner."
          />
          <div className="editor-preview">
            <span className="muted small">On the public page it will look like this</span>
            <CourseCover
              code={f.code || "NEW"}
              name={f.name || "Course"}
              thumbnailUrl={assetId ? `/api/v1/public/course-media/${assetId}` : null}
            />
          </div>
        </div>
      </EditorSection>

      {!creating && course && (
        <EditorSection title="Its batches and its fee" hint="Where students actually go, and what they pay.">
          <div className="editor-facets">
            <div>
              <span className="course-facet-label">
                <Icon name="users" /> Batches
              </span>
              {course.batches.length === 0 ? (
                <p className="muted small">None yet — nobody can be admitted to this course.</p>
              ) : (
                <ul className="list small">
                  {course.batches.map((b) => (
                    <li key={b.id}>
                      <span>{b.name}</span>
                      <span className="muted">
                        {b.enrolled}/{b.capacity}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link className="btn btn-sm" to={`/courses-admin/batch/new?courseId=${course.id}`}>
                Add a batch
              </Link>
            </div>

            <div>
              <span className="course-facet-label">
                <Icon name="money" /> Fee
              </span>
              <p className="small">
                {course.fee.published ? (
                  <span className="pill pill-ok">Published</span>
                ) : (
                  <span className="pill pill-warn">
                    {course.fee.drafts > 0 ? `${course.fee.drafts} draft` : "Not set"}
                  </span>
                )}
              </p>
              <p className="muted small">
                A fee is a table with its own instalments and its own draft life, so it is edited
                on the Courses screen where there is room for it.
              </p>
            </div>
          </div>

          <label className="field-inline">
            <input
              type="checkbox"
              checked={!isActive}
              onChange={(e) => setIsActive(!e.target.checked)}
            />
            <span>Stop offering this course</span>
          </label>
          <span className="muted small">
            It disappears from the public page and from the application form. Students already on
            it keep everything — their batch, their marks and their certificate are untouched.
          </span>
        </EditorSection>
      )}
    </EditorPage>
  );
}
