import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { AppError } from "@lms/shared";
import {
  describeSchedule,
  planInstalments,
  type Cadence,
  type Instalment,
} from "./instalments";

export interface PlanInput {
  studentId: string;
  totalRupees: number;
  count: number;
  firstDueDate: Date;
  cadence: Cadence;
  label: string;
  academicSessionId?: string;
}

/**
 * Writing an instalment plan — FR-PAY-033..038.
 *
 * A PLAN IS JUST CHARGES. There is deliberately no InstalmentPlan table: the
 * ledger already knows how to hold a charge with a due date, and a second
 * concept would mean two places to look for what a student owes and two
 * chances for them to disagree. What a plan adds is that the charges are
 * created together, sum to the total exactly, and are named so a statement
 * reads as a schedule rather than as several unexplained debts.
 *
 * ALL OF THEM OR NONE. Unlike a cohort import — where each student is separate
 * and a partial result is honest — half a plan is a lie about what the student
 * owes. So the charges are written in ONE transaction.
 */
@Injectable()
export class InstalmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The schedule, without writing anything. */
  preview(input: Omit<PlanInput, "studentId" | "academicSessionId">) {
    const { instalments, problem } = planInstalments(input);
    return {
      instalments: instalments.map(serialise),
      problem,
      message: problem ? problem.message : describeSchedule(instalments),
    };
  }

  async create(input: PlanInput, ip?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const { instalments, problem } = planInstalments(input);
    if (problem) {
      throw new AppError("VALIDATION_FAILED", {
        message: problem.message,
        details: [{ field: "plan", code: problem.code, message: problem.message }],
      });
    }

    // Scoped, so an administrator whose reach does not cover this student
    // finds nothing rather than being told they may not (ARC-051).
    const student = await this.prisma.scoped.student.findFirst({
      where: { id: input.studentId },
      select: { id: true, registrationNo: true },
    });
    if (!student) throw new AppError("RESOURCE_NOT_FOUND");

    const created = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const rows = [];
        for (const i of instalments) {
          rows.push(
            await tx.feeCharge.create({
              data: {
                studentId: student.id,
                description: i.description,
                amount: i.amount,
                dueDate: i.dueDate,
                createdBy: actor.userId,
                ...(input.academicSessionId
                  ? { academicSessionId: input.academicSessionId }
                  : {}),
              },
              select: { id: true, description: true, amount: true, dueDate: true },
            }),
          );
        }

        await this.audit.record(
          {
            action: "fee.plan.create",
            entityType: "Student",
            entityId: student.id,
            after: {
              label: input.label,
              total: input.totalRupees,
              count: input.count,
              cadence: input.cadence,
              chargeIds: rows.map((r) => r.id),
            },
            ...(ip ? { ipAddress: ip } : {}),
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        return rows;
      }),
    );

    return {
      studentId: student.id,
      registrationNo: student.registrationNo,
      charges: created.map((c) => ({
        id: c.id,
        description: c.description,
        amount: Number(c.amount),
        dueDate: c.dueDate,
      })),
      message:
        `${describeSchedule(instalments)} They are on the student's statement now, and the ` +
        `first is due ${instalments[0]!.dueDate.toISOString().slice(0, 10)}.`,
    };
  }
}

function serialise(i: Instalment) {
  return {
    number: i.number,
    amount: i.amount,
    dueDate: i.dueDate,
    description: i.description,
  };
}
