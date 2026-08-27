import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { EditorPage, EditorSection } from "../components/EditorPage";
import { ThumbnailField } from "../components/ThumbnailField";
import { CourseCover } from "../components/CourseCover";
import { Icon } from "../components/Icon";
import { Skeleton } from "../components/Ui";
import { Field } from "../components/Field";

/**
 * One subject — SRS FR-CRS-015.
 *
 * A SUBJECT IS THE SMALLEST THING THE INSTITUTE TEACHES, and the form used to
 * ask for four fields in a panel the width of a card. Two things it could not
 * offer, both of which the API had supported the whole time:
 *
 *   `isActive` — there was no way to retire a subject that is no longer
 *   taught, so the picker on every course and batch form grew forever.
 *
 *   `thumbnailUrl` — an external picture, for subjects illustrated from the
 *   Institute's own site.
 *
 * And one thing nothing could show: WHICH COURSES TEACH IT. That is the
 * question somebody actually has before editing or retiring a subject, and it
 * was answerable only by opening every course in turn.
 */

interface SubjectDetail {
  id: string;
  name: string;
  code: string;
  description: string | null;
  credits: number | null;
  isActive: boolean;
  thumbnailAssetId: string | null;
  thumbnailUrl: string | null;
}

interface CourseUsing {
  id: string;
  code: string;
  name: string;
  batches: number;
}

