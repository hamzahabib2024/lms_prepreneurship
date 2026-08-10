import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * The audit log — SRS §13.7, FR-LOG-010..016.
 *
 * Written since the first commit and, until now, read by nothing. Every
 * approval, grade revision, suspension and revoked certificate has been
 * recorded faithfully and been invisible, which makes a log a compliance
 * artefact rather than a tool.
 *
 * WHAT CHANGED IS THE POINT, not that something did. A row saying
 * "assignment.release_grades" tells nobody anything; the before and after are
 * why the record exists, so they are rendered as a diff rather than hidden
 * behind an expander nobody opens.
 */

interface AuditEntry {
  id: string;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: string;
  actorRole: string | null;
  impersonatedBy: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  correlationId: string;
}

export function AuditPage() {
  const { hasRole } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [actions, setActions] = useState<Array<{ action: string; count: number }>>([]);
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (action) params.set("action", action);
    api
      .list<AuditEntry>(`/admin/audit?${params.toString()}`)
      .then((r) => {
        setEntries(r.data);
        setTotal(r.pagination?.totalItems ?? r.data.length);
        setPages(r.pagination?.totalPages ?? 1);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not read the log."));
  }, [action, page]);

  useEffect(load, [load]);

  useEffect(() => {
    api
      .get<Array<{ action: string; count: number }>>("/admin/audit/actions")
      .then(setActions)
      .catch(() => setActions([]));
  }, []);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted small">
            {total} recorded {total === 1 ? "action" : "actions"}
            {/* §4.5.12 — the asymmetry is deliberate and worth stating, so an
                administrator does not think the log is incomplete. */}
            {!hasRole("super_admin") && " — your own. A Super Admin sees everything."}
          </p>
        </div>
      </header>

      {error && (
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      )}

      <section className="card">
        <label className="field">
          <span>Action</span>
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Everything</option>
            {actions.map((a) => (
              <option key={a.action} value={a.action}>
                {a.action} ({a.count})
              </option>
            ))}
          </select>
        </label>
      </section>

      {!entries ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="card">
          <p className="muted">Nothing matches that.</p>
        </div>
      ) : (
        <>
          <section className="card">
            <ul className="list">
              {entries.map((e) => (
                <AuditRow key={e.id} entry={e} />
              ))}
            </ul>
          </section>

          <section className="card">
            <span className="row-actions">
              <button
                className="btn btn-quiet"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <span className="muted small">
                Page {page} of {pages}
              </span>
              <button
                className="btn btn-quiet"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </span>
          </section>
        </>
      )}
    </>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const changed = summarise(entry.before, entry.after);

  return (
    <li className="assignment">
      <div className="assignment-head">
        <span>
          <button className="link-button" onClick={() => setOpen(!open)}>
            {entry.action}
          </button>
          <br />
          <span className="muted small">
            {entry.actor}
            {entry.actorRole ? ` (${entry.actorRole})` : ""} ·{" "}
            {new Date(entry.occurredAt).toLocaleString()}
          </span>
        </span>
        <span className="row-actions">
          {/* SEC-AUZ-013 — an action taken while impersonating is a different
              kind of event and must never read as an ordinary one. */}
          {entry.impersonatedBy && <span className="warn small">while impersonating</span>}
          <span className="muted small">{entry.entityType}</span>
        </span>
      </div>

      {changed.length > 0 && !open && (
        <p className="muted small">{changed.slice(0, 3).join(" · ")}</p>
      )}

      {open && (
        <div className="assignment-body">
          <p className="muted small">
            {entry.entityType} {entry.entityId}
            {entry.ipAddress ? ` · from ${entry.ipAddress}` : ""}
            <br />
            request {entry.correlationId}
          </p>

          {changed.length === 0 ? (
            <p className="muted small">No field values were recorded for this action.</p>
          ) : (
            <ul className="list small">
              {changed.map((line) => (
                <li key={line}>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The change, in words.
 *
 * FR-LOG-003 records only the fields that changed, so this reads them rather
 * than diffing whole objects. "status: ISSUED → REVOKED" is what somebody came
 * to find out; two JSON blobs side by side are what they would have to work it
 * out from.
 */
function summarise(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];

  return keys.map((key) => {
    const from = b[key];
    const to = a[key];
    if (from === undefined) return `${key}: ${render(to)}`;
    if (to === undefined) return `${key}: was ${render(from)}`;
    return `${key}: ${render(from)} → ${render(to)}`;
  });
}

function render(value: unknown): string {
  if (value === null) return "none";
  if (typeof value === "string") return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  if (typeof value === "object") return JSON.stringify(value).slice(0, 60);
  return String(value);
}
