/**
 * The settings catalogue — SRS §5.20, CFG-*.
 *
 * Every value the Institute is allowed to change, declared in one place, with
 * its type, its default, what it means and where it may be overridden.
 *
 * IT IS A CATALOGUE, NOT A KEY-VALUE STORE, and that is the whole design. A
 * free-form settings table accepts `attendance.warningThresold` without
 * complaint: the administrator sets it, the screen shows it saved, and nothing
 * reads it — the real threshold stays at its default forever. That failure is
 * silent, permanent, and looks exactly like a working feature. An unknown key
 * is refused here instead.
 *
 * THE DEFAULT LIVES IN CODE, NOT IN THE DATABASE. A settings row is an
 * OVERRIDE. This matters more than it looks:
 *
 *   - a fresh install works with no seeding, and works identically to a
 *     configured one until somebody deliberately changes something;
 *   - deleting a row restores the documented behaviour rather than leaving a
 *     hole that reads as zero;
 *   - and the default is visible next to the code that depends on it, so
 *     nobody has to query a table to find out what 0.15 means.
 *
 * CHANGING A SETTING IS NOT RETROACTIVE. Lowering the attendance threshold
 * does not un-warn students already warned, and re-weighting progress does not
 * rewrite a certificate already issued. Anything already decided stays decided;
 * these values inform decisions still to come. Where that is not obvious the
 * description says so, because an administrator moving a threshold expects
 * *something* to happen and needs to know what.
 */

export type SettingType = "number" | "percent" | "boolean" | "string" | "string[]" | "weights";

/** Where an override may be attached. INSTITUTE is always allowed. */
export type ScopeType = "INSTITUTE" | "PROGRAMME" | "SECTION" | "SUBJECT";

export interface SettingDefinition {
  key: string;
  type: SettingType;
  /** The value used when nothing overrides it. */
  default: unknown;
  /** Shown on the settings screen. Says what changes, and when. */
  description: string;
  /** Grouping for the screen. */
  group: string;
  /** Scopes at which an override may be set, beyond INSTITUTE. */
  overridableAt?: ScopeType[];
  /** SEC-CRY-010 — write-only. Never read back, not even to an administrator. */
  isSecret?: boolean;
  /** Inclusive bounds for numeric types. */
  min?: number;
  max?: number;
  /** For string[], the values allowed. */
  allowed?: string[];
}

/**
 * A hard ceiling the multipart parser enforces before any of this is consulted
 * (assessment.controller.ts). A setting above it would be accepted here and
 * then fail at upload with a parser error that names nothing an administrator
 * could act on, so the bound is repeated rather than left implicit.
 */
export const UPLOAD_HARD_LIMIT_MB = 12;

