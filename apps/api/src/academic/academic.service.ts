import { Injectable, Logger } from "@nestjs/common";
import {
  AppError,
  buildPagination,
  clampPageSize,
  type AcademicSessionCreateInput,
  type AcademicSessionUpdateInput,
  type BatchCreateInput,
  type BatchUpdateInput,
  type OfferingCreateInput,
  type ProgrammeCreateInput,
  type ProgrammeUpdateInput,
  type SectionCreateInput,
  type SectionUpdateInput,
  type SubjectCreateInput,
  type SubjectUpdateInput,
} from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

/**
 * Academic structure — SRS §5.3.
 *
 * The backbone from which almost every authorisation and every report derives.
 * FR-CRS-011/015 require an Admin to create a subject or a section through the
 * interface without a deployment, so nothing here is hard-coded.
 */
@Injectable()
export class AcademicService {
  private readonly logger = new Logger(AcademicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------- programmes --

  async createProgramme(input: ProgrammeCreateInput) {
    const created = await this.prisma.scoped.programme.create({
      data: {
        name: input.name,
        code: input.code,
        description: input.description ?? null,
        durationWeeks: input.durationWeeks ?? null,
        thumbnailAssetId: input.thumbnailAssetId ?? null,
      },
    });
    await this.audit.record({
      action: "programme.create",
      entityType: "Programme",
      entityId: created.id,
      after: { code: created.code, name: created.name },
    });
    return created;
  }

  /**
   * FR-CRS-004 — correct a programme after it exists.
   *
   * THE CODE CANNOT BE CHANGED and the schema does not offer it: a programme
   * code is baked into every registration number issued against it (Appendix
   * B), several of which are printed on certificates in people's hands.
   *
   * `undefined` leaves a field alone and `null` clears it, which is why the
   * spread is conditional rather than a blanket assignment — sending only a
   * new name must not blank the description.
   */
  async updateProgramme(id: string, input: ProgrammeUpdateInput) {
    const before = await this.prisma.scoped.programme.findFirst({
      where: { id, deletedAt: null },
    });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND");

    const updated = await this.prisma.scoped.programme.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.durationWeeks !== undefined
          ? { durationWeeks: input.durationWeeks ?? null }
          : {}),
        ...(input.thumbnailAssetId !== undefined
          ? { thumbnailAssetId: input.thumbnailAssetId ?? null }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await this.audit.record({
      action: "programme.update",
      entityType: "Programme",
      entityId: id,
      before: { name: before.name, isActive: before.isActive },
      after: { name: updated.name, isActive: updated.isActive },
    });
    return updated;
  }

  /**
   * WITH ENOUGH TO SEE WHAT IS MISSING.
   *
   * The fee structures come back as a status list rather than as a count,
   * because the question the courses screen has to answer is not "how many"
   * but "is there a published one". A programme on offer with no published fee
   * is the failure that matters: the application form then tells every
   * applicant to telephone and ask what to pay, and nothing on any screen says
   * so. Counting drafts would report that programme as having a fee.
   */
  async listProgrammes() {
    const rows = await this.prisma.scoped.programme.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { sessions: true } },
        thumbnail: { select: { id: true } },
        feeStructures: {
          where: { deletedAt: null },
          select: { id: true, status: true },
        },
      },
    });

    return rows.map(({ feeStructures, ...p }) => ({
      ...p,
      fee: {
        published: feeStructures.some((f) => f.status === "PUBLISHED"),
        drafts: feeStructures.filter((f) => f.status === "DRAFT").length,
      },
    }));
  }

  // ------------------------------------------------------------- subjects --

  async createSubject(input: SubjectCreateInput) {
    const created = await this.prisma.scoped.subject.create({
      data: {
        name: input.name,
        code: input.code,
        description: input.description ?? null,
        credits: input.credits ?? null,
        thumbnailAssetId: input.thumbnailAssetId ?? null,
        thumbnailUrl: input.thumbnailUrl ?? null,
      },
    });
    await this.audit.record({
      action: "subject.create",
      entityType: "Subject",
      entityId: created.id,
      after: { code: created.code, name: created.name },
    });
    return created;
  }

  /** FR-CRS-015 — correct a subject. The code is immutable, as a programme's is. */
  async updateSubject(id: string, input: SubjectUpdateInput) {
    const before = await this.prisma.scoped.subject.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND");

    const updated = await this.prisma.scoped.subject.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.credits !== undefined ? { credits: input.credits ?? null } : {}),
        ...(input.thumbnailAssetId !== undefined
          ? { thumbnailAssetId: input.thumbnailAssetId ?? null }
          : {}),
        ...(input.thumbnailUrl !== undefined ? { thumbnailUrl: input.thumbnailUrl ?? null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await this.audit.record({
      action: "subject.update",
      entityType: "Subject",
      entityId: id,
      before: { name: before.name, isActive: before.isActive },
      after: { name: updated.name, isActive: updated.isActive },
    });
    return updated;
  }

  listSubjects() {
    return this.prisma.scoped.subject.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      include: { thumbnail: { select: { id: true } } },
    });
  }

  // ------------------------------------------------- sessions and batches --

  /**
   * FR-CRS-005. Until now these existed only in the seed script.
   *
   * A section cannot be created without a batchId, a batch cannot be created
   * without an academicSessionId, and nothing in the running system could
   * produce either — so `POST /sections` was a door with no handle on this
   * side. The permission matrix has granted an Admin FULL on both resources
   * since the day it was written; there were simply no routes behind it.
   */
  listSessions(params: { programmeId?: string; status?: string } = {}) {
    return this.prisma.scoped.academicSession.findMany({
      where: {
        deletedAt: null,
        ...(params.programmeId ? { programmeId: params.programmeId } : {}),
        ...(params.status ? { status: params.status } : {}),
      },
      orderBy: [{ startDate: "desc" }, { code: "asc" }],
      include: {
        programme: { select: { id: true, code: true, name: true } },
        _count: { select: { batches: true } },
      },
    });
  }

  async createSession(input: AcademicSessionCreateInput) {
    const programme = await this.prisma.scoped.programme.findFirst({
      where: { id: input.programmeId, deletedAt: null },
      select: { id: true, code: true },
    });
    if (!programme) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          { field: "programmeId", code: "NOT_FOUND", message: "That programme does not exist." },
        ],
      });
    }

    // (programmeId, code) is UNIQUE. Checked here so the Institute is told
    // which term already holds the code, rather than being shown a constraint
    // violation naming a database index.
    const clash = await this.prisma.scoped.academicSession.findFirst({
      where: { programmeId: input.programmeId, code: input.code },
      select: { name: true },
    });
    if (clash) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "code",
            code: "DUPLICATE",
            message: `${programme.code} already has a session coded ${input.code} — "${clash.name}".`,
          },
        ],
      });
    }

    const created = await this.prisma.scoped.academicSession.create({
      data: {
        programmeId: input.programmeId,
        name: input.name,
        code: input.code,
        startDate: input.startDate,
        endDate: input.endDate,
        status: "PLANNED",
      },
    });
    await this.audit.record({
      action: "academic_session.create",
      entityType: "AcademicSession",
      entityId: created.id,
      after: { code: created.code, name: created.name, programmeId: created.programmeId },
    });
    return created;
  }

  async updateSession(id: string, input: AcademicSessionUpdateInput) {
    const before = await this.prisma.scoped.academicSession.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, status: true, startDate: true, endDate: true },
    });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND", { message: "That session does not exist." });

    // Each date may arrive alone, so the range is checked against what is
    // already stored — otherwise moving the start past a stored end would be
    // accepted by a schema that only ever sees one of the two.
    const startDate = input.startDate ?? before.startDate;
    const endDate = input.endDate ?? before.endDate;
    if (endDate <= startDate) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "endDate",
            code: "RANGE",
            message: "The end date must be after the start date.",
          },
        ],
      });
    }

    const updated = await this.prisma.scoped.academicSession.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        startDate,
        endDate,
      },
    });
    await this.audit.record({
      action: "academic_session.update",
      entityType: "AcademicSession",
      entityId: id,
      before: { name: before.name, status: before.status },
      after: { name: updated.name, status: updated.status },
    });
    return updated;
  }

  listBatches(params: { academicSessionId?: string } = {}) {
    return this.prisma.scoped.batch.findMany({
      where: {
        deletedAt: null,
        ...(params.academicSessionId ? { academicSessionId: params.academicSessionId } : {}),
      },
      orderBy: { name: "asc" },
      include: {
        academicSession: {
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            programme: { select: { id: true, code: true, name: true } },
          },
        },
        _count: { select: { sections: true } },
      },
    });
  }

  async createBatch(input: BatchCreateInput) {
    const session = await this.prisma.scoped.academicSession.findFirst({
      where: { id: input.academicSessionId, deletedAt: null },
      select: { id: true, status: true, code: true },
    });
    if (!session) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "academicSessionId",
            code: "NOT_FOUND",
            message: "That session does not exist.",
          },
        ],
      });
    }
    // Adding a batch to a finished or abandoned term is a mistake every time,
    // and it would carry sections and enrolments in behind it.
    if (session.status === "COMPLETED" || session.status === "CANCELLED") {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "academicSessionId",
            code: "CLOSED",
            message: `Session ${session.code} is ${session.status.toLowerCase()}, so no new batch can be added to it.`,
          },
        ],
      });
    }

    const created = await this.prisma.scoped.batch.create({
      data: {
        academicSessionId: input.academicSessionId,
        name: input.name,
        deliveryPattern: input.deliveryPattern,
      },
    });
    await this.audit.record({
      action: "batch.create",
      entityType: "Batch",
      entityId: created.id,
      after: { name: created.name, academicSessionId: created.academicSessionId },
    });
    return created;
  }

  async updateBatch(id: string, input: BatchUpdateInput) {
    const before = await this.prisma.scoped.batch.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, deliveryPattern: true },
    });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND", { message: "That batch does not exist." });

    const updated = await this.prisma.scoped.batch.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.deliveryPattern !== undefined
          ? { deliveryPattern: input.deliveryPattern }
          : {}),
      },
    });
    await this.audit.record({
      action: "batch.update",
      entityType: "Batch",
      entityId: id,
      before: { name: before.name, deliveryPattern: before.deliveryPattern },
      after: { name: updated.name, deliveryPattern: updated.deliveryPattern },
    });
    return updated;
  }

  // ------------------------------------------------------------- sections --

  async createSection(input: SectionCreateInput) {
    // findFirst on the scoped client, always — see scoped-find.spec.ts.
    const batch = await this.prisma.scoped.batch.findFirst({
      where: { id: input.batchId },
      select: { id: true },
    });
    if (!batch) {
      throw new AppError("VALIDATION_FAILED", {
        details: [{ field: "batchId", code: "NOT_FOUND", message: "That batch does not exist." }],
      });
    }

    const created = await this.prisma.scoped.section.create({
      data: {
        batchId: input.batchId,
        code: input.code,
        name: input.name,
        capacity: input.capacity,
        genderRestriction: input.genderRestriction,
        shift: input.shift,
        deliveryMode: input.deliveryMode,
        attributes: (input.attributes ?? {}) as object,
        whatsappChannelUrl: input.whatsappChannelUrl ?? null,
        whatsappGroupUrl: input.whatsappGroupUrl ?? null,
        status: "PLANNED",
      },
    });

    await this.audit.record({
      action: "section.create",
      entityType: "Section",
      entityId: created.id,
      after: {
        code: created.code,
        capacity: created.capacity,
        genderRestriction: created.genderRestriction,
      },
    });
    return created;
  }

  async listSections(params: { batchId?: string; status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = clampPageSize(params.pageSize);

    const where = {
      deletedAt: null,
      ...(params.batchId ? { batchId: params.batchId } : {}),
      ...(params.status ? { status: params.status as never } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.scoped.section.findMany({
        where,
        orderBy: { code: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          batch: { select: { name: true, academicSession: { select: { code: true, name: true } } } },
          _count: { select: { sectionSubjects: true } },
        },
      }),
      this.prisma.scoped.section.count({ where }),
    ]);

    return {
      // FR-CRS-010 — occupancy, capacity and remaining places wherever a
      // section appears, so an administrator never has to work it out.
      data: rows.map((s: (typeof rows)[number]) => ({
        ...s,
        placesRemaining: Math.max(0, s.capacity - s.enrolledCount),
        isFull: s.enrolledCount >= s.capacity,
      })),
      pagination: buildPagination(page, pageSize, total),
      appliedFilters: params,
    };
  }

  async updateSection(id: string, input: SectionUpdateInput) {
    const before = await this.prisma.scoped.section.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND");

    // FR-CRS-008 — capacity may be raised freely but must not be lowered
    // below the students already in the section, which would leave the
    // section permanently and inexplicably "over" capacity.
    if (input.capacity !== undefined && input.capacity < before.enrolledCount) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "capacity",
            code: "BELOW_ENROLLED",
            message:
              `This batch already has ${before.enrolledCount} students. ` +
              `Capacity cannot be set below that.`,
          },
        ],
      });
    }

    // FR-CRS-009 / BR-ENR-05 — gender restriction is absolute, so it cannot be
    // changed once students are admitted. Changing it would retrospectively
    // make existing students ineligible for their own section.
    if (
      input.genderRestriction !== undefined &&
      input.genderRestriction !== before.genderRestriction &&
      before.enrolledCount > 0
    ) {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          "The gender restriction cannot be changed once students are enrolled. " +
          "Create a new section instead.",
      });
    }

    const updated = await this.prisma.scoped.section.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.genderRestriction !== undefined
          ? { genderRestriction: input.genderRestriction }
          : {}),
        ...(input.shift !== undefined ? { shift: input.shift } : {}),
        ...(input.deliveryMode !== undefined ? { deliveryMode: input.deliveryMode } : {}),
        ...(input.attributes !== undefined ? { attributes: input.attributes as object } : {}),
        ...(input.whatsappChannelUrl !== undefined
          ? { whatsappChannelUrl: input.whatsappChannelUrl }
          : {}),
        ...(input.whatsappGroupUrl !== undefined
          ? { whatsappGroupUrl: input.whatsappGroupUrl }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.liveProviderKey !== undefined ? { liveProviderKey: input.liveProviderKey } : {}),
      },
    });

    const { before: b, after: a } = AuditService.diff(
      before as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    );
    await this.audit.record({
      action: "section.update",
      entityType: "Section",
      entityId: id,
      before: b,
      after: a,
    });
    return updated;
  }

  /**
   * FR-CRS-012/013 — a section that has ever had an enrolment is ARCHIVED,
   * never deleted (BR-DAT-04). Archiving preserves every record while removing
   * it from operational lists.
   */
  async archiveSection(id: string) {
    const section = await this.prisma.scoped.section.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { students: true } } },
    });
    if (!section) throw new AppError("RESOURCE_NOT_FOUND");

    const updated = await this.prisma.scoped.section.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });

    await this.audit.record({
      action: "section.archive",
      entityType: "Section",
      entityId: id,
      before: { status: section.status },
      after: { status: "ARCHIVED" },
    });
    return updated;
  }

  // ------------------------------------------------------------ offerings --

  /** FR-CRS-016 — a subject is offered to many sections and vice versa. */
  async offerSubject(sectionId: string, input: OfferingCreateInput) {
    const [section, subject] = await Promise.all([
      this.prisma.scoped.section.findFirst({ where: { id: sectionId, deletedAt: null } }),
      this.prisma.scoped.subject.findFirst({ where: { id: input.subjectId, deletedAt: null } }),
    ]);
    if (!section) throw new AppError("RESOURCE_NOT_FOUND");
    if (!subject) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          { field: "subjectId", code: "NOT_FOUND", message: "That subject does not exist." },
        ],
      });
    }

    const existing = await this.prisma.scoped.sectionSubject.findFirst({
      where: { sectionId, subjectId: input.subjectId },
    });
    if (existing) {
      throw new AppError("DUPLICATE_RESOURCE", {
        message: `${subject.name} is already offered to ${section.name}.`,
      });
    }

    const created = await this.prisma.scoped.sectionSubject.create({
      data: {
        sectionId,
        subjectId: input.subjectId,
        isCompulsory: input.isCompulsory,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        status: "ACTIVE",
      },
      include: { subject: { select: { code: true, name: true } } },
    });

    await this.audit.record({
      action: "offering.create",
      entityType: "SectionSubject",
      entityId: created.id,
      after: { sectionId, subjectId: input.subjectId, isCompulsory: input.isCompulsory },
    });
    return created;
  }

  /**
   * FR-CRS-026 — surfaces subject-sections with no live teacher, so an
   * uncovered class is noticed by the Institute rather than by its students.
   */
  async listOfferings(sectionId: string) {
    const rows = await this.prisma.scoped.sectionSubject.findMany({
      where: { sectionId, deletedAt: null },
      include: {
        subject: { select: { id: true, code: true, name: true } },
        assignments: {
          where: {
            deletedAt: null,
            OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
          },
          include: { teacher: { include: { user: { select: { fullName: true } } } } },
        },
        _count: { select: { enrolments: true } },
      },
      orderBy: { subject: { name: "asc" } },
    });

    return rows.map((o: (typeof rows)[number]) => ({
      ...o,
      hasTeacher: o.assignments.length > 0,
      needsTeacher: o.assignments.length === 0 && o.status === "ACTIVE",
    }));
  }
}
