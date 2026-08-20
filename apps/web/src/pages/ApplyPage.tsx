import { useEffect, useState } from "react";
import { Skeleton } from "../components/Ui";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { EDUCATION_LEVEL, EDUCATION_LEVEL_LABEL } from "@lms/shared";

/**
 * The public application — SRS §13.2, FR-REG-001..010.
 *
 * The last piece of a path that no member of the public could walk. The
 * endpoint has always existed; nothing returned a programme id, nothing could
 * create a payment slip, and the code that attached one did nothing. All of
 * that is fixed, and this is the form.
 *
 * NO ACCOUNT, and that is the requirement. Somebody who has not enrolled
 * cannot have a login, so every field here goes to a public endpoint and the
 * only thing they get back is a tracking reference.
 *
 * IN STEPS, because it is nineteen fields and a file. One long form on a phone
 * is where an applicant gives up, and the steps are ordered so the easiest
 * questions come first and the payment — the part that needs them to go and
 * find a slip — comes last, once they have already invested something.
 *
 * NOTHING IS SUBMITTED UNTIL THE LAST STEP. The slip uploads early because it
 * has to exist before the application names it, but no application is created
 * until the applicant presses the button, so abandoning halfway leaves an
 * unattached file and no half-record for a reviewer to puzzle over.
 */

interface Section {
  id: string;
  name: string;
  shift: string;
  genderRestriction: string;
  session: string;
}

interface Programme {
  id: string;
  name: string;
  code: string;
  sections: Section[];
}

const SHIFT: Record<string, string> = {
  MORNING: "Morning",
  EVENING: "Evening",
  WEEKEND: "Weekend",
};

const SOURCES = [
  ["FACEBOOK", "Facebook"],
  ["INSTAGRAM", "Instagram"],
  ["WHATSAPP", "WhatsApp"],
  ["WEBSITE", "The website"],
  ["REFERRAL", "Somebody told me"],
  ["WALK_IN", "I visited the office"],
  ["OTHER", "Something else"],
] as const;

/** The notice version recorded with the consent (SEC-PRV-003). */
const CONSENT_VERSION = "2026-01";

