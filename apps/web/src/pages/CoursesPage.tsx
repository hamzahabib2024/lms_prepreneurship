import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { CourseCover } from "../components/CourseCover";
import { EmptyState, SkeletonCards } from "../components/Ui";
import { Icon } from "../components/Icon";
import { HowItWorks } from "../components/HowItWorks";

interface Course {
  id: string;
  subject: { id: string; code: string; name: string };
  section: { id: string; code: string; name: string; status: string; session: string | null };
  teachers: string[];
  publishedCount: number;
  draftCount: number;
  folderConnected: boolean;
  lectureFolderRef: string | null;
  latestRecordingOn: string | null;
  canManage: boolean;
}

/**
 * Every class, in one place — the screen that was missing.
 *
 * THE COURSE PAGE HAD NO WAY IN. It was reachable by knowing a UUID, or by
 * opening Sections and drilling term → batch → section → a "Recordings" link on
 * one row. A student had "My subjects"; staff had a page and no route to it, so
 * for an administrator the entire recordings feature was invisible.
 *
 * WHAT AN ADMINISTRATOR ACTUALLY NEEDS HERE is not a prettier list of subjects.
 * It is the two facts that are invisible everywhere else and that between them
 * explain almost every "last Tuesday's class isn't there":
 *
 *   WHICH CLASSES HAVE NO FOLDER CONNECTED. Nothing arrives on its own for
 *   those, ever, and nobody finds out until a student asks.
 *
 *   WHICH HAVE RECORDINGS WAITING. A draft is a recording that exists, that
 *   the students cannot see, and that somebody has forgotten to publish.
 *
 * Both are counted on the server and shown first, before the decoration.
 *
 * WHO SEES WHAT IS THE SCOPE PREDICATE'S DECISION, not this page's. An
 * administrator gets the Institute, a teacher their own classes, a student
 * their enrolments. There is no role test here.
 */
