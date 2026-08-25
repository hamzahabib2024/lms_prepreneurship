import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState, SkeletonTable } from "../components/Ui";
import { HowItWorks } from "../components/HowItWorks";

interface Programme {
  id: string;
  code: string;
  name: string;
}

interface Session {
  id: string;
  code: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  programme: Programme;
  _count: { batches: number };
}

interface Batch {
  id: string;
  name: string;
  deliveryPattern: string;
  academicSession: {
    id: string;
    code: string;
    name: string;
    status: string;
    programme: Programme;
  };
  _count: { sections: number };
}

const STATUSES = ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"] as const;

/** A term's dates, without the time nobody set. */
const day = (iso: string) => (iso ? iso.slice(0, 10) : "");

/**
 * Academic structure — programmes, terms and batches (FR-CRS-005).
 *
 * THIS PAGE EXISTS BECAUSE THE ONES BELOW IT COULD NOT BE USED. Creating a
 * section requires a batchId; creating a batch requires an academicSessionId;
 * and until now nothing in the running system produced either. Both were seeded
 * once and never again, so `POST /sections` was a door with no handle on this
 * side — reachable, correctly guarded, and impossible to call.
 *
 * The order on screen is the order of the dependency: a term holds batches, a
 * batch holds sections. Choosing a term filters the batches beneath it, because
 * "which term is this batch in" is the question somebody gets wrong at the start
 * of every year.
 */
