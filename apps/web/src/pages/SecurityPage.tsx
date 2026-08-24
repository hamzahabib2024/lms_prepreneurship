import { useCallback, useEffect, useState } from "react";
import { EmptyState, Skeleton } from "../components/Ui";
import { ApiError, api } from "../api/client";
import { HowItWorks } from "../components/HowItWorks";

/**
 * The security log — SRS §13.8, FR-LOG-020..026.
 *
 * THE SCREEN LEADS WITH THE JUDGEMENT, NOT THE ROWS. The development database
 * holds 674 events, 664 of which are people signing in successfully. A table
 * newest-first is a wall of ordinary logins with the handful that matter buried
 * inside it, and nobody reads that twice.
 *
 * So: concerns first, each saying what happened and what to do; then the counts;
 * then the events, for when somebody is investigating something specific.
 *
 * When there is nothing wrong it says so in words. An empty table is ambiguous
 * between quiet and broken, and this is a screen people open precisely when
 * they are worried.
 */

interface Concern {
  kind: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  headline: string;
  advice: string;
  count: number;
  subject: string | null;
  subjectKind: "account" | "address" | null;
  subjectName: string | null;
}

interface Overview {
  windowHours: number;
  message: string;
  tally: {
    total: number;
    signIns: number;
    failures: number;
    lockouts: number;
    tokenReuse: number;
    passwordChanges: number;
    stepUpFailures: number;
  };
  concerns: Concern[];
}

interface SecurityEvent {
  id: string;
  occurredAt: string;
  eventType: string;
  outcome: string;
  who: string | null;
  email: string | null;
  ipAddress: string | null;
  detail: unknown;
}

const WINDOWS = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
];

