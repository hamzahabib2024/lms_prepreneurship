import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { CourseCover } from "../components/CourseCover";
import { EmptyState } from "../components/Ui";
import { Icon } from "../components/Icon";
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
  const [data, setData] = useState<CourseLectures | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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
      const r = await api.post<{ added: number; restored: number; missing: number; scanned: number }>(
        `/section-subjects/${sectionSubjectId}/sync-lectures`,
      );
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
  if (!data) return <p className="muted">Loading…</p>;

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

      {/* Staff only, and it says where the recordings come from. Somebody
          wondering why nothing appears needs to see that no folder is set
          rather than concluding the feature is broken. */}
      {data.canManage && (
        <div className="folder-note">
          <Icon name="database" />
          {!data.lectureFolderRef ? (
            <span className="warn small">
              No folder is connected, so nothing arrives on its own. Set one and recordings put in
              it will appear here.
            </span>
          ) : data.storage?.live ? (
            <span className="muted small">
              Live from{" "}
              {data.storage.provider === "google_drive" ? "Google Drive" : "local storage"} —
              folder <code>{data.lectureFolderRef}</code>, checked every hour. Anything new arrives
              as a draft.
            </span>
          ) : (
            /* THE SCREEN USED TO SAY "checked every hour" REGARDLESS, and that
               can be flatly untrue: these rows were catalogued from Drive while
               the System is configured for local storage, so the sweep looks
               for a local directory named after a Drive folder id, finds
               nothing, and no new recording ever appears. Silently. Saying so
               here is the difference between a fault somebody can fix and one
               they discover when a student complains. */
            <span className="warn small">
              <strong>Not live.</strong> These{" "}
              {data.storage?.mismatchedSources.includes("google_drive")
                ? "were catalogued from Google Drive"
                : "came from another store"}
              , but lecture storage is set to{" "}
              <code>{data.storage?.provider ?? "local"}</code>. Nothing new will arrive and these
              will not play until it is connected — see <code>INTEGRATIONS.md</code>, section 2.
            </span>
          )}
        </div>
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
