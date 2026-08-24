import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { EditorPage, EditorSection } from "../components/EditorPage";
import { Icon } from "../components/Icon";
import { Skeleton } from "../components/Ui";

/**
 * One batch — a section of a course, with everything it needs to run.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A BATCH NEEDS, AND WHAT THE OLD FORM ASKED FOR.
 *
 * A batch is ready when it has subjects (so there is a register), a teacher (so
 * somebody can mark it), seats, and somewhere for the class to talk. The panel
 * asked for four of those and could not ask for two, because the endpoints
 * existed and no screen called them:
 *
 *   TWENTY OF TWENTY-FOUR subject-batches in this Institute's own data had NO
 *   TEACHER. The dashboard reported the number as an exception and had nowhere
 *   to send anybody to fix it.
 *
 *   AND NO BATCH COULD BE GIVEN A WHATSAPP LINK, although the column existed,
 *   the API accepted it, and FR-REG-044 shows those links to a student the
 *   moment they are admitted. Every batch made through the System admitted
 *   students and told them nothing about where their class actually talks.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE SUBJECTS DEFAULT TO THE COURSE'S SYLLABUS, because a batch of a course
 * teaches that course. Starting from blank is how a batch ends up with no
 * register, which is the state this page exists to make impossible to reach by
 * accident.
 */

interface CourseNode {
  id: string;
  code: string;
  name: string;
  subjects: Array<{ id: string; code: string; name: string }>;
  totals: { batches: number };
}

interface TeacherRow {
  teacherId: string;
  name: string;
  status: string;
  subjectSections: number;
  students: number;
}

const SHIFTS = [
  ["MORNING", "Morning"],
  ["EVENING", "Evening"],
  ["WEEKEND", "Weekend"],
] as const;

/**
 * The values are the SCHEMA'S, not invented here — DELIVERY_MODE is
 * ONLINE | HYBRID | ON_CAMPUS. Writing "ONSITE" because it reads better would
 * typecheck perfectly and be refused by the API at the moment somebody presses
 * Create, which is the worst place to find out.
 */
const MODES = [
  ["ONLINE", "Online", "Taught over a live link."],
  ["ON_CAMPUS", "On campus", "Taught in a room at the Institute."],
  ["HYBRID", "Both", "Some sessions on campus, some online."],
] as const;

/** FR-CRS-009 is absolute once a student is admitted, and the wording says so. */
const AUDIENCES = [
  ["MIXED", "Anyone", "Male and female students together."],
  ["FEMALE", "Female only", "Only female students may be admitted."],
  ["MALE", "Male only", "Only male students may be admitted."],
] as const;

