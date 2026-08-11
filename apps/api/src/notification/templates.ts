/**
 * Notification templates — SRS §5.19, FR-NOT-020..026.
 *
 * The Institute writes to its students in its own words. Until now every
 * message was a string literal in whichever service happened to send it, so
 * changing "Your certificate has been issued" meant changing code, and nobody
 * could see the whole set of things the System says.
 *
 * A DECLARED CATALOGUE, like the settings one, and for the same reason. Each
 * kind names the placeholders it can offer. A template using a placeholder the
 * System will never supply is REFUSED at the moment it is saved, rather than
 * discovered by a student receiving "Dear {studentNmae}".
 *
 * THE UNRESOLVED PLACEHOLDER IS THE WHOLE PROBLEM. Every templating bug that
 * reaches a real person looks the same: a value was missing and the braces went
 * out as written. So rendering NEVER emits a brace. A placeholder with no value
 * collapses to nothing and the surrounding sentence is tidied — and because a
 * sentence that reads oddly is better than one that reads as broken software,
 * the caller can find out which values were missing rather than only that the
 * message went.
 *
 * `kind` IS FREE TEXT IN THE DATABASE and has already drifted: the System sends
 * both `grade.released` and `DISCUSSION_REPLY`. This catalogue is the list that
 * matters, and `isTemplated()` says whether a kind is one the Institute can
 * edit — an unknown kind keeps whatever the calling service passes, so a drifted
 * name degrades to today's behaviour rather than to an empty message.
 */

export interface TemplateDefinition {
  kind: string;
  /** What the Institute sees in the list of things the System says. */
  label: string;
  description: string;
  /** Placeholders this kind can supply. Anything else is refused. */
  placeholders: string[];
  defaultTitle: string;
  defaultBody: string;
}

/**
 * The messages an Institute would reasonably want to word itself.
 *
 * Deliberately not every notification the System sends. An announcement's
 * title IS the announcement, and a template for it would be a box that
 * overwrites what the teacher just typed.
 */
export const TEMPLATES: TemplateDefinition[] = [
  {
    kind: "certificate.issued",
    label: "Certificate issued",
    description: "Sent when a certificate is issued, for a subject or a whole programme.",
    placeholders: ["studentName", "certificateNo", "subject", "programme"],
    defaultTitle: "Your certificate has been issued",
    defaultBody:
      "Certificate {certificateNo} is now available, with a link you can give to an employer.",
  },
  {
    kind: "grade.released",
    label: "Mark released",
    description: "Sent when a teacher releases the mark for an assignment.",
    placeholders: ["studentName", "assignment", "subject"],
    defaultTitle: 'Your mark for "{assignment}" is available',
    defaultBody: "Your teacher has released the mark for this assignment.",
  },
  {
    kind: "quiz.result_released",
    label: "Quiz result released",
    description: "Sent when quiz results are released to a section.",
    placeholders: ["studentName", "quiz", "subject"],
    defaultTitle: 'Your result for "{quiz}" is available',
    defaultBody: "Your teacher has released the results for this quiz.",
  },
  {
    kind: "attendance.warning",
    label: "Attendance warning",
    description:
      "Sent when attendance falls below the Institute's warning threshold (BR-ATT-05). The figures come from the register, not from this text.",
    placeholders: ["studentName", "subject", "percentage", "threshold"],
    defaultTitle: "Your attendance in {subject} has fallen below {threshold}%",
    defaultBody:
      "Your attendance is {percentage}%. Please speak to your teacher about how to catch up.",
  },
  {
    kind: "attendance.critical",
    label: "Attendance — critical",
    description: "Sent when attendance falls below the critical threshold.",
    placeholders: ["studentName", "subject", "percentage", "threshold"],
    defaultTitle: "Your attendance in {subject} is now {percentage}%",
    defaultBody:
      "This is below the level required to complete the subject. Please speak to the office this week.",
  },
  {
    kind: "fee.reminder",
    label: "Fee reminder",
    description:
      "Sent when a fee is overdue. The amount and the due date come from the ledger, not from this text.",
    placeholders: ["studentName", "amount", "dueDate", "daysOverdue"],
    defaultTitle: "A fee payment is overdue",
    defaultBody:
      "{amount} was due on {dueDate}. Please settle it at the office, or speak to us if there is a difficulty.",
  },
];

export interface TemplateProblem {
  field: "title" | "body";
  code: "UNKNOWN_PLACEHOLDER" | "EMPTY" | "TOO_LONG" | "UNBALANCED";
  message: string;
}

export const MAX_TITLE = 200;
export const MAX_BODY = 2000;