export function CoursesPage() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "waiting" | "unconnected">("all");

  useEffect(() => {
    api
      .get<Course[]>("/courses")
      .then(setCourses)
      .catch((e) => setError(e instanceof ApiError ? e : null));
  }, []);

  const shown = useMemo(() => {
    if (!courses) return [];
    const q = query.trim().toLowerCase();
    return courses.filter((c) => {
      if (filter === "waiting" && c.draftCount === 0) return false;
      if (filter === "unconnected" && c.folderConnected) return false;
      if (!q) return true;
      return (
        c.subject.name.toLowerCase().includes(q) ||
        c.subject.code.toLowerCase().includes(q) ||
        c.section.name.toLowerCase().includes(q) ||
        c.section.code.toLowerCase().includes(q) ||
        c.teachers.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [courses, query, filter]);

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <strong>Could not load the classes</strong>
        <p>{error.message}</p>
      </div>
    );
  }
  if (!courses) return <SkeletonCards count={6} />;

  const canManage = courses.some((c) => c.canManage);
  const waiting = courses.reduce((n, c) => n + c.draftCount, 0);
  const unconnected = courses.filter((c) => !c.folderConnected).length;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Courses</h1>
          <p className="muted small">
            {courses.length} class{courses.length === 1 ? "" : "es"} · recordings, published and
            waiting
          </p>
        </div>
      </header>

      <HowItWorks
        id="courses-recordings"
        title="Your classes and their recordings"
        intro="Every class you teach, and what is waiting to be dealt with in each."
        steps={[
          { icon: "folder", title: "Connect a Drive folder", body: "Point the class at the folder its recordings land in. Do this once." },
          { icon: "shuffle", title: "Recordings appear by themselves", body: "Anything put in that folder is picked up and listed here — you do not upload it twice." },
          { icon: "play", title: "Check it plays", body: "Open one before the class does. A recording that will not play is better found by you." },
          { icon: "check", title: "Publish the ones to keep", body: "New recordings arrive unpublished. Students see them when you say so." },
        ]}
        note="Changing a class's folder clears the recordings from the old one and pulls in the new folder's. Nothing is destroyed — point it back and they return."
      />

      {/* The two facts worth acting on, as buttons rather than as text —
          reading "3 classes have no folder" and then having to find them is
          most of the work. Only for staff: neither number means anything to a
          student, and one of them is about their own teacher. */}
      {canManage && (courses.length > 0) && (
        <div className="course-summary">
          <button
            className={`course-stat${filter === "all" ? " is-on" : ""}`}
            onClick={() => setFilter("all")}
            aria-pressed={filter === "all"}
          >
            <span className="course-stat-n">{courses.length}</span>
            <span className="muted small">all classes</span>
          </button>
          <button
            className={`course-stat${filter === "waiting" ? " is-on" : ""}${waiting > 0 ? " is-warn" : ""}`}
            onClick={() => setFilter(filter === "waiting" ? "all" : "waiting")}
            aria-pressed={filter === "waiting"}
            disabled={waiting === 0}
          >
            <span className="course-stat-n">{waiting}</span>
            <span className="muted small">recordings not published</span>
          </button>
          <button
            className={`course-stat${filter === "unconnected" ? " is-on" : ""}${unconnected > 0 ? " is-warn" : ""}`}
            onClick={() => setFilter(filter === "unconnected" ? "all" : "unconnected")}
            aria-pressed={filter === "unconnected"}
            disabled={unconnected === 0}
          >
            <span className="course-stat-n">{unconnected}</span>
            <span className="muted small">no folder connected</span>
          </button>
        </div>
      )}

      {courses.length > 6 && (
        <div className="course-search">
          <label className="visually-hidden" htmlFor="course-q">
            Search classes
          </label>
          <input
            id="course-q"
            type="search"
            placeholder="Subject, section or teacher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {courses.length === 0 ? (
        <EmptyState icon="book" title="No classes yet">
          {canManage
            ? "Once a section has subjects on it, each one appears here as a class."
            : "You are not enrolled on any classes yet."}
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon="book" title="Nothing matches">
          Try a different search, or choose “all classes” above.
        </EmptyState>
      ) : (
        <div className="course-grid">
          {shown.map((c) => (
            <CourseTile key={c.id} course={c} />
          ))}
        </div>
      )}
    </>
  );
}

function CourseTile({ course: c }: { course: Course }) {
  const total = c.publishedCount + c.draftCount;

  return (
    <Link className="course-tile" to={`/courses/${c.id}`}>
      <CourseCover code={c.subject.code} name={c.subject.name} />

      <div className="course-tile-body">
        <h2>{c.subject.name}</h2>
        <p className="muted small">
          {c.section.name}
          {c.section.session ? ` · ${c.section.session}` : ""}
        </p>

        {c.teachers.length > 0 && (
          <p className="muted small course-tile-who">
            <Icon name="users" />
            {c.teachers.join(", ")}
          </p>
        )}

        <div className="course-tile-facts">
          {/* The count students can see, first, because it is the one that
              answers "is there anything here". */}
          <span className={c.publishedCount > 0 ? "pill pill-ok" : "pill"}>
            {c.publishedCount} published
          </span>

          {/* Staff-only, and worded as an action rather than a status: these
              are recordings that exist and that nobody can watch. */}
          {c.canManage && c.draftCount > 0 && (
            <span className="pill pill-warn">{c.draftCount} to publish</span>
          )}

          {/* THE ONE THAT MATTERS MOST, and the reason this page exists. A
              class with no folder receives nothing, ever, and says so nowhere
              else. Never shown to a student — they cannot act on it, and it
              reads as their teacher's failing. */}
          {c.canManage && !c.folderConnected && (
            <span className="pill pill-warn">
              <Icon name="folder" /> no folder
            </span>
          )}
        </div>

        <p className="muted small course-tile-when">
          {c.latestRecordingOn
            ? `Last recorded ${new Date(c.latestRecordingOn).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}`
            : total === 0
              ? "Nothing recorded yet"
              : "No date on record"}
        </p>
      </div>
    </Link>
  );
}
