import { GENDER, type Gender } from "@lms/shared";

/**
 * Importing a cohort — SRS §5.24, FR-OPS-024..026.
 *
 * WHAT THIS IS FOR, because it decides everything else. An Institute arriving
 * at this System already has students: a batch admitted on paper last month, or
 * a register kept in a spreadsheet for years. Typing three hundred of them into
 * the admission form one at a time is not a plan. This loads them.
 *
 * IT IS NOT AN APPLICATION, AND MUST NOT PRETEND TO BE. The public form
 * (FR-REG-001..010) records things only the applicant can truthfully provide:
 * that they accepted the data-collection notice, what they paid, which slip
 * proves it. An import has none of that, and fabricating it — writing
 * `consentAccepted: true` on behalf of somebody who never saw a notice, or a
 * payment claim nobody made — would put a lie in the audit record and in the
 * fee ledger. So an import records what the Institute actually knows, and the
 * operator asserts separately that consent was collected offline. An imported
 * student has NO payment recorded, because none was seen.
 *
 * EVERY ROW STILL GOES THROUGH THE ORDINARY CHECKS. The gender restriction is
 * absolute (FR-CRS-009), capacity needs an explicit override (BR-ENR-04), roll
 * numbers are allocated per section, and a returning student keeps the
 * registration number they already hold (BR-REG-07). A clever bulk INSERT would
 * skip all four; the service calls the ordinary allocation once per row, and
 * this module holds only what is genuinely about the file.
 *
 * THE ROW NUMBERS HERE ARE SPREADSHEET ROW NUMBERS. The header is row 1 and the
 * first student is row 2. An off-by-one makes every message point at the wrong
 * person, and the operator fixes the wrong line — which is worse than no
 * message, because they trust it.
 */

export const REQUIRED_COLUMNS = [
  "fullName",
  "email",
  "gender",
  "phone",
  "dateOfBirth",
  // Required because the Student record requires it, and UNIQUE there. It is
  // the identifier the Institute's paper forms already carry.
  "nationalId",
] as const;

/**
 * Accepted but not required. Anything outside both lists is reported rather
 * than ignored: a column called `emial` is a typo the operator wants to know
 * about, and silently dropping it loses every address in the file.
 */
export const OPTIONAL_COLUMNS = [
  "fatherName",
  "city",
  "qualification",
  "altPhone",
] as const;

export type ImportColumn = (typeof REQUIRED_COLUMNS)[number] | (typeof OPTIONAL_COLUMNS)[number];

export interface ImportRow {
  /** The row number in the operator's spreadsheet. Header is 1. */
  line: number;
  fullName: string;
  email: string;
  gender: Gender;
  phone: string;
  dateOfBirth: Date;
  nationalId: string;
  fatherName?: string;
  city?: string;
  qualification?: string;
  altPhone?: string;
}

export interface RowProblem {
  line: number;
  field: string;
  message: string;
}

export interface FileProblem {
  code: "EMPTY" | "NO_HEADER" | "MISSING_COLUMNS" | "UNKNOWN_COLUMNS" | "TOO_MANY" | "ALL_INVALID";
  message: string;
}

export interface ImportPlan {
  rows: ImportRow[];
  rowProblems: RowProblem[];
  fileProblem: FileProblem | null;
  /** Column headings present in the file that this System does not use. */
  unknownColumns: string[];
}

/**
 * Above this it is a migration, and a migration is somebody sitting with the
 * database rather than a web form holding a request open for ten minutes.
 */
export const MAX_IMPORT = 500;

/**
 * Splits CSV text into rows of fields.
 *
 * Hand-written rather than pulled in, because the awkward cases are few and
 * specific: a quoted field containing a comma (every address), a quoted field
 * containing a doubled quote, CRLF from Excel on Windows, and a UTF-8 BOM which
 * Excel writes by default and which makes the first heading `U+FEFF` followed by `fullName`
 * and match nothing.
 */
