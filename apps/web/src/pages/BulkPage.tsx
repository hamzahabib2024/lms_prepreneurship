import { useEffect, useState } from "react";
import { ApiError, api } from "../api/client";

/**
 * Bulk operations — SRS §13.10, FR-OPS-020..026.
 *
 * PREVIEW IS THE DEFAULT PATH, not an optional extra. A bulk transfer is not
 * all-or-nothing: each student's move is atomic in itself and the batch is "as
 * many as could be done", so the way to get it right is to look first. The
 * screen makes that the obvious thing to do — you cannot reach the button that
 * acts without having previewed.
 *
 * AND THE REPORT MUST NOT FLATTER. "38 of 50 done" beside a green tick is how
 * somebody closes the page believing all fifty moved. Failures are listed
 * first, in the server's own words, and the summary says plainly that the rest
 * went through.
 */

interface Section {
  id: string;
  code: string;
  name: string;
  genderRestriction?: string;
  placesRemaining?: number;
}

interface Row {
  studentId: string;
  name?: string;
  outcome: "WOULD_SUCCEED" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  message?: string;
}

interface Report {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  rows: Row[];
  summary: string;
  section?: { id: string; name: string; placesRemaining: number };
}

export function BulkPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [roster, setRoster] = useState<Array<{ id: string; name: string }> | null>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Report | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Section[]>("/sections")
      .then(setSections)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load sections."));
  }, []);

  useEffect(() => {
    if (!fromId) return setRoster(null);
    setChosen(new Set());
    setPreview(null);
    setResult(null);
    api
      .get<Array<{ studentId?: string; id?: string; name?: string; fullName?: string }>>(
        `/sections/${fromId}/roster`,
      )
      .then((rows) =>
        setRoster(
          rows.map((r) => ({
            id: (r.studentId ?? r.id) as string,
            name: r.name ?? r.fullName ?? "",
          })),
        ),
      )
      .catch(() => setRoster([]));
  }, [fromId]);

  const ids = [...chosen];

  const run = async (path: string, body: unknown, into: (r: Report) => void) => {
    setBusy(true);
    setError(null);
    try {
      into(await api.post<Report>(path, body));
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

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Bulk changes</h1>
          <p className="muted small">
            Move or withdraw many students at once. Every student goes through the same checks as
            a single change, so a batch cannot get past a gender restriction or a full section.
          </p>
        </div>
      </header>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      <section className="card">
        <div className="field-row">
          <label className="field">
            <span>From</span>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">Choose a section</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>To</span>
            <select value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Choose a section</option>
              {sections
                .filter((s) => s.id !== fromId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                    {s.genderRestriction && s.genderRestriction !== "MIXED"
                      ? ` (${s.genderRestriction.toLowerCase()} only)`
                      : ""}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Reason — recorded against every student</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Merging the evening section into the morning one."
          />
        </label>
      </section>

      {roster && (
        <section className="card">
          <div className="assignment-head">
            <h2>
              {chosen.size} of {roster.length} chosen
            </h2>
            <span className="row-actions">
              <button
                className="btn btn-quiet"
                onClick={() => setChosen(new Set(roster.map((r) => r.id)))}
              >
                Choose all
              </button>
              <button className="btn btn-quiet" onClick={() => setChosen(new Set())}>
                Clear
              </button>
            </span>
          </div>

          {roster.length === 0 ? (
            <p className="muted">Nobody is in that section.</p>
          ) : (
            <ul className="list">
              {roster.map((r) => (
                <li key={r.id}>
                  <label className="inline-field">
                    <input
                      type="checkbox"
                      checked={chosen.has(r.id)}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.target.checked) next.add(r.id);
                        else next.delete(r.id);
                        setChosen(next);
                        // A preview describes a batch. Change the batch and the
                        // preview is about something else, so it goes.
                        setPreview(null);
                        setResult(null);
                      }}
                    />
                    <span>{r.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {ids.length > 0 && (
        <section className="card">
          <span className="row-actions">
            <button
              className="btn btn-primary"
              disabled={busy || !toId}
              onClick={() =>
                void run(
                  "/admin/bulk/transfer/preview",
                  { studentIds: ids, toSectionId: toId },
                  (r) => {
                    setPreview(r);
                    setResult(null);
                  },
                )
              }
            >
              {busy ? "Checking…" : "Check what would happen"}
            </button>

            {/* Only reachable after a preview. Not a nag — a bulk change that
                partly fails leaves the operator reconciling two lists, and
                looking first is how that is avoided. */}
            <button
              className="btn btn-quiet"
              disabled={busy || !preview || reason.trim().length < 10}
              onClick={() =>
                void run(
                  "/admin/bulk/transfer",
                  { studentIds: ids, toSectionId: toId, reason },
                  (r) => {
                    setResult(r);
                    setPreview(null);
                    setChosen(new Set());
                  },
                )
              }
            >
              Move {ids.length}
            </button>

            <button
              className="btn btn-quiet"
              disabled={busy || reason.trim().length < 10}
              onClick={() =>
                void run("/admin/bulk/withdraw", { studentIds: ids, reason }, (r) => {
                  setResult(r);
                  setPreview(null);
                  setChosen(new Set());
                })
              }
            >
              Withdraw {ids.length}
            </button>
          </span>

          {!preview && toId && (
            <p className="muted small">Check first — moving is not all-or-nothing.</p>
          )}
          {reason.trim().length < 10 && (
            <p className="muted small">A reason is required before anything is changed.</p>
          )}
        </section>
      )}

      {preview && <ReportPanel report={preview} title="What would happen" />}
      {result && <ReportPanel report={result} title="What happened" />}
    </>
  );
}

function ReportPanel({ report, title }: { report: Report; title: string }) {
  const trouble = report.failed + report.skipped > 0;

  return (
    <section className={`card ${trouble ? "alert-warn" : ""}`}>
      <h2>{title}</h2>
      {/* The server's sentence, not a count of our own. It is the one that says
          "this is not all-or-nothing, so the rest went through". */}
      <p>
        <strong>{report.summary}</strong>
      </p>
      {report.section && (
        <p className="muted small">
          {report.section.name} — {report.section.placesRemaining} places would remain.
        </p>
      )}

      <ul className="list">
        {report.rows.map((r) => (
          <li key={r.studentId}>
            <span>
              {/* The outcome as a WORD, never colour alone (NFR-ACC-003). */}
              <strong className={r.outcome === "FAILED" ? "warn" : undefined}>
                {label(r.outcome)}
              </strong>{" "}
              {r.name ?? r.studentId}
              {r.message && (
                <>
                  <br />
                  <span className="muted small">{r.message}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function label(outcome: Row["outcome"]): string {
  switch (outcome) {
    case "FAILED":
      return "Not changed —";
    case "SKIPPED":
      return "Nothing to do —";
    case "WOULD_SUCCEED":
      return "Would move —";
    default:
      return "Done —";
  }
}
