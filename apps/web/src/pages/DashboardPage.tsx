import { useEffect, useState } from "react";
import { text } from "../api/text";
import { ApiError, api } from "../api/client";
import { ProgressRing, SkeletonCards } from "../components/Ui";

/**
 * The dashboard — SRS §5.18, §13.3, §13.4.
 *
 * The server decides which widgets this user gets (FR-DSH-002), so the screen
 * renders whatever it is given rather than branching on role. That keeps the
 * authorisation decision in one place: a client that chose its own widgets
 * would be a second, weaker copy of the permission matrix.
 *
 * FR-DSH-010 — a widget that failed server-side arrives as
 * `{ unavailable: true }`. It is rendered as an unavailable panel rather than
 * omitted, because a silently missing panel looks like data that does not
 * exist.
 */

interface DashboardResponse {
  role: string;
  generatedAt: string;
  widgets: Record<string, unknown>;
}

const WIDGET_TITLES: Record<string, string> = {
  nextClass: "Next class",
  workDue: "Due soon",
  progress: "My progress",
  attendance: "My attendance",
  announcements: "Announcements",
  actionQueue: "Needs your attention",
  mySections: "My subject-sections",
  registrationQueue: "Registrations",
  instituteKpis: "Institute",
  acquisitionMix: "Where students come from",
  exceptions: "Exceptions",
};

export function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .get<DashboardResponse>("/dashboards/me")
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e : null));
  }, []);

  if (error) {
    return (
      <div className="alert alert-error">
        <strong>Could not load your dashboard</strong>
        <p>{error.message}</p>
      </div>
    );
  }

  if (!data) return <SkeletonCards count={4} />;

  /**
   * The hour decides the greeting, and the greeting is the point.
   *
   * "Dashboard" is a word about the software. A person opening this at nine in
   * the morning is opening their day, and naming it as such costs one line and
   * makes the screen feel like it was built for them rather than for a demo.
   */
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{greeting}</h1>
          <p className="muted small">{today}</p>
        </div>
        {/* ARC-048 — anything that may be stale carries when it was computed. */}
        <span className="pill">
          as at {new Date(data.generatedAt).toLocaleTimeString()}
        </span>
      </header>

      <div className="grid">
        {Object.entries(data.widgets).map(([key, value]) => (
          <Widget key={key} name={key} value={value} />
        ))}
      </div>
    </>
  );
}

function Widget({ name, value }: { name: string; value: unknown }) {
  const title = WIDGET_TITLES[name] ?? name;
  const v = (value ?? {}) as Record<string, unknown>;

  if (v["unavailable"]) {
    return (
      <section className="card widget widget-unavailable">
        <h2>{title}</h2>
        <p className="muted">{text(v["message"], "Temporarily unavailable.")}</p>
      </section>
    );
  }

  return (
    <section className="card widget">
      <h2>{title}</h2>
      <WidgetBody name={name} v={v} />
    </section>
  );
}