export const CATALOGUE: SettingDefinition[] = [
  // ------------------------------------------------------------ attendance --
  {
    key: "attendance.warningThreshold",
    type: "percent",
    default: 75,
    group: "Attendance",
    min: 0,
    max: 100,
    overridableAt: ["PROGRAMME", "SECTION"],
    description:
      "Below this attendance percentage a student is warned (BR-ATT-05). Applies from the next register taken; students already warned stay warned.",
  },
  {
    key: "attendance.criticalThreshold",
    type: "percent",
    default: 60,
    group: "Attendance",
    min: 0,
    max: 100,
    overridableAt: ["PROGRAMME", "SECTION"],
    description:
      "Below this, the warning escalates to critical and the administrator is notified as well as the student.",
  },
  {
    key: "attendance.minimumSessions",
    type: "number",
    default: 3,
    group: "Attendance",
    min: 1,
    max: 50,
    overridableAt: ["PROGRAMME"],
    description:
      "How many classes must have been held before anyone is warned. Missing one of two classes is 50% attendance and means almost nothing; this stops the System alarming students in the first week.",
  },
  {
    key: "attendance.selfCheckInLateAfterMinutes",
    type: "number",
    default: 10,
    group: "Attendance",
    min: 0,
    max: 120,
    overridableAt: ["PROGRAMME", "SECTION"],
    description:
      "A student checking themselves in later than this many minutes after the class starts is recorded as LATE rather than present (FR-ATT-008). Measured from when the class actually started, so a student is not late because the teacher was.",
  },
  {
    key: "attendance.lateWeight",
    type: "number",
    default: 1.0,
    group: "Attendance",
    min: 0,
    max: 1,
    overridableAt: ["PROGRAMME"],
    description:
      "How much a LATE mark counts towards attendance. 1 counts it as present, 0.5 as half, 0 as absent.",
  },

  // -------------------------------------------------------------- progress --
  {
    key: "progress.weights",
    type: "weights",
    default: { video: 0.3, assignment: 0.3, quiz: 0.25, attendance: 0.15 },
    group: "Progress",
    overridableAt: ["PROGRAMME", "SUBJECT"],
    description:
      "How the four components combine into one progress figure (CFG-PRG-01..04). They must add up to 100%. A component a subject does not use is redistributed automatically (BR-PRG-03).",
  },
  {
    key: "completion.minProgressPercent",
    type: "percent",
    default: 80,
    group: "Progress",
    min: 0,
    max: 100,
    overridableAt: ["PROGRAMME", "SUBJECT"],
    description: "Progress a student must reach before a certificate can be issued.",
  },
  {
    key: "completion.minAttendancePercent",
    type: "percent",
    default: 75,
    group: "Progress",
    min: 0,
    max: 100,
    overridableAt: ["PROGRAMME", "SUBJECT"],
    description: "Attendance a student must reach before a certificate can be issued.",
  },
  {
    key: "completion.minAverageGradePercent",
    type: "percent",
    default: 50,
    group: "Progress",
    min: 0,
    max: 100,
    overridableAt: ["PROGRAMME", "SUBJECT"],
    description: "Average grade a student must reach before a certificate can be issued.",
  },

  // --------------------------------------------------------------- uploads --
  {
    key: "upload.maxFileSizeMb",
    type: "number",
    default: 10,
    group: "Submissions",
    min: 1,
    max: UPLOAD_HARD_LIMIT_MB,
    description:
      `The largest file a student may submit. A teacher can require less on a given assignment, never more. Cannot exceed ${UPLOAD_HARD_LIMIT_MB} MB, which the upload parser enforces before this is consulted.`,
  },
  {
    key: "upload.maxFileCount",
    type: "number",
    default: 5,
    group: "Submissions",
    min: 1,
    max: 20,
    description: "How many files one submission may carry.",
  },
  {
    key: "upload.allowedFileTypes",
    type: "string[]",
    default: ["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "jpg", "jpeg", "png", "mp3", "zip", "txt"],
    group: "Submissions",
    allowed: [
      "pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls",
      "jpg", "jpeg", "png", "gif", "mp3", "mp4", "zip", "txt", "csv",
    ],
    description:
      "The institute-wide ceiling (Appendix H). A teacher may narrow this for one assignment, never widen it. Files are checked by CONTENT, so renaming an extension does not get past it.",
  },

  // ----------------------------------------------------------- maintenance --
  //
  // Operational state rather than policy, but it lives here for the same
  // reasons everything else does: it must survive a restart, be audited when it
  // changes, and be readable without a database round trip on every request.
  {
    key: "maintenance.enabled",
    type: "boolean",
    default: false,
    group: "Maintenance",
    description:
      "Take the System off the air. Everybody except a Super Admin is shown a notice instead of the application; signing in stays available so a Super Admin can always turn it off again.",
  },
  {
    key: "maintenance.message",
    type: "string",
    default: "The System is unavailable for scheduled maintenance. Please try again shortly.",
    group: "Maintenance",
    description:
      "Shown to everybody who is turned away. Say what is happening in a sentence a student would understand.",
  },
  {
    key: "maintenance.expectedEndAt",
    type: "string",
    default: "",
    group: "Maintenance",
    description:
      "When the System is expected back, as an ISO date and time. Optional, and worth setting: whether to wait ten minutes or give up for the evening is the question somebody actually has.",
  },

  // ------------------------------------------------------------- institute --
  {
    key: "institute.timezoneOffsetMinutes",
    type: "number",
    default: 300,
    group: "Institute",
    min: -720,
    max: 840,
    description:
      "Minutes ahead of UTC where the Institute is. Pakistan is +05:00, so 300. Timetable times are read as local wall-clock and converted with this; it is a fixed offset because Pakistan does not observe daylight saving, and an institute that does would need more than a number here.",
  },
  {
    key: "institute.name",
    type: "string",
    default: "The Institute",
    group: "Institute",
    description:
      "Used on certificates, receipts, emails and the public verification page. The default is a placeholder — set it before anything is printed.",
  },
  {
    key: "institute.campus",
    type: "string",
    default: "",
    group: "Institute",
    description:
      "The campus or address printed under the Institute's name on a receipt. Leave it empty for a single-campus institute; the line is then omitted rather than printed blank.",
  },
  {
    key: "finance.receiptNote",
    type: "string",
    default: "Please keep this receipt. It is your proof of payment.",
    group: "Institute",
    description:
      "Printed at the foot of every receipt. A reversed payment ignores this and prints its own notice instead, because a receipt for money the Institute no longer holds must not end with a line telling the student to keep it as proof.",
  },
  {
    key: "certificate.signatoryName",
    type: "string",
    default: "",
    group: "Institute",
    description:
      "Printed on certificates beneath the signature line. Changing it does not alter certificates already issued — those carry the name recorded at the time.",
  },
  {
    key: "certificate.signatoryTitle",
    type: "string",
    default: "Director",
    group: "Institute",
    description: "The office the signatory holds, printed under their name.",
  },
];

const BY_KEY = new Map(CATALOGUE.map((d) => [d.key, d]));

export function definitionFor(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

export function isKnownKey(key: string): boolean {
  return BY_KEY.has(key);
}

export interface SettingProblem {
  key: string;
  message: string;
}

/**
 * Is this a value the setting can actually take?
 *
 * Runs on write. The stored value is JSON and the reader trusts it, so an
 * invalid value written today is a wrong figure on every screen tomorrow with
 * nothing pointing back here.
 */
export function validateValue(key: string, value: unknown): SettingProblem[] {
  const def = BY_KEY.get(key);
  if (!def) {
    return [
      {
        key,
        message: `"${key}" is not a setting this System has. Check the spelling — nothing reads an unknown key.`,
      },
    ];
  }

  const problems: SettingProblem[] = [];
  const fail = (message: string) => problems.push({ key, message });

  switch (def.type) {
    case "number":
    case "percent": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        fail(`${def.key} must be a number.`);
        break;
      }
      if (def.min !== undefined && value < def.min) fail(`${def.key} cannot be below ${def.min}.`);
      if (def.max !== undefined && value > def.max) fail(`${def.key} cannot be above ${def.max}.`);
      break;
    }

    case "boolean":
      if (typeof value !== "boolean") fail(`${def.key} must be true or false.`);
      break;

    case "string":
      if (typeof value !== "string") fail(`${def.key} must be text.`);
      break;

    case "string[]": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        fail(`${def.key} must be a list of text values.`);
        break;
      }
      if (value.length === 0) {
        // An empty allow-list reads as "no restriction" and means "nothing is
        // permitted". Students would find every upload refused with a message
        // about file types, and the list they were shown would be empty.
        fail(`${def.key} cannot be empty — that would refuse every file.`);
      }
      if (def.allowed) {
        for (const v of value as string[]) {
          if (!def.allowed.includes(v)) {
            fail(`"${v}" is not a file type this System can verify by content.`);
          }
        }
      }
      break;
    }

    case "weights": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail(`${def.key} must name each component and its share.`);
        break;
      }
      const w = value as Record<string, unknown>;
      const keys = ["video", "assignment", "quiz", "attendance"];
      for (const k of keys) {
        const n = w[k];
        if (typeof n !== "number" || !Number.isFinite(n)) {
          fail(`The ${k} share must be a number.`);
        } else if (n < 0 || n > 1) {
          fail(`The ${k} share must be between 0 and 1.`);
        }
      }
      for (const k of Object.keys(w)) {
        if (!keys.includes(k)) fail(`"${k}" is not a progress component.`);
      }
      if (problems.length === 0) {
        const sum = keys.reduce((total, k) => total + (w[k] as number), 0);
        if (Math.abs(sum - 1) > 0.0001) {
          // Not a rounding nicety. Weights that sum to 0.9 make every student's
          // progress read 10% low, uniformly and invisibly, and the figure gates
          // certificates.
          fail(
            `The four shares add up to ${Math.round(sum * 100)}%, not 100%. ` +
              `Progress would be wrong for every student.`,
          );
        }
      }
      break;
    }
  }

  return problems;
}

