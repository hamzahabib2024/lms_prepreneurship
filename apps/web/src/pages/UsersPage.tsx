import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/**
 * User administration — SRS §13.7, FR-USR-003..015.
 *
 * A TEMPORARY PASSWORD IS SHOWN ONCE AND NEVER AGAIN. It is stored as an
 * Argon2id hash the moment it is created, so nothing can retrieve it — not this
 * screen, not the database, not an administrator. That makes the panel showing
 * it the most consequential thing on the page: dismissing it before writing the
 * password down means resetting it again.
 *
 * So it is presented as something to deal with rather than a toast that fades,
 * it says plainly that it will not be shown again, and it has to be dismissed
 * deliberately.
 */

interface DirectoryUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: string;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  roles: string[];
  subPermissions: string[];
  registrationNo: string | null;
  employeeCode: string | null;
}

interface Issued {
  fullName: string;
  temporaryPassword: string;
  what: "created" | "reset";
}

const SUB_PERMISSIONS = [
  { key: "admin_manager", label: "Manage other administrators" },
  { key: "financial_reporter", label: "Revenue reports and financial export" },
  { key: "bulk_operator", label: "Bulk import and bulk enrolment change" },
  { key: "certificate_issuer", label: "Issue and revoke certificates" },
];

export function UsersPage() {
  const { hasRole } = useAuth();
  const [users, setUsers] = useState<DirectoryUser[] | null>(null);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (role) params.set("role", role);
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    api
      .get<DirectoryUser[]>(`/admin/users?${params.toString()}`)
      .then(setUsers)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the directory."));
  }, [role, status, q]);

  useEffect(load, [load]);

  return (
    <>
      <header className="page-head">
        <h1>People</h1>
      </header>

      {error && (
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      )}

      {issued && <PasswordPanel issued={issued} onDismiss={() => setIssued(null)} />}

      <NewStaff onCreated={(i) => { setIssued(i); load(); }} />

      <section className="card">
        <div className="field-row">
          <label className="field">
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">Everyone</option>
              <option value="super_admin">Super admins</option>
              <option value="admin">Administrators</option>
              <option value="teacher">Teachers</option>
              <option value="student">Students</option>
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="INVITED">Invited</option>
            </select>
          </label>
          <label className="field">
            <span>Search</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" />
          </label>
        </div>
      </section>

      {!users ? (
        <p className="muted">Loading…</p>
      ) : users.length === 0 ? (
        <div className="card">
          <p className="muted">Nobody matches that.</p>
        </div>
      ) : (
        <section className="card">
          <ul className="list">
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                canGrant={hasRole("super_admin")}
                onChanged={load}
                onIssued={(i) => { setIssued(i); load(); }}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/**
 * The one-time password.
 *
 * Deliberately not a toast. Nothing can retrieve this again, so it must not be
 * possible to lose it by looking away.
 */
function PasswordPanel({ issued, onDismiss }: { issued: Issued; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <section className="card password-panel">
      <h2>
        {issued.what === "created" ? "Account created" : "Password reset"} — {issued.fullName}
      </h2>
      <p className="stat">{issued.temporaryPassword}</p>
      <div className="row-actions">
        <button
          className="btn btn-primary"
          onClick={() => {
            void navigator.clipboard?.writeText(issued.temporaryPassword);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy password"}
        </button>
        <button className="btn btn-quiet" onClick={onDismiss}>
          I have written it down
        </button>
      </div>
      <p className="warn small">
        This will not be shown again. It is stored as a hash the moment it is created, so
        nobody can look it up — if it is lost you have to reset it again. They must change
        it when they first sign in.
      </p>
    </section>
  );
}

function NewStaff({ onCreated }: { onCreated: (issued: Issued) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", fullName: "", phone: "", role: "teacher" });
  const [subs, setSubs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const create = async () => {
    setBusy(true);
    setProblems([]);
    try {
      const created = await api.post<{ fullName: string; temporaryPassword: string }>(
        "/admin/users",
        {
          email: form.email,
          fullName: form.fullName,
          ...(form.phone ? { phone: form.phone } : {}),
          role: form.role,
          ...(form.role === "admin" ? { subPermissions: subs } : {}),
        },
      );
      onCreated({
        fullName: created.fullName,
        temporaryPassword: created.temporaryPassword,
        what: "created",
      });
      setForm({ email: "", fullName: "", phone: "", role: "teacher" });
      setSubs([]);
      setOpen(false);
    } catch (e) {
      setProblems(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message) ?? [e.message])
          : ["That account could not be created."],
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <section className="card">
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          Add a teacher or administrator
        </button>
        <p className="muted small">
          Students are added by approving their application, not here.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>New account</h2>
      <div className="field-row">
        <label className="field">
          <span>Full name</span>
          <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </label>
        <label className="field">
          <span>Email — they sign in with this</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
      </div>

      <div className="field-row">
        <label className="field">
          <span>Phone</span>
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="teacher">Teacher</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
      </div>

      {form.role === "admin" && (
        <>
          <span className="field-label">What may they do beyond ordinary administration?</span>
          {SUB_PERMISSIONS.map((s) => (
            <label className="option" key={s.key}>
              <input
                type="checkbox"
                checked={subs.includes(s.key)}
                onChange={() =>
                  setSubs(
                    subs.includes(s.key) ? subs.filter((x) => x !== s.key) : [...subs, s.key],
                  )
                }
              />
              <span>{s.label}</span>
            </label>
          ))}
          {/* §4.2.2 — granted individually, never implied by the role, and
              creating an administrator at all needs admin_manager. */}
          <p className="muted small">
            Each is granted individually. Creating an administrator needs the
            &ldquo;manage other administrators&rdquo; permission yourself.
          </p>
        </>
      )}

      {problems.length > 0 && (
        <div className="alert alert-error">
          <ul className="list small">
            {problems.map((p) => (
              <li key={p}>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <span className="row-actions">
        <button
          className="btn btn-primary"
          onClick={() => void create()}
          disabled={busy || form.fullName.trim().length < 2 || !form.email.includes("@")}
        >
          {busy ? "Creating…" : "Create"}
        </button>
        <button className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
    </section>
  );
}

function UserRow({
  user: u,
  canGrant,
  onChanged,
  onIssued,
}: {
  user: DirectoryUser;
  canGrant: boolean;
  onChanged: () => void;
  onIssued: (issued: Issued) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
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

  const suspended = u.status === "SUSPENDED";

  return (
    <li className="assignment">
      <div className="assignment-head">
        <span>
          <button className="link-button" onClick={() => setOpen(!open)}>
            {u.fullName}
          </button>
          <br />
          <span className="muted small">
            {u.email} · {u.roles.join(", ")}
            {u.registrationNo ? ` · ${u.registrationNo}` : ""}
            {u.employeeCode ? ` · ${u.employeeCode}` : ""}
          </span>
        </span>
        <span className="row-actions">
          {/* Status as a word, never colour alone (NFR-ACC-003). */}
          {suspended ? (
            <span className="warn small">Suspended</span>
          ) : u.status === "INVITED" ? (
            <span className="muted small">Invited</span>
          ) : (
            <span className="small">Active</span>
          )}
          {u.mustChangePassword && <span className="muted small">must change password</span>}
        </span>
      </div>

      {open && (
        <div className="assignment-body">
          <p className="muted small">
            {u.lastLoginAt
              ? `Last signed in ${new Date(u.lastLoginAt).toLocaleString()}`
              : "Has never signed in."}
            {u.subPermissions.length > 0 && ` · ${u.subPermissions.join(", ")}`}
          </p>

          {error && (
            <div className="alert alert-error">
              <p>{error}</p>
            </div>
          )}

          <label className="field">
            <span>Reason — recorded in the audit log</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Left the Institute at the end of term."
            />
          </label>

          <span className="row-actions">
            <button
              className="btn btn-quiet"
              disabled={busy || reason.trim().length < 5}
              onClick={() =>
                void act(() =>
                  api.post(`/admin/users/${u.id}/status`, {
                    status: suspended ? "ACTIVE" : "SUSPENDED",
                    reason,
                  }),
                )
              }
            >
              {suspended ? "Reactivate" : "Suspend"}
            </button>

            <button
              className="btn btn-quiet"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const reset = await api.post<{ fullName: string; temporaryPassword: string }>(
                    `/admin/users/${u.id}/reset-password`,
                  );
                  onIssued({
                    fullName: reset.fullName,
                    temporaryPassword: reset.temporaryPassword,
                    what: "reset",
                  });
                })
              }
            >
              Reset password
            </button>

            <button
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => void act(() => api.post(`/admin/users/${u.id}/revoke-sessions`))}
            >
              Sign out everywhere
            </button>
          </span>

          {!suspended && (
            <p className="muted small">
              Suspending or resetting ends every session they currently hold.
            </p>
          )}

          {canGrant && u.roles.includes("admin") && (
            <p className="muted small">
              Changing what an administrator may do needs you to re-authenticate first.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