export function definitionFor(kind: string): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.kind === kind);
}

export function isTemplated(kind: string): boolean {
  return definitionFor(kind) !== undefined;
}

/** Every `{placeholder}` in a piece of text, in the order they appear. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((m) => m[1]!);
}

/**
 * Refuses a template the System could never fill.
 *
 * CHECKED WHEN IT IS SAVED, not when it is sent. A message goes out once, to a
 * person, and there is no second chance to notice that `{studentNmae}` was a
 * typo — so the misspelling is refused at the keyboard of whoever wrote it,
 * while they still remember what they meant.
 */
export function refuseTemplate(
  kind: string,
  title: string,
  body: string,
): TemplateProblem[] {
  const definition = definitionFor(kind);
  const known = new Set(definition?.placeholders ?? []);
  const problems: TemplateProblem[] = [];

  for (const [field, text, limit] of [
    ["title", title, MAX_TITLE],
    ["body", body, MAX_BODY],
  ] as const) {
    if (text.trim() === "") {
      problems.push({
        field,
        code: "EMPTY",
        message: `The ${field} cannot be empty. To go back to the System's own wording, reset it.`,
      });
      continue;
    }
    if (text.length > limit) {
      problems.push({
        field,
        code: "TOO_LONG",
        message: `The ${field} is ${text.length} characters; the limit is ${limit}.`,
      });
    }

    // A lone brace is almost always a placeholder somebody started and did not
    // finish, and it would go out as a brace.
    const opens = (text.match(/\{/g) ?? []).length;
    const closes = (text.match(/\}/g) ?? []).length;
    if (opens !== closes) {
      problems.push({
        field,
        code: "UNBALANCED",
        message: `The ${field} has a { without a matching }. A stray brace is sent as written.`,
      });
    }

    for (const used of placeholdersIn(text)) {
      if (!known.has(used)) {
        problems.push({
          field,
          code: "UNKNOWN_PLACEHOLDER",
          message:
            `{${used}} is not something this message can fill. ` +
            (known.size > 0
              ? `Available: ${[...known].map((p) => `{${p}}`).join(", ")}.`
              : "This message has no placeholders."),
        });
      }
    }
  }

  return problems;
}

export interface Rendered {
  title: string;
  body: string;
  /** Placeholders the template used that had no value. Never sent to anybody. */
  missing: string[];
}

/**
 * Fills a template.
 *
 * NEVER EMITS A BRACE. A placeholder with no value is removed, not left as
 * `{amount}` — the one outcome that tells a student the Institute's software
 * is broken. The surrounding whitespace and any doubled punctuation left
 * behind are tidied, so "Your mark for "" is available" does not go out either.
 *
 * The missing names are returned so a caller can log or refuse, rather than
 * being swallowed; the message itself never mentions them.
 */
export function render(
  title: string,
  body: string,
  values: Record<string, string | number | null | undefined>,
): Rendered {
  const missing: string[] = [];

  const fill = (text: string): string => {
    const filled = text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, name: string) => {
      const value = values[name];
      if (value === undefined || value === null || String(value).trim() === "") {
        if (!missing.includes(name)) missing.push(name);
        return "";
      }
      return String(value);
    });

    return (
      filled
        // A quoted placeholder that vanished leaves "" behind.
        .replace(/""|''/g, "")
        // Doubled spaces from a removed word.
        .replace(/[ \t]{2,}/g, " ")
        // Punctuation left stranded: "is available ." or "for , see".
        .replace(/\s+([.,;:!?])/g, "$1")
        // A sentence that now begins with punctuation.
        .replace(/^[\s.,;:!?]+/, "")
        .trim()
    );
  };

  return { title: fill(title), body: fill(body), missing };
}

/**
 * What the Institute sees before saving: the message as a student would get it.
 *
 * Uses example values rather than a real student's, because a preview that
 * needed a real recipient could only be shown by picking one — and picking one
 * means reading their marks and their fees to fill the placeholders.
 */
export function previewValues(definition: TemplateDefinition): Record<string, string> {
  const examples: Record<string, string> = {
    studentName: "Ayesha Khan",
    certificateNo: "CERT/2026/00042",
    subject: "Graphic Designing",
    programme: "Diploma in Graphic Designing",
    assignment: "Logo redesign",
    quiz: "Typography basics",
    percentage: "68",
    threshold: "75",
    amount: "Rs 30,000",
    dueDate: "30 September 2026",
    daysOverdue: "12",
  };
  const out: Record<string, string> = {};
  for (const p of definition.placeholders) out[p] = examples[p] ?? p;
  return out;
}
