import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { EmptyState, ErrorState, Skeleton } from "../components/Ui";
import { Field } from "../components/Field";

/**
 * THE PARTNER PORTAL — what somebody from a sending institute sees. SRS §9.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE SCREEN, NOT A SECOND APPLICATION. A partner signs into the same shell as
 * everybody else, with the same sidebar, the same theme and the same account
 * menu. Building them a separate app would mean a second place to fix every
 * layout bug for the sake of an audience of about four people per institute.
 *
 * IT IS READ-ONLY AND IT SAYS SO. There is not a single control on this page
 * that changes anything — no button that marks, edits, enrols or releases. The
 * server would refuse all of those anyway (the `partner_admin` role holds no
 * write grant except paying its own invoice), but a screen that offers an
 * action and then refuses it is a screen that wastes somebody's afternoon.
 *
 * WHAT IS DELIBERATELY ABSENT IS THE INTERESTING PART:
 *
 *   · Any student who is not theirs. Not a row, not a name, not a COUNT. The
 *     scope predicate does that, not this file — see partner-isolation.spec.ts.
 *   · Any individual's payment history or receipts. Even under PARTNER_PAYS,
 *     where they are shown an invoice line per student, they never see a
 *     ledger.
 *   · Anything financial at all under STUDENT_PAYS. `seesInvoices` comes from
 *     the server; the tab does not exist rather than showing an empty page,
 *     because an empty Invoices page implies there could be invoices.
 *   · Unreleased marks. BR-ASG-09 holds a mark until the cohort is released,
 *     and a partner must not learn a result before the student does.
 *
 * WHY THERE ARE NO PERCENTAGES ON THE LIST. A coordinator scanning forty rows
 * wants to know who is in trouble, and a column of marks invites ranking
 * students against each other in a screen their own teachers never see. The
 * list carries identity; the results live one click away, on the student they
 * belong to.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface Me {
  id: string;
  name: string;
  code: string;
  billingMode: "PARTNER_PAYS" | "STUDENT_PAYS";
  studentCount: number;
  seesInvoices: boolean;
}

interface StudentRow {
  id: string;
  name: string;
  registrationNo: string;
  rollNo: string | null;
  programme: string | null;
  section: string | null;
  feePaidBy: string;
}

interface StudentDetail {
  student: StudentRow & { admissionDate: string | null };
  subjects: Array<{
    subject: string;
    decision: string;
    percent: number | null;
    criteriaMet: boolean;
    decidedAt: string | null;
  }>;
  attendanceWarnings: Array<{
    subject: string;
    severity: string;
    percentage: number;
    threshold: number;
    raisedAt: string | null;
  }>;
  certificates: Array<{
    id: string;
    number: string;
    kind: string;
    status: string;
    issuedAt: string | null;
  }>;
}

interface Invoice {
  id: string;
  number: string;
  periodLabel: string | null;
  status: string;
  currency: string;
  total: number;
  paid: number;
  outstanding: number;
  issuedAt: string | null;
  dueDate: string | null;
  studentCount: number;
}

interface InvoiceDetail extends Omit<Invoice, "studentCount"> {
  notes: string | null;
  lines: Array<{
    id: string;
    student: string;
    registrationNo: string;
    programme: string | null;
    description: string;
    amount: number;
  }>;
}

type Tab = "students" | "invoices";

export function PartnerPortalPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("students");
  /** The student whose results are open, or null for the list. */
  const [openStudent, setOpenStudent] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMe(await api.get<Me>("/partner/me"));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Your institute's details could not be loaded.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!me) return <Skeleton lines={6} />;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{me.name}</h1>
          <p className="muted small">
            {me.studentCount === 0
              ? "No students have been enrolled against your institute yet."
              : `${me.studentCount} student${me.studentCount === 1 ? "" : "s"} studying with us`}
            {" · "}
            {me.billingMode === "PARTNER_PAYS"
              ? "We invoice your institute for these students."
              : "Your students pay us directly."}
          </p>
        </div>
      </header>

      {/*
        THE TABS EXIST ONLY WHEN THERE IS SOMETHING BEHIND BOTH OF THEM. A
        STUDENT_PAYS partner has no financial relationship with us, so they get
        no tab strip at all rather than one with a single tab in it.
      */}
      {me.seesInvoices && (
        <div className="marker-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "students"}
            className={tab === "students" ? "marker-tab is-valid" : "marker-tab"}
            onClick={() => {
              setTab("students");
              setOpenStudent(null);
            }}
          >
            Students
          </button>
          <button
            role="tab"
            aria-selected={tab === "invoices"}
            className={tab === "invoices" ? "marker-tab is-valid" : "marker-tab"}
            onClick={() => setTab("invoices")}
          >
            Invoices
          </button>
        </div>
      )}

      {tab === "students" &&
        (openStudent ? (
          <OneStudent id={openStudent} onBack={() => setOpenStudent(null)} />
        ) : (
          <StudentList onOpen={setOpenStudent} />
        ))}

      {tab === "invoices" && me.seesInvoices && <Invoices currency={me.code} />}
    </>
  );
}

