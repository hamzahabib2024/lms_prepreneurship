import { useCallback, useEffect, useState } from "react";
import { EmptyState, SkeletonTable } from "../components/Ui";
import { ApiError, api, tokens } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { StepUpPrompt, needsStepUp } from "../components/StepUpPrompt";

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
        <div className="alert alert-error" role="alert">
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
        <SkeletonTable rows={8} columns={5} />
      ) : users.length === 0 ? (
        <EmptyState
          icon="users"
          title="Nobody matches those filters"
          action={
            <button type="button" className="btn" onClick={() => { setRole(""); setStatus(""); setQ(""); }}>
              Clear the filters
            </button>
          }
        >
          The directory is not empty — this combination of role, status and search simply
          excludes everyone in it.
        </EmptyState>
      ) : (
        <section className="card">
          <ul className="list">
            {users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                canGrant={hasRole("super_admin")}
                canImpersonate={hasRole("super_admin")}
                canErase={hasRole("super_admin")}
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
        <div className="alert alert-error" role="alert">
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

/**
 * FR-PRV-008/009 — erasure, with the plan shown first.
 *
 * The plan is not a confirmation dialogue. It is the honest answer to what
 * somebody is actually asking for: erasure ANONYMISES, because the audit log is
 * append-only and certificates must stay verifiable, and a person expecting
 * "delete everything" needs to read what will really happen before they agree
 * to it — and, if the server refuses, why.
 */
function ErasePanel({
  user: u,
  reason,
  onDone,
}: {
  user: DirectoryUser;
  reason: string;
  onDone: () => void;
}) {
  const [plan, setPlan] = useState<{
    canErase: boolean;
    refusal?: string;
    warning: string;
    plan: Array<{ label: string; what: string; reason: string }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState(false);

  // Reading the PLAN needs step-up too, because it is guarded by the same
  // permission as the act: nobody should be able to enumerate who is erasable
  // without being able to erase.
  const fetchPlan = () =>
    api
      .get<NonNullable<typeof plan>>(`/admin/users/${u.id}/erasure-plan`)
      .then((p) => {
        setPlan(p);
        setStepUp(false);
      })
      .catch((e) => {
        if (needsStepUp(e)) setStepUp(true);
        else setError(e instanceof ApiError ? e.message : "Could not read the plan.");
      });

  if (stepUp) {
    return (
      <StepUpPrompt
        what={`erase ${u.fullName}'s personal data`}
        onCancel={() => setStepUp(false)}
        onDone={() => void fetchPlan()}
      />
    );
  }

  if (!plan) {
    return (
      <span className="row-actions">
        <button className="btn btn-quiet" onClick={() => void fetchPlan()}>
          Erase personal data…
        </button>
        {error && <span className="warn small">{error}</span>}
      </span>
    );
  }

  return (
    <div className="alert alert-warn">
      <p>
        <strong>{plan.warning}</strong>
      </p>
      <ul className="list small">
        {plan.plan.map((p) => (
          <li key={p.label}>
            <span>
              <strong>{p.label}</strong> — {p.what}
              <br />
              <span className="muted small">{p.reason}</span>
            </span>
          </li>
        ))}
      </ul>

      {/* Why it cannot proceed, if it cannot. Shown here rather than after
          pressing, because the remedy is usually somebody else's job. */}
      {!plan.canErase && <p className="warn">{plan.refusal}</p>}
      {error && <p className="warn">{error}</p>}

      <span className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy || !plan.canErase || reason.trim().length < 10}
          onClick={() => {
            setBusy(true);
            setError(null);
            api
              .del(`/admin/users/${u.id}/personal-data`, { reason })
              .then(onDone)
              .catch((e) =>
                setError(
                  e instanceof ApiError
                    ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
                    : "That did not work.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Erasing…" : `Erase ${u.fullName}`}
        </button>
        <button className="btn btn-quiet" onClick={() => setPlan(null)}>
          Cancel
        </button>
        {reason.trim().length < 10 && (
          <span className="muted small">Give a reason above first — it cannot be undone.</span>
        )}
      </span>
    </div>
  );
}

function UserRow({
  user: u,
  canGrant,
  canImpersonate,
  canErase,
  onChanged,
  onIssued,
}: {
  user: DirectoryUser;
  canGrant: boolean;
  canImpersonate: boolean;
  canErase: boolean;
  onChanged: () => void;
  onIssued: (issued: Issued) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The action the server refused for want of a recent re-authentication, kept
  // so it can be run again once the password is confirmed rather than making
  // somebody find the button a second time.
  const [pending, setPending] = useState<{ what: string; run: () => Promise<unknown> } | null>(null);

  const act = async (fn: () => Promise<unknown>, what?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      if (needsStepUp(e) && what) {
        setPending({ what, run: fn });
      } else {
        setError(
          e instanceof ApiError
            ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
            : "That did not work.",
        );
      }
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
            <div className="alert alert-error" role="alert">
              <p>{error}</p>
            </div>
          )}

          {pending && (
            <StepUpPrompt
              what={pending.what}
              onCancel={() => setPending(null)}
              onDone={() => {
                const retry = pending.run;
                setPending(null);
                void act(retry);
              }}
            />
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

            {/* SEC-AUT-008 — not a password reset, and the label says so. A
                lockout is usually somebody mistyping their own password, and
                until this existed the only remedy was replacing it. */}
            <button
              className="btn btn-quiet"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const r = await api.post<{ message: string }>(`/admin/users/${u.id}/unlock`);
                  setNotice(r.message);
                })
              }
            >
              Unlock
            </button>

            {/* FR-PRV-001. Downloaded rather than shown: it is a file somebody
                asked for, and it is audited as bulk extraction either way. */}
            <button
              className="btn btn-quiet"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const data = await api.get<unknown>(`/admin/users/${u.id}/personal-data`);
                  download(`personal-data-${u.id}.json`, JSON.stringify(data, null, 2));
                  setNotice("Downloaded. This export is recorded in the audit log.");
                })
              }
            >
              Export their data
            </button>
          </span>

          {notice && <p className="small">{notice}</p>}

          {/* The two that are not peers of the buttons above, kept apart on
              purpose. One puts you inside somebody else's account; the other
              cannot be undone. Putting them in the same row as "Sign out
              everywhere" would invite the wrong click. */}
          {(canImpersonate || canErase) && (
            <div className="danger-zone">
              {canImpersonate && !u.roles.includes("super_admin") && (
                <span className="row-actions">
                  <button
                    className="btn btn-quiet"
                    disabled={busy || reason.trim().length < 10}
                    onClick={() =>
                      void act(async () => {
                        const r = await api.post<{ accessToken: string; message: string }>(
                          "/admin/impersonate",
                          { userId: u.id, reason },
                        );
                        // Replacing the token IS becoming them. The banner in
                        // the shell reads /me/impersonation on load, so a full
                        // reload is what makes it appear.
                        tokens.setAccess(r.accessToken);
                        window.location.assign("/");
                      }, `act as ${u.fullName}`)
                    }
                  >
                    Act as {u.fullName.split(" ")[0]}
                  </button>
                  <span className="muted small">
                    15 minutes, cannot be extended, and everything you do is recorded against
                    your name. Needs a reason above and a recent re-authentication.
                  </span>
                </span>
              )}

              {canErase && (
                <ErasePanel
                  user={u}
                  reason={reason}
                  onDone={() => {
                    setNotice("Erased.");
                    onChanged();
                  }}
                />
              )}
            </div>
          )}

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

/**
 * Save a file the browser never fetched from a URL.
 *
 * The export arrives as a response body, not as a link: a downloadable URL for
 * somebody's personal data would be a URL that could be forwarded, and the
 * whole point of SEC-PRV-007 auditing the extraction is that it happens once,
 * to a named person.
 */
function download(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