export function StructurePage() {
  const { hasRole } = useAuth();
  const mayEdit = hasRole("super_admin", "admin");

  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Which term the batch panel is filtered to. "" is all of them. */
  const [termFilter, setTermFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const [newSession, setNewSession] = useState({
    programmeId: "",
    name: "",
    code: "",
    startDate: "",
    endDate: "",
  });
  const [newBatch, setNewBatch] = useState({
    academicSessionId: "",
    name: "",
    deliveryPattern: "",
  });

  async function load() {
    setError(null);
    try {
      const [s, b] = await Promise.all([
        api.get<Session[]>("/academic-sessions"),
        api.get<Batch[]>("/batches"),
      ]);
      setSessions(s);
      setBatches(b);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
  }

  useEffect(() => {
    void load();
    // A teacher may read the structure but holds no programme:create, and the
    // picker is only used for creating. If this is refused the form is simply
    // not offered.
    api
      .get<Programme[]>("/programmes")
      .then(setProgrammes)
      .catch(() => setProgrammes([]));
  }, []);

  /** One place, so every form reports a refusal the same way. */
  async function run(work: () => Promise<unknown>, said: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await work();
      setNote(said);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createSession(e: FormEvent) {
    e.preventDefault();
    const ok = await run(
      () => api.post("/academic-sessions", newSession),
      `Term ${newSession.code} created.`,
    );
    if (ok) setNewSession({ programmeId: "", name: "", code: "", startDate: "", endDate: "" });
  }

  async function createBatch(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => api.post("/batches", newBatch), `Batch "${newBatch.name}" created.`);
    if (ok) setNewBatch({ academicSessionId: "", name: "", deliveryPattern: "" });
  }

  async function saveSession(id: string) {
    const ok = await run(
      () =>
        api.patch(`/academic-sessions/${id}`, {
          ...(draft["name"] ? { name: draft["name"] } : {}),
          ...(draft["status"] ? { status: draft["status"] } : {}),
          ...(draft["startDate"] ? { startDate: draft["startDate"] } : {}),
          ...(draft["endDate"] ? { endDate: draft["endDate"] } : {}),
        }),
      "Term updated.",
    );
    if (ok) {
      setEditing(null);
      setDraft({});
    }
  }

  /**
   * Remove a batch created by mistake.
   *
   * Refused while it holds any section, and the refusal names them. A batch
   * looks empty from this screen — the students and the marks are a level
   * further down, in the sections — so "it has nothing in it" is exactly the
   * judgement an administrator cannot safely make from here, and the server
   * makes it instead.
   */
  async function removeBatch(b: Batch) {
    if (
      !window.confirm(
        `Delete the batch "${b.name}"?

Only possible while it holds no sections. ` +
          `It leaves every list and every dropdown.`,
      )
    )
      return;
    await run(() => api.del(`/batches/${b.id}`), `Batch "${b.name}" deleted.`);
  }

  async function saveBatch(id: string) {
    const ok = await run(
      () =>
        api.patch(`/batches/${id}`, {
          ...(draft["name"] ? { name: draft["name"] } : {}),
          ...(draft["deliveryPattern"] ? { deliveryPattern: draft["deliveryPattern"] } : {}),
        }),
      "Batch updated.",
    );
    if (ok) {
      setEditing(null);
      setDraft({});
    }
  }

  if (!sessions) return <SkeletonTable rows={6} columns={4} />;

  const visibleBatches = termFilter
    ? batches.filter((b) => b.academicSession.id === termFilter)
    : batches;

  /* A term that has ended cannot take new batches, so it is not offered. */
  const openSessions = sessions.filter(
    (s) => s.status !== "COMPLETED" && s.status !== "CANCELLED",
  );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Academic structure</h1>
          <p className="muted small">
            Terms hold batches; batches hold sections. Set these up before the intake opens.
          </p>
        </div>
        <span className="muted small">
          {sessions.length} {sessions.length === 1 ? "term" : "terms"} · {batches.length}{" "}
          {batches.length === 1 ? "batch" : "batches"}
        </span>
      </header>

      <HowItWorks
        id="structure"
        title="Terms and intakes"
        intro="The calendar the whole Institute runs on. Set once a term, then left alone."
        steps={[
          { icon: "calendar", title: "Make the session", body: "The term itself — its name and the dates it runs between." },
          { icon: "users", title: "Add the intakes", body: "A group starting together. Sections belong to one of these." },
          { icon: "clock", title: "Set the dates", body: "Everything else — deadlines, attendance, certificates — is measured against these." },
          { icon: "check", title: "Make it current", body: "The current term is the one new sections and applications default to." },
        ]}
        note="Dates here are the ones everything else is judged against, so a term with the wrong end date makes every completion figure wrong at once."
      />

      {error && (
        <div className="alert alert-error" role="alert">
          <strong>That did not work</strong>
          <p>{error.details?.map((d) => d.message).join(" ") ?? error.message}</p>
          {error.reference && <p className="muted small">Reference: {error.reference}</p>}
        </div>
      )}
      {note && (
        <div className="alert alert-ok" role="status">
          <p>{note}</p>
        </div>
      )}

      {/* ------------------------------------------------------------ terms */}
      <section className="card">
        <h2>Terms</h2>
        {sessions.length === 0 ? (
          <EmptyState
            title="No terms yet"
          >
            A term is an intake — Spring 2026, Fall 2026. Everything else hangs off one.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Programme</th>
                  <th>Runs</th>
                  <th className="num">Batches</th>
                  <th>Status</th>
                  {mayEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const isEditing = editing === `s:${s.id}`;
                  return (
                    <tr key={s.id}>
                      <td>
                        <code>{s.code}</code>
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            aria-label="Term name"
                            value={draft["name"] ?? s.name}
                            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                          />
                        ) : (
                          s.name
                        )}
                      </td>
                      <td className="muted small">{s.programme.code}</td>
                      <td className="muted small">
                        {isEditing ? (
                          <span className="date-pair">
                            <input
                              type="date"
                              aria-label="Start date"
                              value={draft["startDate"] ?? day(s.startDate)}
                              onChange={(e) =>
                                setDraft((d) => ({ ...d, startDate: e.target.value }))
                              }
                            />
                            <input
                              type="date"
                              aria-label="End date"
                              value={draft["endDate"] ?? day(s.endDate)}
                              onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
                            />
                          </span>
                        ) : (
                          `${day(s.startDate)} → ${day(s.endDate)}`
                        )}
                      </td>
                      <td className="num">{s._count.batches}</td>
                      <td>
                        {isEditing ? (
                          <select
                            aria-label="Term status"
                            value={draft["status"] ?? s.status}
                            onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                          >
                            {STATUSES.map((x) => (
                              <option key={x} value={x}>
                                {x.toLowerCase()}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`pill ${s.status === "ACTIVE" ? "pill-ok" : ""}`}>
                            {s.status.toLowerCase()}
                          </span>
                        )}
                      </td>
                      {mayEdit && (
                        <td className="row-actions">
                          {isEditing ? (
                            <>
                              <button
                                className="btn btn-primary btn-sm"
                                disabled={busy}
                                onClick={() => void saveSession(s.id)}
                              >
                                Save
                              </button>
                              <button
                                className="btn btn-quiet btn-sm"
                                onClick={() => {
                                  setEditing(null);
                                  setDraft({});
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn btn-quiet btn-sm"
                              onClick={() => {
                                setEditing(`s:${s.id}`);
                                setDraft({});
                              }}
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {mayEdit && (
          <form className="inline-form" onSubmit={(e) => void createSession(e)}>
            <h3>Add a term</h3>
            <div className="form-row">
              <label className="field">
                <span>Programme</span>
                <select
                  required
                  value={newSession.programmeId}
                  onChange={(e) => setNewSession((s) => ({ ...s, programmeId: e.target.value }))}
                >
                  <option value="">Choose one</option>
                  {programmes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Code</span>
                <input
                  required
                  maxLength={10}
                  placeholder="SP26"
                  value={newSession.code}
                  onChange={(e) =>
                    setNewSession((s) => ({ ...s, code: e.target.value.toUpperCase() }))
                  }
                />
                {/* Said here because it cannot be changed afterwards. */}
                <span className="muted small">Used in registration numbers — permanent.</span>
              </label>
              <label className="field">
                <span>Name</span>
                <input
                  required
                  minLength={3}
                  placeholder="Spring 2026"
                  value={newSession.name}
                  onChange={(e) => setNewSession((s) => ({ ...s, name: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Starts</span>
                <input
                  type="date"
                  required
                  value={newSession.startDate}
                  onChange={(e) => setNewSession((s) => ({ ...s, startDate: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Ends</span>
                <input
                  type="date"
                  required
                  value={newSession.endDate}
                  onChange={(e) => setNewSession((s) => ({ ...s, endDate: e.target.value }))}
                />
              </label>
            </div>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Working…" : "Create term"}
            </button>
            {programmes.length === 0 && (
              <p className="warn small">
                No programme is available to you, so a term cannot be created here.
              </p>
            )}
          </form>
        )}
      </section>

      {/* ---------------------------------------------------------- batches */}
      <section className="card">
        <div className="card-head">
          <h2>Batches</h2>
          <label className="field field-inline">
            <span>Term</span>
            <select value={termFilter} onChange={(e) => setTermFilter(e.target.value)}>
              <option value="">All terms</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {visibleBatches.length === 0 ? (
          <EmptyState
            title={termFilter ? "No batches in that term" : "No batches yet"}
          >
            A batch groups the sections that run together — one delivery pattern, one intake.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Pattern</th>
                  <th>Term</th>
                  <th className="num">Sections</th>
                  {mayEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {visibleBatches.map((b) => {
                  const isEditing = editing === `b:${b.id}`;
                  return (
                    <tr key={b.id}>
                      <td>
                        {isEditing ? (
                          <input
                            aria-label="Batch name"
                            value={draft["name"] ?? b.name}
                            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                          />
                        ) : (
                          b.name
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            aria-label="Delivery pattern"
                            value={draft["deliveryPattern"] ?? b.deliveryPattern}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, deliveryPattern: e.target.value }))
                            }
                          />
                        ) : (
                          <span className="pill">{b.deliveryPattern}</span>
                        )}
                      </td>
                      <td className="muted small">
                        {b.academicSession.programme.code} · {b.academicSession.code}
                      </td>
                      <td className="num">{b._count.sections}</td>
                      {mayEdit && (
                        <td className="row-actions">
                          {isEditing ? (
                            <>
                              <button
                                className="btn btn-primary btn-sm"
                                disabled={busy}
                                onClick={() => void saveBatch(b.id)}
                              >
                                Save
                              </button>
                              <button
                                className="btn btn-quiet btn-sm"
                                onClick={() => {
                                  setEditing(null);
                                  setDraft({});
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="btn btn-quiet btn-sm"
                                onClick={() => {
                                  setEditing(`b:${b.id}`);
                                  setDraft({});
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn-quiet btn-sm"
                                disabled={busy}
                                onClick={() => void removeBatch(b)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {mayEdit && (
          <form className="inline-form" onSubmit={(e) => void createBatch(e)}>
            <h3>Add a batch</h3>
            <div className="form-row">
              <label className="field">
                <span>Term</span>
                <select
                  required
                  value={newBatch.academicSessionId}
                  onChange={(e) =>
                    setNewBatch((b) => ({ ...b, academicSessionId: e.target.value }))
                  }
                >
                  <option value="">Choose one</option>
                  {openSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.programme.code} · {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Name</span>
                <input
                  required
                  minLength={3}
                  placeholder="Morning intake"
                  value={newBatch.name}
                  onChange={(e) => setNewBatch((b) => ({ ...b, name: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Delivery pattern</span>
                <input
                  required
                  minLength={2}
                  placeholder="Weekday"
                  value={newBatch.deliveryPattern}
                  onChange={(e) => setNewBatch((b) => ({ ...b, deliveryPattern: e.target.value }))}
                />
              </label>
            </div>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Working…" : "Create batch"}
            </button>
            {/* Named rather than left as an empty list somebody stares at. */}
            {openSessions.length === 0 && sessions.length > 0 && (
              <p className="warn small">
                Every term is completed or cancelled, so a new batch cannot be added to any of
                them. Add a term first.
              </p>
            )}
          </form>
        )}
      </section>
    </>
  );
}