export function ApplyPage() {
  const [programmes, setProgrammes] = useState<Programme[] | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    trackingRef: string;
    email: string;
    /** Absent when the application was a duplicate — nothing is emailed then. */
    emailSent?: boolean;
  } | null>(null);

  // Kept flat rather than nested: it is posted flat, and a shape that matches
  // the request is one fewer thing to get wrong.
  const [f, setF] = useState({
    fullName: "",
    fatherName: "",
    dateOfBirth: "",
    gender: "",
    nationalId: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    educationLevel: "",
    qualification: "",
    desiredProgrammeId: "",
    desiredSectionId: "",
    acquisitionSource: "",
    acquisitionDetail: "",
    claimedAmount: "",
    claimedPaymentDate: "",
    claimedBankRef: "",
  });
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);

  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    api
      .get<Programme[]>("/public/prospectus")
      .then(setProgrammes)
      .catch(() => setProgrammes([]));
  }, []);

  const programme = programmes?.find((p) => p.id === f.desiredProgrammeId);
  const section = programme?.sections.find((s) => s.id === f.desiredSectionId);

  if (done)
    return (
      <Submitted
        trackingRef={done.trackingRef}
        email={done.email}
        emailSent={done.emailSent === true}
      />
    );

  const steps = [
    { title: "What you want to study", done: !!f.desiredSectionId },
    { title: "About you", done: !!(f.fullName && f.fatherName && f.dateOfBirth && f.gender && f.nationalId) },
    { title: "How to reach you", done: !!(f.phone && f.email && f.address && f.city) },
    { title: "Your payment", done: documentIds.length > 0 && !!f.claimedAmount && !!f.claimedPaymentDate },
  ];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ trackingRef: string; email: string; emailSent?: boolean }>(
        "/public/registrations",
        {
          ...f,
          claimedAmount: Number(f.claimedAmount),
          phoneIsWhatsapp: true,
          documentIds,
          consentVersion: CONSENT_VERSION,
          consentAccepted: true,
          ...(f.acquisitionDetail ? {} : { acquisitionDetail: undefined }),
        },
      );
      setDone(r);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
      // Back to the first step that is incomplete, so a validation message
      // about a field three steps back is not shown beside a field it does not
      // describe.
      const firstBad = steps.findIndex((s) => !s.done);
      if (firstBad >= 0) setStep(firstBad);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link className="auth-logo" to="/">
          <img className="brand-mark" src="/brand/ppship-emblem.png" alt="" width="32" height="32" />
          Prepreneurship
        </Link>
        <Link className="btn btn-quiet" to="/login">
          Sign in
        </Link>
      </header>

      <div className="apply-shell">
        <header className="page-head">
          <div>
            <h1>Apply to Prepreneurship</h1>
            <p className="muted">
              No account needed. It takes about five minutes, and you will need a photo of your
              payment slip at the end.
            </p>
          </div>
        </header>

        {/* Where they are, and what is left. A form with no visible end is one
            people abandon at the third question. */}
        <ol className="steps">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className={i === step ? "step is-current" : s.done ? "step is-done" : "step"}
            >
              <span className="step-no" aria-hidden="true">
                {s.done && i !== step ? "✓" : i + 1}
              </span>
              <button type="button" className="link-button" onClick={() => setStep(i)}>
                {s.title}
              </button>
            </li>
          ))}
        </ol>

        {error && (
          <div className="alert alert-error" role="alert">
            <strong>That could not be sent</strong>
            <p>{error.message}</p>
            {error.details?.map((d) => (
              <p key={d.field} className="small">
                {d.message}
              </p>
            ))}
          </div>
        )}

        <section className="card">
          {step === 0 && (
            <>
              <h2>What you want to study</h2>
              {!programmes ? (
                <Skeleton lines={2} />
              ) : programmes.length === 0 ? (
                <p className="muted">
                  Nothing is open for enrolment at the moment. Please speak to the office.
                </p>
              ) : (
                <>
                  <label className="field">
                    <span>Programme</span>
                    <select
                      value={f.desiredProgrammeId}
                      onChange={(e) => {
                        set("desiredProgrammeId")(e.target.value);
                        // The section belongs to the programme; keeping a stale
                        // one would submit a pairing that does not exist.
                        set("desiredSectionId")("");
                      }}
                    >
                      <option value="">Choose a programme…</option>
                      {programmes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  {programme && (
                    <label className="field">
                      <span>Which section</span>
                      <select
                        value={f.desiredSectionId}
                        onChange={(e) => set("desiredSectionId")(e.target.value)}
                      >
                        <option value="">Choose a section…</option>
                        {programme.sections.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} — {SHIFT[s.shift] ?? s.shift}
                            {s.genderRestriction !== "MIXED"
                              ? ` (${s.genderRestriction.toLowerCase()} only)`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {/* FR-CRS-009 is absolute, so it is said BEFORE they fill in
                      the rest rather than as a rejection afterwards. */}
                  {section && section.genderRestriction !== "MIXED" && (
                    <div className="alert alert-warn">
                      <p className="small">
                        {section.name} admits {section.genderRestriction.toLowerCase()} students
                        only. If that is not you, please choose another section — this cannot be
                        waived.
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <h2>About you</h2>
              <Field label="Your full name" value={f.fullName} onChange={set("fullName")} />
              <Field
                label="Your father's or guardian's name"
                value={f.fatherName}
                onChange={set("fatherName")}
              />
              <div className="field-row">
                <Field
                  label="Date of birth"
                  type="date"
                  value={f.dateOfBirth}
                  onChange={set("dateOfBirth")}
                />
                <label className="field">
                  <span>Gender</span>
                  <select value={f.gender} onChange={(e) => set("gender")(e.target.value)}>
                    <option value="">Choose…</option>
                    <option value="FEMALE">Female</option>
                    <option value="MALE">Male</option>
                  </select>
                </label>
              </div>
              <Field
                label="CNIC"
                value={f.nationalId}
                onChange={set("nationalId")}
                hint="Thirteen digits, with or without dashes."
              />
              {/*
                The LEVEL from a list, and the detail as free text beside it.
                "FSc", "F.Sc" and "Intermediate" are one answer typed three
                ways, and a report grouping them is one nobody can trust — so
                the countable part is a choice and the describable part is not.
              */}
              <label className="field">
                <span>Your education</span>
                <select
                  value={f.educationLevel}
                  onChange={(e) => set("educationLevel")(e.target.value)}
                  required
                >
                  <option value="">Choose one…</option>
                  {EDUCATION_LEVEL.map((level) => (
                    <option key={level} value={level}>
                      {EDUCATION_LEVEL_LABEL[level]}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="What exactly, and when"
                value={f.qualification}
                onChange={set("qualification")}
                hint="For example: FSc Pre-Engineering, 2024 — or the madrasah and year."
              />
            </>
          )}

          {step === 2 && (
            <>
              <h2>How to reach you</h2>
              <Field
                label="Mobile number"
                value={f.phone}
                onChange={set("phone")}
                hint="We will use this on WhatsApp for class announcements."
              />
              <Field label="Email address" type="email" value={f.email} onChange={set("email")} />
              <Field label="Address" value={f.address} onChange={set("address")} />
              <Field label="City" value={f.city} onChange={set("city")} />

              <label className="field">
                <span>How did you hear about us?</span>
                <select
                  value={f.acquisitionSource}
                  onChange={(e) => set("acquisitionSource")(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {SOURCES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              {/* FR-REG-005 — these two require a detail, so the box appears
                  rather than the submission being refused for a missing field
                  the applicant was never shown. */}
              {["REFERRAL", "OTHER"].includes(f.acquisitionSource) && (
                <Field
                  label={f.acquisitionSource === "REFERRAL" ? "Who told you about us?" : "Please tell us more"}
                  value={f.acquisitionDetail}
                  onChange={set("acquisitionDetail")}
                />
              )}
            </>
          )}

          {step === 3 && (
            <>
              <h2>Your payment</h2>
              <p className="muted small">
                Pay the fee into the Institute's account, then attach a photo of the slip. The
                office checks it against the bank before your place is confirmed.
              </p>

              <SlipUpload
                documentIds={documentIds}
                onUploaded={(id) => setDocumentIds((d) => (d.includes(id) ? d : [...d, id]))}
                onRemove={(id) => setDocumentIds((d) => d.filter((x) => x !== id))}
              />

              <div className="field-row">
                <Field
                  label="Amount you paid"
                  value={f.claimedAmount}
                  onChange={set("claimedAmount")}
                  hint="In rupees."
                />
                <Field
                  label="Date you paid"
                  type="date"
                  value={f.claimedPaymentDate}
                  onChange={set("claimedPaymentDate")}
                />
              </div>
              <Field
                label="Bank reference (optional)"
                value={f.claimedBankRef}
                onChange={set("claimedBankRef")}
                hint="The transaction number on the slip, if it has one."
              />

              {/* SEC-PRV-003 — the notice version and the moment are recorded.
                  It is a checkbox somebody has to tick, never a default. */}
              <label className="check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  I agree that Prepreneurship may hold and use the details above to consider this
                  application and, if I am admitted, to run my enrolment. I can ask for a copy of
                  what is held about me at any time.
                </span>
              </label>
            </>
          )}

          <div className="row-actions">
            {step > 0 && (
              <button className="btn" onClick={() => setStep((s) => s - 1)}>
                Back
              </button>
            )}
            {step < steps.length - 1 ? (
              <button
                className="btn btn-primary"
                disabled={!steps[step]!.done}
                onClick={() => setStep((s) => s + 1)}
              >
                Continue
              </button>
            ) : (
              <button
                className="btn btn-primary btn-lg"
                disabled={busy || !consent || !steps.every((s) => s.done)}
                onClick={() => void submit()}
              >
                {busy ? "Sending…" : "Send my application"}
              </button>
            )}
          </div>

          {/* Named, rather than a disabled button nobody can explain. */}
          {step === steps.length - 1 && !steps.every((s) => s.done) && (
            <p className="warn small">
              Still needed: {steps.filter((s) => !s.done).map((s) => s.title.toLowerCase()).join(", ")}.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

/**
 * The payment slip.
 *
 * Uploaded IMMEDIATELY rather than held until submission, because the
 * application names slip ids and they must exist first. The consequence is
 * that abandoning the form leaves an unattached file — which is why the server
 * keeps unattached slips findable and disposable.
 */
function SlipUpload({
  documentIds,
  onUploaded,
  onRemove,
}: {
  documentIds: string[];
  onUploaded: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.upload<{ documentId: string }>("/public/registrations/slips", form);
      onUploaded(r.documentId);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.details?.map((d) => d.message).join(" ") ?? e.message)
          : "That file could not be uploaded.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <span>Photo of your payment slip</span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        disabled={busy || documentIds.length >= 5}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      <span className="muted small">
        A photo from your phone is fine. JPEG, PNG or PDF, up to 5 MB. You can attach up to five.
      </span>

      {busy && <p className="muted small">Uploading…</p>}
      {error && <p className="warn small">{error}</p>}

      {documentIds.length > 0 && (
        <ul className="list small">
          {documentIds.map((id, i) => (
            <li key={id}>
              <span className="pill pill-ok">Slip {i + 1} attached</span>{" "}
              <button type="button" className="link-button" onClick={() => onRemove(id)}>
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What happens next.
 *
 * THE TRACKING REFERENCE IS THE WHOLE PAGE. It is the only way back to this
 * application without an account, so it is large, selectable in one click, and
 * accompanied by the thing to do with it.
 */
function Submitted({
  trackingRef,
  email,
  emailSent,
}: {
  trackingRef: string;
  email: string;
  emailSent: boolean;
}) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Link className="auth-logo" to="/">
          <img className="brand-mark" src="/brand/ppship-emblem.png" alt="" width="32" height="32" />
          Prepreneurship
        </Link>
      </header>

      <div className="apply-shell">
        <div className="card">
          <span className="pill pill-ok">Application received</span>
          <h1 style={{ marginTop: ".75rem" }}>Thank you — we have your application.</h1>

          <p className="muted">Keep this reference. It is how you check on your application.</p>
          <p className="password">{trackingRef}</p>

          {/* Say which it was. "A copy is on its way" when nothing was sent is
              how a person closes the page without writing the reference down. */}
          {emailSent ? (
            <p className="small muted">
              We have emailed a copy to <strong>{email}</strong>. If it is not there in a few
              minutes, look in your spam folder.
            </p>
          ) : (
            <div className="alert alert-warn">
              <strong>Write this reference down now.</strong>
              <p className="small">
                We could not email you a copy. Nothing is wrong with your application — but this
                page is the only place the reference is shown.
              </p>
            </div>
          )}

          <h3>What happens now</h3>
          <ul className="list small">
            <li>The office checks your payment slip against the bank record.</li>
            <li>
              If anything is unclear, somebody will contact you on the number or email you gave.
            </li>
            <li>
              When you are admitted, an account is created for you and you will be sent a temporary
              password to sign in with.
            </li>
          </ul>

          <div className="row-actions">
            {/* FR-REG-020 — the reference is only useful with somewhere to
                type it, and this is the one moment the applicant certainly
                has it in front of them. Pre-filled, so the first check costs
                them nothing. */}
            <Link className="btn btn-primary" to={`/track/${encodeURIComponent(trackingRef)}`}>
              Check your application
            </Link>
            <Link className="btn" to="/">
              Back to the home page
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
