import { useEffect, useState } from "react";
import { ApiError, api } from "../api/client";

interface Section {
  id: string;
  code: string;
  name: string;
  capacity: number;
  enrolledCount: number;
  placesRemaining: number;
  isFull: boolean;
  shift: string;
  genderRestriction: string;
  status: string;
}

/**
 * Sections — SRS §13.11.
 *
 * The list is already scoped by the server (ARC-051), so a teacher sees their
 * own sections here without this screen asking for a filter. That is the
 * point of the scope predicate: the client cannot widen what it is shown.
 */
export function SectionsPage() {
  const [rows, setRows] = useState<Section[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .list<Section>("/sections")
      .then((r) => setRows(r.data))
      .catch((e) => setError(e instanceof ApiError ? e : null));
  }, []);

  if (error) {
    return (
      <div className="alert alert-error">
        <strong>Could not load sections</strong>
        <p>{error.message}</p>
      </div>
    );
  }
  if (!rows) return <p className="muted">Loading…</p>;

  return (
    <>
      <header className="page-head">
        <h1>Sections</h1>
        <span className="muted small">{rows.length} visible to you</span>
      </header>

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted">
            No sections are visible to you. If you are a teacher, you see only the sections you are
            assigned to.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Shift</th>
                <th>Admits</th>
                <th className="num">Enrolled</th>
                <th className="num">Capacity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><code>{s.code}</code></td>
                  <td>{s.name}</td>
                  <td>{s.shift.toLowerCase()}</td>
                  <td>{s.genderRestriction.toLowerCase()}</td>
                  {/* FR-CRS-010 — occupancy wherever a section appears, so
                      nobody has to do the subtraction themselves. */}
                  <td className={`num ${s.isFull ? "warn" : ""}`}>{s.enrolledCount}</td>
                  <td className="num">{s.capacity}</td>
                  <td>
                    {s.isFull ? (
                      <span className="pill pill-warn">full</span>
                    ) : (
                      <span className="pill">{s.placesRemaining} free</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
