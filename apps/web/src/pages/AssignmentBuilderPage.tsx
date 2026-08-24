import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { VoiceRecorder, type Recording } from "../components/VoiceRecorder";
import { HowItWorks } from "../components/HowItWorks";

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
  /*
   * THE RECORDING IS HELD UNTIL THE ASSIGNMENT EXISTS.
   *
   * A brief attaches to an assignment id, and there is no id until the
   * form is saved. So the blob waits here and is uploaded immediately
   * after creation, before publishing — a published assignment whose
   * spoken brief is still uploading is one a student can open and find
   * half of.
   */
  const [brief, setBrief] = useState<Recording | null>(null);
  /*
   * THE MARKING GUIDES THIS TEACHER CAN ATTACH.
   *
   * RubricsPage has existed all along and NOTHING could use what it made: the
   * API has accepted `rubricId` on an assignment since the beginning and this
   * form never sent it, so every rubric a teacher wrote was a document with no
   * way to reach a piece of work.
   */
  const [rubrics, setRubrics] = useState<Array<{ id: string; name: string; totalMarks?: number; criteriaCount?: number }>>([]);
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
    maxAttempts: "2",
    graceMinutes: "0",
    rubricId: "",
  });

  useEffect(() => {
    api
      .get<{ widgets: { mySections?: TeacherSection[] } }>("/dashboards/me")
      .then((d) => setSections(d.widgets.mySections ?? []))
      .catch(() => setSections([]));
  }, []);

  useEffect(() => {
    // A failure here costs the picker, not the form: an assignment without a
    // marking guide is perfectly normal, and refusing to load the page because
    // the rubric list did not arrive would be a worse trade.
    api
      .get<Array<{ id: string; name: string; totalMarks?: number; criteriaCount?: number }>>("/rubrics")
      .then(setRubrics)
      .catch(() => setRubrics([]));
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
        // Only where it means something: the API rejects a count on a policy
        // that has no limit, and sending 0 grace is the same as sending none.
        ...(form.resubmissionPolicy === "LIMITED"
          ? { maxAttempts: Number(form.maxAttempts) }
          : {}),
        ...(Number(form.graceMinutes) > 0 ? { graceMinutes: Number(form.graceMinutes) } : {}),
        ...(form.rubricId ? { rubricId: form.rubricId } : {}),
      });

      /*
       * BEFORE PUBLISHING, DELIBERATELY. Publishing is what makes the
       * assignment visible; a student opening it in the seconds between would
       * find a brief that mentions a recording which is not there yet.
       *
       * A failure here does NOT fail the assignment — it exists and is
       * correct, and losing the whole form because a microphone file did not
       * upload would be a far worse trade. The teacher is told, and the brief
       * can be recorded again from the assignment itself.
       */
      if (brief) {
        const body = new FormData();
        const ext = brief.contentType === "audio/mp4" ? "m4a" : brief.contentType === "audio/ogg" ? "ogg" : "webm";
        body.append("file", new File([brief.blob], `brief.${ext}`, { type: brief.contentType }));
        body.append("seconds", String(brief.seconds));
        await api.upload(`/assignments/${assignment.id}/brief-audio`, body).catch((e: unknown) => {
          setProblems([
            e instanceof ApiError
              ? `The assignment was created, but the recording did not upload: ${e.message}`
              : "The assignment was created, but the recording did not upload.",
          ]);
        });
      }

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

      <HowItWorks
        id="assignment-builder"
        title="How setting work goes"
        intro="Everything below can be changed until you publish. Nothing reaches a student before that."
        steps={[
          {
            icon: "pen",
            title: "Describe the task",
            body: "A title and what they have to do. You can record it in your own voice as well.",
          },
          {
            icon: "calendar",
            title: "Say when",
            body: "When it opens, when it is due, and what happens to work that arrives late.",
          },
          {
            icon: "clipboard",
            title: "Say how it is marked",
            body: "Out of a number, or against a marking guide that breaks the marks down for you.",
          },
          {
            icon: "check",
            title: "Publish it",
            body: "Until you do, it is a draft only you can see. Save now, publish when you are ready.",
          },
        ]}
        note="Marks stay hidden from the whole class until you release them, so you can mark over several days without anybody comparing notes early."
      />

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

        {/*
          A SPOKEN BRIEF — FR-ASG.

          THE WRITTEN INSTRUCTIONS ABOVE STAY REQUIRED, and this sits under
          them rather than beside them to say so. For design and language work
          speech carries what text cannot — a tutor explaining what is wrong
          with a layout says it in forty seconds and says it better — but a
          brief that exists ONLY as sound is unusable for a deaf student,
          unsearchable, and unreadable on a metered connection. Audio is an
          addition to the brief; it is never the brief.
        */}
        <VoiceRecorder
          label="Say it as well (optional)"
          hint="Explain the task in your own words. Students hear it beside the written instructions — it does not replace them."
          maxSeconds={300}
          busy={busy}
          onRecorded={setBrief}
          onDiscard={() => setBrief(null)}
        />
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

        <div className="field-row">
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

          {/*
            THE OPTION ABOVE WAS UNUSABLE WITHOUT THIS.
            "A limited number of times" asks a question — how many? — that the
            form never let anybody answer. The API has accepted `maxAttempts`
            all along; nothing sent it, so choosing the option set no limit at
            all and behaved as "unlimited" while claiming otherwise.
          */}
          {form.resubmissionPolicy === "LIMITED" && (
            <label className="field">
              <span>How many times?</span>
              <input
                type="number"
                min={1}
                max={20}
                value={form.maxAttempts}
                onChange={(e) => set({ maxAttempts: e.target.value })}
              />
              <span className="muted small">Counting the first one.</span>
            </label>
          )}
        </div>

        {/*
          A GRACE PERIOD, which the deadline alone cannot express.
          Every teacher has a student whose upload finished at 23:01, and
          marking that late is a punishment for a slow connection rather than
          for leaving it to the last minute. Accepted by the API since the
          beginning; never offered.
        */}
        <label className="field">
          <span>Grace period after the deadline</span>
          <input
            type="number"
            min={0}
            max={10080}
            value={form.graceMinutes}
            onChange={(e) => set({ graceMinutes: e.target.value })}
          />
          <span className="muted small">
            Minutes. Anything submitted within this is on time — not late, and no penalty. Zero
            means the deadline is the deadline.
          </span>
        </label>

        {/*
          THE MARKING GUIDE, and the reason Rubrics existed with nothing to
          point at. Optional, because most work is marked out of a number.
        */}
        <label className="field">
          <span>Marking guide</span>
          <select value={form.rubricId} onChange={(e) => set({ rubricId: e.target.value })}>
            <option value="">None — mark it out of {form.marksAvailable || "the total"}</option>
            {rubrics.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {typeof r.totalMarks === "number" ? ` — ${r.totalMarks} marks` : ""}
                {typeof r.criteriaCount === "number" ? `, ${r.criteriaCount} criteria` : ""}
              </option>
            ))}
          </select>
          <span className="muted small">
            {rubrics.length === 0
              ? "You have not written any yet. Marking guides are made on the Marking guides screen."
              : "Marking then shows each criterion with its own marks, and adds them up for you."}
          </span>
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
