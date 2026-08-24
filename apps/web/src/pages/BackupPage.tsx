import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "../components/Ui";
import { ApiError, api } from "../api/client";
import { StepUpPrompt, needsStepUp } from "../components/StepUpPrompt";
import { HowItWorks } from "../components/HowItWorks";

/**
 * Backup and restore — SRS §13.14, FR-OPS-030..038.
 *
 * THE RESTORE BUTTON IS THE MOST DANGEROUS CONTROL IN THE SYSTEM. It is the
 * only one that destroys data belonging to everybody at once, and it is
 * deliberately awkward: the archive has to be verified, maintenance mode has to
 * be on, the exact phrase has to be typed, and the password has to be confirmed
 * again. None of those is a dialogue that can be clicked through.
 *
 * WHAT A BACKUP IS NOT is stated on the page, not buried in a manual. Somebody
 * who believes these archives contain the schema will find out they do not on
 * the day they need them.
 *
 * VERIFYING IS OFFERED ON EVERY ROW, because a backup nobody has read back is
 * a hope. The result is shown as a sentence — "Verified: 2963 rows read back
 * and the checksum matches" — rather than a tick.
 */

interface Backup {
  id: string;
  takenAt: string;
  age: string;
  totalRows: number;
  sizeBytes: number;
  schemaVersion: string;
  broken: boolean;
}

interface Verification {
  id: string;
  ok: boolean;
  problems: Array<{ code: string; message: string }>;
  message: string;
}

const CONFIRMATION = "REPLACE ALL DATA";

