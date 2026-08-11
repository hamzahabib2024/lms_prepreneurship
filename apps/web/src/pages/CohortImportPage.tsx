import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api/client";

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
}

interface Result {
  sectionName: string;
  loaded: number;
  rejoined: number;
  skipped: number;
  outcomes: Outcome[];
  message: string;
}

export function CohortImportPage() {
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
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
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load sections."));
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
            kept in a spreadsheet — into one section. Every student goes through the same checks
            as a single admission, so an import cannot get past a gender restriction.
          </p>
        </div>
        <a className="btn btn-quiet" href="/api/v1/admin/cohort-import/template.csv" download>
          Download the template
        </a>
      </header>

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
        <div className="alert alert-error">
          <p>{error}</p>
        </div>
      )}

      {!result && (
        <section className="card">
          <div className="field-row">
            <label className="field">
              <span>Into which section</span>
              <select
                value={sectionId}
                onChange={(e) => {
                  setSectionId(e.target.value);
                  setPreview(null);
                  setResult(null);
                }}
              >
                <option value="">Choose a section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

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

          <label className="field">
            <span>The file</span>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                changeCsv(await file.text(), file.name);
              }}
            />
          </label>

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
                  { csv, sectionId },
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
                  Load them anyway, past the section's capacity. This is recorded against your
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

          <label className="field">
            <span>Why this cohort is being imported</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Spring 2026 intake, admitted on paper before this System"
            />
            {note.trim().length > 0 && note.trim().length < 10 && (
              <span className="warn small">A sentence, so this makes sense to somebody later.</span>
            )}
          </label>

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
                },
                setResult,
              )
            }
          >
            {busy
              ? "Loading…"
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
        <div className="alert alert-error">
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
              this section.
            </strong>{" "}
            {blocked[0]?.blocked} This cannot be overridden — put them in another section.
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
                <code>{o.temporaryPassword}</code>
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