export function BatchEditPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const courseId = params.get("courseId") ?? "";

  const [loaded, setLoaded] = useState(false);
  const [courses, setCourses] = useState<CourseNode[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [programmeId, setProgrammeId] = useState(courseId);

  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("40");
  const [genderRestriction, setGenderRestriction] = useState<"MIXED" | "FEMALE" | "MALE">("MIXED");
  const [shift, setShift] = useState<"MORNING" | "EVENING" | "WEEKEND">("MORNING");
  const [deliveryMode, setDeliveryMode] = useState<"ONLINE" | "ON_CAMPUS" | "HYBRID">("ONLINE");
  const [chosen, setChosen] = useState<string[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
  const [groupUrl, setGroupUrl] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    try {
      const [tree, workload] = await Promise.all([
        api.get<CourseNode[]>("/course-tree"),
        // Not just a list of names: the workload says who is already carrying
        // how much, which is the thing an administrator is weighing when they
        // decide who takes another batch.
        api.get<TeacherRow[]>("/teachers/workload").catch(() => [] as TeacherRow[]),
      ]);
      setCourses(tree);
      setTeachers(workload.filter((t) => t.status === "ACTIVE"));
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const course = courses.find((c) => c.id === programmeId);

  // The syllabus follows the chosen course — a batch of a course teaches that
  // course, so an empty selection here is almost always an accident.
  useEffect(() => {
    if (course) setChosen(course.subjects.map((s) => s.id));
  }, [course]);

  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/course-batches", {
        programmeId,
        name: name.trim(),
        capacity: Number(capacity),
        genderRestriction,
        shift,
        deliveryMode,
        subjectIds: chosen,
        ...(teacherId ? { teacherId } : {}),
        ...(channelUrl.trim() ? { whatsappChannelUrl: channelUrl.trim() } : {}),
        ...(groupUrl.trim() ? { whatsappGroupUrl: groupUrl.trim() } : {}),
      });
      navigate("/courses-admin");
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <EditorPage title="New batch" backLabel="Courses">
        <Skeleton lines={6} />
      </EditorPage>
    );
  }

  /* What this batch will still be missing when it is created. */
  const gaps: string[] = [];
  if (chosen.length === 0) gaps.push("no subjects, so it will have no register");
  if (!teacherId) gaps.push("no teacher, so nobody can mark it");

  return (
    <EditorPage
      title="New batch"
      subtitle={
        course
          ? `A section of ${course.name} — same course, different group of students.`
          : "A section of a course. Students are admitted into a batch, never into the course itself."
      }
      intro={
        <p className="small">
          A batch is <strong>one group of students</strong> taking a course — Section A, Section B,
          the female batch, the evening batch. It has its own seats, its own register and its own
          timetable, and it teaches the subjects the course teaches.
        </p>
      }
      actions={
        <>
          <button
            className="btn btn-primary"
            disabled={busy || !programmeId || !name.trim() || !capacity}
            onClick={() => void submit()}
          >
            <Icon name="check" />
            {busy ? "Creating…" : "Create this batch"}
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

      <EditorSection step={1} title="Which course is it a batch of?">
        {courses.length === 0 ? (
          <p className="muted small">
            No courses exist yet. <Link to="/courses-admin/course/new">Create one first</Link>.
          </p>
        ) : (
          <label className="field">
            <span>Course</span>
            <select value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
              <option value="">Choose a course…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code}) — {c.totals.batches} batch
                  {c.totals.batches === 1 ? "" : "es"} so far
                </option>
              ))}
            </select>
          </label>
        )}
      </EditorSection>

      <EditorSection
        step={2}
        title="Who is in it"
        hint="The name, the size, and who may be admitted."
      >
        <label className="field">
          <span>What is this batch called?</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Section A"
          />
          <span className="muted small">
            The section letter, or whatever staff and students call it — &ldquo;A&rdquo;,
            &ldquo;Morning A (Female)&rdquo;, &ldquo;Batch 2&rdquo;. A short code is generated for
            you.
          </span>
        </label>

        <div className="form-row">
          <label className="field">
            <span>How many seats?</span>
            <input
              type="number"
              min={1}
              max={500}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
            <span className="muted small">Admissions warn once it is full. Can be raised later.</span>
          </label>

          <label className="field">
            <span>When does it run?</span>
            <select value={shift} onChange={(e) => setShift(e.target.value as typeof shift)}>
              {SHIFTS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

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
              This cannot be changed once a student has been admitted, and there is no override
              anywhere in the System. Choose carefully.
            </p>
          )}
        </fieldset>

        <fieldset className="field">
          <legend>Where is it taught?</legend>
          {MODES.map(([value, label, note]) => (
            <label key={value} className="radio-row">
              <input
                type="radio"
                name="delivery-mode"
                checked={deliveryMode === value}
                onChange={() => setDeliveryMode(value)}
              />
              <span>
                <strong>{label}</strong>
                <span className="muted small">{note}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </EditorSection>

      <EditorSection
        step={3}
        title="What it teaches"
        hint="Starts from the course's syllabus. Untick anything this batch does not take."
      >
        {!course ? (
          <p className="muted small">Choose a course above first.</p>
        ) : course.subjects.length === 0 ? (
          <p className="warn small">
            {course.name} has no subjects on its syllabus.{" "}
            <Link to={`/courses-admin/course/${course.id}`}>Set them first</Link> — a batch with no
            subjects has no register and nothing on its course page.
          </p>
        ) : (
          <>
            <div className="subject-picker">
              {course.subjects.map((s) => (
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
            {chosen.length < course.subjects.length && (
              <p className="warn small">
                This batch will teach {chosen.length} of the course&rsquo;s {course.subjects.length}{" "}
                subjects, so its students get less of the course than other batches. That may be
                deliberate.
              </p>
            )}
          </>
        )}
      </EditorSection>

      <EditorSection
        step={4}
        title="Who teaches it"
        hint="Assigned to every subject of the batch. A subject taught by somebody else is changed afterwards."
      >
        {teachers.length === 0 ? (
          <p className="muted small">
            No active teachers. <Link to="/users">Create one first</Link> — a batch with no teacher
            has nobody who can mark its register.
          </p>
        ) : (
          <>
            <label className="field">
              <span>Teacher</span>
              <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                <option value="">Nobody yet</option>
                {teachers.map((t) => (
                  <option key={t.teacherId} value={t.teacherId}>
                    {t.name} — already teaching {t.subjectSections} class
                    {t.subjectSections === 1 ? "" : "es"}, {t.students} student
                    {t.students === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
              {/* The workload is on the option itself, because "who is free"
                  is the actual question and a bare list of names cannot
                  answer it. */}
              <span className="muted small">
                What each teacher already carries is shown, so a batch is not handed to somebody
                already at capacity.
              </span>
            </label>
            {!teacherId && (
              <p className="warn small">
                Without a teacher, nobody can mark this batch&rsquo;s register or its coursework.
                Twenty of the Institute&rsquo;s twenty-four classes are in this state.
              </p>
            )}
          </>
        )}
      </EditorSection>

      <EditorSection
        step={5}
        title="Where the class talks"
        hint="FR-REG-044 — these are given to a student the moment they are admitted."
      >
        <div className="form-row">
          <label className="field">
            <span>WhatsApp channel</span>
            <input
              value={channelUrl}
              onChange={(e) => setChannelUrl(e.target.value)}
              placeholder="https://whatsapp.com/channel/…"
            />
            <span className="muted small">Announcements from the Institute, one way.</span>
          </label>
          <label className="field">
            <span>WhatsApp group</span>
            <input
              value={groupUrl}
              onChange={(e) => setGroupUrl(e.target.value)}
              placeholder="https://chat.whatsapp.com/…"
            />
            <span className="muted small">Where the class talks to each other.</span>
          </label>
        </div>
        <p className="muted small">
          Optional, and both are shown on the approval screen and sent to the student. Leave them
          blank and a new student is told nothing about where their class is.
        </p>
      </EditorSection>

      {gaps.length > 0 && (
        <div className="alert alert-warn" role="status">
          <strong>It will be created with {gaps.join(" and ")}.</strong>
          <p className="small">
            That is allowed — a batch is often set up before everything is decided — but it is not
            ready to take students until both are sorted.
          </p>
        </div>
      )}
    </EditorPage>
  );
}