function WidgetBody({ name, v }: { name: string; v: Record<string, unknown> }) {
  // NFR-USE-009 — every widget states why it is empty rather than showing
  // nothing at all.
  const emptyMessage = typeof v["message"] === "string" ? (v["message"] as string) : null;

  switch (name) {
    case "nextClass": {
      if (!v["hasNext"]) return <p className="muted">{emptyMessage ?? "Nothing scheduled."}</p>;
      const subject = v["subject"] as { name?: string } | undefined;
      const startsIn = Number(v["startsInSeconds"] ?? 0);
      return (
        <>
          <p className="stat">{subject?.name ?? String(v["title"])}</p>
          <p className="muted">
            {new Date(String(v["scheduledStart"])).toLocaleString()} · starts in{" "}
            {formatDuration(startsIn)}
          </p>
          <button className="btn btn-primary" disabled={!v["joinWindowOpen"]}>
            {v["joinWindowOpen"] ? "Join class" : "Join opens shortly"}
          </button>
          {/* FR-LIV-019 — surfaced before the class, not during it. */}
          {!v["linkReady"] && <p className="muted small">The class link is not ready yet.</p>}
        </>
      );
    }

    case "actionQueue": {
      const total = Number(v["total"] ?? 0);
      if (total === 0) return <p className="muted">{emptyMessage ?? "You are up to date."}</p>;
      return (
        <ul className="list">
          <Counter n={v["unmarkedRegisters"]} label="registers not marked" />
          <Counter n={v["ungradedSubmissions"]} label="submissions to grade" />
          <Counter n={v["quizzesAwaitingMarking"]} label="quiz answers to mark" />
        </ul>
      );
    }

    case "registrationQueue":
      return (
        <ul className="list">
          <Counter n={v["pending"]} label="waiting for review" />
          {/* FR-REG-038 — an application nobody has looked at for two days. */}
          <Counter n={v["overdue"]} label="waiting over 48 hours" warn />
          <Counter n={v["decidedToday"]} label="decided today" />
        </ul>
      );

    case "instituteKpis":
      return (
        <ul className="list">
          <Counter n={v["activeStudents"]} label="students" />
          <Counter n={v["activeTeachers"]} label="teachers" />
          <Counter n={v["activeSections"]} label="active sections" />
          <Counter n={v["sectionsAtCapacity"]} label="sections full" warn />
        </ul>
      );

    case "acquisitionMix": {
      const sources = (v["sources"] ?? []) as Array<{ source: string; count: number; percent: number }>;
      if (sources.length === 0) return <p className="muted">{emptyMessage ?? "No data yet."}</p>;
      return (
        <ul className="list">
          {sources.map((s) => (
            <li key={s.source}>
              <span>{s.source.replace(/_/g, " ").toLowerCase()}</span>
              <strong>
                {s.count} <span className="muted small">({s.percent}%)</span>
              </strong>
            </li>
          ))}
        </ul>
      );
    }

    case "exceptions": {
      const items = (v["items"] ?? []) as Array<{ key: string; message: string; severity: string }>;
      if (items.length === 0) return <p className="muted">{emptyMessage ?? "Nothing to action."}</p>;
      return (
        <ul className="list">
          {items.map((i) => (
            <li key={i.key} className={i.severity === "high" ? "warn" : ""}>
              {i.message}
            </li>
          ))}
        </ul>
      );
    }

    case "mySections": {
      const sections = (v as unknown as Array<{
        sectionSubjectId: string;
        subject: { code: string; name: string };
        section: { code: string };
        enrolled: number;
      }>);
      if (!Array.isArray(sections) || sections.length === 0) {
        return <p className="muted">No subject-sections assigned to you.</p>;
      }
      return (
        <ul className="list">
          {sections.map((s) => (
            <li key={s.sectionSubjectId}>
              <span>
                {s.subject.name} <span className="muted small">{s.section.code}</span>
              </span>
              <strong>{s.enrolled}</strong>
            </li>
          ))}
        </ul>
      );
    }

    case "attendance": {
      const overall = v["overall"] as { percentage: number | null } | undefined;
      if (!overall || overall.percentage === null) {
        return <p className="muted">No attendance recorded yet.</p>;
      }
      const below = Boolean(v["isBelowThreshold"]);
      return (
        <div className="subject-top">
          <div className={below ? "ring" : "ring is-met"}>
            <ProgressRing
              percent={overall.percentage}
              label={`Attendance ${overall.percentage}%`}
            />
          </div>
          <div className="subject-title">
            {/* FR-ATT-021 — the warning states the REQUIREMENT, not just a
                colour, and says what to do about it. */}
            {below ? (
              <>
                <span className="pill pill-warn">Below {String(v["threshold"])}%</span>
                <p className="muted small">
                  This is below the level required to complete the subject. Speak to your teacher
                  about catching up.
                </p>
              </>
            ) : (
              <>
                <span className="pill pill-ok">Meeting the requirement</span>
                <p className="muted small">at least {String(v["threshold"])}% is required</p>
              </>
            )}
          </div>
        </div>
      );
    }

    case "progress": {
      const percent = Number(v["overallPercent"] ?? 0);
      const subjects = Number(v["subjectCount"] ?? 0);
      return (
        <div className="subject-top">
          <ProgressRing percent={percent} label={`Overall progress ${percent}%`} />
          <div className="subject-title">
            <p className="muted small">
              across {subjects} {subjects === 1 ? "subject" : "subjects"}
            </p>
            {/* The bar is gone. Two renderings of one number is one more than
                anybody reads, and the ring already carries it. */}
          </div>
        </div>
      );
    }

    case "workDue": {
      const items = (v["items"] ?? []) as Array<{
        id: string;
        kind: string;
        title: string;
        dueAt: string;
        submitted: boolean;
      }>;
      if (items.length === 0) return <p className="muted">{emptyMessage ?? "Nothing due."}</p>;
      return (
        <ul className="list">
          {items.map((i) => (
            <li key={i.id} className={i.submitted ? "done" : ""}>
              <span>
                {i.title} <span className="muted small">{i.kind}</span>
              </span>
              <span className="muted small">{new Date(i.dueAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      );
    }

    default:
      return <p className="muted">{emptyMessage ?? "Nothing to show."}</p>;
  }
}

function Counter({ n, label, warn }: { n: unknown; label: string; warn?: boolean }) {
  const value = Number(n ?? 0);
  if (value === 0 && warn) return null; // do not shout about zero problems
  return (
    <li className="counter-row">
      <strong className={warn && value > 0 ? "warn" : ""}>{value}</strong>
      <span className="muted">{label}</span>
    </li>
  );
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)} days`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m} minutes`;
}
