import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CourseCover } from "../components/CourseCover";
import { EmptyState, SkeletonCards } from "../components/Ui";
import { Icon } from "../components/Icon";
import { LectureFolderPicker } from "../components/LectureFolderPicker";
import { LectureUpload } from "../components/LectureUpload";
import { LectureThumb } from "../components/LectureThumb";

interface Lecture {
  id: string;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  recordedOn: string;
  publicationStatus: "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "SCHEDULED";
  availabilityStatus: "AVAILABLE" | "MISSING" | "CHECKING";
  lessonId: string | null;
  watch: { watchedPercent: number; lastPositionSeconds: number; isComplete: boolean } | null;
}

interface CourseLectures {
  subject: { id: string; code: string; name: string };
  section: { code: string; name: string };
  lectureFolderRef: string | null;
  canManage: boolean;
  /** Whether these recordings actually come from the store configured now. */
  storage?: { provider: string; live: boolean; mismatchedSources: string[] };
  lectures: Lecture[];
}

/**
 * One class's recordings — SRS §13.5, FR-VID-005.
 *
 * THE SCREEN THE SYNC NEEDED. Recordings arrive from the shared folder with no
 * lesson attached, and the content tree is modules → lessons → lectures — so
 * before this they existed and appeared nowhere. A card that only a database
 * client can see is not a card.
 *
 * WHAT EACH PERSON SEES IS DECIDED ON THE SERVER, not here. A student gets
 * published recordings on classes they are enrolled in; staff get drafts too,
 * because a draft they cannot see is one they cannot publish. This screen shows
 * what it is given and says which is which.
 *
 * NO STORAGE REFERENCE REACHES THIS PAGE (ARC-041). Playing a lecture asks for
 * a short-lived, user-bound ticket; there is no link to a file anywhere in the
 * markup, which is what stops a student sharing one.
 */