/**
 * Rules that involve MORE THAN ONE setting.
 *
 * Checked against the resolved set, not against the one being written, because
 * a value that is fine alone can be incoherent beside its neighbour and the
 * administrator changing one has no reason to be looking at the other.
 */
export function validateCoherence(resolved: Record<string, unknown>): SettingProblem[] {
  const problems: SettingProblem[] = [];
  const warning = resolved["attendance.warningThreshold"];
  const critical = resolved["attendance.criticalThreshold"];

  if (typeof warning === "number" && typeof critical === "number" && critical > warning) {
    // A student would reach "critical" while still above the level that
    // triggers a warning: escalation before notification, which reads as the
    // System skipping a step.
    problems.push({
      key: "attendance.criticalThreshold",
      message:
        `Critical (${critical}%) is above the warning threshold (${warning}%), so a student ` +
        `would be escalated before ever being warned.`,
    });
  }

  return problems;
}

/**
 * The order an override wins in: the most specific wins.
 *
 * SUBJECT beats SECTION beats PROGRAMME beats INSTITUTE beats the code default.
 * A subject with its own weighting keeps it when the Institute changes the
 * default, which is the point of an override — but it means a change that
 * "does nothing" usually means something more specific is set, so the screen
 * shows where each value comes from.
 */
export const SCOPE_PRECEDENCE: ScopeType[] = ["SUBJECT", "SECTION", "PROGRAMME", "INSTITUTE"];

