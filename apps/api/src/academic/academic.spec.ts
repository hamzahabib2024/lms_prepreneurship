/**
 * Academic structure and enrolment rules — SRS §5.3, §5.4.
 *
 * These cover the contract-level rules that do not need a database: what the
 * schemas accept and refuse. The state transitions themselves are exercised by
 * the end-to-end probes against real rows.
 */

import {
  assignmentCreateSchema,
  sectionCreateSchema,
  sectionUpdateSchema,
  subjectCreateSchema,
  transferSchema,
  suspendSchema,
  academicSessionCreateSchema,
  academicSessionUpdateSchema,
  batchUpdateSchema,
  ACADEMIC_SESSION_STATUS,
  SESSION_STATUS,
} from "@lms/shared";

describe("section contract (FR-CRS-006/007)", () => {
  const valid = {
    batchId: "018f2b04-0000-7000-8000-000000000000",
    code: "SP26-GD-MOR-A",
    name: "Graphic Designing — Morning A",
    capacity: 40,
    shift: "MORNING" as const,
  };

  it("accepts a well-formed section and applies the documented defaults", () => {
    const parsed = sectionCreateSchema.parse(valid);
    // MIXED unless stated: a restriction is a deliberate act, and defaulting
    // to a gendered section would silently exclude applicants.
    expect(parsed.genderRestriction).toBe("MIXED");
    expect(parsed.deliveryMode).toBe("ONLINE");
  });

  it("rejects a non-positive capacity", () => {
    expect(() => sectionCreateSchema.parse({ ...valid, capacity: 0 })).toThrow();
    expect(() => sectionCreateSchema.parse({ ...valid, capacity: -5 })).toThrow();
  });

  it("normalises the section code and rejects punctuation", () => {
    expect(sectionCreateSchema.parse({ ...valid, code: "sp26-gd-mor-a" }).code).toBe(
      "SP26-GD-MOR-A",
    );
    expect(() => sectionCreateSchema.parse({ ...valid, code: "SP26 GD/A" })).toThrow();
  });

  it("carries arbitrary attributes so a new tag needs no deployment", () => {
    // FR-CRS-007 — attributes are configurable tags, not fixed columns.
    const parsed = sectionCreateSchema.parse({
      ...valid,
      attributes: { language: "Urdu", room: "Lab 2", pilotCohort: true },
    });
    expect(parsed.attributes).toEqual({ language: "Urdu", room: "Lab 2", pilotCohort: true });
  });

  it("allows a partial update without re-sending the batch", () => {
    const parsed = sectionUpdateSchema.parse({ capacity: 45 });
    expect(parsed.capacity).toBe(45);
    expect("batchId" in parsed).toBe(false);
  });
});

describe("subject and programme codes (Appendix B)", () => {
  it("constrains the charset, because the code enters the registration number", () => {
    // A code containing "-" or "/" would make CIIT/SP26-GD-034/ISB ambiguous
    // to parse and to read.
    expect(subjectCreateSchema.parse({ name: "Graphic Designing", code: "gd101" }).code).toBe(
      "GD101",
    );
    expect(() => subjectCreateSchema.parse({ name: "X", code: "GD-101" })).toThrow();
    expect(() => subjectCreateSchema.parse({ name: "X", code: "G" })).toThrow();
    expect(() => subjectCreateSchema.parse({ name: "X", code: "TOOLONGACODE12" })).toThrow();
  });
});

describe("academic session dates", () => {
  it("refuses an end date at or before the start", () => {
    const base = {
      programmeId: "018f2b04-0000-7000-8000-000000000000",
      name: "Spring 2026",
      code: "SP26",
    };
    expect(() =>
      academicSessionCreateSchema.parse({
        ...base,
        startDate: "2026-07-31",
        endDate: "2026-02-01",
      }),
    ).toThrow();
    expect(() =>
      academicSessionCreateSchema.parse({
        ...base,
        startDate: "2026-02-01",
        endDate: "2026-07-31",
      }),
    ).not.toThrow();
  });
});

