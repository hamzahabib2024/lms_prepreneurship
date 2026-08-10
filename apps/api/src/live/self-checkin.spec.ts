import {
  evaluateCheckIn,
  type ExistingRecord,
  type SessionForCheckIn,
} from "./self-checkin";

const at = (iso: string) => new Date(iso);

const session = (over: Partial<SessionForCheckIn> = {}): SessionForCheckIn => ({
  status: "LIVE",
  attendancePolicy: "SELF_CHECKIN",
  scheduledStart: at("2026-08-10T10:00:00Z"),
  scheduledEnd: at("2026-08-10T11:00:00Z"),
  actualStart: null,
  actualEnd: null,
  joinWindowMinutesBefore: 15,
  ...over,
});

const decide = (over: {
  now: string;
  session?: Partial<SessionForCheckIn>;
  existing?: ExistingRecord | null;
  lateAfterMinutes?: number;
}) =>
  evaluateCheckIn({
    now: at(over.now),
    session: session(over.session),
    existing: over.existing ?? null,
    lateAfterMinutes: over.lateAfterMinutes ?? 10,
  });

describe("the session's policy decides whether check-in exists at all", () => {
  it("allows it when the policy is SELF_CHECKIN", () => {
    expect(decide({ now: "2026-08-10T10:05:00Z" }).outcome).toBe("CHECKED_IN");
  });

  it("allows it under HYBRID", () => {
    // HYBRID means a provider proposes and people confirm; a student confirming
    // their own presence is exactly that.
    expect(
      decide({ now: "2026-08-10T10:05:00Z", session: { attendancePolicy: "HYBRID" } }).outcome,
    ).toBe("CHECKED_IN");
  });

  it("refuses it when the teacher takes the register", () => {
    const d = decide({ now: "2026-08-10T10:05:00Z", session: { attendancePolicy: "MANUAL" } });
    expect(d.outcome).toBe("REFUSED_POLICY");
    expect(d.message).toContain("Your teacher takes the register");
  });

  it("refuses it when the provider derives attendance", () => {
    expect(
      decide({ now: "2026-08-10T10:05:00Z", session: { attendancePolicy: "PROVIDER_DERIVED" } })
        .outcome,
    ).toBe("REFUSED_POLICY");
  });
});

describe("the window", () => {
  it("opens joinWindowMinutesBefore ahead of the start", () => {
    expect(decide({ now: "2026-08-10T09:45:00Z" }).outcome).toBe("CHECKED_IN");
  });

  it("is closed a minute earlier than that", () => {
    const d = decide({ now: "2026-08-10T09:44:00Z" });
    expect(d.outcome).toBe("REFUSED_NOT_OPEN");
    expect(d.message).toContain("15 minutes before");
  });

  it("is closed the day before", () => {
    expect(decide({ now: "2026-08-09T10:00:00Z" }).outcome).toBe("REFUSED_NOT_OPEN");
  });

  it("stays open to the scheduled end", () => {
    expect(decide({ now: "2026-08-10T11:00:00Z" }).outcome).toBe("CHECKED_IN");
  });

  it("is closed after it", () => {
    const d = decide({ now: "2026-08-10T11:01:00Z" });
    expect(d.outcome).toBe("REFUSED_NOT_OPEN");
    expect(d.message).toContain("finished");
  });

  it("is closed a month later", () => {
    // The obvious abuse: checking in to every class of the term at once.
    expect(decide({ now: "2026-09-10T10:30:00Z" }).outcome).toBe("REFUSED_NOT_OPEN");
  });

  it("uses the ACTUAL start when the class began late", () => {
    // A class that starts twenty minutes late must not have eaten its own
    // check-in window before anyone arrived.
    const d = decide({
      now: "2026-08-10T10:25:00Z",
      session: { actualStart: at("2026-08-10T10:20:00Z") },
    });
    expect(d.outcome).toBe("CHECKED_IN");
    expect(d.status).toBe("PRESENT");
  });

  it("closes when the class actually ended, even if early", () => {
    const d = decide({
      now: "2026-08-10T10:45:00Z",
      session: { actualEnd: at("2026-08-10T10:30:00Z"), status: "ENDED" },
    });
    expect(d.outcome).toBe("REFUSED_NOT_OPEN");
  });

  it("refuses an ENDED session with no recorded end time", () => {
    // The teacher has finished. Whatever the clock says, this is not
    // attendance any more.
    expect(
      decide({ now: "2026-08-10T10:30:00Z", session: { status: "ENDED" } }).outcome,
    ).toBe("REFUSED_NOT_OPEN");
  });

  it("refuses a cancelled class outright", () => {
    const d = decide({ now: "2026-08-10T10:30:00Z", session: { status: "CANCELLED" } });
    expect(d.outcome).toBe("REFUSED_CANCELLED");
    expect(d.message).toContain("cancelled");
  });

  it("refuses a cancelled class even inside the window", () => {
    expect(
      decide({ now: "2026-08-10T09:50:00Z", session: { status: "CANCELLED" } }).outcome,
    ).toBe("REFUSED_CANCELLED");
  });

  it("allows check-in to a SCHEDULED session inside its window", () => {
    // The teacher may not have pressed "start" yet. The student is there.
    expect(
      decide({ now: "2026-08-10T09:55:00Z", session: { status: "SCHEDULED" } }).outcome,
    ).toBe("CHECKED_IN");
  });
});