export function parseCsv(text: string): string[][] {
  /*
   * The BOM, stripped for real.
   *
   * This line used to read `text.replace(/^/, "")` — the U+FEFF had been lost
   * out of the pattern at some point, leaving a no-op with a comment above it
   * claiming to strip a byte-order mark. Nobody noticed because it WORKED
   * anyway: the header cells are `.trim()`ed below, and ECMAScript counts
   * U+FEFF as whitespace, so trim happened to eat it.
   *
   * That is an accident, not a design. Anybody tightening the header handling
   * to something other than trim() would have reintroduced "The file has no
   * fullName column" for every file Excel saves as CSV UTF-8, with a comment
   * three lines up promising that could not happen.
   */
  const clean = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A BLANK LINE IS KEPT, and that is not fussiness. Dropping it here shifts
    // every row after it up by one, so an error about row 12 sends the operator
    // to row 11 — a different student, whose data is fine. They then "correct"
    // it. Blank lines are skipped later, by position, where the true line
    // number is still known.
    rows.push(row);
    row = [];
  };

  while (i < clean.length) {
    const c = clean[i];

    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      // CRLF or a lone CR; either way the row ends here.
      if (clean[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }

    field += c;
    i++;
  }

  if (field !== "" || row.length > 0) endRow();

  // The one empty row a file's own trailing newline creates is an artefact of
  // the format, not a line anybody typed. Only the last one, and only if empty.
  const last = rows[rows.length - 1];
  if (rows.length > 0 && last && last.length === 1 && last[0] === "") rows.pop();

  return rows;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pakistani mobile numbers, in the shapes people actually type them:
 * 03001234567, 0300-1234567, +923001234567, 92 300 1234567.
 */
function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, "");
  if (/^\+92\d{10}$/.test(digits)) return digits;
  if (/^92\d{10}$/.test(digits)) return `+${digits}`;
  if (/^0\d{10}$/.test(digits)) return `+92${digits.slice(1)}`;
  return null;
}

/** CNIC, with or without the dashes people include about half the time. */
function normaliseCnic(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{13}$/.test(digits) ? digits : null;
}

/**
 * A date of birth, which the Student record requires.
 *
 * THE AMBIGUITY IS THE WHOLE PROBLEM. 03/04/2005 is the 3rd of April here and
 * the 4th of March in an American export, and nothing in the file says which.
 * Guessing wrong is silent — the student exists, the date looks plausible, and
 * nobody finds out. So: `YYYY-MM-DD` is taken as written, `DD/MM/YYYY` is taken
 * as the local convention, and a value that can only be MM/DD (a second part
 * above 12) is REFUSED rather than reinterpreted, because a file written in the
 * other convention has every other date wrong too.
 */
function normaliseDate(raw: string): { date: Date } | { error: string } {
  const v = raw.trim();
  if (v === "") return { error: "No date of birth." };

  let y: number, m: number, d: number;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);

  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (slash) {
    d = Number(slash[1]);
    m = Number(slash[2]);
    y = Number(slash[3]);
    if (m > 12) {
      return {
        error:
          `"${v}" looks like month/day/year. Dates must be DD/MM/YYYY or YYYY-MM-DD — if this ` +
          "file came from an American export, every date in it needs converting.",
      };
    }
  } else {
    return { error: `"${v}" is not a date. Use DD/MM/YYYY or YYYY-MM-DD.` };
  }

  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return { error: `"${v}" is not a real date.` };
  }

  const date = new Date(Date.UTC(y, m - 1, d));
  // Catches the 31st of February, which the constructor rolls forward silently.
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { error: `"${v}" is not a real date.` };
  }

  // The same bounds the application form applies, so an import cannot create a
  // student the public form would have refused.
  const age = (Date.now() - date.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 10 || age > 100) {
    return { error: `"${v}" gives an age of ${Math.floor(age)}, which cannot be right.` };
  }

  return { date };
}

function normaliseGender(raw: string): Gender | null {
  const v = raw.trim().toUpperCase();
  if ((GENDER as readonly string[]).includes(v)) return v as Gender;
  if (v === "M" || v === "MALE") return "MALE" as Gender;
  if (v === "F" || v === "FEMALE") return "FEMALE" as Gender;
  return null;
}

/**
 * Reads a file into a plan: the rows that could be understood, and a specific
 * complaint about each that could not.
 *
 * EVERY problem in a row is reported, not just the first. An operator fixing a
 * three-hundred-row file one error per attempt is a bad afternoon, and they
 * will start guessing.
 */
