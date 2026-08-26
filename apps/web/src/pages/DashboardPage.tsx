import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { text } from "../api/text";
import { ApiError, api } from "../api/client";
import { ProgressRing, SkeletonCards } from "../components/Ui";
import { Icon } from "../components/Icon";
import { useAuth } from "../auth/AuthContext";

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
  myClasses: "Join a class",
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

/**
 * WHERE EACH CARD GOES — one table, read by the heading and by every row.
 *
 * THE DASHBOARD WAS A DEAD END. It is the first screen everybody sees and its
 * whole job is to say what needs doing: "8 waiting for review", "3 registers
 * not marked". Every one of those was a number and nothing more, so the answer
 * to "what do I do about it" was to read it, remember it, find the right entry
 * in the sidebar, and start again from a list that does not know why you came.
 * A figure that names an action and cannot reach it is a worse affordance than
 * no figure at all, because it looks finished.
 *
 * ROLE-AWARE, and that is not decoration either. A destination a student would
 * be refused is worse than no link: it turns a dashboard figure into a 403.
 * `roles` is a whitelist and an absent `roles` means everybody — the same
 * convention navigation.ts uses, deliberately, so there is one idea to learn.
 *
 * IT IS STILL NOT SECURITY (UI-002, ARC-003). Hiding a link stops the
 * interface offering something that would be refused; the server refuses it.
 */
interface Destination {
  to: string;
  roles?: readonly string[];
}

const OFFICE = ["super_admin", "admin"] as const;
const TEACHING = ["super_admin", "admin", "teacher"] as const;

/** Where a whole card leads, when it leads anywhere. */
const WIDGET_LINKS: Record<string, Destination> = {
  registrationQueue: { to: "/admissions", roles: OFFICE },
  instituteKpis: { to: "/reports", roles: OFFICE },
  acquisitionMix: { to: "/reports", roles: OFFICE },
  exceptions: { to: "/sections", roles: OFFICE },
  actionQueue: { to: "/marking", roles: TEACHING },
  mySections: { to: "/courses", roles: TEACHING },
  announcements: { to: "/announcements" },
  workDue: { to: "/subjects", roles: ["student"] },
  progress: { to: "/subjects", roles: ["student"] },
  attendance: { to: "/attendance", roles: ["student"] },
};

/**
 * Where an individual figure leads.
 *
 * More specific than the card's own link wherever the System can be more
 * specific — "waiting over 48 hours" opens the queue already filtered to
 * those, because arriving at an unfiltered list and re-finding them by eye is
 * the work the figure was supposed to save.
 */
const COUNTER_LINKS: Record<string, Destination> = {
  "registrationQueue.pending": { to: "/admissions", roles: OFFICE },
  "registrationQueue.overdue": { to: "/admissions?overdue=1", roles: OFFICE },
  "registrationQueue.decidedToday": { to: "/admissions", roles: OFFICE },
  "actionQueue.unmarkedRegisters": { to: "/attendance", roles: TEACHING },
  "actionQueue.ungradedSubmissions": { to: "/marking", roles: TEACHING },
  "actionQueue.quizzesAwaitingMarking": { to: "/marking", roles: TEACHING },
  "instituteKpis.activeStudents": { to: "/users?role=student", roles: OFFICE },
  "instituteKpis.activeTeachers": { to: "/users?role=teacher", roles: OFFICE },
  "instituteKpis.activeSections": { to: "/sections", roles: OFFICE },
  "instituteKpis.sectionsAtCapacity": { to: "/sections", roles: OFFICE },
  "exceptions.sections_without_teacher": { to: "/sections", roles: OFFICE },
  "exceptions.lectures_missing": { to: "/content", roles: TEACHING },
};

export function DashboardPage() {
  const { hasRole } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  /**
   * A destination, or null when this reader may not go there.
   *
   * One place decides, so no widget can quietly offer a link its reader would
   * be refused — which turns a dashboard figure into a 403 and is worse than
   * the number having stayed inert.
   */
  const may = useCallback(
    (d?: Destination): Destination | null => {
      if (!d) return null;
      if (!d.roles) return d;
      return hasRole(...d.roles) ? d : null;
    },
    [hasRole],
  );

  useEffect(() => {
    api
      .get<DashboardResponse>("/dashboards/me")
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e : null));
  }, []);

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
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
          <Widget key={key} name={key} value={value} may={may} />
        ))}
      </div>
    </>
  );
}

