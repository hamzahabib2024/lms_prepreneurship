import { useCallback, useEffect, useState } from "react";
import {
  CERTIFICATE_KIND,
  CERTIFICATE_KIND_COPY,
  CERTIFICATE_STATUS_LABEL,
  type CertificateDocument,
  type CertificateKind,
} from "@lms/shared";
import { EmptyState, ErrorState, SkeletonList, SkeletonTable } from "../components/Ui";
import { CertificateModal } from "../components/CertificateModal";
import { Icon } from "../components/Icon";
import { ApiError, api } from "../api/client";
import { HowItWorks } from "../components/HowItWorks";

/**
 * The certificate register — SRS §13.7, FR-CRT-002/006/012.
 *
 * THREE DIFFERENT JOBS SHARE THIS ADDRESS, and they are separated rather than
 * stacked because they are done by the same person at different moments:
 *
 *   THE REGISTER — every certificate the Institute has ever issued, searchable
 *   by the thing an administrator with a phone call in their ear actually
 *   knows: a name, or a number read off a document.
 *
 *   ISSUING WHAT WAS EARNED — a subject-section at a time, with everybody's
 *   standing shown, because "why is this student not on the list" is always
 *   the next question and an absence cannot answer it.
 *
 *   ISSUING BY HAND — a workshop, a guest cohort, a certificate for somebody
 *   who was never enrolled in anything. Deliberately the shortest form in the
 *   application: a name and what it is for.
 *
 * The register opens first. It is the one somebody arrives with a question
 * about; the other two are things they came here intending to do.
 */

type Tab = "register" | "earned" | "manual";

const TABS: ReadonlyArray<{ id: Tab; label: string; hint: string }> = [
  { id: "register", label: "Register", hint: "Everything issued" },
  { id: "earned", label: "Issue for a subject", hint: "Who has met the requirements" },
  { id: "manual", label: "Issue by hand", hint: "Workshops and one-offs" },
];

export function CertificatesPage() {
  const [tab, setTab] = useState<Tab>("register");
  /* Bumped whenever a certificate is issued anywhere on this page, so the
     register reloads instead of showing a count that is one behind. */
  const [issued, setIssued] = useState(0);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Certificates</h1>
          <p className="muted">
            Every certificate the Institute has issued, and the two ways to issue another.
          </p>
        </div>
      </header>

      <HowItWorks
        id="certificates"
        title="Issuing a certificate"
        intro="A certificate is a public claim by the Institute, so it is issued only when the requirements are genuinely met."
        steps={[
          { icon: "search", title: "Check they qualify", body: "Attendance, submitted work and marks. The System tells you if something is short." },
          { icon: "award", title: "Issue it", body: "It gets a number of its own, printed on the document." },
          { icon: "monitor", title: "Anybody can verify it", body: "An employer types that number on the public page and sees whether it is genuine — no account needed." },
          { icon: "alert", title: "Revoke only if you must", body: "A revoked certificate stays on record and reads as revoked. It is never quietly deleted." },
        ]}
        note="What the certificate says is copied onto it when you issue it. Renaming a course next year does not change a certificate already given out."
      />

      <nav className="cert-tabs" aria-label="Certificate views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "cert-tab is-current" : "cert-tab"}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            <span className="cert-tab-label">{t.label}</span>
            <span className="cert-tab-hint">{t.hint}</span>
          </button>
        ))}
      </nav>

      {tab === "register" && <Register reloadKey={issued} />}
      {tab === "earned" && <EarnedPanel onIssued={() => setIssued((n) => n + 1)} />}
      {tab === "manual" && <ManualPanel onIssued={() => setIssued((n) => n + 1)} />}
    </>
  );
}

// ------------------------------------------------------------- register ----

interface Summary {
  total: number;
  valid: number;
  revoked: number;
  archived: number;
  thisMonth: number;
}

