import { Injectable, Logger } from "@nestjs/common";
import {
  AppError,
  buildPagination,
  clampPageSize,
  type OfferingCreateInput,
  type ProgrammeCreateInput,
  type SectionCreateInput,
  type SectionUpdateInput,
  type SubjectCreateInput,
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

  listProgrammes() {
    return this.prisma.scoped.programme.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      include: { _count: { select: { sessions: true } } },
    });
  }

  // ------------------------------------------------------------- subjects --

  async createSubject(input: SubjectCreateInput) {
    const created = await this.prisma.scoped.subject.create({
      data: {
        name: input.name,
        code: input.code,
        description: input.description ?? null,
        credits: input.credits ?? null,
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

  listSubjects() {
    return this.prisma.scoped.subject.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
    });
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
              `This section already has ${before.enrolledCount} students. ` +
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
