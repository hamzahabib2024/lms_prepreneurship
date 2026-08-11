import { useEffect, useState } from "react";
import { text } from "../api/text";
import { ApiError, api } from "../api/client";

interface FilterSpec {
  key: "sectionId" | "from" | "to" | "status" | "belowThresholdOnly";
  label: string;
  type: "section" | "date" | "status" | "boolean";
  required?: boolean;
  hint?: string;
}

interface ReportDef {
  key: string;
  name: string;
  description: string;
  columns: string[];
  filters: FilterSpec[];
}

interface Section {
  id: string;
  code: string;
  name: string;
}

/**
 * Reports — SRS §14.
 *
 * FR-RPT-019: the catalogue the server returns already excludes reports this
 * user cannot run, so a teacher is never shown the revenue report and then
 * refused it. Offering something and then denying it is worse than not
 * offering it.
 *
 * THE FILTERS ARE DECLARED BY THE SERVER, not assumed here. Each report says
 * which it accepts and which it requires, and this page renders exactly those.
 * Before that it sent none at all, so "Section Roster" returned every student
 * in the Institute — the student directory under a name promising a class
 * list, which somebody notices at the photocopier.
 *
 * EXPORT GOES THROUGH THE API CLIENT, not a plain link. An <a href> sends no
 * Authorization header, so every Export CSV button on this page answered 401
 * from the day it was written.
 */
export function ReportsPage() {
  const [defs, setDefs] = useState<ReportDef[] | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, Record<string, string>>>({});
  const [result, setResult] = useState<{
    key: string;
    rows: Record<string, unknown>[];
    rowCount: number;
    message?: string;
  } | null>(null);

  useEffect(() => {
    api
      .get<ReportDef[]>("/reports")
      .then(setDefs)
      .catch((e) => setError(e instanceof ApiError ? e : null));
    // Best effort: a user who may run a section-filtered report can generally
    // read sections. If not, the picker is simply empty and the report says
    // what it needs.
    api
      .get<Section[]>("/sections")
      .then(setSections)
      .catch(() => setSections([]));
  }, []);

  const valuesFor = (key: string) => filters[key] ?? {};
  const setValue = (report: string, field: string, value: string) =>
    setFilters((f) => ({ ...f, [report]: { ...(f[report] ?? {}), [field]: value } }));

  /** Only the filters that have a value, so an empty date is not sent as "". */
  const queryFor = (d: ReportDef) => {
    const params = new URLSearchParams();
    for (const spec of d.filters) {
      const v = valuesFor(d.key)[spec.key];
      if (v !== undefined && v !== "") params.set(spec.key, v);
    }
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  const missingRequired = (d: ReportDef) =>
    d.filters.filter((f) => f.required && !valuesFor(d.key)[f.key]).map((f) => f.label);

  async function run(d: ReportDef) {
    setRunning(d.key);
    setError(null);
    try {
      const r = await api.get<{
        rows: Record<string, unknown>[];
        rowCount: number;
        message?: string;
      }>(`/reports/${d.key}${queryFor(d)}`);
      setResult({ key: d.key, rows: r.rows, rowCount: r.rowCount, message: r.message });
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setRunning(null);
    }
  }

  async function exportCsv(d: ReportDef) {
    setError(null);
    try {
      const blob = await api.download(`/reports/${d.key}/export${queryFor(d)}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${d.key}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
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
          <p>{error.details?.map((x) => x.message).join(" ") ?? error.message}</p>
        </div>
      )}

      <div className="grid">
        {defs.map((d) => {
          const missing = missingRequired(d);
          return (
            <section className="card widget" key={d.key}>
              <h2>{d.name}</h2>
              <p className="muted small">{d.description}</p>

              {d.filters.map((spec) => (
                <label className="field" key={spec.key}>
                  <span>
                    {spec.label}
                    {spec.required && <span className="warn"> *</span>}
                  </span>

                  {spec.type === "section" && (
                    <select
                      value={valuesFor(d.key)[spec.key] ?? ""}
                      onChange={(e) => setValue(d.key, spec.key, e.target.value)}
                    >
                      <option value="">{spec.required ? "Choose one" : "All sections"}</option>
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} — {s.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {spec.type === "date" && (
                    <input
                      type="date"
                      value={valuesFor(d.key)[spec.key] ?? ""}
                      onChange={(e) => setValue(d.key, spec.key, e.target.value)}
                    />
                  )}

                  {spec.type === "boolean" && (
                    <input
                      type="checkbox"
                      checked={valuesFor(d.key)[spec.key] === "true"}
                      onChange={(e) =>
                        setValue(d.key, spec.key, e.target.checked ? "true" : "")
                      }
                    />
                  )}

                  {spec.hint && <span className="muted small">{spec.hint}</span>}
                </label>
              ))}

              <div className="row-actions">
                <button
                  className="btn"
                  onClick={() => void run(d)}
                  disabled={running === d.key || missing.length > 0}
                >
                  {running === d.key ? "Running…" : "Run"}
                </button>
                {/* Export is a separate permission (§4.1.2), so the server may
                    refuse this even when the report itself ran. */}
                <button
                  className="btn btn-quiet"
                  onClick={() => void exportCsv(d)}
                  disabled={missing.length > 0}
                >
                  Export CSV
                </button>
              </div>

              {/* Named, rather than a greyed-out button nobody can explain. */}
              {missing.length > 0 && (
                <p className="warn small">Choose {missing.join(" and ")} first.</p>
              )}
            </section>
          );
        })}
      </div>

      {result && (
        <section className="card" style={{ marginTop: "1rem" }}>
          <h2>{defs.find((d) => d.key === result.key)?.name}</h2>

          {result.rows.length === 0 ? (
            <p className="muted">{result.message ?? "No records matched."}</p>
          ) : (
            <>
              {/* Said plainly. A table showing 50 of 300 rows with nothing to
                  say so is how somebody reports a number that is wrong by 250. */}
              <p className="muted small">
                {result.rowCount} {result.rowCount === 1 ? "row" : "rows"}
                {result.rowCount > 50 && " — showing the first 50. Export for all of them."}
              </p>
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
                          <td key={j}>{text(val)}</td>
                        ))}
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
