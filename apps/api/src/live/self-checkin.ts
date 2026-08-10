/**
 * Self check-in — SRS §5.11, FR-ATT-008.
 *
 * A student confirming their own presence in a class that is actually running.
 *
 * THIS PERMISSION EXISTED BEFORE THIS CODE DID. `attendance_self_checkin` was
 * split out of `attendance` while fixing a defect where a student holding
 * `attendance:update` "for self check-in" could mark the ENTIRE CLASS present —
 * the bulk-marking endpoint accepted the same permission. Splitting it was the
 * fix; it left a grant students held that nothing implemented. This is the
 * implementation, and it is deliberately the narrowest thing that satisfies the
 * requirement.
 *
 * The rules are here, pure, because every one of them is a way the feature can
 * be abused rather than merely misused:
 *
 *   - a student must not check in to a class that has not started, or to one
 *     that finished last month;
 *   - a student must not overturn a mark a teacher has already made;
 *   - and a self-reported presence must never be indistinguishable from a
 *     teacher's observation of it.
 *
 * The last is why MarkingSource exists and why nothing here ever writes
 * MANUAL. A register that renders both identically has quietly moved the
 * authority for attendance from the teacher to the student.
 */

export type CheckInOutcome =
  | "CHECKED_IN"
  | "ALREADY_CHECKED_IN"
  | "REFUSED_POLICY"
  | "REFUSED_NOT_OPEN"
  | "REFUSED_TEACHER_MARKED"
  | "REFUSED_CANCELLED";

export interface SessionForCheckIn {
  status: "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED";
  attendancePolicy: "MANUAL" | "SELF_CHECKIN" | "PROVIDER_DERIVED" | "HYBRID";
  scheduledStart: Date;
  scheduledEnd: Date;
  actualStart: Date | null;
  actualEnd: Date | null;
  joinWindowMinutesBefore: number;
}

export interface ExistingRecord {
  status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "NOT_MARKED";
  markingSource: "MANUAL" | "SELF_CHECKIN" | "PROVIDER_DERIVED" | "AUTOMATED" | "IMPORTED";
}

export interface CheckInDecision {
  outcome: CheckInOutcome;
  /** The status to record. Only set when the outcome is CHECKED_IN. */
  status?: "PRESENT" | "LATE";
  /** Said to the student. Never blames them for a rule they cannot see. */
  message: string;
  /** Minutes after the start the student checked in. Recorded, not judged. */
  minutesAfterStart?: number;
}

export interface CheckInInput {
  now: Date;
  session: SessionForCheckIn;
  existing: ExistingRecord | null;
  /** Institute policy: later than this and the mark is LATE, not PRESENT. */
  lateAfterMinutes: number;
}

export function evaluateCheckIn({
  now,
  session,
  existing,
  lateAfterMinutes,
}: CheckInInput): CheckInDecision {
  if (session.status === "CANCELLED") {
    return {
      outcome: "REFUSED_CANCELLED",
      message: "This class was cancelled, so there is no attendance to record.",
    };
  }

  // The policy is a property of the SESSION, not of the student. A teacher who
  // takes the register by hand has not delegated it, and a student in that
  // class must be told so rather than left pressing a button that does nothing.
  if (session.attendancePolicy !== "SELF_CHECKIN" && session.attendancePolicy !== "HYBRID") {
    return {
      outcome: "REFUSED_POLICY",
      message: "Your teacher takes the register for this class. You do not need to check in.",
    };
  }

  const opensAt = new Date(
    (session.actualStart ?? session.scheduledStart).getTime() -
      session.joinWindowMinutesBefore * 60_000,
  );
  // Ends when the class actually ended, or was due to. A session marked ENDED
  // early closes check-in immediately: the teacher has finished, and anything
  // after that is not attendance.
  const closesAt = session.actualEnd ?? session.scheduledEnd;

  if (session.status === "ENDED" && session.actualEnd == null) {
    return {
      outcome: "REFUSED_NOT_OPEN",
      message: "This class has finished. Ask your teacher to mark you present.",
    };
  }

  if (now < opensAt) {
    return {
      outcome: "REFUSED_NOT_OPEN",
      message: `Check-in opens ${session.joinWindowMinutesBefore} minutes before the class starts.`,
    };
  }

  if (now > closesAt) {
    return {
      outcome: "REFUSED_NOT_OPEN",
      message: "This class has finished. Ask your teacher to mark you present.",
    };
  }

  if (existing && existing.status !== "NOT_MARKED") {
    // A TEACHER'S MARK STANDS. This is the rule the whole feature turns on: a
    // student marked absent must not be able to overturn it by pressing a
    // button, and a student marked EXCUSED must not lose that by checking in.
    if (existing.markingSource !== "SELF_CHECKIN") {
      return {
        outcome: "REFUSED_TEACHER_MARKED",
        message:
          existing.status === "PRESENT" || existing.status === "LATE"
            ? "Your teacher has already marked you present."
            : "Your teacher has already marked this class. Speak to them if it is wrong.",
      };
    }
    // Their own earlier check-in. Pressing it twice is not an error.
    return {
      outcome: "ALREADY_CHECKED_IN",
      message: "You are already checked in.",
    };
  }

  const startedAt = session.actualStart ?? session.scheduledStart;
  const minutesAfterStart = Math.max(
    0,
    Math.floor((now.getTime() - startedAt.getTime()) / 60_000),
  );
  const isLate = minutesAfterStart > lateAfterMinutes;

  return {
    outcome: "CHECKED_IN",
    status: isLate ? "LATE" : "PRESENT",
    minutesAfterStart,
    message: isLate
      ? `Checked in ${minutesAfterStart} minutes after the start, so this is recorded as late.`
      : "Checked in.",
  };
}