export interface StoredSetting {
  key: string;
  value: unknown;
  scopeType: string | null;
  scopeId: string | null;
}

export interface ResolvedSetting {
  key: string;
  value: unknown;
  /** Where it came from: a scope, or "default" when nothing overrides it. */
  source: ScopeType | "default";
  scopeId: string | null;
}

/**
 * Resolve one key against the stored overrides that apply to this context.
 *
 * `context` names the ids in play — the programme, section and subject the
 * caller is asking about. An override is only considered when its scopeId
 * matches, so one section's threshold never leaks into another's.
 */
export function resolve(
  key: string,
  stored: StoredSetting[],
  context: Partial<Record<ScopeType, string>> = {},
): ResolvedSetting {
  const def = BY_KEY.get(key);

  for (const scope of SCOPE_PRECEDENCE) {
    const match = stored.find((s) => {
      if (s.key !== key) return false;
      if (scope === "INSTITUTE") return s.scopeType === "INSTITUTE" || s.scopeType === null;
      return s.scopeType === scope && s.scopeId != null && s.scopeId === context[scope];
    });
    if (match) {
      return { key, value: match.value, source: scope, scopeId: match.scopeId };
    }
  }

  return { key, value: def?.default, source: "default", scopeId: null };
}

/** Resolve every catalogued key at once. */
export function resolveAll(
  stored: StoredSetting[],
  context: Partial<Record<ScopeType, string>> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of CATALOGUE) out[def.key] = resolve(def.key, stored, context).value;
  return out;
}