export function SubjectEditPage() {
  const { subjectId } = useParams();
  const navigate = useNavigate();
  const creating = !subjectId || subjectId === "new";

  const [loaded, setLoaded] = useState(creating);
  const [f, setF] = useState({
    name: "",
    code: "",
    description: "",
    credits: "",
    thumbnailUrl: "",
  });
  const [assetId, setAssetId] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [usedBy, setUsedBy] = useState<CourseUsing[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const load = useCallback(async () => {
    if (creating) return;
    try {
      const [subjects, courses] = await Promise.all([
        api.get<SubjectDetail[]>("/subjects"),
        // Which courses teach it — the question somebody has before editing or
        // retiring one, and previously answerable only by opening every course.
        api.get<Array<{ id: string; code: string; name: string; subjects: Array<{ id: string }>; totals: { batches: number } }>>(
          "/course-tree",
        ),
      ]);
      const found = subjects.find((s) => s.id === subjectId);
      if (!found) {
        setError(new ApiError(404, { code: "RESOURCE_NOT_FOUND", message: "That subject no longer exists." }));
        setLoaded(true);
        return;
      }
      setF({
        name: found.name,
        code: found.code,
        description: found.description ?? "",
        credits: found.credits ? String(found.credits) : "",
        thumbnailUrl: found.thumbnailUrl ?? "",
      });
      setAssetId(found.thumbnailAssetId);
      setIsActive(found.isActive);
      setUsedBy(
        courses
          .filter((c) => c.subjects.some((s) => s.id === subjectId))
          .map((c) => ({ id: c.id, code: c.code, name: c.name, batches: c.totals.batches })),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setLoaded(true);
    }
  }, [creating, subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      name: f.name.trim(),
      ...(creating ? { code: f.code.trim().toUpperCase() } : {}),
      description: f.description.trim() || null,
      /*
       * CREDITS IS OPTIONAL, AND OPTIONAL MEANS ABSENT — NOT NULL.
       *
       * The create schema is `.optional()` on a coerced number, so a null
       * arrives as 0 and fails `.positive()`. The whole form was then refused
       * with "Number must be greater than 0", naming no field, for leaving an
       * explicitly optional box empty. Update accepts null (it is `.nullish()`,
       * and clearing the value has to be expressible), so the two differ.
       */
      ...(f.credits.trim()
        ? { credits: Number(f.credits) }
        : creating
          ? {}
          : { credits: null }),
      thumbnailAssetId: assetId,
      thumbnailUrl: f.thumbnailUrl.trim() || null,
      ...(creating ? {} : { isActive }),
    };
    try {
      if (creating) await api.post("/subjects", body);
      else await api.patch(`/subjects/${subjectId}`, body);
      navigate("/courses-admin");
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) {
    return (
      <EditorPage title="Subject" backLabel="Courses">
        <Skeleton lines={6} />
      </EditorPage>
    );
  }

  return (
    <EditorPage
      title={creating ? "New subject" : f.name || "Subject"}
      subtitle={
        creating
          ? "A single thing that is taught. Make it once, then any course can teach it."
          : `${f.code} · a single thing that is taught`
      }
      aside={
        !creating && (
          <span className={isActive ? "pill pill-ok" : "pill pill-warn"}>
            {isActive ? "In use" : "Retired"}
          </span>
        )
      }
      intro={
        creating && (
          <p className="small">
            A subject is the <strong>smallest</strong> thing the Institute teaches —{" "}
            <em>Adobe Photoshop</em>, <em>English</em>. It is not a course on its own: a course is
            two or more subjects taught together, and students are admitted into a batch of a
            course.
          </p>
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
            {busy ? "Saving…" : creating ? "Create subject" : "Save changes"}
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

      <EditorSection
        step={1}
        title="What it is called"
        hint="The name students see on their timetable and their certificate."
      >
        <div className="form-row">
          <Field label="Name" required><input
              value={f.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="Adobe Photoshop"
              autoFocus={creating}
            />
          </Field>
          <Field label="Code" required hint={<>{creating
                ? "2–20 letters or digits. It appears on transcripts, so it cannot be changed afterwards."
                : "Cannot be changed — it appears on transcripts already issued."}</>}><input
              value={f.code}
              onChange={(e) => set("code")(e.target.value.toUpperCase())}
              placeholder="PS101"
              disabled={!creating}
              maxLength={20}
            />
          </Field>
        </div>

        <Field label="What students learn in it" hint={<>Shown on the course page. A sentence or two is enough.</>}><textarea
            rows={4}
            value={f.description}
            onChange={(e) => set("description")(e.target.value)}
            placeholder="Retouching, colour correction, and preparing artwork for print and screen."
          />
        </Field>

        <div className="form-row">
          <Field label="Credits" hint={<>Optional. Used when a programme weights subjects against each other.</>}><input
              type="number"
              min={1}
              max={20}
              value={f.credits}
              onChange={(e) => set("credits")(e.target.value)}
              placeholder="3"
            />
          </Field>
        </div>
      </EditorSection>

      <EditorSection
        step={2}
        title="How it looks"
        hint="A picture on the subject's card. Without one, the System draws a cover from the code."
      >
        <div className="editor-preview-row">
          <ThumbnailField
            assetId={assetId}
            onChange={setAssetId}
            hint="Uploaded to the System, so it does not depend on anybody's Drive share staying public."
          />
          <div className="editor-preview">
            <span className="muted small">On a card it will look like this</span>
            <CourseCover
              code={f.code || "SUB"}
              name={f.name || "Subject"}
              thumbnailUrl={
                assetId ? `/api/v1/public/course-media/${assetId}` : f.thumbnailUrl || null
              }
            />
          </div>
        </div>

        <Field label="Or link a picture already on the web" hint={<>An uploaded picture wins over this one. Useful when the artwork already lives on the
            Institute&rsquo;s own site.</>}><input
            value={f.thumbnailUrl}
            onChange={(e) => set("thumbnailUrl")(e.target.value)}
            placeholder="https://prepreneurship.pk/images/photoshop.jpg"
          />
        </Field>
      </EditorSection>

      {!creating && (
        <EditorSection
          title="Where it is taught"
          hint="The courses whose syllabus lists this subject."
        >
          {usedBy.length === 0 ? (
            <p className="muted small">
              No course teaches this yet. Add it to a course&rsquo;s syllabus from the Courses
              screen — a subject on its own has no students.
            </p>
          ) : (
            <ul className="list small">
              {usedBy.map((c) => (
                <li key={c.id}>
                  <span>
                    {c.name} <span className="muted">{c.code}</span>
                  </span>
                  <span className="muted">
                    {c.batches} batch{c.batches === 1 ? "" : "es"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <label className="field-inline">
            <input
              type="checkbox"
              checked={!isActive}
              onChange={(e) => setIsActive(!e.target.checked)}
            />
            <span>Retire this subject</span>
          </label>
          <span className="muted small">
            A retired subject stops appearing when somebody builds a course or a batch. Courses
            already teaching it are untouched, and so is every register and mark — retiring is
            about what can be chosen next, not about deleting a history.
          </span>
        </EditorSection>
      )}
    </EditorPage>
  );
}
