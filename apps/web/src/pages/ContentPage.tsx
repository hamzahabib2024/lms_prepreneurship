import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";

/**
 * Course content — SRS §13.6, FR-CRS-027..032, FR-VID-003..007.
 *
 * A subject's modules, the lessons inside them, and the recordings attached to
 * each. This is the teacher's side of the page students read.
 *
 * PUBLICATION IS THE THROUGH-LINE. Everything is created as a draft (BR-CNT-01)
 * and the state is stated on every row, because the question a teacher is
 * actually asking when they open this is "can my students see this yet" — and
 * getting that wrong in either direction is the expensive mistake. Publishing
 * next term's material early spoils it; leaving this week's unpublished means a
 * class with nothing to watch.
 */

interface TeacherSection {
  sectionSubjectId: string;
  subject: { id?: string; code: string; name: string };
  section: { code: string };
}

interface Lecture {
  id: string;
  title: string;
  durationSeconds: number | null;
  publicationStatus: string;
  availabilityStatus: string;
}

interface Lesson {
  id: string;
  title: string;
  estimatedMinutes: number | null;
  publicationStatus: string;
  lectures: Lecture[];
}

interface Module {
  id: string;
  title: string;
  description: string | null;
  publicationStatus: string;
  lessons: Lesson[];
}

interface StorageEntry {
  storageRef: string;
  name: string;
  isFolder: boolean;
  durationSeconds: number | null;
}