/* ========================================================================== *
 *  THEIR STUDENTS
 * ========================================================================== */

function StudentList({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async (query: string) => {
    setError(null);
    try {
      const path = query.trim()
        ? `/partner/students?q=${encodeURIComponent(query.trim())}`
        : "/partner/students";
      setRows(await api.get<StudentRow[]>(path));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Your students could not be loaded.");
    }
  }, []);

  useEffect(() => {
    /* Debounced, so typing a registration number is not forty requests. */
    const t = setTimeout(() => void load(q), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Your students</h2>
      </div>

      <Field label="Find a student" hint="By name or registration number.">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
      </Field>

      {error && <ErrorState message={error} onRetry={() => void load(q)} />}
      {!rows && !error && <Skeleton lines={5} />}

      {rows && rows.length === 0 && (
        <EmptyState icon="users" title={q ? "Nobody matches that" : "No students yet"}>
          {q
            ? "Try part of a name, or the registration number on its own."
            : "Once we have enrolled the students your institute sent us, they will be listed here."}
        </EmptyState>
      )}

      {rows && rows.length > 0 && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Registration no.</th>
                <th scope="col">Course</th>
                <th scope="col">Batch</th>
                <th scope="col">Fees paid by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button className="link-button" onClick={() => onOpen(s.id)}>
                      {s.name}
                    </button>
                  </td>
                  <td>{s.registrationNo}</td>
                  <td>{s.programme ?? <span className="muted">—</span>}</td>
                  <td>{s.section ?? <span className="muted">—</span>}</td>
                  <td>{s.feePaidBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ========================================================================== *
 *  ONE STUDENT'S RESULTS
 * ========================================================================== */

/**
 * EVERY OPENING OF THIS PANEL IS LOGGED against the person who opened it. A
 * third party reading somebody's daughter's marks is an event the Institute
 * has to be able to account for when a parent asks who has seen them, so the
 * server records it — see `partner.student.read` in partner.service.ts.
 */
function OneStudent({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<StudentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api
      .get<StudentDetail>(`/partner/students/${id}`)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e: unknown) => {
        if (live) {
          setError(
            e instanceof ApiError ? e.message : "That student's record could not be loaded.",
          );
        }
      });
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <section className="card">
      <div className="card-head">
        <button className="btn btn-sm btn-quiet" onClick={onBack}>
          ← All students
        </button>
      </div>

      {error && <ErrorState message={error} />}
      {!data && !error && <Skeleton lines={6} />}

      {data && (
        <>
          <h2>{data.student.name}</h2>
          <p className="muted small">
            {data.student.registrationNo}
            {data.student.programme && ` · ${data.student.programme}`}
            {data.student.section && ` · ${data.student.section}`}
            {data.student.rollNo && ` · Roll no. ${data.student.rollNo}`}
          </p>

          <h3>Subjects</h3>
          {data.subjects.length === 0 ? (
            <p className="muted small">
              No subject has been decided yet. Results appear here once the Institute releases
              them — never before the student has seen them.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Subject</th>
                    <th scope="col">Result</th>
                    <th scope="col">Mark</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subjects.map((s) => (
                    <tr key={s.subject}>
                      <td>{s.subject}</td>
                      <td>{s.decision}</td>
                      <td>
                        {s.percent === null ? (
                          <span className="muted">—</span>
                        ) : (
                          `${s.percent.toFixed(1)}%`
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3>Attendance</h3>
          {data.attendanceWarnings.length === 0 ? (
            <p className="muted small">No attendance warnings. Nothing to be concerned about.</p>
          ) : (
            <ul className="list">
              {data.attendanceWarnings.map((w, i) => (
                <li key={i}>
                  {/* The severity is in the WORDS as well as the colour of the
                      pill — NFR-ACC-007, never colour alone. */}
                  <span className={w.severity === "CRITICAL" ? "pill pill-danger" : "pill pill-warn"}>
                    {w.severity === "CRITICAL" ? "Critical" : "Warning"}
                  </span>{" "}
                  {w.subject} — {w.percentage.toFixed(0)}% attended, against a requirement of{" "}
                  {w.threshold.toFixed(0)}%.
                </li>
              ))}
            </ul>
          )}

          <h3>Certificates</h3>
          {data.certificates.length === 0 ? (
            <p className="muted small">None issued yet.</p>
          ) : (
            <ul className="list">
              {data.certificates.map((c) => (
                <li key={c.id}>
                  {c.kind} — {c.number}{" "}
                  {c.status !== "ISSUED" && <span className="pill pill-warn">{c.status}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/* ========================================================================== *
 *  INVOICES — PARTNER_PAYS ONLY
 * ========================================================================== */

function Invoices({ currency }: { currency: string }) {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The invoice whose students are being read, or null for the list. */
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Invoice[]>("/partner/invoices")
      .then(setRows)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : "Your invoices could not be loaded."),
      );
  }, []);

  if (error) return <ErrorState message={error} />;
  if (open) return <OneInvoice id={open} onBack={() => setOpen(null)} />;
  if (!rows) return <Skeleton lines={5} />;

  if (rows.length === 0) {
    return (
      <EmptyState icon="money" title="No invoices yet">
        Once we have billed your institute for a period, the invoice and the students it covers
        will appear here.
      </EmptyState>
    );
  }

  return (
    <section className="card">
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Invoice</th>
              <th scope="col">Period</th>
              <th scope="col">Students</th>
              <th scope="col">Total</th>
              <th scope="col">Outstanding</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td>
                  <button className="link-button" onClick={() => setOpen(i.id)}>
                    {i.number}
                  </button>
                </td>
                <td>{i.periodLabel ?? <span className="muted">—</span>}</td>
                <td>{i.studentCount}</td>
                <td>
                  {i.currency} {i.total.toLocaleString()}
                </td>
                <td>
                  {i.outstanding > 0 ? (
                    <strong>
                      {i.currency} {i.outstanding.toLocaleString()}
                    </strong>
                  ) : (
                    <span className="muted">Nothing owed</span>
                  )}
                </td>
                <td>
                  <span className={i.outstanding > 0 ? "pill pill-warn" : "pill pill-ok"}>
                    {i.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Open an invoice to see the students it covers. Quote your code{" "}
        <strong>{currency}</strong> and the invoice number on any query.
      </p>
    </section>
  );
}

/**
 * ONE INVOICE, AND THE STUDENTS IT COVERS.
 *
 * THE LINES ARE THE WHOLE POINT. A total on its own is a number an institute
 * has to take on trust; a line per student — with the registration number they
 * know them by — is a document their own bursar can reconcile against their
 * own records. That is the difference between an invoice that gets paid and
 * one that generates a telephone call.
 *
 * THE FIGURES ARE AS THEY WERE WHEN IT WAS ISSUED, not as they are today. Each
 * line carries the name, registration number and course snapshotted at the
 * moment the invoice was raised (BR-DAT-02), so a student who later transfers
 * course does not silently rewrite a document the partner is holding a copy
 * of.
 *
 * AND STILL NO LEDGER. What is outstanding on the INVOICE is shown, because
 * that is the partner's own debt. What any individual student has paid is not,
 * because that is somebody else's business even when the institute is the one
 * being billed.
 */
function OneInvoice({ id, onBack }: { id: string; onBack: () => void }) {
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<InvoiceDetail>(`/partner/invoices/${id}`)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e: unknown) => {
        if (live) {
          setError(e instanceof ApiError ? e.message : "That invoice could not be loaded.");
        }
      });
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <section className="card">
      <div className="card-head">
        <button className="btn btn-sm btn-quiet" onClick={onBack}>
          ← All invoices
        </button>
      </div>

      {error && <ErrorState message={error} />}
      {!data && !error && <Skeleton lines={6} />}

      {data && (
        <>
          <h2>{data.number}</h2>
          <p className="muted small">
            {data.periodLabel}
            {data.issuedAt && ` · issued ${new Date(data.issuedAt).toLocaleDateString()}`}
            {data.dueDate && ` · due ${new Date(data.dueDate).toLocaleDateString()}`}
          </p>

          <div className="fee-figures">
            <div className="fee-figure">
              <span className="fee-figure-label">Total</span>
              <span className="fee-figure-value">
                {data.currency} {data.total.toLocaleString()}
              </span>
            </div>
            <div className="fee-figure">
              <span className="fee-figure-label">Paid</span>
              <span className="fee-figure-value">
                {data.currency} {data.paid.toLocaleString()}
              </span>
            </div>
            <div className="fee-figure">
              <span className="fee-figure-label">Outstanding</span>
              <span className="fee-figure-value">
                {data.currency} {data.outstanding.toLocaleString()}
              </span>
            </div>
          </div>

          {data.notes && <p className="small">{data.notes}</p>}

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Registration no.</th>
                  <th scope="col">For</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.student}</td>
                    <td>{l.registrationNo}</td>
                    <td>{l.description}</td>
                    <td>
                      {data.currency} {l.amount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
