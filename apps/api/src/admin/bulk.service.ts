import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EnrolmentService } from "../academic/enrolment.service";
import { refuseBatch, report, type RowResult } from "./bulk-rules";

/**
 * Bulk operations — SRS §5.24, FR-OPS-020..026.
 *
 * EVERY ROW GOES THROUGH THE ORDINARY OPERATION. transfer() enforces the gender
 * restriction (FR-CRS-009, which is absolute), capacity, archived sections and
 * locked roll-number allocation; a bulk transfer written as one clever UPDATE
 * would be faster and would put a male student in a women's section.
 *
 * That costs one transaction per student, which for a batch of fifty is fine
 * and is the correct trade. If it ever is not, the answer is to make transfer()
 * faster, not to write a second implementation of the rules.
 *
 * NOT ALL-OR-NOTHING. Each row is atomic in itself and the batch is "as many as
 * could be done". Stopping at the first failure would leave an arbitrary prefix
 * applied with the operator working out where it got to. The report says so in
 * words and lists the failures first.
 */
@Injectable()
export class BulkService {
  private readonly logger = new Logger(BulkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly enrolments: EnrolmentService,
  ) {}

  /**
   * FR-OPS-021 — what a bulk transfer WOULD do.
   *
   * Checks the same conditions transfer() checks, without writing. It cannot be
   * perfect — capacity can change between the preview and the act, and two
   * administrators can preview the same section at once — so the real
   * enforcement stays in transfer() and this is an aid, not a guarantee. That
   * is why the summary speaks in the conditional.
   */
  async previewTransfer(studentIds: string[], toSectionId: string) {
    this.refuseShape(studentIds);

    const [students, section] = await Promise.all([
      this.prisma.asSystem((db) =>
        db.student.findMany({
          where: { id: { in: studentIds } },
          select: {
            id: true,
            gender: true,
            currentSectionId: true,
            user: { select: { fullName: true } },
          },
        }),
      ),
      this.prisma.asSystem((db) =>
        db.section.findUnique({
          where: { id: toSectionId },
          select: {
            id: true,
            name: true,
            status: true,
            capacity: true,
            enrolledCount: true,
            genderRestriction: true,
          },
        }),
      ),
    ]);
    if (!section) throw new AppError("RESOURCE_NOT_FOUND");

    const byId = new Map(students.map((s: (typeof students)[number]) => [s.id, s]));
    let placesLeft = section.capacity - section.enrolledCount;

    const rows: RowResult[] = studentIds.map((studentId) => {
      const student = byId.get(studentId);
      if (!student) {
        return { studentId, outcome: "FAILED" as const, message: "No such student." };
      }
      const name = student.user.fullName;

      if (student.currentSectionId === toSectionId) {
        return { studentId, name, outcome: "SKIPPED" as const, message: "Already in that section." };
      }
      if (section.status === "ARCHIVED") {
        return {
          studentId, name, outcome: "FAILED" as const,
          message: "That section is archived and cannot accept students.",
        };
      }
      if (section.genderRestriction !== "MIXED" && section.genderRestriction !== student.gender) {
        return {
          studentId, name, outcome: "FAILED" as const,
          message: `${section.name} admits ${section.genderRestriction.toLowerCase()} students only.`,
        };
      }
      if (placesLeft <= 0) {
        // Counted DOWN across the batch. Checking each student against the
        // section's current occupancy would say all fifty fit into ten places.
        return {
          studentId, name, outcome: "FAILED" as const,
          message: `${section.name} has no places left for this batch.`,
        };
      }
      placesLeft -= 1;
      return { studentId, name, outcome: "WOULD_SUCCEED" as const };
    });

    return {
      section: { id: section.id, name: section.name, placesRemaining: Math.max(0, placesLeft) },
      ...report(rows, true),
    };
  }

  /** FR-OPS-022 — move them, one ordinary transfer at a time. */
  async transfer(studentIds: string[], toSectionId: string, reason: string) {
    this.refuseShape(studentIds);

    const rows: RowResult[] = [];
    for (const studentId of studentIds) {
      try {
        await this.enrolments.transfer(studentId, { toSectionId, reason } as never);
        rows.push({ studentId, outcome: "SUCCEEDED" });
      } catch (err) {
        // The ordinary operation's own message, verbatim. Rewriting it here
        // would mean two descriptions of the same rule, drifting apart.
        rows.push({
          studentId,
          outcome: "FAILED",
          message: err instanceof AppError ? err.message : "Could not transfer this student.",
        });
      }
    }

    const result = report(rows, false);

    // One audit entry for the batch, carrying the counts. Each transfer has
    // already written its own; ARC-008 gives them all the same correlation id,
    // so the log reads as one act with fifty parts rather than fifty acts.
    await this.audit.record({
      action: "bulk.transfer",
      entityType: "Section",
      entityId: toSectionId,
      after: {
        requested: studentIds.length,
        succeeded: result.succeeded,
        failed: result.failed,
        reason,
      },
    });

    this.logger.log(
      `Bulk transfer to ${toSectionId}: ${result.succeeded} of ${studentIds.length} moved.`,
    );

    return result;
  }

  /** FR-OPS-023 — withdraw many, with one reason recorded against each. */
  async withdraw(studentIds: string[], reason: string) {
    this.refuseShape(studentIds);

    if (reason.trim().length < 10) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "reason",
            code: "REASON_TOO_SHORT",
            message: "Record why these students are being withdrawn. It goes on each record.",
          },
        ],
      });
    }

    const rows: RowResult[] = [];
    for (const studentId of studentIds) {
      try {
        await this.enrolments.withdraw(studentId, reason);
        rows.push({ studentId, outcome: "SUCCEEDED" });
      } catch (err) {
        rows.push({
          studentId,
          outcome: "FAILED",
          message: err instanceof AppError ? err.message : "Could not withdraw this student.",
        });
      }
    }

    const result = report(rows, false);

    await this.audit.record({
      action: "bulk.withdraw",
      entityType: "Student",
      entityId: studentIds[0] ?? "",
      after: {
        requested: studentIds.length,
        succeeded: result.succeeded,
        failed: result.failed,
        reason,
      },
    });

    return result;
  }

  private refuseShape(studentIds: string[]): void {
    const problem = refuseBatch(studentIds);
    if (problem) {
      throw new AppError("VALIDATION_FAILED", {
        details: [{ field: "studentIds", code: problem.code, message: problem.message }],
      });
    }
  }
}