function Widget({
  name,
  value,
  may,
}: {
  name: string;
  value: unknown;
  may: (d?: Destination) => Destination | null;
}) {
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

  const link = may(WIDGET_LINKS[name]);

  return (
    <section className={link ? "card widget widget-linked" : "card widget"}>
      {/*
        THE HEADING IS THE LINK, not the whole card.

        A card-sized click target sounds friendlier and is worse: this card
        contains its own links, and a person aiming at "waiting over 48 hours"
        who misses by four pixels lands somewhere else entirely. Nested
        interactive elements are also invalid — an anchor inside an anchor —
        and screen readers announce the outer one over everything inside it.
      */}
      <h2>
        {link ? (
          <Link to={link.to} className="widget-title-link">
            {title}
            <Icon name="chevron-right" />
          </Link>
        ) : (
          title
        )}
      </h2>
      <WidgetBody name={name} v={v} may={may} />
    </section>
  );
}

function WidgetBody({
  name,
  v,
  may,
}: {
  name: string;
  v: Record<string, unknown>;
  may: (d?: Destination) => Destination | null;
}) {
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
          {/*
            A LINK, and it used to be a button that did nothing at all — no
            click handler, no destination. A student could see that their
            class existed and had no way into it from here.

            It goes to the class page rather than straight to the meeting,
            because joining has to record attendance and the page is what
            does that. Sending them to the video directly would mark nobody
            present.
          */}
          <div className="row-actions">
            {v["joinWindowOpen"] ? (
              <Link className="btn btn-primary" to={`/classes/${String(v["sessionId"])}`}>
                Join class
              </Link>
            ) : (
              <Link className="btn" to={`/classes/${String(v["sessionId"])}`}>
                See the class
              </Link>
            )}
            {/*
              THE ROOM ITSELF — FR-LIV.

              Beside the class page, not instead of it. The page is what
              records attendance, so it stays the primary way in; but a
              student whose class starts in ninety seconds and whose teacher
              takes the register by hand needs the door, and being sent to a
              page that then sends them onward is one click of nothing.

              Only rendered where a room exists. Most classes taught in a
              building have none, and a dead button is worse than no button.
            */}
            {typeof v["meetingUrl"] === "string" && v["meetingUrl"] && (
              <a
                className={v["joinWindowOpen"] ? "btn" : "btn btn-primary"}
                href={String(v["meetingUrl"])}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open the meeting
              </a>
            )}
          </div>
          {typeof v["meetingNote"] === "string" && v["meetingNote"] && (
            <p className="muted small">{String(v["meetingNote"])}</p>
          )}
          {/* FR-LIV-019 — surfaced before the class, not during it. Silent
              where the Institute uses its own standing room instead, because
              then there is no provider link to be waiting for. */}
          {!v["linkReady"] && !v["meetingUrl"] && (
            <p className="muted small">The class link is not ready yet.</p>
          )}
        </>
      );
    }

    /*
      EVERY CLASS THE STUDENT CAN WALK INTO — FR-LIV.

      "Next class" answers what is on now. This answers the question a student
      actually opens the dashboard with on a Tuesday afternoon: which of my
      classes can I get into, and where is the link. One row per class, with
      the room's own note under it where the teacher wrote one.
    */
    case "myClasses": {
      const classes = (v["classes"] ?? []) as Array<{
        sectionSubjectId: string;
        subject: { code: string; name: string };
        section: { code: string; name: string };
        meetingUrl: string;
        meetingNote: string | null;
      }>;
      if (classes.length === 0) return <p className="muted">{emptyMessage ?? "Nothing to join."}</p>;
      return (
        <ul className="list join-list">
          {classes.map((c) => (
            <li key={c.sectionSubjectId}>
              <span className="join-list-what">
                <Link to={`/subjects/${c.sectionSubjectId}`}>{c.subject.name}</Link>
                {c.meetingNote && <span className="muted small">{c.meetingNote}</span>}
              </span>
              <a
                className="btn btn-primary btn-sm"
                href={c.meetingUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                Join
              </a>
            </li>
          ))}
        </ul>
      );
    }

    case "actionQueue": {
      const total = Number(v["total"] ?? 0);
      if (total === 0) return <p className="muted">{emptyMessage ?? "You are up to date."}</p>;
      return (
        <ul className="list">
          <Counter
            n={v["unmarkedRegisters"]}
            label="registers not marked"
            to={may(COUNTER_LINKS["actionQueue.unmarkedRegisters"])}
          />
          <Counter
            n={v["ungradedSubmissions"]}
            label="submissions to grade"
            to={may(COUNTER_LINKS["actionQueue.ungradedSubmissions"])}
          />
          <Counter
            n={v["quizzesAwaitingMarking"]}
            label="quiz answers to mark"
            to={may(COUNTER_LINKS["actionQueue.quizzesAwaitingMarking"])}
          />
        </ul>
      );
    }

    case "registrationQueue":
      return (
        <ul className="list">
          <Counter
            n={v["pending"]}
            label="waiting for review"
            to={may(COUNTER_LINKS["registrationQueue.pending"])}
          />
          {/* FR-REG-038 — an application nobody has looked at for two days.
              It opens the queue ALREADY FILTERED to them: arriving at the
              whole list and finding them again by eye is the work this figure
              exists to save. */}
          <Counter
            n={v["overdue"]}
            label="waiting over 48 hours"
            warn
            to={may(COUNTER_LINKS["registrationQueue.overdue"])}
          />
          <Counter
            n={v["decidedToday"]}
            label="decided today"
            to={may(COUNTER_LINKS["registrationQueue.decidedToday"])}
          />
        </ul>
      );

    case "instituteKpis":
      return (
        <ul className="list">
          <Counter
            n={v["activeStudents"]}
            label="students"
            to={may(COUNTER_LINKS["instituteKpis.activeStudents"])}
          />
          <Counter
            n={v["activeTeachers"]}
            label="teachers"
            to={may(COUNTER_LINKS["instituteKpis.activeTeachers"])}
          />
          <Counter
            n={v["activeSections"]}
            label="active batches"
            to={may(COUNTER_LINKS["instituteKpis.activeSections"])}
          />
          <Counter
            n={v["sectionsAtCapacity"]}
            label="batches full"
            warn
            to={may(COUNTER_LINKS["instituteKpis.sectionsAtCapacity"])}
          />
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
          {items.map((i) => {
            const to = may(COUNTER_LINKS[`exceptions.${i.key}`]);
            return (
              <li key={i.key} className={i.severity === "high" ? "warn" : ""}>
                {to ? (
                  <Link className="row-link" to={to.to}>
                    {i.message}
                    <Icon name="chevron-right" />
                  </Link>
                ) : (
                  i.message
                )}
              </li>
            );
          })}
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
        return (
          <p className="muted">
            No subject-sections are assigned to you yet. An administrator assigns these
            when the timetable is set.
          </p>
        );
      }
      return (
        <ul className="list">
          {sections.map((s) => (
            <li key={s.sectionSubjectId}>
              {/* Straight to that class, which is the only reason anybody
                  reads this list. */}
              <Link className="row-link" to={`/courses/${s.sectionSubjectId}`}>
                <span>
                  {s.subject.name} <span className="muted small">{s.section.code}</span>
                </span>
                <strong>{s.enrolled}</strong>
              </Link>
            </li>
          ))}
        </ul>
      );
    }

    case "attendance": {
      const overall = v["overall"] as { percentage: number | null } | undefined;
      if (!overall || overall.percentage === null) {
        return (
          <p className="muted">
            No attendance recorded yet — this fills in after your first class.
          </p>
        );
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

/**
 * One figure, and the way to act on it.
 *
 * NOT A LINK WHEN THERE IS NOTHING TO DO. Zero submissions to grade is a
 * finished job, and offering a route to an empty list dressed as an action
 * makes the dashboard cry wolf — the reader learns to ignore the affordance,
 * which is the one thing it cannot afford. So the number still shows and the
 * link does not appear.
 */
function Counter({
  n,
  label,
  warn,
  to,
}: {
  n: unknown;
  label: string;
  warn?: boolean;
  to?: Destination | null;
}) {
  const value = Number(n ?? 0);
  if (value === 0 && warn) return null; // do not shout about zero problems

  const body = (
    <>
      <strong className={warn && value > 0 ? "warn" : ""}>{value}</strong>
      <span className="muted">{label}</span>
    </>
  );

  if (!to || value === 0) {
    return <li className="counter-row">{body}</li>;
  }

  return (
    <li className="counter-row">
      {/*
        The whole row is the target, not just the number. A four-character
        figure is a small thing to hit on a phone, and the label is what the
        reader is actually looking at when they decide to act on it.
      */}
      <Link className="row-link" to={to.to}>
        {body}
        <Icon name="chevron-right" />
      </Link>
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
