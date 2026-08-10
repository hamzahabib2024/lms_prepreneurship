import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";

/**
 * Issuing certificates — SRS §13.7, FR-CRT-002/006.
 *
 * An administrator opens this with one question: who can I issue to now. So the
 * eligible students are listed first and the button is only enabled for them —
 * the server refuses an unearned certificate regardless, but offering a button
 * that will be refused wastes the administrator's time and teaches them to
 * ignore errors.
 *
 * Students who have not met the criteria are still listed, with their standing,
 * because "why is this student not here" is the immediate next question and an
 * absence cannot answer it.
 */

interface Section {
  id: string;
  code: string;
  name: string;
}

interface Offering {
  id: string;
  subject: { code: string; name: string };
}

interface Candidate {
  studentId: string;
  rollNo: number | null;
  name: string;
  overallPercent: number;
  attendancePercent: number | null;
  averageGradePercent: number | null;
  completionMet: boolean;
  certificate: {
    id: string;
    certificateNo: string;
    status: string;
    issuedAt: string;
  } | null;
  canIssue: boolean;
}

interface IssuanceView {
  sectionSubjectId: string;
  students: Candidate[];
  eligible: number;
  issued: number;
}

export function CertificatesPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [offeringId, setOfferingId] = useState("");
  const [view, setView] = useState<IssuanceView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items?: Section[] } | Section[]>("/sections")
      .then((r) => setSections(Array.isArray(r) ? r : (r.items ?? [])))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load sections."));
  }, []);

  useEffect(() => {
    setOfferings([]);
    setOfferingId("");
    setView(null);
    if (!sectionId) return;
    api
      .get<Offering[]>(`/sections/${sectionId}/subjects`)
      .then(setOfferings)
      .catch(() => setOfferings([]));
  }, [sectionId]);

  const load = useCallback(() => {
    if (!offeringId) return;
    api
      .get<IssuanceView>(`/section-subjects/${offeringId}/certificates`)
      .then(setView)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load that subject."));
  }, [offeringId]);

  useEffect(load, [load]);

  return (
    <>
      <header className="page-head">
        <h1>Certificates</h1>
      </header>

      {error && (
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      )}

      <section className="card">
        <div className="field-row">
          <label className="field">
            <span>Section</span>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">Choose a section…</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Subject</span>
            <select
              value={offeringId}
              onChange={(e) => setOfferingId(e.target.value)}
              disabled={offerings.length === 0}
            >
              <option value="">
                {offerings.length === 0 ? "Choose a section first" : "Choose a subject…"}
              </option>
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.subject.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {view && (
        <section className="card">
          <p className="muted small">
            {view.eligible === 0
              ? "Nobody is currently eligible."
              : `${view.eligible} eligible to issue`}
            {view.issued > 0 ? ` · ${view.issued} already issued` : ""}
          </p>

          <ul className="list">
            {[...view.students]
              // Eligible first: that is the work. Then those already holding
              // one, then the rest.
              .sort(
                (a, b) =>
                  Number(b.canIssue) - Number(a.canIssue) ||
                  Number(b.certificate != null) - Number(a.certificate != null) ||
                  (a.rollNo ?? 0) - (b.rollNo ?? 0),
              )
              .map((c) => (
                <CandidateRow
                  key={c.studentId}
                  candidate={c}
                  sectionSubjectId={view.sectionSubjectId}
                  onIssued={load}
                />
              ))}
          </ul>
        </section>
      )}
    </>
  );
}

function CandidateRow({
  candidate: c,
  sectionSubjectId,
  onIssued,
}: {
  candidate: Candidate;
  sectionSubjectId: string;
  onIssued: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string[] | null>(null);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/students/${c.studentId}/certificates/subject/${sectionSubjectId}`,
      );
      onIssued();
    } catch (e) {
      // The server returns the specific gaps. Showing them is the whole point:
      // an administrator can then tell the student what is missing.
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message) ?? [e.message])
          : ["That certificate could not be issued."],
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="assignment">
      <div className="assignment-head">
        <span>
          {c.rollNo}. {c.name}
          <span className="muted small">
            {" "}
            · {c.overallPercent}%
            {c.attendancePercent !== null ? ` · ${c.attendancePercent}% attendance` : ""}
          </span>
        </span>

        <span className="row-actions">
          {/* Every state is a word, never colour alone (NFR-ACC-003). */}
          {c.certificate?.status === "ISSUED" ? (
            <span className="small">✓ {c.certificate.certificateNo}</span>
          ) : c.certificate?.status === "REVOKED" ? (
            <span className="warn small">Revoked</span>
          ) : !c.completionMet ? (
            <span className="muted small">Not yet eligible</span>
          ) : null}

          {c.canIssue && (
            <button className="btn btn-primary" onClick={() => void issue()} disabled={busy}>
              {busy ? "Issuing…" : c.certificate ? "Reissue" : "Issue"}
            </button>
          )}
        </span>
      </div>

      {error && (
        <div className="alert alert-error">
          <ul className="list small">
            {error.map((m) => (
              <li key={m}>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
