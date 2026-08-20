import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import {
  byDue,
  format,
  validateForPublication,
  type FeeLineInput,
  type FeeStructureInput,
} from "./fee-structure";

export interface UpsertFeeStructureInput extends FeeStructureInput {
  programmeId: string;
  academicSessionId?: string | null;
  notes?: string | null;
}

/**
 * A course's price, as the Institute sets it and the public reads it — FR-PAY-033.
 *
 * TWO AUDIENCES, ONE TABLE, AND THEY MUST NEVER DISAGREE. An administrator
 * edits a draft; an applicant reads a published structure on a page that tells
 * them how much money to transfer. Everything here exists to keep the second
 * from ever seeing a number the first had not finished deciding — which is why
 * DRAFT and PUBLISHED are separate states rather than an `isVisible` flag, and
 * why the arithmetic is checked on the way to PUBLISHED rather than on save.
 *
 * PUBLISHING SUPERSEDES, IT DOES NOT OVERWRITE. Once an applicant has been
 * quoted 90,000 and paid 25,000 against it, that structure is the record of
 * what they were told; the office checks their slip against it. Editing it in
 * place would rewrite history for every application already in the queue, so a
 * new price is a new row and the old one is marked superseded.
 */
@Injectable()
export class FeeStructureService {
  private readonly logger = new Logger(FeeStructureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ reading --

  /** Everything for one programme — drafts included. Staff only. */
  async listForProgramme(programmeId: string) {
    const rows = await this.prisma.asSystem((db) =>
      db.feeStructure.findMany({
        where: { programmeId, deletedAt: null },
        include: {
          lines: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
          academicSession: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      }),
    );
    return rows.map((r) => this.present(r));
  }

  async byId(id: string) {
    const row = await this.prisma.asSystem((db) =>
      db.feeStructure.findFirst({
        where: { id, deletedAt: null },
        include: {
          lines: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] },
          academicSession: { select: { id: true, code: true, name: true } },
        },
      }),
    );
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");
    return this.present(row);
  }

  /**
   * The one an applicant should be quoted — FR-REG-003.
   *
   * A SESSION'S OWN STRUCTURE BEATS THE PROGRAMME'S STANDING ONE, which is the
   * whole reason `academicSessionId` is nullable. An institute raising fees for
   * one intake sets a structure on that term; every other term keeps reading
   * the programme-wide row, and nobody has to re-enter twelve unchanged tables.
   *
   * Returns null rather than throwing. A programme with no published fee is a
   * programme whose price has not been set yet — the apply page then says so,
   * plainly, instead of failing to load.
   */
  async publishedFor(programmeId: string, academicSessionId?: string | null) {
    const rows = await this.prisma.asSystem((db) =>
      db.feeStructure.findMany({
        where: {
          programmeId,
          status: "PUBLISHED",
          deletedAt: null,
          supersededAt: null,
          OR: [{ academicSessionId: null }, ...(academicSessionId ? [{ academicSessionId }] : [])],
        },
        include: { lines: true },
      }),
    );
    if (rows.length === 0) return null;

    // The session-specific one, when there is one.
    const exact = rows.find((r) => r.academicSessionId !== null);
    return this.present(exact ?? rows[0]!);
  }

  // ------------------------------------------------------------ writing --

  /** A new draft. Never publishes: the arithmetic is checked separately. */
  async create(input: UpsertFeeStructureInput) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    await this.assertProgrammeExists(input.programmeId);

    const created = await this.prisma.asSystem((db) =>
      db.feeStructure.create({
        data: {
          programmeId: input.programmeId,
          academicSessionId: input.academicSessionId ?? null,
          name: input.name.trim(),
          currency: input.currency.toUpperCase(),
          totalAmount: input.totalAmount,
          dueAtApplication: input.dueAtApplication,
          notes: input.notes?.trim() || null,
          status: "DRAFT",
          createdBy: actor.userId,
          lines: { create: this.lineRows(input.lines) },
        },
        include: { lines: true, academicSession: { select: { id: true, code: true, name: true } } },
      }),
    );

    await this.audit.record({
      action: "fee_structure.create",
      entityType: "FeeStructure",
      entityId: created.id,
      after: {
        programmeId: input.programmeId,
        name: created.name,
        totalAmount: String(created.totalAmount),
      },
    });

