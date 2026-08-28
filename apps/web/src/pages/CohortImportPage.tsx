import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api/client";
import { HowItWorks } from "../components/HowItWorks";
import { Field } from "../components/Field";

/**
 * Importing a cohort — SRS §13.10, FR-OPS-024..026.
 *
 * PREVIEW IS THE ONLY PATH TO THE BUTTON, as it is on the bulk changes screen
 * and for the same reason: the import is not all-or-nothing, so the way to get
 * it right is to look first. Choosing a file does not load anybody.
 *
 * THE PROBLEMS ARE LISTED BY SPREADSHEET ROW NUMBER, because that is where the
 * operator will go to fix them. A message about "the third student" is useless
 * in a file of three hundred; "row 47" is a place.
 *
 * THE PASSWORDS AT THE END ARE THE DIFFICULT PART. Every new account gets one,
 * shown exactly once — they are hashed the moment they are made and cannot be
 * looked up. For three hundred students, copying them one at a time is not
 * something anybody will do, so the list downloads as a file. That file is
 * live credentials, which is said plainly rather than left to be worked out.
 */

interface Section {
  id: string;
  code: string;
  name: string;
  genderRestriction?: string;
  capacity?: number;
  enrolledCount?: number;
}

interface RowProblem {
  line: number;
  field: string;
  message: string;
}

interface PreviewRow {
  line: number;
  fullName: string;
  email: string;
  gender: string;
  returningWith: string | null;
  blocked: string | null;
}

interface Preview {
  section: { id: string; name: string; genderRestriction: string; capacity: number; enrolledCount: number };
  fileProblem: { code: string; message: string } | null;
  unknownColumns: string[];
  rowProblems: RowProblem[];
  rows: PreviewRow[];
  wouldLoad: number;
  wouldRejoin: number;
  capacityWarning: string | null;
  message: string;
}

interface Outcome {
  line: number;
  fullName: string;
  email: string;
  status: "LOADED" | "REJOINED" | "SKIPPED";
  registrationNo?: string;
  rollNo?: number;
  reason?: string;
  temporaryPassword?: string;
  /**
   * Whether the student was sent their own copy.
   *
   * Absent means nothing was owed — a returning student, or a skipped row.
   * False means a send was attempted and failed, and this row must be relayed
   * by hand.
   */
  emailSent?: boolean;
  /** Why it did not go, in the mail server's own words. */
  emailProblem?: string;
}

interface Result {
  sectionName: string;
  loaded: number;
  rejoined: number;
  skipped: number;
  outcomes: Outcome[];
  /** How many students were sent their own password, and how many were not. */
  emailed: number;
  notEmailed: number;
  message: string;
}

interface PartnerOption {
  id: string;
  name: string;
  isActive: boolean;
  billingMode: "PARTNER_PAYS" | "STUDENT_PAYS";
  billingLabel: string;
}

/**
 * Did every failure come from the mail account being used up for the day?
 *
 * Worth separating because it is the one mail failure that is TEMPORARY and
 * has nothing to do with the file: no address is wrong, no setting is wrong,
 * and the same import will work tomorrow. Told instead to "check whether email
 * is configured", somebody spends an afternoon inspecting settings that are
 * correct.
 */
function mailLimitHit(result: Result): boolean {
  return result.outcomes.some(
    (o) => o.emailSent === false && /daily .*limit|5\.4\.5|quota/i.test(o.emailProblem ?? ""),
  );
}

/**
 * The mail server's answer, shortened to the part a person can act on.
 *
 * An SMTP rejection arrives as several lines of repeated codes and a support
 * URL — "550-5.4.5 Daily user sending limit exceeded. For more information on
 * Gmail 550-5.4.5 sending limits go to 550 5.4.5 https://…". Printed whole
 * beside a student's name it buries the one useful clause in punctuation.
 */
function tidyMailProblem(detail: string): string {
  if (/daily .*limit|5\.4\.5|quota/i.test(detail)) {
    return "The sending account has reached its daily limit — try again tomorrow.";
  }
  if (/550|no such user|does not exist|recipient/i.test(detail)) {
    return "The mail server would not accept that address. Check it is spelled correctly.";
  }
  if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(detail)) {
    return "The mail server could not be reached.";
  }
  // Anything unrecognised is shown as it came, trimmed — a message nobody
  // anticipated is exactly the one worth passing on verbatim.
  const firstLine = detail.split("\n")[0] ?? detail;
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
}

