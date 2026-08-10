import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { SettingsService } from "../settings/settings.service";
import { LiveSessionService } from "./live-session.service";
import { expand, groupByDay, upcoming, validatePattern, type WeeklyPattern } from "./timetable";
import { report, type RowResult } from "../admin/bulk-rules";

export interface GenerateInput extends Omit<WeeklyPattern, "offsetMinutes"> {
  sectionSubjectId: string;
  hostTeacherId: string;
  titleTemplate?: string;
  sessionType?: "ONLINE" | "OFFLINE";
  attendancePolicy?: "MANUAL" | "SELF_CHECKIN" | "PROVIDER_DERIVED" | "HYBRID";
}

/**
 * The timetable — SRS §5.13, FR-LIV-030..036.
 *
 * "Monday and Wednesday, 09:00 to 11:00, for the term" — thirty classes,
 * described once.
 *
 * EVERY GENERATED CLASS GOES THROUGH THE ORDINARY SCHEDULER. LiveSessionService
 * .schedule() refuses a teacher already booked at that hour, an archived
 * section and an end before a start; a generator that wrote rows directly would
 * be the fastest way to double-book somebody thirty times. It is the same
 * decision as bulk transfer calling the ordinary transfer, for the same reason.
 *
 * AND SO IT IS NOT ALL-OR-NOTHING. A term where one Wednesday clashes with an
 * exam should produce twenty-nine classes and a line about the thirtieth, not
 * nothing at all. The report says which, in the scheduler's own words, using
 * the same shape as bulk operations.
 */
@Injectable()
export class TimetableService {
  private readonly logger = new Logger(TimetableService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly sessions: LiveSessionService,
  ) {}

  /** FR-LIV-031 — what a pattern WOULD create, before it creates anything. */
  async preview(input: GenerateInput) {
    const pattern = await this.patternFrom(input);
    const problem = validatePattern(pattern);
    if (problem) {
      throw new AppError("VALIDATION_FAILED", {
        details: [{ field: "pattern", code: problem.code, message: problem.message }],
      });
    }

    const occurrences = expand(pattern);
    return {
      count: occurrences.length,
      first: occurrences[0]?.scheduledStart ?? null,
      last: occurrences[occurrences.length - 1]?.scheduledStart ?? null,
      occurrences: occurrences.map((o) => ({
        scheduledStart: o.scheduledStart,
        scheduledEnd: o.scheduledEnd,
      })),
      // Said, because a pattern that silently produced nothing would look like
      // a broken button rather than a range with no matching days in it.
      message:
        occurrences.length === 0
          ? "No days in that range match the pattern."
          : `${occurrences.length} classes, from ${occurrences[0]?.scheduledStart.toISOString().slice(0, 10)} to ${occurrences[occurrences.length - 1]?.scheduledStart.toISOString().slice(0, 10)}.`,
    };
  }