    return this.present(created);
  }

  /**
   * Edit a draft.
   *
   * A PUBLISHED STRUCTURE IS NOT EDITABLE, and the refusal says what to do
   * instead. Somebody has already been quoted these numbers; changing them
   * silently changes what an application in the queue will be judged against.
   */
  async update(id: string, input: UpsertFeeStructureInput) {
    const existing = await this.prisma.asSystem((db) =>
      db.feeStructure.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw new AppError("RESOURCE_NOT_FOUND");

    if (existing.status === "PUBLISHED") {
      throw new AppError("VALIDATION_FAILED", {
        message:
          "This fee structure is published, so it cannot be edited. Applicants have been quoted " +
          "these figures and their slips are checked against them. Create a new one instead — " +
          "publishing it supersedes this, and the old numbers stay on the record.",
      });
    }

    const updated = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        // Replaced wholesale rather than diffed. The editor sends the table as
        // it now stands; matching rows up to decide which to update would be a
        // lot of machinery to arrive at the same place.
        await tx.feeStructureLine.deleteMany({ where: { feeStructureId: id } });
        return tx.feeStructure.update({
          where: { id },
          data: {
            academicSessionId: input.academicSessionId ?? null,
            name: input.name.trim(),
            currency: input.currency.toUpperCase(),
            totalAmount: input.totalAmount,
            dueAtApplication: input.dueAtApplication,
            notes: input.notes?.trim() || null,
            lines: { create: this.lineRows(input.lines) },
          },
          include: {
            lines: true,
            academicSession: { select: { id: true, code: true, name: true } },
          },
        });
      }),
    );

    await this.audit.record({
      action: "fee_structure.update",
      entityType: "FeeStructure",
      entityId: id,
      before: { totalAmount: String(existing.totalAmount), status: existing.status },
      after: { totalAmount: String(updated.totalAmount) },
    });

    return this.present(updated);
  }

  /**
   * Make it the price — the only thing on this service a member of the public
   * can feel.
   *
   * THE ARITHMETIC IS CHECKED HERE, not on save, because a half-typed table is
   * unfinished rather than wrong and an editor that refuses every keystroke is
   * an editor nobody can use. Everything that is wrong is reported at once:
   * an administrator gets three things wrong at a time and one-per-save is
   * three round trips to learn what one screen could have said.
   *
   * SUPERSEDING THE OLD ONE HAPPENS IN THE SAME TRANSACTION. The database has
   * a partial unique index allowing exactly one published structure per
   * programme per term; doing this in two statements would leave a window
   * where there are two, or none, and the apply page reads this table.
   */
  async publish(id: string) {
    const row = await this.prisma.asSystem((db) =>
      db.feeStructure.findFirst({ where: { id, deletedAt: null }, include: { lines: true } }),
    );
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");

    if (row.status === "PUBLISHED") {
      return { alreadyPublished: true as const, ...this.present(row) };
    }

    const problems = validateForPublication({
      name: row.name,
      currency: row.currency,
      totalAmount: Number(row.totalAmount),
      dueAtApplication: Number(row.dueAtApplication),
      lines: row.lines.map((l) => ({
        kind: l.kind as FeeLineInput["kind"],
        label: l.label,
        amount: Number(l.amount),
        dueAfterDays: l.dueAfterDays,
        sortOrder: l.sortOrder,
      })),
    });

    if (problems.length > 0) {
      throw new AppError("VALIDATION_FAILED", {
        message:
          "This fee structure cannot be published yet — applicants would be shown figures that " +
          "do not add up.",
        details: problems.map((p) => ({ field: p.field, code: p.code, message: p.message })),
      });
    }

    const published = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        await tx.feeStructure.updateMany({
          where: {
            programmeId: row.programmeId,
            academicSessionId: row.academicSessionId,
            status: "PUBLISHED",
            deletedAt: null,
          },
          data: { status: "ARCHIVED", supersededAt: new Date() },
        });

        return tx.feeStructure.update({
          where: { id },
          data: { status: "PUBLISHED", supersededAt: null },
          include: {
            lines: true,
            academicSession: { select: { id: true, code: true, name: true } },
          },
        });
      }),
    );

    await this.audit.record({
      action: "fee_structure.publish",
      entityType: "FeeStructure",
      entityId: id,
      after: {
        programmeId: row.programmeId,
        totalAmount: String(row.totalAmount),
        dueAtApplication: String(row.dueAtApplication),
      },
    });

    this.logger.log(
      `Published fee structure ${id} for programme ${row.programmeId} — ` +
        `${format(Number(row.totalAmount), row.currency)}`,
    );

    return { alreadyPublished: false as const, ...this.present(published) };
  }

  /**
   * Withdraw a published price without deleting the record of it.
   *
   * The apply page stops quoting it immediately. The row stays, because
   * applications already in the queue were judged against it.
   */
  async archive(id: string) {
    const row = await this.prisma.asSystem((db) =>
      db.feeStructure.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");

    const updated = await this.prisma.asSystem((db) =>
      db.feeStructure.update({
        where: { id },
        data: { status: "ARCHIVED", supersededAt: new Date() },
        include: { lines: true, academicSession: { select: { id: true, code: true, name: true } } },
      }),
    );

    await this.audit.record({
      action: "fee_structure.archive",
      entityType: "FeeStructure",
      entityId: id,
      before: { status: row.status },
      after: { status: "ARCHIVED" },
    });

    return this.present(updated);
  }

  /** Only a draft can be discarded — anything published is part of the record. */
  async remove(id: string) {
    const row = await this.prisma.asSystem((db) =>
      db.feeStructure.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");

    if (row.status !== "DRAFT") {
      throw new AppError("VALIDATION_FAILED", {
        message:
          "Only a draft can be deleted. A structure that was published is what somebody was " +
          "quoted, so it is archived rather than removed.",
      });
    }

    await this.prisma.asSystem((db) =>
      db.feeStructure.update({ where: { id }, data: { deletedAt: new Date() } }),
    );

    await this.audit.record({
      action: "fee_structure.delete",
      entityType: "FeeStructure",
      entityId: id,
      before: { name: row.name, status: row.status },
    });

    return { deleted: true };
  }

  // ------------------------------------------------------------ helpers --

  private lineRows(lines: FeeLineInput[]): Prisma.FeeStructureLineCreateWithoutFeeStructureInput[] {
    return lines.map((l, i) => ({
      kind: l.kind,
      label: l.label.trim(),
      amount: l.amount,
      dueAfterDays: l.kind === "INSTALMENT" ? (l.dueAfterDays ?? 0) : null,
      sortOrder: l.sortOrder ?? i,
    }));
  }

  private async assertProgrammeExists(programmeId: string): Promise<void> {
    const found = await this.prisma.asSystem((db) =>
      db.programme.findFirst({ where: { id: programmeId, deletedAt: null }, select: { id: true } }),
    );
    if (!found) {
      throw new AppError("RESOURCE_NOT_FOUND", {
        message: "That programme does not exist, so a fee cannot be set for it.",
      });
    }
  }

  /**
   * Decimal to number, and the two line kinds split apart.
   *
   * PRISMA DECIMALS ARE OBJECTS, and they serialise as `{"s":1,"e":4,"d":[9,0000]}`
   * — which is what reaches the browser if they are passed through untouched.
   * Converting here, once, means no screen has to know that.
   */
  private present(row: {
    id: string;
    programmeId: string;
    academicSessionId: string | null;
    name: string;
    currency: string;
    totalAmount: Prisma.Decimal;
    dueAtApplication: Prisma.Decimal;
    notes: string | null;
    status: string;
    supersededAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    lines: Array<{
      id: string;
      kind: string;
      label: string;
      amount: Prisma.Decimal;
      dueAfterDays: number | null;
      sortOrder: number;
    }>;
    academicSession?: { id: string; code: string; name: string } | null;
  }) {
    const lines = row.lines.map((l) => ({
      id: l.id,
      kind: l.kind as FeeLineInput["kind"],
      label: l.label,
      amount: Number(l.amount),
      dueAfterDays: l.dueAfterDays,
      sortOrder: l.sortOrder,
    }));

    return {
      id: row.id,
      programmeId: row.programmeId,
      academicSessionId: row.academicSessionId,
      academicSession: row.academicSession ?? null,
      name: row.name,
      currency: row.currency,
      totalAmount: Number(row.totalAmount),
      dueAtApplication: Number(row.dueAtApplication),
      notes: row.notes,
      status: row.status,
      supersededAt: row.supersededAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      components: lines
        .filter((l) => l.kind === "COMPONENT")
        .sort((a, b) => a.sortOrder - b.sortOrder),
      // In the order the applicant will actually pay them, not the order they
      // were typed — an instalment added later still belongs where it falls.
      instalments: lines.filter((l) => l.kind === "INSTALMENT").sort(byDue),
    };
  }
}
