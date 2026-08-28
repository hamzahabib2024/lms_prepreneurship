import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { EmptyState, ErrorState, Skeleton } from "../components/Ui";
import { HowItWorks } from "../components/HowItWorks";

/**
 * OUTGOING EMAIL — what is waiting to go, and the person who decides it goes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS SCREEN EXISTS BECAUSE OF TWO DIFFERENT PROBLEMS, and it must not blur
 * them together.
 *
 *   WAITING FOR YOU. The Institute has chosen to see account mail before it
 *   leaves. Nothing has gone wrong; somebody has to look and say yes. This is
 *   the only thing on the screen that is a JOB, so it is at the top, counted in
 *   the heading, and carries the only primary button.
 *
 *   WAITING FOR THE MAIL SERVER. A message the server would not take — almost
 *   always the daily allowance being used up. It needs nothing from anybody and
 *   will go out on its own. It is here so that "why has this not arrived" has
 *   an answer, and is deliberately quiet.
 *
 * A SINGLE "PENDING" COUNT COVERING BOTH WOULD BE THE BUG. The second is far
 * more common, so the handful that genuinely need a decision would disappear
 * into a number nobody acts on — which is how a queue of unsent student
 * passwords sits for a week.
 *
 * RELEASING DOES NOT SEND, AND THE SCREEN SAYS SO. The sweep sends, within ten
 * minutes, because doing forty SMTP round trips inside this request is the
 * thirty-seven-second freeze the cohort import was just cured of. Somebody who
 * pressed Release and then watched an inbox would otherwise conclude it had not
 * worked.
 *
 * DISCARD IS NOT DELETE. The row is kept and marked, because "why did that
 * student never get their details" is asked weeks later and the honest answer
 * only exists if the record does.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface QueueRow {
  id: string;
  kind: string;
  status: string;
  toAddress: string;
  fullName: string;
  subject: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  nextAttemptAt: string;
  sentAt: string | null;
}

interface Usage {
  sent: number;
  failed: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  /** The mail server itself refused something for being over the limit. */
  blocked: boolean;
  blockedSince: string | null;
  byKind: Array<{ kind: string; label: string; sent: number }>;
  recent: Array<{
    occurredAt: string;
    toAddress: string;
    kind: string;
    subject: string;
    status: string;
  }>;
}

interface Queue {
  awaitingApproval: number;
  retrying: number;
  abandoned: number;
  sentToday: number;
  requiresApproval: boolean;
  usage: Usage;
  rows: QueueRow[];
}

const KIND_LABEL: Record<string, string> = {
  CREDENTIALS: "Sign-in details",
  COURSE_ADDED: "Enrolled in a course",
};

const when = (iso: string): string => new Date(iso).toLocaleString();

