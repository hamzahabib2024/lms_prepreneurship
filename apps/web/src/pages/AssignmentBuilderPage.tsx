import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "../api/client";

/**
 * Setting an assignment — SRS §13.6, FR-ASG-001..014.
 *
 * The fields are grouped by the QUESTION each one answers, not by the shape of
 * the request: what the work is, when it is due, what happens if it is late,
 * what they hand in. A flat list of fourteen inputs makes a teacher decide
 * fourteen things; grouped, most of them have a sensible default they never
 * have to look at.
 *
 * The consequences are spelled out where they are chosen. A late policy is a
 * decision about somebody's marks, and "PER_DAY_PERCENT" in a dropdown does not
 * tell a teacher what a student will actually lose.
 */

interface TeacherSection {
  sectionSubjectId: string;
  subject: { name: string };
  section: { code: string };
}

const FILE_TYPES = ["pdf", "docx", "doc", "pptx", "xlsx", "jpg", "png", "zip", "txt"];

export function AssignmentBuilderPage() {
  const navigate = useNavigate();
  const [sections, setSections] = useState<TeacherSection[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);

  const [form, setForm] = useState({
    sectionSubjectId: "",
    title: "",
    instructions: "",
    marksAvailable: "20",
    opensAt: "",
    dueAt: "",
    hardCloseAt: "",
    latePolicy: "FLAG_ONLY",
    latePenaltyValue: "10",
    latePenaltyFloor: "40",
    submissionType: "FILE",
    allowedFileTypes: ["pdf"] as string[],
    maxFileSizeMb: "10",
    maxFileCount: "3",
    resubmissionPolicy: "NONE",
  });

  useEffect(() => {
    api
      .get<{ widgets: { mySections?: TeacherSection[] } }>("/dashboards/me")
      .then((d) => setSections(d.widgets.mySections ?? []))
      .catch(() => setSections([]));
  }, []);

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const toggleType = (type: string) =>
    set({
      allowedFileTypes: form.allowedFileTypes.includes(type)
        ? form.allowedFileTypes.filter((t) => t !== type)
        : [...form.allowedFileTypes, type],
    });

  const create = async (publish: boolean) => {
    setBusy(true);
    setProblems([]);
    try {
      const assignment = await api.post<{ id: string; title: string }>("/assignments", {
        sectionSubjectId: form.sectionSubjectId,
        title: form.title,
        instructions: form.instructions,
        marksAvailable: Number(form.marksAvailable),
        opensAt: new Date(form.opensAt).toISOString(),
        dueAt: new Date(form.dueAt).toISOString(),
        ...(form.hardCloseAt ? { hardCloseAt: new Date(form.hardCloseAt).toISOString() } : {}),
        latePolicy: form.latePolicy,
        ...(form.latePolicy === "FIXED_DEDUCTION" || form.latePolicy === "PER_DAY_PERCENT"
          ? {
              latePenaltyValue: Number(form.latePenaltyValue),
              latePenaltyFloor: Number(form.latePenaltyFloor),
            }
          : {}),
        submissionType: form.submissionType,
        ...(form.submissionType !== "TEXT"
          ? {
              allowedFileTypes: form.allowedFileTypes,
              maxFileSizeMb: Number(form.maxFileSizeMb),
              maxFileCount: Number(form.maxFileCount),
            }
          : {}),
        resubmissionPolicy: form.resubmissionPolicy,
      });

      if (publish) await api.post(`/assignments/${assignment.id}/publish`);
      setCreated(assignment);
      if (publish) navigate(`/marking/${assignment.id}`);
    } catch (e) {
      setProblems(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message) ?? [e.message])
          : ["That assignment could not be created."],
      );
    } finally {
      setBusy(false);
    }
  };

  const ready =
    form.sectionSubjectId &&
    form.title.trim().length >= 3 &&
    form.instructions.trim().length >= 10 &&
    form.opensAt &&
    form.dueAt &&
    (form.submissionType === "TEXT" || form.allowedFileTypes.length > 0);

  return (
    <>
      <header className="page-head">
        <h1>New assignment</h1>
        <Link className="btn btn-quiet" to="/marking">
          Back to marking
        </Link>
      </header>

      {created && (
        <div className="alert alert-warn">
          <p>
            Saved as a draft. Students cannot see it until you publish.{" "}
            <Link to={`/marking/${created.id}`}>Open it</Link>.
          </p>
        </div>
      )}

      <section className="card">
        <h2>The work</h2>
        <div className="field-row">
          <label className="field">
            <span>Subject</span>
            <select
              value={form.sectionSubjectId}
              onChange={(e) => set({ sectionSubjectId: e.target.value })}
            >
              <option value="">Choose…</option>
              {sections.map((s) => (
                <option key={s.sectionSubjectId} value={s.sectionSubjectId}>
                  {s.subject.name} — {s.section.code}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Marks</span>
            <input
              type="number"
              min={1}
              value={form.marksAvailable}
              onChange={(e) => set({ marksAvailable: e.target.value })}
            />
          </label>
        </div>

        <label className="field">
          <span>Title</span>
          <input value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </label>

        <label className="field">
          <span>What do they have to do?</span>
          <textarea
            rows={4}
            value={form.instructions}
            onChange={(e) => set({ instructions: e.target.value })}
          />
        </label>
      </section>

      <section className="card">
        <h2>When</h2>
        <div className="field-row">
          <label className="field">
            <span>Opens</span>
            <input
              type="datetime-local"
              value={form.opensAt}
              onChange={(e) => set({ opensAt: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Due</span>
            <input
              type="datetime-local"
              value={form.dueAt}
              onChange={(e) => set({ dueAt: e.target.value })}
            />
          </label>
        </div>

        <label className="field">
          <span>Absolutely closed after</span>
          <input
            type="datetime-local"
            value={form.hardCloseAt}
            onChange={(e) => set({ hardCloseAt: e.target.value })}
          />
          {/* FR-ASG-002/020 — the hard close is the one that cannot be argued
              with, and leaving it empty means work can arrive for ever. */}
          <span className="muted small">
            Nothing can be submitted after this, whatever the late policy says. Leave it
            empty and late work never stops arriving.
          </span>
        </label>
      </section>

      <section className="card">
        <h2>If it is late</h2>
        <label className="field">
          <span>What happens</span>
          <select value={form.latePolicy} onChange={(e) => set({ latePolicy: e.target.value })}>
            <option value="FLAG_ONLY">Accept it, marked late, no deduction</option>
            <option value="NOT_ACCEPTED">Do not accept it at all</option>
            <option value="FIXED_DEDUCTION">Take off a fixed number of marks</option>
            <option value="PER_DAY_PERCENT">Take off a percentage for each day</option>
          </select>
        </label>

        {(form.latePolicy === "FIXED_DEDUCTION" || form.latePolicy === "PER_DAY_PERCENT") && (
          <div className="field-row">
            <label className="field">
              <span>{form.latePolicy === "PER_DAY_PERCENT" ? "Percent per day" : "Marks off"}</span>
              <input
                type="number"
                min={0}
                value={form.latePenaltyValue}
                onChange={(e) => set({ latePenaltyValue: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Never below (percent of the total)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={form.latePenaltyFloor}
                onChange={(e) => set({ latePenaltyFloor: e.target.value })}
              />
              {/* BR-ASG-03 — without a floor a late submission can reach zero,
                  which makes handing it in pointless and is rarely intended. */}
              <span className="muted small">
                A floor stops a late submission reaching zero, which would make handing it
                in at all pointless.
              </span>
            </label>
          </div>
        )}

        {form.latePolicy === "NOT_ACCEPTED" && (
          <p className="muted small">
            A student who misses the deadline cannot submit at all. Consider a hard close
            with a deduction instead if you want to leave a way back.
          </p>
        )}
      </section>

      <section className="card">
        <h2>What they hand in</h2>
        <label className="field">
          <span>Form</span>
          <select
            value={form.submissionType}
            onChange={(e) => set({ submissionType: e.target.value })}
          >
            <option value="FILE">Files only</option>
            <option value="TEXT">Typed into the page</option>
            <option value="BOTH">Either, or both</option>
          </select>
        </label>

        {form.submissionType !== "TEXT" && (
          <>
            <span className="field-label">Accepted file types</span>
            <div className="row-actions">
              {FILE_TYPES.map((t) => (
                <label className="option" key={t}>
                  <input
                    type="checkbox"
                    checked={form.allowedFileTypes.includes(t)}
                    onChange={() => toggleType(t)}
                  />
                  <span>.{t}</span>
                </label>
              ))}
            </div>
            {form.allowedFileTypes.length === 0 && (
              <p className="warn small">Choose at least one, or nothing can be handed in.</p>
            )}

            <div className="field-row">
              <label className="field">
                <span>Largest file, in MB</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={form.maxFileSizeMb}
                  onChange={(e) => set({ maxFileSizeMb: e.target.value })}
                />
                <span className="muted small">The Institute allows up to 10.</span>
              </label>
              <label className="field">
                <span>How many files</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={form.maxFileCount}
                  onChange={(e) => set({ maxFileCount: e.target.value })}
                />
              </label>
            </div>
          </>
        )}

        <label className="field">
          <span>Can they submit again?</span>
          <select
            value={form.resubmissionPolicy}
            onChange={(e) => set({ resubmissionPolicy: e.target.value })}
          >
            <option value="NONE">No — one submission only</option>
            <option value="UNLIMITED_UNTIL_DUE">Yes, until the deadline</option>
            <option value="LIMITED">Yes, a limited number of times</option>
          </select>
        </label>
      </section>

      {problems.length > 0 && (
        <div className="alert alert-error" role="alert">
          <ul className="list small">
            {problems.map((p) => (
              <li key={p}>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="card">
        <span className="row-actions">
          <button
            className="btn btn-primary"
            onClick={() => void create(true)}
            disabled={busy || !ready}
          >
            {busy ? "Saving…" : "Create and publish"}
          </button>
          <button
            className="btn btn-quiet"
            onClick={() => void create(false)}
            disabled={busy || !ready}
          >
            Save as draft
          </button>
        </span>
        <p className="muted small">
          A draft is invisible to students until you publish it (BR-CNT-01).
        </p>
      </section>
    </>
  );
}
