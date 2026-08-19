import { useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, SkeletonTable } from "../components/Ui";

interface Status {
  key: string;
  name: string;
  dependency: string | null;
  mode: "LIVE" | "SIMULATED" | "NOT_CONFIGURED";
  behaviour: string;
  toGoLive: string | null;
}

interface Outbox {
  messages: {
    at: string;
    channel: string;
    kind: string;
    recipientName: string;
    destination: string;
    title: string;
    body: string;
    isUrgent: boolean;
  }[];
  held: number;
  limit: number;
  note: string;
}

const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * Integrations — SRS §3.4, DEP-01 and DEP-04.
 *
 * THE POINT OF THIS SCREEN IS THAT NOBODY MISREADS A SIMULATION FOR A SEND.
 * The Institute will run this System before the Google and Meta credentials
 * arrive, and the dangerous failure is not an outage — it is an administrator
 * assuming a fee reminder reached a student. From the office, a message that
 * went out and one that did not look exactly the same unless something says so.
 *
 * So SIMULATED is not styled as a mild warning next to a reassuring green tick.
 * It gets its own banner, its own word, and a plain sentence about what the
 * System is actually doing instead.
 */
export function IntegrationsPage() {
  const { hasRole } = useAuth();
  const mayReadOutbox = hasRole("super_admin", "admin");

  const [rows, setRows] = useState<Status[] | null>(null);
  const [outbox, setOutbox] = useState<Outbox | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  async function loadOutbox() {
    if (!mayReadOutbox) return;
    try {
      setOutbox(await api.get<Outbox>("/integrations/outbox"));
    } catch {
      // A teacher reaching this page sees the statuses and no outbox, which is
      // the intended shape rather than an error.
      setOutbox(null);
    }
  }

  useEffect(() => {
    api
      .get<Status[]>("/integrations")
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e : null));
    void loadOutbox();
  }, []);

  async function clear() {
    if (!window.confirm("Clear the simulated outbox? Nothing real is affected.")) return;
    try {
      await api.del("/integrations/outbox");
      await loadOutbox();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }

  if (error && !rows) {
    return (
      <div className="alert alert-error" role="alert">
        <strong>Could not load integrations</strong>
        <p>{error.message}</p>
      </div>
    );
  }
  if (!rows) return <SkeletonTable rows={5} columns={4} />;

  const simulated = rows.filter((r) => r.mode !== "LIVE");

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Integrations</h1>
          <p className="muted small">
            What the System is connected to, and exactly what it does when it is not.
          </p>
        </div>
      </header>

      {simulated.length > 0 && (
        <div className="alert alert-warn" role="status">
          <strong>
            {simulated.length} of {rows.length} integrations are not live
          </strong>
          <p>
            Everything below still works — but nothing is being sent to WhatsApp, and lecture
            files are held on this server rather than in Drive. Messages a student would receive
            are kept in the outbox on this page so you can read them.
          </p>
        </div>
      )}

      <div className="grid">
        {rows.map((r) => (
          <section className="card widget" key={r.key}>
            <div className="card-head">
              <h2>{r.name}</h2>
              <span
                className={`pill ${
                  r.mode === "LIVE" ? "pill-ok" : r.mode === "SIMULATED" ? "pill-warn" : ""
                }`}
              >
                {r.mode === "NOT_CONFIGURED" ? "not configured" : r.mode.toLowerCase()}
              </span>
            </div>
            <p className="small">{r.behaviour}</p>
            {r.toGoLive && (
              <>
                <h3 className="small">To go live</h3>
                {/* The names of the settings, never their values. SEC-CRY-010
                    makes credentials write-only for every role. */}
                <p className="muted small">{r.toGoLive}</p>
              </>
            )}
            {r.dependency && <p className="muted small">Blocked on {r.dependency}.</p>}
          </section>
        ))}
      </div>

      {mayReadOutbox && (
        <section className="card">
          <div className="card-head">
            <h2>Simulated outbox</h2>
            {outbox && outbox.held > 0 && (
              <button className="btn btn-quiet btn-sm" onClick={() => void clear()}>
                Clear
              </button>
            )}
          </div>

          {!outbox || outbox.messages.length === 0 ? (
            <EmptyState icon="chat" title="Nothing yet">
              When the System sends a notification, the WhatsApp wording a student would have
              received appears here. Release a mark or post an announcement and come back.
            </EmptyState>
          ) : (
            <>
              <p className="warn small">{outbox.note}</p>
              <p className="muted small">
                Holding {outbox.held} of a maximum {outbox.limit}, newest first.
              </p>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Would have gone to</th>
                      <th>Message</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {outbox.messages.map((m, i) => (
                      <tr key={i}>
                        <td className="muted small">{when(m.at)}</td>
                        <td>
                          {m.recipientName}
                          <div className="muted small">{m.destination}</div>
                        </td>
                        <td>
                          <strong>{m.title}</strong>
                          {open === i && <p className="small">{m.body}</p>}
                          <div className="muted small">
                            {m.kind}
                            {m.isUrgent && " · urgent"}
                          </div>
                        </td>
                        <td>
                          <button
                            className="btn btn-quiet btn-sm"
                            aria-expanded={open === i}
                            onClick={() => setOpen(open === i ? null : i)}
                          >
                            {open === i ? "Hide" : "Read"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