export function EmailQueuePage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      setQueue(await api.get<Queue>("/admin/email-queue"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The queue could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string, ids: string[], describe: (n: number) => string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.post<{ released?: number; discarded?: number }>(
        `/admin/email-queue/${path}`,
        { ids },
      );
      setNotice(describe(r.released ?? r.discarded ?? 0));
      setChosen(new Set());
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That did not work.",
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const waiting = queue?.rows.filter((r) => r.status === "AWAITING_APPROVAL") ?? [];
  const retrying = queue?.rows.filter((r) => r.status === "PENDING") ?? [];
  const givenUp = queue?.rows.filter((r) => r.status === "ABANDONED") ?? [];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Outgoing email</h1>
          <p className="muted small">
            {queue?.requiresApproval
              ? "Account email is held here until somebody releases it."
              : "Account email is sent as soon as it is written. Anything below is waiting on the mail server, not on you."}
          </p>
        </div>
      </header>

      <HowItWorks
        id="email-queue"
        title="How outgoing email works"
        steps={[
          {
            icon: "bell",
            title: "Messages are written here",
            body: "New sign-in details and course notes. Nothing has been sent to anybody yet.",
          },
          {
            icon: "check",
            title: "You release the ones that should go",
            body: "Look at who they are for. Release them together, or one at a time.",
          },
          {
            icon: "megaphone",
            title: "They go out within ten minutes",
            body: "A background sweep sends them a few at a time so the mail account is not overrun.",
          },
        ]}
        note="Turn this off in Settings → Email if you would rather every message went immediately. The temporary passwords on the import screen work whether or not a message is ever sent."
      />

      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {notice && (
        <div className="alert alert-ok">
          <p>{notice}</p>
        </div>
      )}

      {!queue && !error && <Skeleton lines={6} />}

      {queue && (
        <>
          {/* THE ALLOWANCE FIRST, because when it is exhausted it explains
              every other number on the page — and somebody who does not know
              that reads the queue below as a fault. */}
          <Allowance usage={queue.usage} />

          <div className="kpis">
            <div className="kpi">
              <span className="kpi-value">{queue.awaitingApproval}</span>
              <span className="kpi-label">Waiting for you</span>
              <span className="kpi-note">Nothing sent until released</span>
            </div>
            <div className="kpi">
              <span className="kpi-value">{queue.retrying}</span>
              <span className="kpi-label">Waiting for the mail server</span>
              <span className="kpi-note">Goes out on its own</span>
            </div>
            <div className="kpi">
              <span className="kpi-value">{queue.sentToday}</span>
              <span className="kpi-label">Sent today</span>
            </div>
            <div className="kpi">
              <span className="kpi-value">{queue.abandoned}</span>
              <span className="kpi-label">Given up on</span>
              <span className="kpi-note">Tell these people yourself</span>
            </div>
          </div>

          {/* ------------------------------------------- waiting for you -- */}
          <section className="card">
            <div className="card-head">
              <h2>Waiting for you ({waiting.length})</h2>
              {waiting.length > 0 && (
                <span className="row-actions">
                  <button
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() =>
                      void act("approve", [], (n) =>
                        `${n} released. They will go out within ten minutes.`,
                      )
                    }
                  >
                    {busy ? "Releasing…" : `Release all ${waiting.length}`}
                  </button>
                  {chosen.size > 0 && (
                    <>
                      <button
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void act("approve", [...chosen], (n) =>
                            `${n} released. They will go out within ten minutes.`,
                          )
                        }
                      >
                        Release {chosen.size} chosen
                      </button>
                      <button
                        className="btn btn-sm btn-quiet"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Discard ${chosen.size} message${chosen.size === 1 ? "" : "s"}?\n\n` +
                                "They will never be sent. The record is kept so you can see " +
                                "later that this was a decision rather than a fault.",
                            )
                          ) {
                            return;
                          }
                          void act("discard", [...chosen], (n) => `${n} discarded.`);
                        }}
                      >
                        Discard {chosen.size}
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>

            {waiting.length === 0 ? (
              <EmptyState icon="check" title="Nothing waiting">
                {queue.requiresApproval
                  ? "Every message written so far has been dealt with."
                  : "Account email is going out immediately — nothing is being held for approval."}
              </EmptyState>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="visually-hidden">Choose</span>
                      </th>
                      <th scope="col">Who</th>
                      <th scope="col">What it says</th>
                      <th scope="col">Written</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waiting.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={chosen.has(r.id)}
                              onChange={() => toggle(r.id)}
                            />
                            <span className="visually-hidden">
                              Choose the message for {r.fullName}
                            </span>
                          </label>
                        </td>
                        <td>
                          <strong>{r.fullName}</strong>
                          <br />
                          <span className="muted small">{r.toAddress}</span>
                        </td>
                        <td>
                          {r.subject ?? KIND_LABEL[r.kind] ?? r.kind}
                          {r.kind === "CREDENTIALS" && (
                            <>
                              <br />
                              {/* Said plainly, because it is the thing people
                                  assume wrongly: a held credentials message
                                  cannot carry the original password. */}
                              <span className="muted small">
                                Sends a link to choose a password, not the temporary one.
                              </span>
                            </>
                          )}
                        </td>
                        <td className="muted small">{when(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ------------------------------- waiting for the mail server -- */}
          {retrying.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h2>Waiting for the mail server ({retrying.length})</h2>
              </div>
              <p className="muted small">
                Released or sent automatically, and refused by the mail server for now — almost
                always the daily sending limit. <strong>Nothing to do.</strong> These are tried
                again every half hour until they go.
              </p>
              <ul className="list small">
                {retrying.map((r) => (
                  <li key={r.id}>
                    <strong>{r.fullName}</strong> — {r.toAddress}
                    <br />
                    <span className="muted">
                      {r.attempts} attempt{r.attempts === 1 ? "" : "s"} · next at{" "}
                      {when(r.nextAttemptAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ------------------------------------------------ given up on -- */}
          {givenUp.length > 0 && (
            <section className="card">
              <div className="card-head">
                <h2>Given up on ({givenUp.length})</h2>
              </div>
              <p className="muted small">
                These will not be sent. Tell these people yourself — the temporary passwords are
                on the import result, or reset the account to have new details sent.
              </p>
              <ul className="list small">
                {givenUp.map((r) => (
                  <li key={r.id}>
                    <strong>{r.fullName}</strong> — {r.toAddress}
                    <br />
                    <span className="muted">{r.lastError ?? "No reason recorded."}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

/**
 * THE ALLOWANCE, AND WHAT SPENT IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO QUESTIONS, ASKED IN THIS ORDER. "Why is nothing sending?" and then, half
 * a second later, "what used it all up?" — and the second one had no answer
 * anywhere in the System until the log existed, because only failures were
 * recorded and an allowance is spent by the mail that WORKED.
 *
 * THE BLOCKED BAND IS THE SERVER'S OWN VERDICT, not our arithmetic. It appears
 * because smtp.gmail.com actually refused something with 5.4.5, which is worth
 * far more than comparing a local count to a configured number: mail sent from
 * the same account by a person sitting in Gmail spends the same allowance and
 * never passes through this System at all. So the count below is described as
 * an estimate every time it is shown, and the band is stated as fact.
 *
 * NOTHING HERE ENFORCES ANYTHING. Google enforces the limit. A System that
 * stopped sending at its own count of 500 would withhold mail an account still
 * had room for, and would still be caught out when the real limit arrived
 * early.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function Allowance({ usage }: { usage: Usage }) {
  const nearlyOut = !usage.blocked && usage.limit > 0 && usage.percentUsed >= 80;

  return (
    <>
      {usage.blocked && (
        <div className="alert alert-error" role="alert">
          <strong>The sending account is out of its daily allowance.</strong>
          <p className="small">
            The mail server refused a message
            {usage.blockedSince && ` at ${new Date(usage.blockedSince).toLocaleString()}`} with
            &ldquo;Daily user sending limit exceeded&rdquo;. Nothing is wrong with the addresses
            or the settings.
          </p>
          <p className="small">
            The allowance is a <strong>rolling 24 hours</strong>, so it returns gradually rather
            than at midnight. Anything waiting below is retried every half hour and will go out
            on its own. Read passwords out from the import screen if somebody needs to get in
            before then.
          </p>
        </div>
      )}

      {nearlyOut && (
        <div className="alert alert-warn">
          <strong>
            About {usage.percentUsed}% of the day&rsquo;s sending allowance has been used.
          </strong>
          <p className="small">
            Roughly {usage.remaining} left of {usage.limit}. A large import today may not all get
            through — hold it until tomorrow, or expect the rest to arrive late.
          </p>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Sending allowance</h2>
        </div>

        <div className="fee-figures">
          <div className="fee-figure">
            <span className="fee-figure-label">Sent in the last 24 hours</span>
            <span className="fee-figure-value">{usage.sent}</span>
            <span className="fee-figure-note">as far as this System can see</span>
          </div>
          <div className="fee-figure">
            <span className="fee-figure-label">Allowance</span>
            <span className="fee-figure-value">{usage.limit}</span>
            <span className="fee-figure-note">set in Settings → Email</span>
          </div>
          <div className="fee-figure">
            <span className="fee-figure-label">Refused</span>
            <span className="fee-figure-value">{usage.failed}</span>
            <span className="fee-figure-note">in the same period</span>
          </div>
        </div>

        {/* The shape carries it as well as the number — and the number is the
            one that decides anything (NFR-ACC-007). */}
        <div className="bar" role="img" aria-label={`${usage.percentUsed}% of the allowance used`}>
          <div
            className="bar-fill"
            style={{ width: `${Math.min(100, usage.percentUsed)}%` }}
          />
        </div>
        <p className="muted small">
          An <strong>estimate</strong>, and always low. It counts what this System sent; anything
          sent from the same mailbox by a person in Gmail spends the same allowance and never
          passes through here. Google&rsquo;s own count is the one that decides.
        </p>

        {/* --------------------------------------------- where it went -- */}
        <h3>What used it</h3>
        {usage.byKind.length === 0 ? (
          <p className="muted small">Nothing has been sent in the last 24 hours.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Kind of message</th>
                  <th scope="col">Sent</th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                {usage.byKind.map((k) => (
                  <tr key={k.kind}>
                    <td>{k.label}</td>
                    <td>{k.sent}</td>
                    <td>
                      {usage.sent > 0 ? `${Math.round((k.sent / usage.sent) * 100)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* The individual sends, for "did this person get theirs". */}
        {usage.recent.length > 0 && (
          <details>
            <summary className="small">Every message in the last 24 hours</summary>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">To</th>
                    <th scope="col">About</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.recent.map((r, i) => (
                    <tr key={`${r.occurredAt}-${i}`}>
                      <td className="muted small">{new Date(r.occurredAt).toLocaleString()}</td>
                      <td className="small">{r.toAddress}</td>
                      <td className="small">{r.subject}</td>
                      <td>
                        {/* A word, never a colour alone. */}
                        {r.status === "SENT" ? (
                          <span className="pill pill-ok">sent</span>
                        ) : r.status === "FAILED" ? (
                          <span className="pill pill-warn">refused</span>
                        ) : (
                          <span className="pill">not attempted</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">
              The most recent fifty. Nothing here records what a message said — only who it went
              to and what it was about.
            </p>
          </details>
        )}
      </section>
    </>
  );
}