export function planImport(text: string, limit = MAX_IMPORT): ImportPlan {
  const empty: ImportPlan = { rows: [], rowProblems: [], fileProblem: null, unknownColumns: [] };
  const grid = parseCsv(text);

  if (grid.length === 0) {
    return { ...empty, fileProblem: { code: "EMPTY", message: "The file has nothing in it." } };
  }

  const header = (grid[0] ?? []).map((h) => h.trim());
  const known = new Set<string>([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);
  // Case-insensitive, because a heading typed as "Email" is not a mistake.
  const index = new Map<string, number>();
  const unknownColumns: string[] = [];
  for (const [at, name] of header.entries()) {
    if (name === "") continue;
    const match = [...known].find((k) => k.toLowerCase() === name.toLowerCase());
    if (match) index.set(match, at);
    else unknownColumns.push(name);
  }

  const missing = REQUIRED_COLUMNS.filter((c) => !index.has(c));
  if (missing.length === REQUIRED_COLUMNS.length) {
    return {
      ...empty,
      unknownColumns,
      fileProblem: {
        code: "NO_HEADER",
        message:
          "The first row does not look like column headings. It must name the columns: " +
          `${REQUIRED_COLUMNS.join(", ")}.`,
      },
    };
  }
  if (missing.length > 0) {
    return {
      ...empty,
      unknownColumns,
      fileProblem: {
        code: "MISSING_COLUMNS",
        message: `The file has no ${missing.join(" or ")} column. Every student needs one.`,
      },
    };
  }

  // Paired with the line number the operator will see, BEFORE the blanks are
  // dropped. A row of nothing but commas counts as blank too: spreadsheet
  // exports are full of them and they are not mistakes anybody made.
  const body = grid
    .slice(1)
    .map((fields, n) => ({ fields, line: n + 2 }))
    .filter((r) => r.fields.some((f) => f.trim() !== ""));

  if (body.length === 0) {
    return {
      ...empty,
      unknownColumns,
      fileProblem: { code: "EMPTY", message: "The file has headings but no students." },
    };
  }
  if (body.length > limit) {
    return {
      ...empty,
      unknownColumns,
      fileProblem: {
        code: "TOO_MANY",
        message:
          `${body.length} students is more than the ${limit} this can load at once. ` +
          "Split the file by section or batch.",
      },
    };
  }

  const at = (r: string[], col: ImportColumn) => {
    const i = index.get(col);
    return i === undefined ? "" : (r[i] ?? "").trim();
  };

  const rows: ImportRow[] = [];
  const rowProblems: RowProblem[] = [];
  const seenEmails = new Map<string, number>();
  const seenCnics = new Map<string, number>();

  for (const { fields: raw, line } of body) {
    const problems: RowProblem[] = [];

    const fullName = at(raw, "fullName");
    if (fullName.length < 2) {
      problems.push({ line, field: "fullName", message: "No name." });
    }

    const email = at(raw, "email").toLowerCase();
    if (!EMAIL.test(email)) {
      problems.push({
        line,
        field: "email",
        message: email === "" ? "No email address." : `"${email}" is not an email address.`,
      });
    } else {
      const earlier = seenEmails.get(email);
      if (earlier !== undefined) {
        // Within one file this is a mistake, and loading both would put the
        // same person in the section twice. An email the SYSTEM already holds
        // is a different matter entirely — that is a returning student, and
        // they keep their registration number.
        problems.push({
          line,
          field: "email",
          message: `${email} is also on row ${earlier}. Each student appears once.`,
        });
      } else {
        seenEmails.set(email, line);
      }
    }

    const gender = normaliseGender(at(raw, "gender"));
    if (!gender) {
      const given = at(raw, "gender");
      problems.push({
        line,
        field: "gender",
        message:
          given === ""
            ? "No gender, which decides which sections they may join."
            : `"${given}" is not a gender this System knows. Use ${GENDER.join(", ")}.`,
      });
    }

    const phone = normalisePhone(at(raw, "phone"));
    if (!phone) {
      const given = at(raw, "phone");
      problems.push({
        line,
        field: "phone",
        message:
          given === ""
            ? "No phone number, which is how the Institute reaches them."
            : `"${given}" is not a phone number. Use 03001234567 or +923001234567.`,
      });
    }

    const dob = normaliseDate(at(raw, "dateOfBirth"));
    if ("error" in dob) {
      problems.push({ line, field: "dateOfBirth", message: dob.error });
    }

    const nationalIdRaw = at(raw, "nationalId");
    const nationalId = normaliseCnic(nationalIdRaw);
    if (!nationalId) {
      problems.push({
        line,
        field: "nationalId",
        message:
          nationalIdRaw === ""
            ? "No CNIC. Every student record needs one and no two may share it."
            : `"${nationalIdRaw}" is not a 13-digit CNIC.`,
      });
    } else {
      // The SAME check as email, and for a harder reason: national_id is
      // UNIQUE in the database. Two rows sharing one would reach it and fail
      // on a constraint, and the operator would be shown a driver error about
      // a column rather than "these two rows are the same person".
      const earlier = seenCnics.get(nationalId);
      if (earlier !== undefined) {
        problems.push({
          line,
          field: "nationalId",
          message: `This CNIC is also on row ${earlier}. Each student appears once.`,
        });
      } else {
        seenCnics.set(nationalId, line);
      }
    }

    if (problems.length > 0) {
      rowProblems.push(...problems);
      continue;
    }

    rows.push({
      line,
      fullName,
      email,
      gender: gender!,
      phone: phone!,
      dateOfBirth: (dob as { date: Date }).date,
      nationalId: nationalId!,
      ...(at(raw, "fatherName") ? { fatherName: at(raw, "fatherName") } : {}),
      ...(at(raw, "city") ? { city: at(raw, "city") } : {}),
      ...(at(raw, "qualification") ? { qualification: at(raw, "qualification") } : {}),
      ...(at(raw, "altPhone") && normalisePhone(at(raw, "altPhone"))
        ? { altPhone: normalisePhone(at(raw, "altPhone"))! }
        : {}),
    });
  }

  // Every single row bad usually means the wrong file, or the right file
  // exported with semicolons. Loading nothing and reporting three hundred
  // separate complaints is not as useful as saying so once.
  if (rows.length === 0) {
    return {
      rows,
      rowProblems,
      unknownColumns,
      fileProblem: {
        code: "ALL_INVALID",
        message:
          `Not one of the ${body.length} rows could be read. Check this is the right file, and ` +
          "that it is comma-separated rather than semicolon-separated.",
      },
    };
  }

  return { rows, rowProblems, fileProblem: null, unknownColumns };
}

export interface PlanCounts {
  /** Rows that would create a NEW student. */
  wouldLoad: number;
  /** Rows for somebody already here, who keeps their registration number. */
  wouldRejoin: number;
  /** Rows the section's gender restriction refuses. */
  blocked: number;
}

/**
 * How many of each, counted against the section they are going into.
 *
 * PURE, AND TESTED, BECAUSE IT IS ARITHMETIC THE BUTTON IS LABELLED WITH. This
 * lived in the service and got it wrong: a returning student was counted both
 * as somebody to load and as somebody to rejoin, so a file of one new student,
 * one returning and one blocked offered to "Load 3 students" and then reported
 * two. A button that promises a number the result contradicts is worse than
 * one with no number at all.
 *
 * The three are DISJOINT. Every row is exactly one of them.
 */
export function countAgainstSection(
  rows: ImportRow[],
  genderRestriction: string,
  isAlreadyHere: (email: string) => boolean,
): PlanCounts {
  let wouldLoad = 0;
  let wouldRejoin = 0;
  let blocked = 0;

  for (const r of rows) {
    // Checked first, and absolutely: a blocked row is not going to be loaded
    // or rejoined, so counting it as either would promise something the
    // gender restriction will refuse (FR-CRS-009).
    if (genderRestriction !== "MIXED" && genderRestriction !== r.gender) {
      blocked++;
    } else if (isAlreadyHere(r.email)) {
      wouldRejoin++;
    } else {
      wouldLoad++;
    }
  }

  return { wouldLoad, wouldRejoin, blocked };
}

/** The heading line for the template offered on the screen. */
export function templateCsv(): string {
  return (
    [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].join(",") +
    "\n" +
    // The example date is deliberately YYYY-MM-DD: it is the one form that
    // cannot be read two ways, and the template is where the convention is
    // actually taught. The trailing comma is the empty altPhone — the row has
    // one field per heading, which is what the operator will copy.
    "Ayesha Khan,ayesha.khan@example.com,FEMALE,03001234567,2005-04-03,3520112345671," +
    "Imran Khan,Lahore,FSc,\n"
  );
}

/**
 * What the operator is told before anything is written.
 *
 * A sentence rather than a count, because "12 of 15" leaves them working out
 * what happened to the other three at the moment they are deciding whether to
 * proceed.
 */
export function describePlan(plan: ImportPlan): string {
  if (plan.fileProblem) return plan.fileProblem.message;

  const bad = new Set(plan.rowProblems.map((p) => p.line)).size;
  if (bad === 0) {
    return `${plan.rows.length} ${plan.rows.length === 1 ? "student" : "students"} ready to load.`;
  }
  return (
    `${plan.rows.length} ready to load. ${bad} ${bad === 1 ? "row" : "rows"} will be SKIPPED ` +
    "and left for you to correct — nothing else is held up by them."
  );
}

/**
 * What happened, in a sentence — FR-OPS-026.
 *
 * PURE, AND HERE RATHER THAN ON THE SERVICE, because the half of it that
 * matters is a claim about the outside world that nobody can check by looking
 * at the screen: whether each student was actually told.
 *
 * THE FAILURE THIS GUARDS. An operator told "300 students loaded" closes the
 * page. If forty of those were never emailed, forty people hold an account
 * they cannot reach, and nobody finds out until the term starts. A message
 * that does not distinguish "all of them" from "260 of them" leaves the reader
 * assuming the first, every time.
 *
 * THE DELIVERY COUNTS COVER BOTH KINDS OF STUDENT, which is why they are
 * separate arguments rather than being derived from `loaded`. A new student is
 * emailed a temporary password; a REJOINING student is emailed to say they are
 * enrolled and should use the sign-in they already have. Both were owed a
 * message, both can fail to get one, and phrasing this in terms of "new
 * students" — as it was when only new students were written to — would report
 * a partial failure among rejoins as complete success.
 */
export function importResultMessage(counts: {
  loaded: number;
  rejoined: number;
  skipped: number;
  emailed: number;
  notEmailed: number;
  /** Owed a message, still going out after the answer was returned. */
  stillSending?: number;
}): string {
  const { loaded, rejoined, skipped, emailed, notEmailed } = counts;
  const stillSending = counts.stillSending ?? 0;

  const parts: string[] = [];
  if (loaded > 0) parts.push(`${loaded} new ${loaded === 1 ? "student" : "students"} loaded`);
  if (rejoined > 0) {
    parts.push(
      `${rejoined} existing ${rejoined === 1 ? "student" : "students"} joined this section ` +
        "keeping their registration number",
    );
  }
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (parts.length === 0) return "Nothing was loaded.";

  // Everyone who was owed a message: a new student their password, a rejoining
  // student the news that they are enrolled and keep their existing sign-in.
  const owed = emailed + notEmailed;

  /*
   * STILL SENDING IS ITS OWN ANSWER, and it is reported first when there is
   * one. Email against a real mail server costs about three seconds a message,
   * so the import stops waiting after a few and lets the rest go out behind
   * the response — the students already exist and the passwords are on screen.
   *
   * It must not be folded into either of the other two. Calling an unsent
   * message "could not be reached" sends somebody off to read out twelve
   * passwords by hand for no reason, and calling it "emailed" is worse.
   */
  const delivery =
    stillSending > 0
      ? ` ${emailed > 0 ? `${emailed} ${emailed === 1 ? "message has" : "messages have"} gone out and ` : ""}` +
        `${stillSending} ${stillSending === 1 ? "is" : "are"} still sending in the background — ` +
        "the passwords below are the ones to read out if anybody says nothing arrived."
      : owed === 0
      ? ""
      : notEmailed === 0
        ? " Every one of them has been emailed."
        : emailed === 0
          ? " NOBODY WAS EMAILED — tell each of them yourself, reading any temporary password " +
            "below. Check Integrations if you expected email to be working."
          : ` ${emailed} of them ${emailed === 1 ? "was" : "were"} emailed; ` +
            `${notEmailed} could not be reached and must be told by hand.`;

  return (
    parts.join(", ") +
    "." +
    (loaded > 0
      ? " Each new student has a temporary password shown once below and must change it when " +
        "they first sign in."
      : "") +
    delivery
  );
}