function Register({ reloadKey }: { reloadKey: number }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<CertificateDocument[] | null>(null);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);

  const [open, setOpen] = useState<CertificateDocument | null>(null);
  const [revoking, setRevoking] = useState<CertificateDocument | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  /* Typing in the search box must not fire a request per keystroke, and it
     must not need a Search button either — an administrator reading a number
     off paper types it once and expects the list to follow. */
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(term);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [term]);

  const load = useCallback(() => {
    setError(null);
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (kind) params.set("kind", kind);

    api
      .list<CertificateDocument>(`/certificates?${params.toString()}`)
      .then((r) => {
        setRows(r.data);
        setPages(r.pagination?.totalPages ?? 1);
        setTotal(r.pagination?.totalItems ?? r.data.length);
      })
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : "Could not read the certificate register."),
      );

    api
      .get<Summary>("/certificates/summary")
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [page, q, status, kind]);

  useEffect(load, [load, reloadKey]);

  const filtered = Boolean(q || status || kind);

  const copyLink = (c: CertificateDocument) => {
    void navigator.clipboard?.writeText(c.verification.url);
    setCopied(c.id);
    window.setTimeout(() => setCopied(null), 2500);
  };

  return (
    <>
      {summary && (
        <div className="stat-band">
          <div className="stat-band-inner">
            <div className="stat-item">
              <strong>{summary.total}</strong>
              <span>Issued altogether</span>
            </div>
            <div className="stat-item">
              <strong>{summary.valid}</strong>
              <span>Valid</span>
            </div>
            <div className="stat-item">
              <strong>{summary.revoked}</strong>
              <span>Revoked</span>
            </div>
            <div className="stat-item">
              <strong>{summary.archived}</strong>
              <span>Archived</span>
            </div>
            <div className="stat-item">
              <strong>{summary.thisMonth}</strong>
              <span>This month</span>
            </div>
          </div>
        </div>
      )}

      <section className="card">
        <div className="field-row cert-filters">
          <label className="field cert-search">
            <span>Search</span>
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Name, certificate number, registration number, or course"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span>Status</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Any status</option>
              <option value="ISSUED">Valid</option>
              <option value="REVOKED">Revoked</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </label>

          <label className="field">
            <span>Certificate</span>
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Any kind</option>
              {CERTIFICATE_KIND.map((k) => (
                <option key={k} value={k}>
                  {CERTIFICATE_KIND_COPY[k].label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error && <ErrorState message={error} onRetry={load} />}

      {!error && rows === null && <SkeletonTable rows={6} columns={6} />}

      {!error && rows?.length === 0 && (
        <EmptyState
          icon="award"
          title={filtered ? "Nothing matches that" : "No certificates have been issued yet"}
          action={
            filtered ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setTerm("");
                  setQ("");
                  setStatus("");
                  setKind("");
                  setPage(1);
                }}
              >
                Clear the filters
              </button>
            ) : undefined
          }
        >
          {filtered
            ? "Try a shorter search, or clear the filters. A certificate number can be typed in full or in part."
            : "Certificates appear here as soon as they are issued — either from “Issue for a subject”, once a student meets the requirements, or by hand for a workshop."}
        </EmptyState>
      )}

      {rows && rows.length > 0 && (
        <section className="card">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Certificate</th>
                  <th>Holder</th>
                  <th>Awarded for</th>
                  <th>Kind</th>
                  <th className="when">Issued</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="num">
                      <span className="certificate-no">{c.certificateNo}</span>
                      {c.issuedManually && (
                        <>
                          <br />
                          <span className="muted small">By hand</span>
                        </>
                      )}
                    </td>
                    <td className="wrap">
                      <strong>{c.student.name}</strong>
                      {c.student.registrationNo && (
                        <>
                          <br />
                          <span className="muted small">{c.student.registrationNo}</span>
                        </>
                      )}
                    </td>
                    <td className="wrap">
                      {c.award.title}
                      {c.award.programme && (
                        <>
                          <br />
                          <span className="muted small">{c.award.programme}</span>
                        </>
                      )}
                    </td>
                    <td>{CERTIFICATE_KIND_COPY[c.kind].label}</td>
                    <td className="when">{new Date(c.issuedAt).toLocaleDateString()}</td>
                    <td>
                      <span
                        className={
                          c.status === "ISSUED"
                            ? "pill pill-ok"
                            : c.status === "REVOKED"
                              ? "pill pill-danger"
                              : "pill"
                        }
                      >
                        {CERTIFICATE_STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td>
                      <span className="row-actions">
                        <button type="button" className="btn btn-sm" onClick={() => setOpen(c)}>
                          Open
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-quiet"
                          onClick={() => copyLink(c)}
                        >
                          <Icon name="link" />
                          {copied === c.id ? "Copied" : "Link"}
                        </button>
                        {c.status === "ISSUED" && (
                          <button
                            type="button"
                            className="btn btn-sm btn-quiet"
                            onClick={() => setRevoking(c)}
                          >
                            Revoke
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="row-actions cert-pager">
              <button
                type="button"
                className="btn btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <Icon name="chevron-left" />
                Previous
              </button>
              <span className="muted small">
                Page {page} of {pages} · {total} certificate{total === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
                <Icon name="chevron-right" />
              </button>
            </div>
          )}
        </section>
      )}

      {open && <CertificateModal certificate={open} onClose={() => setOpen(null)} />}

      {revoking && (
        <RevokeDialog
          certificate={revoking}
          onClose={() => setRevoking(null)}
          onDone={() => {
            setRevoking(null);
            load();
          }}
        />
      )}
    </>
  );
}

/**
 * Revoking, with its reason — FR-CRT-012.
 *
 * THE REASON IS NOT OPTIONAL and it is not a formality: it is what the
 * Institute will have to stand behind if the holder challenges it, possibly
 * years later and possibly in front of somebody who was not there. The server
 * requires ten characters; the dialog says so before the button is pressed
 * rather than after.
 *
 * The certificate is NOT deleted, and the dialog says that too. An
 * administrator who believes "revoke" means "remove" will use it to tidy up.
 */
function RevokeDialog({
  certificate: c,
  onClose,
  onDone,
}: {
  certificate: CertificateDocument;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = reason.trim().length < 10;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Revoke certificate">
      <div className="modal modal-sm">
        <header className="modal-head card-head">
          <h2>Revoke {c.certificateNo}?</h2>
        </header>

        <p>
          <strong>{c.student.name}</strong> — {c.award.title}
        </p>
        <p className="muted small">
          The record is kept and the number is never reused. Anyone checking the certificate — with
          the link or the QR code — will be told plainly that the Institute has withdrawn it.
        </p>

        <label className="field">
          <span>Why is it being withdrawn?</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Issued against the wrong student record; replaced by CERT-2026-000112."
          />
        </label>
        <p className={tooShort && reason.length > 0 ? "warn small" : "muted small"}>
          At least ten characters. This is kept on the record, not published.
        </p>

        {error && (
          <div className="alert alert-error" role="alert">
            <p>{error}</p>
          </div>
        )}

        <div className="row-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || tooShort}
            onClick={() => {
              setBusy(true);
              setError(null);
              api
                .post(`/certificates/${c.id}/revoke`, { reason: reason.trim() })
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
            {busy ? "Revoking…" : "Revoke the certificate"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>
            Keep it
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------ issue by hand ------

interface StudentMatch {
  id: string;
  name: string;
  registrationNo: string | null;
  rollNo: number | null;
}

/**
 * FR-CRT-002, the manual route — and the shortest form in the application.
 *
 * TWO FIELDS ARE REQUIRED: who it is for, and what it is for. Everything else
 * already has a sensible answer — today's date, the Institute's name from
 * settings, a completion kind — and an office issuing forty workshop
 * certificates should type forty names, not four hundred and forty fields.
 *
 * ATTACHING A STUDENT IS OPTIONAL, which is the whole point of the route. A
 * weekend workshop attended by people who are not enrolled in anything is a
 * real thing an institute certifies, and requiring a Student row would mean
 * inventing accounts for people who will never sign in. When a student IS
 * picked, the certificate joins their "My certificates" — so the search is
 * offered first and skipping it is one click.
 */
function ManualPanel({ onIssued }: { onIssued: () => void }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CertificateKind>("COMPLETION");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [student, setStudent] = useState<StudentMatch | null>(null);
  const [matches, setMatches] = useState<StudentMatch[]>([]);
  const [searching, setSearching] = useState("");

  const [more, setMore] = useState(false);
  const [instructorName, setInstructorName] = useState("");
  const [instructorTitle, setInstructorTitle] = useState("");
  const [durationText, setDurationText] = useState("");
  const [completionDate, setCompletionDate] = useState("");
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [made, setMade] = useState<CertificateDocument | null>(null);

  /* The lookup is a convenience, not a requirement, so it stays quiet: no
     spinner, no "no results", nothing that would make skipping it feel like
     an error. Two characters before it asks the server anything. */
  useEffect(() => {
    const term = searching.trim();
    if (term.length < 2) {
      setMatches([]);
      return;
    }
    const t = window.setTimeout(() => {
      api
        .get<StudentMatch[]>(`/certificates/students?q=${encodeURIComponent(term)}`)
        .then(setMatches)
        .catch(() => setMatches([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [searching]);

  const reset = () => {
    setName("");
    setTitle("");
    setKind("COMPLETION");
    setStudent(null);
    setSearching("");
    setMatches([]);
    setInstructorName("");
    setInstructorTitle("");
    setDurationText("");
    setCompletionDate("");
    setNote("");
  };

  const submit = () => {
    setBusy(true);
    setErrors(null);

    /* A date input gives a plain day. The contract wants an instant with an
       offset, and midnight LOCAL is the honest reading of "the 24th" — a UTC
       midnight would print as the 23rd for anybody west of Greenwich. */
    const asInstant = (day: string) => new Date(`${day}T00:00:00`).toISOString();

    const body: Record<string, unknown> = {
      studentName: name.trim(),
      title: title.trim(),
      kind,
      issueDate: asInstant(issueDate),
    };
    if (student) {
      body.studentId = student.id;
      if (student.registrationNo) body.registrationNo = student.registrationNo;
      if (student.rollNo !== null) body.rollNo = student.rollNo;
    }
    if (instructorName.trim()) body.instructorName = instructorName.trim();
    if (instructorTitle.trim()) body.instructorTitle = instructorTitle.trim();
    if (durationText.trim()) body.durationText = durationText.trim();
    if (completionDate) body.completionDate = asInstant(completionDate);
    if (note.trim()) body.note = note.trim();

    api
      .post<CertificateDocument>("/certificates", body)
      .then((c) => {
        setMade(c);
        reset();
        onIssued();
      })
      .catch((e) =>
        setErrors(
          e instanceof ApiError
            ? (e.details?.map((d) => d.message) ?? [e.message])
            : ["That certificate could not be issued."],
        ),
      )
      .finally(() => setBusy(false));
  };

  const ready = name.trim().length >= 2 && title.trim().length >= 2;

  return (
    <>
      <section className="card">
        <h2>Issue a certificate by hand</h2>
        <p className="muted small">
          For a workshop, a guest cohort, or anything the System did not teach. Two things are
          needed: whose name goes on it, and what it is for.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !busy) submit();
          }}
        >
          <div className="field-row">
            <label className="field">
              <span>Name on the certificate</span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  /* Typing over a linked student unlinks them. The alternative
                     is a certificate that says one name and is filed under
                     another, which nobody would notice until it mattered. */
                  if (student && e.target.value !== student.name) setStudent(null);
                  setSearching(e.target.value);
                }}
                placeholder="Ayesha Khan"
                autoComplete="off"
              />
            </label>

            <label className="field">
              <span>What it is for</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Weekend Workshop in Product Design"
                autoComplete="off"
              />
            </label>
          </div>

          {/* The link to a real student, offered while they type the name and
              never demanded. */}
          {student ? (
            <p className="cert-linked">
              <Icon name="tick" /> Linked to <strong>{student.name}</strong>
              {student.registrationNo ? ` (${student.registrationNo})` : ""} — it will appear in
              their My certificates.{" "}
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                onClick={() => setStudent(null)}
              >
                Unlink
              </button>
            </p>
          ) : (
            matches.length > 0 && (
              <div className="cert-matches">
                <p className="muted small">
                  Enrolled students with a similar name. Picking one files the certificate under
                  their record; skip this for somebody who is not enrolled.
                </p>
                <ul className="list small">
                  {matches.slice(0, 6).map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        onClick={() => {
                          setStudent(m);
                          setName(m.name);
                          setMatches([]);
                        }}
                      >
                        {m.name}
                        {m.registrationNo ? ` · ${m.registrationNo}` : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}

          <div className="field-row">
            <label className="field">
              <span>Kind of certificate</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as CertificateKind)}>
                {CERTIFICATE_KIND.map((k) => (
                  <option key={k} value={k}>
                    {CERTIFICATE_KIND_COPY[k].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Issue date</span>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </label>
          </div>

          <details className="cert-more" open={more} onToggle={(e) => setMore(e.currentTarget.open)}>
            <summary>Instructor, duration and dates</summary>

            <div className="field-row">
              <label className="field">
                <span>Instructor name</span>
                <input
                  value={instructorName}
                  onChange={(e) => setInstructorName(e.target.value)}
                  placeholder="Left blank, no instructor line is printed"
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span>Instructor title</span>
                <input
                  value={instructorTitle}
                  onChange={(e) => setInstructorTitle(e.target.value)}
                  placeholder="Course Instructor"
                  autoComplete="off"
                />
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>Duration</span>
                <input
                  value={durationText}
                  onChange={(e) => setDurationText(e.target.value)}
                  placeholder="12 weeks · 60 contact hours"
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span>Completed on</span>
                <input
                  type="date"
                  value={completionDate}
                  onChange={(e) => setCompletionDate(e.target.value)}
                />
              </label>
            </div>

            <label className="field">
              <span>Note for the record</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why this was issued by hand. Kept in the audit log, never printed."
                autoComplete="off"
              />
            </label>
          </details>

          {errors && (
            <div className="alert alert-error" role="alert">
              <ul className="list small">
                {errors.map((m) => (
                  <li key={m}>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="row-actions">
            <button type="submit" className="btn btn-primary" disabled={!ready || busy}>
              {busy ? "Issuing…" : "Generate the certificate"}
            </button>
            <span className="muted small">
              A permanent number and a verification code are allocated on issue.
            </span>
          </div>
        </form>
      </section>

      {/* Straight to the document. The next thing they want is to look at it,
          and the one after that is to send it. */}
      {made && <CertificateModal certificate={made} onClose={() => setMade(null)} />}
    </>
  );
}

// ------------------------------------------------- issue what was earned ---

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

/**
 * Issuing what was earned.
 *
 * An administrator opens this with one question: who can I issue to now. So
 * the eligible students are listed first and the button is only enabled for
 * them — the server refuses an unearned certificate regardless, but offering a
 * button that will be refused wastes their time and teaches them to ignore
 * errors.
 *
 * Students who have NOT met the criteria are still listed, with their
 * standing, because "why is this student not here" is the immediate next
 * question and an absence cannot answer it.
 */
function EarnedPanel({ onIssued }: { onIssued: () => void }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [offeringId, setOfferingId] = useState("");
  const [view, setView] = useState<IssuanceView | null>(null);
  // `view` is null BOTH before a subject is chosen and while one is loading,
  // and those are different screens: one is waiting for the reader, the other
  // is waiting for the server.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items?: Section[] } | Section[]>("/sections")
      .then((r) => setSections(Array.isArray(r) ? r : (r.items ?? [])))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load batches."));
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
      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      <section className="card">
        <div className="field-row">
          <label className="field">
            <span>Batch</span>
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">Choose a batch…</option>
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
                {offerings.length === 0 ? "Choose a batch first" : "Choose a subject…"}
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
          Pick a batch and a subject above to see who has met the requirements for a certificate,
          and who is short of them.
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
                  onIssued={() => {
                    load();
                    onIssued();
                  }}
                />
              ))}
          </ul>
        </section>
      )}

      {/* The whole-programme certificate, which needs a student rather than a
          subject — so it has its own panel rather than a button hidden in the
          subject list where nobody would look for it. */}
      {sectionId && (
        <ProgrammePanel
          sectionId={sectionId}
          onIssued={onIssued}
        />
      )}
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
function ProgrammePanel({ sectionId, onIssued }: { sectionId: string; onIssued: () => void }) {
  const [roster, setRoster] = useState<Array<{ id: string; name: string }>>([]);
  const [studentId, setStudentId] = useState("");
  const [programmes, setProgrammes] = useState<Array<{ id: string; name: string }>>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [standing, setStanding] = useState<Standing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<CertificateDocument | null>(null);

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
                  .post<CertificateDocument>(
                    `/students/${studentId}/certificates/programme/${programmeId}`,
                  )
                  .then((c) => {
                    setMade(c);
                    onIssued();
                    load();
                  })
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

      {made && <CertificateModal certificate={made} onClose={() => setMade(null)} />}
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
  const [made, setMade] = useState<CertificateDocument | null>(null);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await api.post<CertificateDocument>(
        `/students/${c.studentId}/certificates/subject/${sectionSubjectId}`,
      );
      setMade(made);
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

      {made && <CertificateModal certificate={made} onClose={() => setMade(null)} />}
    </li>
  );
}
