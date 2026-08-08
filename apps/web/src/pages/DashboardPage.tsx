import { useEffect, useState } from "react";
import { ApiError, api } from "../api/client";

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

  if (!data) return <p className="muted">Loading…</p>;

  return (
    <>
      <header className="page-head">
        <h1>Dashboard</h1>
        {/* ARC-048 — anything that may be stale carries when it was computed. */}
        <span className="muted small">
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
        <p className="muted">{String(v["message"] ?? "Temporarily unavailable.")}</p>
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
        <>
          <p className={`stat ${below ? "warn" : ""}`}>{overall.percentage}%</p>
          {/* FR-ATT-021 — the warning states the requirement, not just a colour. */}
          {below && (
            <p className="warn small">
              Below the {String(v["threshold"])}% required. Speak to your teacher.
            </p>
          )}
        </>
      );
    }

    case "progress": {
      const percent = Number(v["overallPercent"] ?? 0);
      return (
        <>
          <p className="stat">{percent}%</p>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
          <p className="muted small">{String(v["subjectCount"] ?? 0)} subjects</p>
        </>
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
    <li className={warn && value > 0 ? "warn" : ""}>
      <span>{label}</span>
      <strong>{value}</strong>
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