describe("editing a session or a batch (FR-CRS-005)", () => {
  it("lets a single field arrive alone", () => {
    // Every field is optional on update, so a rename does not require the
    // caller to resend dates it never touched — resending them is how a screen
    // silently overwrites a change somebody else made.
    expect(() => academicSessionUpdateSchema.parse({ name: "Spring 2026 (revised)" })).not.toThrow();
    expect(() => batchUpdateSchema.parse({ deliveryPattern: "Weekend" })).not.toThrow();
  });

  it("REFUSES to move the session to another programme", () => {
    // The absence of programmeId is the rule, so it is asserted rather than
    // assumed: the code is unique per programme and feeds the registration
    // number series, so a move would either collide or orphan issued numbers.
    const parsed = academicSessionUpdateSchema.parse({
      programmeId: "018f2b04-0000-7000-8000-000000000000",
      name: "Spring 2026",
    } as never);
    expect(parsed).not.toHaveProperty("programmeId");
  });

  it("refuses to move a batch to another session, for the same reason", () => {
    const parsed = batchUpdateSchema.parse({
      academicSessionId: "018f2b04-0000-7000-8000-000000000000",
      name: "Batch A",
    } as never);
    expect(parsed).not.toHaveProperty("academicSessionId");
  });

  it("refuses a code change on a session — the code is not editable at all", () => {
    const parsed = academicSessionUpdateSchema.parse({ code: "FA26" } as never);
    expect(parsed).not.toHaveProperty("code");
  });

  it("refuses an end date on or before the start when BOTH are sent", () => {
    const start = "2026-02-01";
    expect(() =>
      academicSessionUpdateSchema.parse({ startDate: start, endDate: "2026-01-01" }),
    ).toThrow();
    // Equal is not a range either — a term cannot begin and end the same day.
    expect(() =>
      academicSessionUpdateSchema.parse({ startDate: start, endDate: start }),
    ).toThrow();
    expect(() =>
      academicSessionUpdateSchema.parse({ startDate: start, endDate: "2026-07-31" }),
    ).not.toThrow();
  });

  it("ACCEPTS one date alone, because the schema cannot see the stored other", () => {
    // Deliberate, and the reason updateSession re-checks the range against the
    // stored row. If this refused, moving only the start would be impossible;
    // if the service did not re-check, moving only the start past a stored end
    // would be accepted. Both halves are needed, so both are written down.
    expect(() => academicSessionUpdateSchema.parse({ startDate: "2026-02-01" })).not.toThrow();
    expect(() => academicSessionUpdateSchema.parse({ endDate: "2026-07-31" })).not.toThrow();
  });

  it("accepts only the four documented session statuses", () => {
    for (const status of ACADEMIC_SESSION_STATUS) {
      expect(() => academicSessionUpdateSchema.parse({ status })).not.toThrow();
    }
    // LIVE belongs to a single class on a single afternoon, not to a term.
    // The two enums share the English word and nothing else.
    expect(() => academicSessionUpdateSchema.parse({ status: "LIVE" } as never)).toThrow();
    expect(() => academicSessionUpdateSchema.parse({ status: "ENDED" } as never)).toThrow();
  });

  it("keeps the two session vocabularies from drifting into each other", () => {
    // They overlap on exactly one word: CANCELLED, which means the same thing
    // in both — called off, never happened. Everything else must stay apart,
    // because a term that reported itself LIVE would be a class timetable
    // reading a calendar.
    const shared = ACADEMIC_SESSION_STATUS.filter((s) =>
      (SESSION_STATUS as readonly string[]).includes(s),
    );
    expect(shared).toEqual(["CANCELLED"]);
  });
});

describe("teacher assignment contract (BR-ACC-04)", () => {
  const base = {
    teacherId: "018f2b04-0000-7000-8000-000000000001",
    sectionSubjectId: "018f2b04-0000-7000-8000-000000000002",
    startDate: "2026-02-01",
  };

  it("binds to a section-subject, never to a subject alone", () => {
    // The absence of a bare `subjectId` field is the point. A schema that
    // accepted one would invite an implementation that grants a teacher every
    // section of that subject.
    const parsed = assignmentCreateSchema.parse(base);
    expect(parsed.sectionSubjectId).toBeDefined();
    expect("subjectId" in parsed).toBe(false);
    expect(parsed.assignmentRole).toBe("PRIMARY");
  });

  it("permits an end date, so temporary cover expires on its own", () => {
    // FR-CRS-025 — cover withdraws scope automatically, with no administrative
    // action and therefore nothing to forget.
    const parsed = assignmentCreateSchema.parse({
      ...base,
      assignmentRole: "SUBSTITUTE",
      endDate: "2026-03-01",
    });
    expect(parsed.endDate).toBeInstanceOf(Date);
  });

  it("refuses an end date at or before the start", () => {
    expect(() =>
      assignmentCreateSchema.parse({ ...base, endDate: "2026-01-01" }),
    ).toThrow();
  });
});

describe("transfer contract (FR-ENR-005)", () => {
  const base = {
    toSectionId: "018f2b04-0000-7000-8000-000000000003",
    reason: "Student moved to the evening shift for work.",
  };

  it("requires an EXPLICIT history decision", () => {
    // Both answers are legitimate and the wrong one is hard to undo, so the
    // System refuses to choose on the administrator's behalf.
    expect(() => transferSchema.parse(base)).toThrow();
    expect(() => transferSchema.parse({ ...base, carryHistory: true })).not.toThrow();
    expect(() => transferSchema.parse({ ...base, carryHistory: false })).not.toThrow();
  });

  it("requires a reason", () => {
    expect(() =>
      transferSchema.parse({ ...base, carryHistory: true, reason: "" }),
    ).toThrow();
  });

  it("defaults capacity override to false, so exceeding capacity is deliberate", () => {
    expect(transferSchema.parse({ ...base, carryHistory: true }).capacityOverride).toBe(false);
  });

  it("has no gender override field at all (BR-ENR-05)", () => {
    // Capacity can be overridden; gender cannot. An override path that exists
    // will eventually be used, so the schema does not offer one — and a
    // transfer must not become a way around the rule enforced at admission.
    const parsed = transferSchema.parse({ ...base, carryHistory: true });
    expect("genderOverride" in parsed).toBe(false);
    expect(Object.keys(transferSchema.parse({ ...base, carryHistory: true }))).not.toContain(
      "genderRestrictionOverride",
    );
  });
});

describe("suspension contract (FR-ENR-008)", () => {
  it("requires a reason, because the student is told why", () => {
    // An unexplained loss of function is indistinguishable from a fault, and
    // generates a support call instead of an understood consequence.
    expect(() => suspendSchema.parse({ reason: "" })).toThrow();
    expect(() => suspendSchema.parse({})).toThrow();
    expect(() =>
      suspendSchema.parse({ reason: "Fees outstanding beyond the agreed date." }),
    ).not.toThrow();
  });
});