export function CoursePage() {
  const { sectionSubjectId = "" } = useParams();
  const { hasRole } = useAuth();
  const [data, setData] = useState<CourseLectures | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Drive refusing to hand the files over — a setting there, not a fault here. */
  const [blocked, setBlocked] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get<CourseLectures>(`/section-subjects/${sectionSubjectId}/lectures`));
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }, [sectionSubjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncNow() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.post<{
        added: number;
        restored: number;
        missing: number;
        scanned: number;
        blocked: number;
      }>(`/section-subjects/${sectionSubjectId}/sync-lectures`);

      /*
       * Catalogued but unplayable, said here rather than discovered by a
       * student. A Drive folder can be perfectly readable while its files
       * cannot be downloaded — the sharing option that stops viewers
       * downloading. Every step succeeds, the cards appear, and playback is
       * refused the first time anybody presses play. It is one setting in
       * Drive, so it is worth interrupting for.
       */
      if (r.blocked > 0) {
        setError(null);
        setNote(null);
        setBlocked(
          `${r.blocked} of ${r.scanned} recordings cannot be played yet: Google Drive is refusing ` +
            `to hand over the files. In Drive, open this class's folder → Share → the settings ` +
            `gear, and allow viewers to download. Nothing here can work around it.`,
        );
        await load();
        return;
      }
      setBlocked(null);
      // The counts, not "done". An administrator who presses this needs to know
      // whether anything actually arrived.
      setNote(
        r.added === 0 && r.restored === 0 && r.missing === 0
          ? `Nothing new. ${r.scanned} recording${r.scanned === 1 ? "" : "s"} in the folder, all already here.`
          : [
              r.added > 0 && `${r.added} new recording${r.added === 1 ? "" : "s"} added as drafts`,
              r.restored > 0 && `${r.restored} came back`,
              r.missing > 0 && `${r.missing} no longer in the folder`,
            ]
              .filter(Boolean)
              .join(" · "),
      );
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  }

  async function publish(lecture: Lecture, status: "PUBLISHED" | "UNPUBLISHED") {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/recorded-lectures/${lecture.id}/publication`, { status });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <div className="alert alert-error" role="alert">
        <strong>Could not open this class</strong>
        <p>{error.message}</p>
      </div>
    );
  }
  if (!data) return <SkeletonCards count={3} />;

  const published = data.lectures.filter((l) => l.publicationStatus === "PUBLISHED");
  const drafts = data.lectures.filter((l) => l.publicationStatus !== "PUBLISHED");

  return (
    <>
      <header className="page-head course-head">
        <div className="course-identity">
          <CourseCover code={data.subject.code} name={data.subject.name} size="chip" />
          <div>
            <h1>{data.subject.name}</h1>
            <p className="muted small">
              {data.section.name} · {data.subject.code}
            </p>
          </div>
        </div>
        {data.canManage && (
          <div className="row-actions">
            <button className="btn" onClick={() => void syncNow()} disabled={busy}>
              {busy ? "Checking…" : "Check the folder"}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error.details?.map((d) => d.message).join(" ") ?? error.message}</p>
        </div>
      )}
      {note && (
        <div className="alert alert-ok" role="status">
          <p>{note}</p>
        </div>
      )}
      {blocked && (
        <div className="alert alert-warn" role="alert">
          <strong>The recordings are here, but Drive will not release them</strong>
          <p>{blocked}</p>
        </div>
      )}

      {/* Staff only, and it says where the recordings come from. Somebody
          wondering why nothing appears needs to see that no folder is set
          rather than concluding the feature is broken. */}
      {data.canManage && (
        <>
          <LectureSource
            sectionSubjectId={sectionSubjectId}
            folderRef={data.lectureFolderRef}
            storage={data.storage}
            onSaved={() => void load()}
            mayBrowseFolders={hasRole("super_admin", "admin")}
          />

          {/* FR-VID-002 — a recording that Google Meet did not make.
              Collapsed by default: the ordinary path is still a file appearing
              in the Drive folder on its own, and a permanently-open upload form
              would make the exception look like the rule. */}
          <div className="lecture-source">
            <div className="lecture-source-head">
              <Icon name="upload" />
              <span className="muted small">
                Have a recording on your own device? Add it here — a phone video, a screen
                capture, or anything Meet did not record for you.
              </span>
              <button
                className="btn btn-quiet btn-sm"
                onClick={() => setUploading((u) => !u)}
              >
                {uploading ? "Close" : "Upload a recording"}
              </button>
            </div>
            {uploading && (
              <LectureUpload
                sectionSubjectId={sectionSubjectId}
                onCancel={() => setUploading(false)}
                onDone={() => {
                  setUploading(false);
                  void load();
                }}
              />
            )}
          </div>
        </>
      )}

      {data.lectures.length === 0 ? (
        <EmptyState icon="play" title="No recordings yet">
          {data.canManage
            ? "When a recording is put in the folder, a card appears here."
            : "Your teacher has not published any recordings for this class yet."}
        </EmptyState>
      ) : (
        <>
          <div className="lecture-grid">
            {published.map((l) => (
              <LectureCard key={l.id} lecture={l} canManage={data.canManage}
                sectionSubjectId={sectionSubjectId}
                onPublish={(s) => void publish(l, s)} busy={busy} />
            ))}
          </div>

          {/* Drafts kept apart rather than mixed in with a badge. A teacher
              scanning for "what have I not published yet" should not have to
              read every card to find out. Students never receive these. */}
          {data.canManage && drafts.length > 0 && (
            <section className="draft-shelf">
              <h2>
                Not published yet
                <span className="muted small"> · {drafts.length} waiting</span>
              </h2>
              <p className="muted small">
                Students cannot see these. Check one and publish it when you are happy with it.
              </p>
              <div className="lecture-grid">
                {drafts.map((l) => (
                  <LectureCard key={l.id} lecture={l} canManage
                    sectionSubjectId={sectionSubjectId}
                    onPublish={(s) => void publish(l, s)} busy={busy} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

    </>
  );
}

/**
 * Where this class's recordings come from — and the field to change it.
 *
 * THE FOLDER ID HAD NO WAY IN. The endpoint existed; nothing on any screen
 * called it, so connecting a class to its Drive folder meant an API client or
 * a database update. Every class the Institute runs needs this set once, so
 * "no interface for it" meant the feature could not be turned on at all.
 *
 * IT STATES WHAT IS TRUE, WITHOUT SHOUTING. An earlier version of this said
 * "read from <folder>, checked every hour" whatever the state, which can be
 * flatly untrue — and the version after it said NOT LIVE in warning colours,
 * which read as though the recordings themselves were broken when they are
 * listed perfectly well below. Neither is right. Setup that is not finished is
 * not a fault; it is a step, and the step is on this panel.
 */
function LectureSource({
  sectionSubjectId,
  folderRef,
  storage,
  onSaved,
  /**
   * Whether this reader may see the FOLDER INDEX — every class folder the
   * Institute keeps, by name and id.
   *
   * Office only, and the server enforces it on `lecture_storage_index`. A
   * teacher may still connect a folder they have been GIVEN the id of, which
   * is what the text box below is for; they may not browse the list, because a
   * folder id is close to a bearer token for that folder's contents and with
   * one a teacher could point their class at another cohort's recordings.
   */
  mayBrowseFolders,
}: {
  sectionSubjectId: string;
  folderRef: string | null;
  storage?: { provider: string; live: boolean; mismatchedSources: string[] };
  onSaved: () => void;
  mayBrowseFolders: boolean;
}) {
  const [value, setValue] = useState(folderRef ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(folderRef === null);
  const [browsing, setBrowsing] = useState(false);

  const provider = storage?.provider ?? "local";
  const providerName = provider === "google_drive" ? "Google Drive" : "local storage";
  const driveNotConfigured = storage?.mismatchedSources.includes("google_drive") ?? false;

  async function save(explicit?: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      // The whole Drive URL is accepted and reduced to the id on the server —
      // pasting the address bar is what people actually do.
      const r = await api.put<{ lectureFolderRef: string | null }>(
        `/section-subjects/${sectionSubjectId}/lecture-folder`,
        { folderRef: (explicit ?? value).trim() },
      );
      setValue(r.lectureFolderRef ?? "");
      setSaved(
        r.lectureFolderRef
          ? "Folder saved. Press “Check the folder” to read it now."
          : "Folder disconnected.",
      );
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the folder.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lecture-source">
      <div className="lecture-source-head">
        <Icon name="folder" />
        {folderRef && storage?.live ? (
          <span className="muted small">
            Live from {providerName} — folder <code>{folderRef}</code>, checked every hour. Anything
            new arrives as a draft.
          </span>
        ) : folderRef ? (
          <span className="muted small">
            Folder <code>{folderRef}</code> is set, but lecture storage is currently{" "}
            <strong>{providerName}</strong>
            {driveNotConfigured
              ? " — so these Drive recordings will not play and nothing new will arrive until Drive is connected."
              : "."}
          </span>
        ) : (
          <span className="muted small">
            No folder connected yet, so nothing arrives on its own.
          </span>
        )}
        <button className="btn btn-quiet btn-sm" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : folderRef ? "Change folder" : "Connect a folder"}
        </button>
        {/* The list, for the people allowed to see it. This is the difference
            between "go to Drive, find it among a dozen similar names, copy the
            address bar, come back" and choosing it here. */}
        {mayBrowseFolders && (
          <button className="btn btn-quiet btn-sm" onClick={() => setBrowsing((b) => !b)}>
            {browsing ? "Hide folders" : "Browse folders"}
          </button>
        )}
      </div>

      {browsing && mayBrowseFolders && (
        <LectureFolderPicker
          currentRef={folderRef}
          onClose={() => setBrowsing(false)}
          onPick={(id) => {
            setValue(id);
            setBrowsing(false);
            // Saved straight away rather than dropped into the box for
            // somebody to press Save on. Choosing "use for this class" IS the
            // instruction; making it a two-step is how a class ends up
            // connected to nothing because the second step was missed.
            void save(id);
          }}
        />
      )}

      {open && (
        <div className="lecture-source-form">
          <label htmlFor="folder-ref">Google Drive folder for this class</label>
          <p className="muted small">
            Open the class’s folder in Drive and paste its address here — the whole link is fine.
            Share that folder with the System’s service account first, as Viewer, or it will read
            as empty.
          </p>
          <div className="row-actions">
            <input
              id="folder-ref"
              type="text"
              value={value}
              placeholder="https://drive.google.com/drive/folders/… or the id"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && void save()}
            />
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            {folderRef && (
              <button
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => {
                  setValue("");
                  void save();
                }}
              >
                Disconnect
              </button>
            )}
          </div>
          {saved && (
            <p className="ok small" role="status">
              {saved}
            </p>
          )}
          {error && (
            <p className="warn small" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LectureCard({
  lecture,
  sectionSubjectId,
  canManage,
  onPublish,
  busy,
}: {
  lecture: Lecture;
  sectionSubjectId: string;
  canManage: boolean;
  onPublish: (status: "PUBLISHED" | "UNPUBLISHED") => void;
  busy: boolean;
}) {
  // ARC-045 — a recording whose file has gone must say so rather than opening
  // a player that fails.
  const missing = lecture.availabilityStatus !== "AVAILABLE";
  const isDraft = lecture.publicationStatus !== "PUBLISHED";
  const watched = lecture.watch?.watchedPercent ?? 0;

  return (
    <article className={`lecture-card${missing ? " is-missing" : ""}`}>
      {/* A LINK, not a button opening a dialog. Watching a lecture is a place
          you go: it has its own address, so it can be bookmarked, opened in a
          new tab, and returned to with the back button — all of which a modal
          takes away, and all of which students expect from anything that plays
          video. */}
      {missing ? (
        <span className="lecture-face is-dead" aria-label={`${lecture.title} — unavailable`}>
          <LectureThumb title={lecture.title} durationSeconds={lecture.durationSeconds} />
          <span className="lecture-play">
            <Icon name="alert" />
          </span>
        </span>
      ) : (
        <Link
          className="lecture-face"
          to={`/courses/${sectionSubjectId}/watch/${lecture.id}`}
          aria-label={`Watch ${lecture.title}`}
        >
          <LectureThumb
            title={lecture.title}
            durationSeconds={lecture.durationSeconds}
            watchedPercent={watched}
          />
        </Link>
      )}

      <div className="lecture-body">
        <h3>
          {missing ? (
            lecture.title
          ) : (
            <Link to={`/courses/${sectionSubjectId}/watch/${lecture.id}`}>{lecture.title}</Link>
          )}
        </h3>
        <p className="muted small">
          {new Date(lecture.recordedOn).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
          {/* "Resume", where a student's eye already goes looking for it. */}
          {lecture.watch?.isComplete
            ? " · watched"
            : watched >= 2
              ? ` · ${Math.round(watched)}% watched`
              : ""}
        </p>

        <div className="lecture-tags">
          {/* Never colour alone — each state is a word (NFR-ACC-007). */}
          {isDraft && <span className="pill pill-warn">draft</span>}
          {missing && <span className="pill pill-warn">file missing</span>}
          {!lecture.lessonId && canManage && <span className="pill">not in a lesson</span>}
        </div>

        {canManage && (
          <div className="row-actions">
            {isDraft ? (
              <button
                className="btn btn-primary btn-sm"
                disabled={busy || missing}
                onClick={() => onPublish("PUBLISHED")}
                title={missing ? "The file is missing, so there is nothing to publish." : undefined}
              >
                Publish
              </button>
            ) : (
              <button className="btn btn-quiet btn-sm" disabled={busy} onClick={() => onPublish("UNPUBLISHED")}>
                Unpublish
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