export function SecurityPage() {
  const [hours, setHours] = useState(24);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<SecurityEvent[] | null>(null);
  const [types, setTypes] = useState<Array<{ eventType: string; count: number }>>([]);
  const [filter, setFilter] = useState({ eventType: "", email: "", ipAddress: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Overview>(`/admin/security?hours=${hours}`)
      .then(setOverview)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not read the log."));
  }, [hours]);

  useEffect(() => {
    api
      .get<Array<{ eventType: string; count: number }>>("/admin/security/event-types")
      .then(setTypes)
      .catch(() => setTypes([]));
  }, []);

  const loadEvents = useCallback(() => {
    const params = new URLSearchParams();
    if (filter.eventType) params.set("eventType", filter.eventType);
    if (filter.email) params.set("email", filter.email);
    if (filter.ipAddress) params.set("ipAddress", filter.ipAddress);
    api
      .list<SecurityEvent>(`/admin/security/events?${params.toString()}`)
      .then((r) => setEvents(r.data))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not read the events."));
  }, [filter]);

  useEffect(loadEvents, [loadEvents]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Security</h1>
          <p className="muted small">
            Sign-ins, failures, lockouts and replayed tokens. Super Admin only.
          </p>
        </div>
        <span className="row-actions">
          {WINDOWS.map((w) => (
            <button
              key={w.hours}
              className={hours === w.hours ? "btn btn-primary" : "btn btn-quiet"}
              onClick={() => setHours(w.hours)}
            >
              {w.label}
            </button>
          ))}
        </span>
      </header>

      <HowItWorks
        id="security"
        title="Sign-ins and lockouts"
        intro="Failed sign-ins, locked accounts and anything that looks like somebody trying to get in."
        steps={[
          { icon: "shield", title: "Look at what is flagged", body: "Repeated failures from one place, or one account being tried over and over." },
          { icon: "users", title: "Check the account", body: "Usually somebody has forgotten their password. Occasionally it is not." },
          { icon: "key", title: "Unlock or reset", body: "A lockout clears itself with time; you can also lift it." },
          { icon: "clock", title: "End sessions if needed", body: "Signs a person out everywhere, on every device, at once." },
        ]}
        note="Most of what appears here is people mistyping their own password. Look for a pattern — many accounts from one place, or one account from many — before assuming an attack."
      />

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {!overview ? (
        <Skeleton lines={2} />
      ) : (
        <>
          {/* The judgement, before anything else. */}
          {overview.concerns.length === 0 ? (
            <section className="card">
              <p>{overview.message}</p>
              <p className="muted small">
                {overview.tally.signIns} successful sign-ins and {overview.tally.failures} failures
                in this window.
              </p>
            </section>
          ) : (
            <section className="card">
              <h2>{overview.message}</h2>
              <ul className="list">
                {overview.concerns.map((c, i) => (
                  <li key={`${c.kind}-${c.subject ?? i}`} className="assignment">
                    <div className="assignment-head">
                      <span>
                        <strong>{c.headline}</strong>
                        {c.subjectName && c.subjectName !== c.subject && (
                          <>
                            <br />
                            <span className="muted small">{c.subjectName}</span>
                          </>
                        )}
                      </span>
                      <span className={severityClass(c.severity)}>{c.severity.toLowerCase()}</span>
                    </div>
                    {/* What to DO. A concern without an action is an alarm. */}
                    <p className="muted small">{c.advice}</p>
                    {c.subject && (
                      <button
                        className="link-button"
                        onClick={() =>
                          setFilter({
                            eventType: "",
                            email: c.subjectKind === "account" ? c.subject! : "",
                            ipAddress: c.subjectKind === "address" ? c.subject! : "",
                          })
                        }
                      >
                        Show these events
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <div className="facts">
              <Stat label="sign-ins" value={overview.tally.signIns} />
              <Stat label="failures" value={overview.tally.failures} />
              <Stat label="lockouts" value={overview.tally.lockouts} />
              <Stat label="token reuse" value={overview.tally.tokenReuse} warn />
              <Stat label="password changes" value={overview.tally.passwordChanges} />
              <Stat label="step-up refused" value={overview.tally.stepUpFailures} />
            </div>
          </section>
        </>
      )}

      <section className="card">
        <h2>Events</h2>
        <div className="field-row">
          <label className="field">
            <span>Kind</span>
            <select
              value={filter.eventType}
              onChange={(e) => setFilter({ ...filter, eventType: e.target.value })}
            >
              <option value="">Everything</option>
              {types.map((t) => (
                <option key={t.eventType} value={t.eventType}>
                  {t.eventType} ({t.count})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Email</span>
            <input
              value={filter.email}
              onChange={(e) => setFilter({ ...filter, email: e.target.value })}
              placeholder="Part of an address"
            />
          </label>
          <label className="field">
            <span>From address</span>
            <input
              value={filter.ipAddress}
              onChange={(e) => setFilter({ ...filter, ipAddress: e.target.value })}
              placeholder="203.0.113."
            />
          </label>
        </div>

        {!events ? (
          <Skeleton lines={2} />
        ) : events.length === 0 ? (
          <EmptyState icon="shield" title="No events match those filters">
            Which is usually the right answer — it means nothing of this kind has happened
            in the window you asked about. Widen the range to be certain.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th className="when">When</th>
                  <th>What</th>
                  <th>Who</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    {/* Fixed width and lining figures, so the column stops
                        resizing as the data changes and the rows line up. */}
                    <td className="when small">{new Date(e.occurredAt).toLocaleString()}</td>
                    <td className={e.eventType.includes("failed") ? "warn" : undefined}>
                      {e.eventType}
                    </td>
                    <td className="small">
                      {/* An email on a failed sign-in may belong to NO account
                          — somebody guessing addresses — so it is never
                          labelled as a person. */}
                      {e.who ?? (e.email ? `tried ${e.email}` : "—")}
                    </td>
                    <td className="small">{e.ipAddress ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <span className="stat">
      <strong className={warn && value > 0 ? "warn" : undefined}>{value}</strong> {label}
    </span>
  );
}

function severityClass(severity: Concern["severity"]): string {
  return severity === "CRITICAL" || severity === "HIGH" ? "pill pill-warn" : "pill";
}
