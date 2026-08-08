import { useEffect, useState } from "react";
import { ApiError, api } from "../api/client";

interface ReportDef {
  key: string;
  name: string;
  description: string;
  columns: string[];
}

/**
 * Reports — SRS §14.
 *
 * FR-RPT-019: the catalogue the server returns already excludes reports this
 * user cannot run, so a teacher is never shown the revenue report and then
 * refused it. Offering something and then denying it is worse than not
 * offering it.
 */
export function ReportsPage() {
  const [defs, setDefs] = useState<ReportDef[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; rows: Record<string, unknown>[] } | null>(null);

  useEffect(() => {
    api
      .get<ReportDef[]>("/reports")
      .then(setDefs)
      .catch((e) => setError(e instanceof ApiError ? e : null));
  }, []);

  async function run(key: string) {
    setRunning(key);
    setError(null);
    try {
      const r = await api.get<{ rows: Record<string, unknown>[] }>(`/reports/${key}`);
      setResult({ key, rows: r.rows });
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setRunning(null);
    }
  }

  if (error && !defs) {
    return (
      <div className="alert alert-error">
        <strong>Could not load reports</strong>
        <p>{error.message}</p>
      </div>
    );
  }
  if (!defs) return <p className="muted">Loading…</p>;

  return (
    <>
      <header className="page-head">
        <h1>Reports</h1>
        <span className="muted small">{defs.length} available to you</span>
      </header>

      {error && (
        <div className="alert alert-error">
          <strong>Could not run that report</strong>
          <p>{error.message}</p>
        </div>
      )}

      <div className="grid">
        {defs.map((d) => (
          <section className="card widget" key={d.key}>
            <h2>{d.name}</h2>
            <p className="muted small">{d.description}</p>
            <div className="row-actions">
              <button className="btn" onClick={() => void run(d.key)} disabled={running === d.key}>
                {running === d.key ? "Running…" : "Run"}
              </button>
              {/* Export is a separate permission (§4.1.2), so the server may
                  refuse this even when the report itself ran. */}
              <a className="btn btn-quiet" href={`/api/v1/reports/${d.key}/export`}>
                Export CSV
              </a>
            </div>
          </section>
        ))}
      </div>

      {result && (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h2>{defs.find((d) => d.key === result.key)?.name}</h2>
          {result.rows.length === 0 ? (
            <p className="muted">No records matched.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    {Object.keys(result.rows[0] ?? {}).map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 50).map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((val, j) => (
                        <td key={j}>{val === null ? "" : String(val)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