export function CohortImportPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  /*
   * WHOSE STUDENTS THESE ARE — our own, or an outside institute's.
   *
   * CHOSEN ONCE FOR THE WHOLE FILE, never as a CSV column. A partner id typed
   * on every line is a partner id mistyped on some of them, and the failure is
   * silent: the wrong institute gains the right to read those students'
   * results. The empty string means the Institute's own intake, which is the
   * common case and therefore the default.
   */
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [partnerInstituteId, setPartnerInstituteId] = useState("");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [capacityOverride, setCapacityOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<Section[]>("/sections")
      .then(setSections)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load batches."));

    /*
     * FAILS QUIETLY, on purpose. Most imports are of our own students and the
     * partner picker is an extra the screen can do without — an institute
     * list that would not load must not stop somebody importing a cohort.
     */
    api
      .get<PartnerOption[]>("/partners")
      .then((rows) => setPartners(rows.filter((p) => p.isActive)))
      .catch(() => setPartners([]));
  }, []);

  // Any change to the file or the destination invalidates the preview. Leaving
  // a stale one on screen would let somebody read a preview of one file and
  // press the button on another.
  const changeCsv = (text: string, name: string) => {
    setCsv(text);
    setFileName(name);
    setPreview(null);
    setResult(null);
  };

  const run = async <T,>(path: string, body: unknown, into: (r: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      into(await api.post<T>(path, body));
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

  const section = sections.find((s) => s.id === sectionId);
  const chosenPartner = partners.find((p) => p.id === partnerInstituteId);
  const canPreview = csv.trim().length > 0 && sectionId !== "" && !busy;
  const canCommit =
    preview !== null &&
    preview.fileProblem === null &&
    preview.wouldLoad + preview.wouldRejoin > 0 &&
    consent &&
    note.trim().length >= 10 &&
    !busy;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Import a cohort</h1>
          <p className="muted small">
            Load students the Institute already has — a batch admitted on paper, or a register
            kept in a spreadsheet — into one batch. Every student goes through the same checks
            as a single admission, so an import cannot get past a gender restriction.
          </p>
        </div>
        <a className="btn btn-quiet" href="/api/v1/admin/cohort-import/template.csv" download>
          Download the template
        </a>
      </header>

      <HowItWorks
        id="cohort-import"
        title="Bringing in a whole class at once"
        intro="For students who already exist on paper — a group joining from elsewhere, or a term the Institute ran before this System."
        steps={[
          { icon: "upload", title: "Upload the sheet", body: "One row per student. The columns it expects are listed on this page." },
          { icon: "search", title: "Look at the preview", body: "Nothing is created yet. You are shown exactly what would happen, row by row." },
          { icon: "alert", title: "Fix what is flagged", body: "Duplicates, missing fields and bad dates are marked. Correct the sheet and upload it again." },
          { icon: "check", title: "Then import", body: "Only once the preview is right. Everybody is created together, with their sign-in details." },
        ]}
        note="Always read the preview. It is the only chance to catch a wrong column before it becomes two hundred students with the wrong course."
      />

      {/* Said before anything is chosen, because it changes whether this is the
          right tool at all. */}
      <div className="alert">
        <p>
          <strong>This is not an admission application.</strong> No payment is recorded, so an
          imported student owes the full amount until the Institute records what they paid. No
          consent is captured either — you are confirming below that these students were given
          the data-collection notice elsewhere, and it is that confirmation which is audited
          against your name.
        </p>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {!result && (
        <section className="card">
          <div className="field-row">
            <Field label="Into which batch" required><select
                value={sectionId}
                onChange={(e) => {
                  setSectionId(e.target.value);
                  setPreview(null);
                  setResult(null);
                }}
              >
                <option value="">Choose a batch</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/*
            WHOSE STUDENTS, asked BEFORE the file and offered only when there
            is at least one institute on file — a dropdown with a single
            "Our own students" entry is a question nobody needs asked.
          */}
          {partners.length > 0 && (
            <div className="field-row">
              <Field
                label="Whose students are these?"
                hint="Choose the institute before the file, never as a column in it."
              >
                <select
                  value={partnerInstituteId}
                  onChange={(e) => {
                    setPartnerInstituteId(e.target.value);
                    setPreview(null);
                    setResult(null);
                  }}
                >
                  <option value="">Our own students</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {/*
            AND WHAT THAT MEANS FOR THE MONEY, said here rather than left to
            the preview alone. Somebody importing two hundred students should
            not discover the billing consequence after pressing the button —
            and under PARTNER_PAYS the consequence is that no charge is ever
            raised against any of them, which is invisible until the ledger is
            empty at the end of term.
          */}
          {chosenPartner && (
            <div className={chosenPartner.billingMode === "PARTNER_PAYS" ? "alert alert-warn" : "alert"}>
              <p className="small">
                <strong>{chosenPartner.name}</strong> —{" "}
                {chosenPartner.billingMode === "PARTNER_PAYS"
                  ? "we invoice the institute. No fee charge will be raised against these students: they will owe nothing, appear on no debtors list, and be offered no payment button."
                  : "their students pay us directly, exactly like our own. Charges and instalments will be raised as usual."}
              </p>
              <p className="muted small">
                Their coordinator will be able to see these students&rsquo; released results,
                attendance and certificates.
              </p>
            </div>
          )}

          {/* The restriction is shown BEFORE the file is chosen, so a file of
              male students is never prepared against a women's section. */}
          {section && (
            <p className="muted small">
              {section.genderRestriction && section.genderRestriction !== "MIXED"
                ? `${section.name} admits ${section.genderRestriction.toLowerCase()} students only. `
                : `${section.name} is open to any gender. `}
              {typeof section.capacity === "number" &&
                typeof section.enrolledCount === "number" &&
                `${section.enrolledCount} of ${section.capacity} places taken.`}
            </p>
          )}

          <Field label="The file" required><input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                // `void`: reading a local file cannot meaningfully fail, and an
                // unhandled rejection from a change handler has no stack that
                // points anywhere useful.
                void file.text().then((t) => changeCsv(t, file.name));
              }}
            />
          </Field>

          <details>
            <summary className="small">or paste it</summary>
            <label className="field">
              <span className="muted small">
                The first row must name the columns: fullName, email, gender, phone, dateOfBirth,
                nationalId. Dates as DD/MM/YYYY or YYYY-MM-DD.
              </span>
              <textarea
                rows={6}
                value={csv}
                onChange={(e) => changeCsv(e.target.value, "")}
                placeholder="fullName,email,gender,phone,dateOfBirth,nationalId"
              />
            </label>
          </details>

          {fileName && (
            <p className="muted small">
              {fileName} — {csv.split("\n").filter((l) => l.trim()).length - 1} rows under the
              headings.
            </p>
          )}

          <div className="row-actions">
            <button
              className="btn btn-primary"
              disabled={!canPreview}
              onClick={() =>
                void run<Preview>(
                  "/admin/cohort-import/preview",
                  {
                    csv,
                    sectionId,
                    ...(partnerInstituteId ? { partnerInstituteId } : {}),
                  },
                  setPreview,
                )
              }
            >
              {busy ? "Reading…" : "Check the file"}
            </button>
            {csv && (
              <button
                className="btn btn-quiet"
                onClick={() => {
                  changeCsv("", "");
                  if (fileInput.current) fileInput.current.value = "";
                }}
              >
                Start again
              </button>
            )}
          </div>
        </section>
      )}

      {preview && !result && <PreviewPanel preview={preview} />}

      {preview && !result && preview.fileProblem === null && (
        <section className="card">
          <h2>Load them</h2>

          {preview.capacityWarning && (
            <>
              <p className="warn">{preview.capacityWarning}</p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={capacityOverride}
                  onChange={(e) => setCapacityOverride(e.target.checked)}
                />
                <span>
                  Load them anyway, past the batch's capacity. This is recorded against your
                  name.
                </span>
              </label>
            </>
          )}

          {/* Not a formality, and worded so it cannot be ticked absently. */}
          <label className="check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              I confirm these students were given the Institute's data-collection notice. The
              System cannot know this, so it is recorded as my assertion.
            </span>
          </label>

          <Field
            label="Why this cohort is being imported"
            error={
              note.trim().length > 0 && note.trim().length < 10
                ? "A sentence, so this makes sense to somebody later."
                : null
            }
          >
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Spring 2026 intake, admitted on paper before this System"
            />
          </Field>

          <button
            className="btn btn-primary"
            disabled={!canCommit}
            onClick={() =>
              void run<Result>(
                "/admin/cohort-import",
                {
                  csv,
                  sectionId,
                  capacityOverride,
                  consentCollectedOffline: true,
                  note: note.trim(),
                  ...(partnerInstituteId ? { partnerInstituteId } : {}),
                },
                setResult,
              )
            }
          >
            {busy
              ? `Loading ${preview.wouldLoad + preview.wouldRejoin} student${
                  preview.wouldLoad + preview.wouldRejoin === 1 ? "" : "s"
                }…`
              : `Load ${preview.wouldLoad + preview.wouldRejoin} student${
                  preview.wouldLoad + preview.wouldRejoin === 1 ? "" : "s"
                }`}
          </button>
        </section>
      )}

      {result && (
        <ResultPanel
          result={result}
          onAgain={() => {
            changeCsv("", "");
            setNote("");
            setConsent(false);
            setCapacityOverride(false);
            if (fileInput.current) fileInput.current.value = "";
          }}
        />
      )}
    </>
  );
}