describe("present or late", () => {
  it("is PRESENT on time", () => {
    const d = decide({ now: "2026-08-10T10:00:00Z" });
    expect(d.status).toBe("PRESENT");
    expect(d.minutesAfterStart).toBe(0);
  });

  it("is PRESENT early", () => {
    const d = decide({ now: "2026-08-10T09:50:00Z" });
    expect(d.status).toBe("PRESENT");
    expect(d.minutesAfterStart).toBe(0);
  });

  it("is PRESENT at exactly the threshold", () => {
    expect(decide({ now: "2026-08-10T10:10:00Z" }).status).toBe("PRESENT");
  });

  it("is LATE a minute past it", () => {
    const d = decide({ now: "2026-08-10T10:11:00Z" });
    expect(d.status).toBe("LATE");
    expect(d.minutesAfterStart).toBe(11);
    expect(d.message).toContain("11 minutes");
  });

  it("honours an institute threshold of zero", () => {
    // "Late is late." A defensible policy and it must not be rounded away.
    expect(decide({ now: "2026-08-10T10:01:00Z", lateAfterMinutes: 0 }).status).toBe("LATE");
    expect(decide({ now: "2026-08-10T10:00:00Z", lateAfterMinutes: 0 }).status).toBe("PRESENT");
  });

  it("measures lateness from the ACTUAL start", () => {
    // A student is not late because the teacher was.
    const d = decide({
      now: "2026-08-10T10:25:00Z",
      session: { actualStart: at("2026-08-10T10:20:00Z") },
    });
    expect(d.status).toBe("PRESENT");
    expect(d.minutesAfterStart).toBe(5);
  });

  it("never reports negative minutes", () => {
    expect(decide({ now: "2026-08-10T09:46:00Z" }).minutesAfterStart).toBe(0);
  });
});

describe("a teacher's mark stands", () => {
  const marked = (over: Partial<ExistingRecord>): ExistingRecord => ({
    status: "PRESENT",
    markingSource: "MANUAL",
    ...over,
  });

  it("refuses to overturn ABSENT", () => {
    // The rule the whole feature turns on.
    const d = decide({
      now: "2026-08-10T10:05:00Z",
      existing: marked({ status: "ABSENT" }),
    });
    expect(d.outcome).toBe("REFUSED_TEACHER_MARKED");
    expect(d.message).toContain("Speak to them");
  });

  it("refuses to overturn EXCUSED", () => {
    // Checking in would LOSE the student something: excused is better than
    // present for an authorised absence.
    expect(
      decide({ now: "2026-08-10T10:05:00Z", existing: marked({ status: "EXCUSED" }) }).outcome,
    ).toBe("REFUSED_TEACHER_MARKED");
  });

  it("says so kindly when the teacher already marked them present", () => {
    const d = decide({ now: "2026-08-10T10:05:00Z", existing: marked({ status: "PRESENT" }) });
    expect(d.outcome).toBe("REFUSED_TEACHER_MARKED");
    expect(d.message).toContain("already marked you present");
  });

  it("refuses to overturn a PROVIDER-derived mark", () => {
    expect(
      decide({
        now: "2026-08-10T10:05:00Z",
        existing: marked({ status: "ABSENT", markingSource: "PROVIDER_DERIVED" }),
      }).outcome,
    ).toBe("REFUSED_TEACHER_MARKED");
  });

  it("treats an existing NOT_MARKED row as no mark at all", () => {
    // Registers are pre-created with a row per student; that is not a decision.
    const d = decide({
      now: "2026-08-10T10:05:00Z",
      existing: marked({ status: "NOT_MARKED" }),
    });
    expect(d.outcome).toBe("CHECKED_IN");
  });
});

describe("checking in twice", () => {
  it("is not an error", () => {
    const d = decide({
      now: "2026-08-10T10:05:00Z",
      existing: { status: "PRESENT", markingSource: "SELF_CHECKIN" },
    });
    expect(d.outcome).toBe("ALREADY_CHECKED_IN");
    expect(d.message).toContain("already checked in");
  });

  it("does not upgrade a LATE self check-in to PRESENT", () => {
    // Otherwise a student arriving late waits, presses again, and is on time.
    const d = decide({
      now: "2026-08-10T10:30:00Z",
      existing: { status: "LATE", markingSource: "SELF_CHECKIN" },
    });
    expect(d.outcome).toBe("ALREADY_CHECKED_IN");
    expect(d.status).toBeUndefined();
  });
});