  /** FR-LIV-032 — create them. */
  async generate(input: GenerateInput) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const pattern = await this.patternFrom(input);
    const problem = validatePattern(pattern);
    if (problem) {
      throw new AppError("VALIDATION_FAILED", {
        details: [{ field: "pattern", code: problem.code, message: problem.message }],
      });
    }

    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: input.sectionSubjectId, deletedAt: null },
      include: {
        subject: { select: { code: true, name: true } },
        section: { select: { code: true } },
      },
    });
    if (!offering) throw new AppError("RESOURCE_NOT_FOUND");

    const occurrences = expand(pattern);
    const rows: RowResult[] = [];

    for (const [index, o] of occurrences.entries()) {
      const title =
        input.titleTemplate?.trim() ||
        `${offering.subject.name} — ${offering.section.code}`;
      try {
        const created = await this.sessions.schedule({
          sectionSubjectId: input.sectionSubjectId,
          title: `${title} (${index + 1} of ${occurrences.length})`,
          scheduledStart: o.scheduledStart,
          scheduledEnd: o.scheduledEnd,
          hostTeacherId: input.hostTeacherId,
          ...(input.sessionType ? { sessionType: input.sessionType } : {}),
          ...(input.attendancePolicy ? { attendancePolicy: input.attendancePolicy } : {}),
        });
        rows.push({
          studentId: created.id,
          name: o.scheduledStart.toISOString().slice(0, 16).replace("T", " "),
          outcome: "SUCCEEDED",
        });
      } catch (err) {
        // The scheduler's own sentence — "This teacher already has X for Y at
        // that time" — is more useful than anything this loop could invent.
        rows.push({
          studentId: o.scheduledStart.toISOString(),
          name: o.scheduledStart.toISOString().slice(0, 16).replace("T", " "),
          outcome: "FAILED",
          message: err instanceof AppError ? err.message : "That class could not be scheduled.",
        });
      }
    }

    const result = report(rows, false);

    await this.audit.record({
      action: "timetable.generate",
      entityType: "SectionSubject",
      entityId: input.sectionSubjectId,
      after: {
        days: input.days,
        startTime: input.startTime,
        endTime: input.endTime,
        requested: occurrences.length,
        created: result.succeeded,
        failed: result.failed,
      },
    });

    this.logger.log(
      `Timetable for ${offering.subject.code}: ${result.succeeded} of ${occurrences.length} classes created.`,
    );

    return result;
  }

  /**
   * FR-LIV-034 — my classes, grouped into days.
   *
   * Read through the SCOPED client: a student sees the classes of the offerings
   * they are enrolled in and a teacher those they teach, because the LiveSession
   * policy says so. No role branching here, and no studentId parameter — the
   * question "whose timetable" is answered by the token.
   */
  async mine(fromDate?: Date, toDate?: Date) {
    const from = fromDate ?? new Date();
    // A fortnight by default: a week is too short on a Friday, and a term is
    // more than anybody reads at once.
    const to = toDate ?? new Date(from.getTime() + 14 * 86_400_000);

    const sessions = await this.prisma.scoped.liveSession.findMany({
      where: {
        deletedAt: null,
        status: { in: ["SCHEDULED", "LIVE"] },
        scheduledStart: { gte: from, lte: to },
      },
      orderBy: { scheduledStart: "asc" },
      take: 500,
    });

    const offeringIds = [
      ...new Set(sessions.map((s: (typeof sessions)[number]) => s.sectionSubjectId)),
    ];
    const teacherIds = [
      ...new Set(sessions.map((s: (typeof sessions)[number]) => s.hostTeacherId)),
    ];

    const [offerings, teachers] = await Promise.all([
      this.prisma.asSystem((db) =>
        db.sectionSubject.findMany({
          where: { id: { in: offeringIds } },
          include: {
            subject: { select: { code: true, name: true } },
            section: { select: { code: true } },
          },
        }),
      ),
      this.prisma.asSystem((db) =>
        db.teacher.findMany({
          where: { id: { in: teacherIds } },
          include: { user: { select: { fullName: true } } },
        }),
      ),
    ]);
    const offeringOf = new Map(offerings.map((o: (typeof offerings)[number]) => [o.id, o]));
    const teacherOf = new Map(
      teachers.map((t: (typeof teachers)[number]) => [t.id, t.user.fullName]),
    );

    const offsetMinutes = await this.settings.number("institute.timezoneOffsetMinutes");

    const entries = sessions.map((s: (typeof sessions)[number]) => {
      const offering = offeringOf.get(s.sectionSubjectId);
      return {
        id: s.id,
        title: s.title,
        subject: offering ? `${offering.subject.code} ${offering.subject.name}` : "",
        section: offering?.section.code ?? "",
        teacher: teacherOf.get(s.hostTeacherId) ?? null,
        scheduledStart: s.scheduledStart,
        scheduledEnd: s.scheduledEnd,
        status: s.status,
      };
    });

    const days = groupByDay(entries, offsetMinutes);
    const next = upcoming(
      entries.map((e) => ({ scheduledStart: e.scheduledStart, scheduledEnd: e.scheduledEnd })),
      new Date(),
    )[0];

    return {
      from,
      to,
      days,
      // The single most useful fact on the screen, computed once here rather
      // than re-derived by every client that shows it.
      nextClass: next
        ? entries.find(
            (e) => e.scheduledStart.getTime() === next.scheduledStart.getTime(),
          ) ?? null
        : null,
      message: days.length === 0 ? "No classes scheduled in this period." : null,
    };
  }

  /** The pattern, with the institute's clock attached. */
  private async patternFrom(input: GenerateInput): Promise<WeeklyPattern> {
    return {
      days: input.days,
      startTime: input.startTime,
      endTime: input.endTime,
      fromDate: input.fromDate,
      toDate: input.toDate,
      ...(input.exclusions ? { exclusions: input.exclusions } : {}),
      offsetMinutes: await this.settings.number("institute.timezoneOffsetMinutes"),
    };
  }
}