/** What the file says, before anything is written. */
function PreviewPanel({ preview }: { preview: Preview }) {
  if (preview.fileProblem) {
    return (
      <section className="card">
        <div className="alert alert-error" role="alert">
          <p>{preview.fileProblem.message}</p>
        </div>
      </section>
    );
  }

  const blocked = preview.rows.filter((r) => r.blocked);
  const returning = preview.rows.filter((r) => r.returningWith);

  return (
    <section className="card">
      <h2>What this would do</h2>
      <p>{preview.message}</p>

      {/* A heading nobody uses is every address in the file going missing. */}
      {preview.unknownColumns.length > 0 && (
        <div className="alert alert-warn">
          <p>
            <strong>
              {preview.unknownColumns.length === 1 ? "A column is" : "Columns are"} not recognised
              and will be ignored:
            </strong>{" "}
            {preview.unknownColumns.join(", ")}. If one of those is a misspelling, everything in
            it is about to be lost.
          </p>
        </div>
      )}

      {returning.length > 0 && (
        <p className="small">
          {returning.length} {returning.length === 1 ? "is somebody" : "are people"} this System
          already knows. They keep the registration number they already hold and their existing
          sign-in — they are not given a new password.
        </p>
      )}

      {blocked.length > 0 && (
        <div className="alert alert-warn">
          <p>
            <strong>
              {blocked.length} {blocked.length === 1 ? "student cannot" : "students cannot"} join
              this batch.
            </strong>{" "}
            {blocked[0]?.blocked} This cannot be overridden — put them in another batch.
          </p>
          <ul className="list small">
            {blocked.slice(0, 10).map((r) => (
              <li key={r.line}>
                Row {r.line} — {r.fullName}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.rowProblems.length > 0 && (
        <>
          <h3>Rows that will be skipped</h3>
          <p className="muted small">
            The row numbers are the ones in your spreadsheet. Everything else still loads.
          </p>
          <ul className="list small">
            {groupByLine(preview.rowProblems).map(([line, messages]) => (
              <li key={line}>
                <strong>Row {line}</strong> — {messages.join(" ")}
              </li>
            ))}
          </ul>
        </>
      )}

      {preview.rows.filter((r) => !r.blocked).length > 0 && (
        <details>
          <summary className="small">
            Show the {preview.rows.filter((r) => !r.blocked).length} that would load
          </summary>
          <ul className="list small">
            {preview.rows
              .filter((r) => !r.blocked)
              .map((r) => (
                <li key={r.line}>
                  Row {r.line} — {r.fullName} ({r.email})
                  {r.returningWith && <span className="muted"> — already here as {r.returningWith}</span>}
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * What happened, and the passwords.
 *
 * The skipped rows come FIRST. "298 of 300 loaded" beside a tick is how
 * somebody closes the page believing all three hundred went in.
 */
function ResultPanel({ result, onAgain }: { result: Result; onAgain: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  const withPasswords = result.outcomes.filter((o) => o.temporaryPassword);
  const skipped = result.outcomes.filter((o) => o.status === "SKIPPED");

  const downloadPasswords = () => {
    const csv =
      "fullName,email,registrationNo,rollNo,temporaryPassword\n" +
      withPasswords
        .map((o) =>
          [o.fullName, o.email, o.registrationNo ?? "", o.rollNo ?? "", o.temporaryPassword].join(
            ",",
          ),
        )
        .join("\n") +
      "\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `passwords-${result.sectionName.replace(/[^a-z0-9]+/gi, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <section className="card">
        <h2>{result.sectionName}</h2>
        <p>{result.message}</p>

        {skipped.length > 0 && (
          <>
            <h3 className="warn">
              {skipped.length} {skipped.length === 1 ? "row was" : "rows were"} not loaded
            </h3>
            <ul className="list small">
              {skipped.map((o) => (
                <li key={o.line}>
                  <strong>Row {o.line}</strong>
                  {o.fullName ? ` — ${o.fullName}` : ""} — {o.reason}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {withPasswords.length > 0 && !dismissed && (
        <section className="card password-panel">
          <h2>
            {withPasswords.length} temporary{" "}
            {withPasswords.length === 1 ? "password" : "passwords"}
          </h2>
          {/* DELIVERY FIRST, because it decides whether there is anything to
              do here at all. The System emails each student their own password
              now; this list used to be the only copy in existence, and every
              one of three hundred was relayed by hand. */}
          {result.notEmailed === 0 ? (
            <p>
              Every one of these was <strong>emailed to the student</strong> at their own
              address. This list is your copy, for anybody who says it never arrived.
            </p>
          ) : (
            <div className="alert alert-warn">
              <strong>
                {result.notEmailed} of these could NOT be emailed — pass those on yourself.
              </strong>
              {/*
                THE MAIL ACCOUNT'S DAILY LIMIT IS ITS OWN CASE, because it is
                the one failure that is temporary, affects every message
                equally, and has nothing to do with the addresses in the file.
                Told to check whether "email is configured", somebody goes and
                inspects settings that are perfectly correct. The answer is to
                wait, or to send from an account that has not been used up.
              */}
              {mailLimitHit(result) ? (
                <p className="small">
                  The sending account has <strong>reached its daily limit</strong>. Nothing is
                  wrong with the addresses or the settings — a Google account will not accept
                  more messages until the limit resets, roughly twenty-four hours after they were
                  sent. Read the passwords out from this list, or reset those accounts tomorrow to
                  have the details sent again.
                </p>
              ) : (
                <p className="small">
                  They are marked below with the reason, and in the downloaded file. Check
                  Integrations to see whether email is configured.
                </p>
              )}
            </div>
          )}

          <p className="warn">
            <strong>These are shown once and cannot be recovered.</strong> Each is hashed the
            moment it is created, so nobody — including a Super Admin — can look one up. If they
            are lost, each account has to be reset by hand.
          </p>

          <div className="row-actions">
            <button className="btn btn-primary" onClick={downloadPasswords}>
              Download as a file
            </button>
            <button className="btn btn-quiet" onClick={() => setDismissed(true)}>
              I have them
            </button>
          </div>

          {/* Downloading credentials to somebody's laptop is a real exposure and
              is said as such. It is still the right affordance: nobody is going
              to copy three hundred passwords one at a time. */}
          <p className="warn small">
            That file contains live credentials. Give each student theirs and delete it. Every one
            of these accounts must change its password at first sign-in, which is what limits the
            damage if the file goes astray.
          </p>

          <ul className="list small">
            {withPasswords.map((o) => (
              <li key={o.line}>
                <strong>{o.fullName}</strong> — {o.email}
                <br />
                <span className="muted">
                  {o.registrationNo} · roll {o.rollNo} ·{" "}
                </span>
                <code>{o.temporaryPassword}</code>{" "}
                {/* A word, not a colour alone (NFR-ACC-007). */}
                {/* A word, not a colour alone (NFR-ACC-007). Two states and
                    no "pending": every message is now waited for, so by the
                    time this renders each one has either gone or failed. */}
                {o.emailSent ? (
                  <span className="pill pill-ok">emailed</span>
                ) : (
                  <span className="pill pill-warn">not emailed</span>
                )}
                {/* The reason, where the row is. Somebody relaying passwords by
                    hand needs to know whether to retype an address or simply
                    wait, and that answer belongs beside the row it concerns. */}
                {o.emailSent === false && o.emailProblem && (
                  <>
                    <br />
                    <span className="muted small">{tidyMailProblem(o.emailProblem)}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="row-actions">
        <button className="btn btn-quiet" onClick={onAgain}>
          Import another file
        </button>
      </div>
    </>
  );
}

/** One line per row, however many things are wrong with it. */
function groupByLine(problems: RowProblem[]): Array<[number, string[]]> {
  const byLine = new Map<number, string[]>();
  for (const p of problems) byLine.set(p.line, [...(byLine.get(p.line) ?? []), p.message]);
  return [...byLine].sort((a, b) => a[0] - b[0]);
}
