import { useCallback, useEffect, useState } from "react";
import { EmptyState, SkeletonList } from "../components/Ui";
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
  // `view` is null BOTH before a subject is chosen and while one is
  // loading, and those are different screens: one is waiting for the
  // reader, the other is waiting for the server.
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    api
      .get<IssuanceView>(`/section-subjects/${offeringId}/certificates`)
      .then(setView)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load that subject."))
      .finally(() => setLoading(false));
  }, [offeringId]);

  useEffect(load, [load]);

  return (
    <>
      <header className="page-head">
        <h1>Certificates</h1>
      </header>

      {error && (
        <div className="alert alert-error" role="alert">
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

      {loading && <SkeletonList rows={6} />}

      {!loading && !offeringId && (
        <EmptyState icon="award" title="Choose a subject">
          Pick a section and a subject above to see who has met the requirements for a
          certificate, and who is short of them.
        </EmptyState>
      )}

      {!loading && view && (
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

      {/* The whole-programme certificate, which needs a student rather than a
          subject — so it has its own panel rather than a button hidden in the
          subject list where nobody would look for it. */}
      {sectionId && <ProgrammePanel sectionId={sectionId} />}
    </>
  );
}

interface Standing {
  programme: { id: string; name: string };
  subjectCount: number;
  completedCount: number;
  eligible: boolean;
  alreadyIssued: { certificateNo: string; issuedAt: string } | null;
  subjects: Array<{
    sectionSubjectId: string;
    subject: string;
    overallPercent: number;
    met: boolean;
    outstanding: string[];
  }>;
  message: string;
}

/**
 * A certificate for finishing the whole programme.
 *
 * IT SHOWS WHY, NOT ONLY WHETHER. "Not eligible" beside a greyed-out button
 * leaves an administrator unable to answer the question the student is
 * actually asking, which is never "am I eligible" but "what is left". So every
 * subject is listed with what is outstanding on it.
 */
function ProgrammePanel({ sectionId }: { sectionId: string }) {
  const [roster, setRoster] = useState<Array<{ id: string; name: string }>>([]);
  const [studentId, setStudentId] = useState("");
  const [programmes, setProgrammes] = useState<Array<{ id: string; name: string }>>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [standing, setStanding] = useState<Standing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStudentId("");
    setStanding(null);
    api
      .get<Array<{ studentId?: string; id?: string; name?: string; fullName?: string }>>(
        `/sections/${sectionId}/roster`,
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
    api
      .get<Array<{ id: string; name: string }>>("/programmes")
      .then(setProgrammes)
      .catch(() => setProgrammes([]));
  }, [sectionId]);

  const load = useCallback(() => {
    if (!studentId || !programmeId) return setStanding(null);
    setError(null);
    api
      .get<Standing>(`/students/${studentId}/certificates/programme/${programmeId}/standing`)
      .then(setStanding)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Could not read their standing."),
      );
  }, [studentId, programmeId]);

  useEffect(load, [load]);

  return (
    <section className="card">
      <h2>Programme certificate</h2>
      <p className="muted small">
        For finishing a whole programme. Every compulsory subject is rechecked at the moment it is
        issued, so the certificate says what it means.
      </p>

      <div className="field-row">
        <label className="field">
          <span>Student</span>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Choose a student…</option>
            {roster.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Programme</span>
          <select value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
            <option value="">Choose a programme…</option>
            {programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="warn">{error}</p>}

      {standing && (
        <>
          <p>{standing.message}</p>

          {standing.alreadyIssued && (
            <p className="stat">
              Already issued: <strong>{standing.alreadyIssued.certificateNo}</strong> on{" "}
              {new Date(standing.alreadyIssued.issuedAt).toLocaleDateString()}
            </p>
          )}

          {/* Said plainly rather than shown as an empty list, because zero
              subjects would otherwise read as "nothing outstanding". */}
          {standing.subjectCount === 0 ? (
            <p className="warn">
              This student takes no compulsory subject in {standing.programme.name}, so there is
              nothing to certify.
            </p>
          ) : (
            <ul className="list small">
              {standing.subjects.map((s) => (
                <li key={s.sectionSubjectId}>
                  <strong>{s.subject}</strong> — {s.overallPercent}%{" "}
                  {s.met ? (
                    <span className="muted">complete</span>
                  ) : (
                    <span className="warn">
                      {s.outstanding.length > 0 ? s.outstanding.join(" ") : "not yet complete"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!standing.alreadyIssued && (
            <button
              className="btn btn-primary"
              disabled={busy || !standing.eligible}
              onClick={() => {
                setBusy(true);
                setError(null);
                api
                  .post(`/students/${studentId}/certificates/programme/${programmeId}`)
                  .then(() => load())
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
              {busy ? "Issuing…" : "Issue the programme certificate"}
            </button>
          )}
        </>
      )}
    </section>
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
        <div className="alert alert-error" role="alert">
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