const size = (bytes: number) =>
  bytes > 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function BackupPage() {
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [summary, setSummary] = useState("");
  const [checks, setChecks] = useState<Record<string, Verification>>({});
  const [maintenance, setMaintenance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepUp, setStepUp] = useState<{ run: () => Promise<unknown> } | null>(null);

  const load = useCallback(() => {
    api
      .get<{ backups: Backup[]; message: string }>("/admin/backups")
      .then((r) => {
        setBackups(r.backups);
        setSummary(r.message);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not read the backups."));
    api
      .get<{ maintenance: boolean }>("/maintenance")
      .then((r) => setMaintenance(r.maintenance))
      .catch(() => setMaintenance(false));
  }, []);

  useEffect(load, [load]);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      load();
    } catch (e) {
      if (needsStepUp(e)) setStepUp({ run });
      else
        setError(
          e instanceof ApiError
            ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
            : "That did not work.",
        );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Backups</h1>
          <p className="muted small">{summary}</p>
        </div>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const made = await api.post<{ id: string; totalRows: number; verification: Verification }>(
                "/admin/backups",
              );
              setChecks((c) => ({ ...c, [made.id]: made.verification }));
              setNotice(`Backed up ${made.totalRows} rows, and read them back to check.`);
            })
          }
        >
          {busy ? "Working…" : "Take a backup now"}
        </button>
      </header>

      <HowItWorks
        id="backups"
        title="Backups and restoring"
        intro="Copies of everything the Institute holds, so a mistake or a failure is recoverable."
        steps={[
          { icon: "database", title: "Check they are running", body: "When the last one was taken, and whether it worked." },
          { icon: "clock", title: "Set how often", body: "And how long they are kept for." },
          { icon: "check", title: "Test a restore", body: "A backup nobody has ever restored is a backup nobody knows works." },
          { icon: "alert", title: "Restore only if you must", body: "It puts everything back to that moment — anything since is lost." },
        ]}
        note="Restoring is the most destructive thing in this System. It undoes every change made since the backup was taken, for everybody, not only the mistake you are fixing."
      />

      {/* Not buried in a manual. Somebody who believes these contain the schema
          will find out they do not on the day they need them. */}
      <div className="alert alert-warn">
        <p>
          <strong>These are data backups, not full database dumps.</strong> They hold every row,
          and not the schema — no tables, indexes, constraints or triggers. Restoring one needs a
          database that already has the migrations and constraints applied. Keep host-level
          database backups as well.
        </p>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {notice && <div className="alert"><p>{notice}</p></div>}

      {stepUp && (
        <StepUpPrompt
          what="work with backups"
          onCancel={() => setStepUp(null)}
          onDone={() => {
            const retry = stepUp.run;
            setStepUp(null);
            void act(retry);
          }}
        />
      )}

      {!backups ? (
        <Skeleton lines={2} />
      ) : backups.length === 0 ? (
        <div className="card">
          <p className="warn">
            There are no backups. Nothing here has ever been backed up — take one now.
          </p>
        </div>
      ) : (
        <section className="card">
          <ul className="list">
            {backups.map((b) => (
              <li key={b.id} className="assignment">
                <div className="assignment-head">
                  <span>
                    <strong>{new Date(b.takenAt).toLocaleString()}</strong>
                    <br />
                    <span className="muted small">
                      {b.age} · {b.totalRows.toLocaleString()} rows · {size(b.sizeBytes)}
                      <br />
                      schema {b.schemaVersion}
                    </span>
                  </span>
                  <span className="row-actions">
                    {b.broken ? (
                      <span className="warn small">Unreadable</span>
                    ) : (
                      <button
                        className="btn btn-quiet"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const v = await api.post<Verification>(`/admin/backups/${b.id}/verify`);
                            setChecks((c) => ({ ...c, [b.id]: v }));
                          })
                        }
                      >
                        Verify
                      </button>
                    )}
                  </span>
                </div>

                {/* A sentence, not a tick. */}
                {checks[b.id] && (
                  <p className={checks[b.id]?.ok ? "small" : "warn small"}>
                    {checks[b.id]?.message}
                    {(checks[b.id]?.problems ?? []).map((p) => (
                      <span key={p.message}>
                        <br />
                        {p.message}
                      </span>
                    ))}
                  </p>
                )}

                <RestorePanel
                  backup={b}
                  maintenance={maintenance}
                  verified={checks[b.id]?.ok === true}
                  busy={busy}
                  onRestore={(confirmation) =>
                    void act(async () => {
                      const r = await api.post<{ message: string; rowsLoaded: number }>(
                        `/admin/backups/${b.id}/restore`,
                        { confirmation },
                      );
                      setNotice(`${r.rowsLoaded} rows restored. ${r.message}`);
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * The dangerous one.
 *
 * Four things stand between a click and losing everything since the backup was
 * taken, and the panel says which are outstanding rather than simply
 * disabling the button. A control that is greyed out for reasons nobody
 * explains is how people end up clicking everything to find out which.
 */
function RestorePanel({
  backup: b,
  maintenance,
  verified,
  busy,
  onRestore,
}: {
  backup: Backup;
  maintenance: boolean;
  verified: boolean;
  busy: boolean;
  onRestore: (confirmation: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  if (b.broken) return null;

  if (!open) {
    return (
      <button className="btn btn-quiet" onClick={() => setOpen(true)}>
        Restore from this…
      </button>
    );
  }

  const blockers: string[] = [];
  if (!maintenance) blockers.push("Maintenance mode is off. Turn it on first from Settings.");
  if (!verified) blockers.push("This archive has not been verified. Verify it before relying on it.");

  return (
    <div className="danger-zone">
      <p className="warn">
        <strong>
          This replaces every record in the System with the contents of this backup.
        </strong>{" "}
        Everything that has happened since {new Date(b.takenAt).toLocaleString()} will be lost —
        enrolments, submissions, marks, payments. The audit log is the exception: it is
        append-only and will still hold the record of what happened, including this restore.
      </p>

      {blockers.length > 0 && (
        <ul className="list small">
          {blockers.map((x) => (
            <li key={x}>
              <span className="warn">{x}</span>
            </li>
          ))}
        </ul>
      )}

      <label className="field">
        <span>
          Type <strong>{CONFIRMATION}</strong> to confirm
        </span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>

      <span className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy || typed !== CONFIRMATION || blockers.length > 0}
          onClick={() => onRestore(typed)}
        >
          Restore, replacing everything
        </button>
        <button
          className="btn btn-quiet"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          Cancel
        </button>
      </span>
    </div>
  );
}