export function ContentPage() {
  const [sections, setSections] = useState<TeacherSection[]>([]);
  const [chosen, setChosen] = useState<TeacherSection | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [modules, setModules] = useState<Module[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ widgets: { mySections?: TeacherSection[] } }>("/dashboards/me")
      .then((d) => setSections(d.widgets.mySections ?? []))
      .catch(() => setSections([]));
  }, []);

  const loadTree = useCallback(() => {
    if (!subjectId) return setModules(null);
    api
      .get<Module[]>(`/subjects/${subjectId}/content`)
      .then(setModules)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the content."));
  }, [subjectId]);

  useEffect(loadTree, [loadTree]);

  const choose = async (sectionSubjectId: string) => {
    const section = sections.find((s) => s.sectionSubjectId === sectionSubjectId) ?? null;
    setChosen(section);
    setModules(null);
    if (!section) return setSubjectId("");
    // The content tree is keyed by SUBJECT, and mySections carries the offering.
    // Progress knows which subject an offering teaches, so it is asked once.
    try {
      const subjects = await api.get<Array<{ id: string; code: string }>>("/subjects");
      setSubjectId(subjects.find((s) => s.code === section.subject.code)?.id ?? "");
    } catch {
      setSubjectId("");
    }
  };

  return (
    <>
      <header className="page-head">
        <h1>Course content</h1>
      </header>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      <section className="card">
        <label className="field">
          <span>Subject</span>
          <select
            value={chosen?.sectionSubjectId ?? ""}
            onChange={(e) => void choose(e.target.value)}
          >
            <option value="">Choose one of your subjects…</option>
            {sections.map((s) => (
              <option key={s.sectionSubjectId} value={s.sectionSubjectId}>
                {s.subject.name} — {s.section.code}
              </option>
            ))}
          </select>
        </label>
      </section>

      {chosen && subjectId && (
        <>
          <NewModule subjectId={subjectId} onCreated={loadTree} />
          {modules?.map((m) => (
            <ModuleCard
              key={m.id}
              module={m}
              sectionSubjectId={chosen.sectionSubjectId}
              onChanged={loadTree}
            />
          ))}
          {modules?.length === 0 && (
            <div className="card">
              <p className="muted">
                Nothing here yet. Start with a module — a week, a theme, a unit — and put
                lessons inside it.
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}

function NewModule({ subjectId, onCreated }: { subjectId: string; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/modules", { subjectId, title });
      setTitle("");
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That module could not be created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="field-row">
        <label className="field">
          <span>New module</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Foundations of Design"
          />
        </label>
        <div className="field">
          <span>&nbsp;</span>
          <button
            className="btn btn-primary"
            onClick={() => void create()}
            disabled={busy || title.trim().length < 2}
          >
            {busy ? "Adding…" : "Add module"}
          </button>
        </div>
      </div>
      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}
    </section>
  );
}

function ModuleCard({
  module: m,
  sectionSubjectId,
  onChanged,
}: {
  module: Module;
  sectionSubjectId: string;
  onChanged: () => void;
}) {
  const [lessonTitle, setLessonTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work.");
    }
  };

  return (
    <section className="card">
      <div className="assignment-head">
        <h2>{m.title}</h2>
        <span className="row-actions">
          <PublicationBadge status={m.publicationStatus} />
          <button
            className="btn btn-quiet"
            onClick={() =>
              void act(() =>
                api.post(`/modules/${m.id}/publication`, {
                  status: m.publicationStatus === "PUBLISHED" ? "UNPUBLISHED" : "PUBLISHED",
                }),
              )
            }
          >
            {m.publicationStatus === "PUBLISHED" ? "Unpublish" : "Publish"}
          </button>
        </span>
      </div>

      {/* BR-CNT-01 stated where the consequence is, not in a help page. */}
      {m.publicationStatus !== "PUBLISHED" && (
        <p className="muted small">
          Students cannot see this module or anything inside it.
        </p>
      )}

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {m.lessons.map((l) => (
        <LessonRow
          key={l.id}
          lesson={l}
          sectionSubjectId={sectionSubjectId}
          onChanged={onChanged}
        />
      ))}

      <div className="field-row">
        <label className="field">
          <span>New lesson</span>
          <input
            value={lessonTitle}
            onChange={(e) => setLessonTitle(e.target.value)}
            placeholder="Colour theory"
          />
        </label>
        <div className="field">
          <span>&nbsp;</span>
          <button
            className="btn btn-quiet"
            disabled={lessonTitle.trim().length < 2}
            onClick={() =>
              void act(async () => {
                await api.post("/lessons", { moduleId: m.id, title: lessonTitle });
                setLessonTitle("");
              })
            }
          >
            Add lesson
          </button>
        </div>
      </div>
    </section>
  );
}

function LessonRow({
  lesson: l,
  sectionSubjectId,
  onChanged,
}: {
  lesson: Lesson;
  sectionSubjectId: string;
  onChanged: () => void;
}) {
  const [attaching, setAttaching] = useState(false);

  return (
    <div className="lesson">
      <div className="assignment-head">
        <h3>{l.title}</h3>
        <span className="row-actions">
          <PublicationBadge status={l.publicationStatus} />
          <button
            className="btn btn-quiet"
            onClick={() =>
              void api
                .post(`/lessons/${l.id}/publication`, {
                  status: l.publicationStatus === "PUBLISHED" ? "UNPUBLISHED" : "PUBLISHED",
                })
                .then(onChanged)
                .catch(() => undefined)
            }
          >
            {l.publicationStatus === "PUBLISHED" ? "Unpublish" : "Publish"}
          </button>
        </span>
      </div>

      {l.lectures.length > 0 && (
        <ul className="list small">
          {l.lectures.map((v) => (
            <li key={v.id}>
              <span>
                {v.title}
                {/* ARC-045 — a missing file is stated here rather than
                    discovered by a student meeting a broken player. */}
                {v.availabilityStatus !== "AVAILABLE" && (
                  <span className="warn"> · file missing</span>
                )}
              </span>
              <PublicationBadge status={v.publicationStatus} />
            </li>
          ))}
        </ul>
      )}

      {/* FR-CRS-035 — the handouts, beside the recording rather than on a
          separate screen: a teacher preparing a lesson is thinking about the
          lesson, not about which kind of file they are attaching. */}
      <LessonResources lessonId={l.id} lessonPublished={l.publicationStatus === "PUBLISHED"} />

      {attaching ? (
        <AttachLecture
          lessonId={l.id}
          sectionSubjectId={sectionSubjectId}
          onDone={() => {
            setAttaching(false);
            onChanged();
          }}
        />
      ) : (
        <button className="btn btn-quiet" onClick={() => setAttaching(true)}>
          Attach a recording
        </button>
      )}
    </div>
  );
}

interface Resource {
  id: string;
  title: string;
  filename: string;
  sizeBytes: number;
  publicationStatus: string;
}

/**
 * Handouts, slides and worksheets on a lesson.
 *
 * Loaded on demand rather than with the tree: most lessons have none, and a
 * request per lesson on every page load to discover that is a poor trade.
 *
 * PUBLISHING A RESOURCE IS NOT THE SAME AS PUBLISHING THE LESSON, and the
 * server says so when they disagree. The message is shown as it comes back
 * rather than replaced with a generic success, because "published, but nobody
 * can see it yet" is the thing a teacher needs to read.
 */
function LessonResources({
  lessonId,
  lessonPublished,
}: {
  lessonId: string;
  lessonPublished: boolean;
}) {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<Resource[]>(`/lessons/${lessonId}/resources`)
      .then(setResources)
      .catch(() => setResources([]));
  }, [lessonId]);

  useEffect(load, [load]);

  const attach = async (file: File, title: string) => {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("title", title || file.name);
    try {
      await api.upload(`/lessons/${lessonId}/resources`, form);
      setNotice("Attached as a draft. Publish it when it is ready.");
      load();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That file could not be attached.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!resources) return null;

  return (
    <div className="lesson-resources">
      {resources.length > 0 && (
        <ul className="list small">
          {resources.map((r) => (
            <li key={r.id}>
              <span>
                {r.title}
                <br />
                <span className="muted small">
                  {r.filename} · {Math.max(1, Math.round(r.sizeBytes / 1024))} KB
                </span>
              </span>
              <span className="row-actions">
                <PublicationBadge status={r.publicationStatus} />
                <button
                  className="btn btn-quiet"
                  disabled={busy}
                  onClick={() =>
                    void api
                      .post<{ message: string }>(`/lesson-resources/${r.id}/publication`, {
                        status: r.publicationStatus === "PUBLISHED" ? "DRAFT" : "PUBLISHED",
                      })
                      .then((res) => {
                        // The server's own sentence: it is the one that says
                        // the lesson is still a draft.
                        setNotice(res.message);
                        load();
                      })
                      .catch(() => setError("That did not work."))
                  }
                >
                  {r.publicationStatus === "PUBLISHED" ? "Hide" : "Publish"}
                </button>
                <button
                  className="btn btn-quiet"
                  disabled={busy}
                  onClick={() =>
                    void api
                      .del(`/lesson-resources/${r.id}`)
                      .then(load)
                      .catch(() => setError("That did not work."))
                  }
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {notice && <p className={/cannot see it yet/.test(notice) ? "warn small" : "muted small"}>{notice}</p>}
      {error && <p className="warn small">{error}</p>}

      <label className="inline-field">
        <span className="muted small">Attach a handout</span>
        <input
          type="file"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void attach(file, file.name.replace(/\.[^.]+$/, ""));
            e.target.value = "";
          }}
        />
      </label>
      {!lessonPublished && resources.length > 0 && (
        <p className="muted small">
          This lesson is a draft, so students cannot see any of these yet.
        </p>
      )}
    </div>
  );
}

/**
 * FR-VID-003 — browse the configured storage and catalogue a file.
 *
 * The teacher picks from what is actually there rather than typing an
 * identifier. A mistyped storage reference produces a lecture that looks
 * catalogued and plays nothing, and nobody finds out until a student tries.
 */
function AttachLecture({
  lessonId,
  sectionSubjectId,
  onDone,
}: {
  lessonId: string;
  sectionSubjectId: string;
  onDone: () => void;
}) {
  const [entries, setEntries] = useState<StorageEntry[] | null>(null);
  const [chosen, setChosen] = useState<StorageEntry | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ provider: string; entries: StorageEntry[] }>("/storage/browse")
      .then((r) => setEntries(r.entries.filter((e) => !e.isFolder)))
      .catch((e) =>
        setError(
          e instanceof ApiError
            ? e.message
            : "Could not reach the storage. Check it is configured.",
        ),
      );
  }, []);

  const attach = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/recorded-lectures", {
        sectionSubjectId,
        lessonId,
        title: title.trim() || chosen.name,
        storageRef: chosen.storageRef,
        recordedOn: new Date().toISOString(),
        ...(chosen.durationSeconds ? { durationSeconds: chosen.durationSeconds } : {}),
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That recording could not be attached.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="composer">
      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {entries === null ? (
        <p className="muted small">Reading the storage…</p>
      ) : entries.length === 0 ? (
        <p className="muted small">
          No files found in the configured folder. Upload the recording there first.
        </p>
      ) : (
        <>
          <label className="field">
            <span>File</span>
            <select
              value={chosen?.storageRef ?? ""}
              onChange={(e) =>
                setChosen(entries.find((x) => x.storageRef === e.target.value) ?? null)
              }
            >
              <option value="">Choose a file…</option>
              {entries.map((e) => (
                <option key={e.storageRef} value={e.storageRef}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Title students will see</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={chosen?.name ?? "Colour theory"}
            />
          </label>
        </>
      )}

      <span className="row-actions">
        <button className="btn btn-primary" onClick={() => void attach()} disabled={busy || !chosen}>
          {busy ? "Attaching…" : "Attach"}
        </button>
        <button className="btn btn-quiet" onClick={onDone}>
          Cancel
        </button>
      </span>
    </div>
  );
}

/** Publication state as a word, never a colour alone (NFR-ACC-003). */
function PublicationBadge({ status }: { status: string }) {
  if (status === "PUBLISHED") return <span className="small">✓ Published</span>;
  return <span className="muted small">Draft — hidden from students</span>;
}
