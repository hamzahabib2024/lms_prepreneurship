import { Injectable } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditFilter {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  correlationId?: string;
  from?: Date;
  to?: Date;
  page?: number;
}

/**
 * Reading the audit log — SRS §5.19, FR-LOG-010..016.
 *
 * The log has been written since the first commit and NOTHING HAS EVER READ IT.
 * Every privileged act in the System — an approval, a grade revision, a
 * suspension, a certificate revoked — has been recorded faithfully and been
 * invisible, which makes it a compliance artefact rather than a tool.
 *
 * The scope policy decides who sees what, and it is stricter here than almost
 * anywhere: a Super Admin sees everything, an ADMIN SEES ONLY THEIR OWN
 * ACTIONS, and nobody else sees anything (§4.5.12). An administrator reading
 * colleagues' actions is surveillance, not administration; investigating
 * somebody is a Super Admin's job and is itself recorded.
 *
 * Nothing here writes, and the table has a database trigger refusing UPDATE and
 * DELETE (FR-LOG-004), so a viewer cannot become an editor by accident.
 */
@Injectable()
export class AuditViewerService {
  constructor(private readonly prisma: PrismaService) {}

  /** FR-LOG-010 — the log, newest first, filtered. */
  async list(filter: AuditFilter) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = 50;

    const where = {
      ...(filter.action ? { action: { startsWith: filter.action } } : {}),
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
      ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
      ...(filter.correlationId ? { correlationId: filter.correlationId } : {}),
      ...(filter.from || filter.to
        ? {
            occurredAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.scoped.auditLog.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.auditLog.count({ where }),
    ]);

    // Actor names are resolved separately and under asSystem. The log stores an
    // id and the role held AT THE TIME, deliberately — a name is what somebody
    // is called today, and a record of what happened must not change when
    // somebody marries or is promoted.
    const actorIds = [
      ...new Set(rows.map((r: (typeof rows)[number]) => r.actorUserId).filter((id): id is string => id !== null)),
    ];
    const actors = actorIds.length
      ? await this.prisma.asSystem((db) =>
          db.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, fullName: true, email: true },
          }),
        )
      : [];
    const nameOf = new Map(
      actors.map((a: (typeof actors)[number]) => [a.id, a.fullName]),
    );

    return {
      data: rows.map((r: (typeof rows)[number]) => ({
        id: r.id,
        occurredAt: r.occurredAt,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        // "System" is a real principal (§4.2.5), not a missing value: a
        // scheduled sweep or an automatic release has no person behind it.
        actor: r.actorUserId ? (nameOf.get(r.actorUserId) ?? "Deleted account") : "System",
        actorUserId: r.actorUserId,
        actorRole: r.actorRole,
        impersonatedBy: r.impersonatedBy,
        before: r.beforeValue,
        after: r.afterValue,
        ipAddress: r.ipAddress,
        correlationId: r.correlationId,
      })),
      pagination: {
        page,
        pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  /**
   * FR-LOG-012 — everything that happened to one record.
   *
   * The question somebody actually asks is never "show me the log", it is "why
   * does this student's grade say 19 when I remember 17". This answers that
   * one directly.
   */
  async forEntity(entityType: string, entityId: string) {
    const rows = await this.prisma.scoped.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { occurredAt: "asc" },
    });

    if (rows.length === 0) {
      // Not an error. A record nobody has changed has no history, and saying so
      // is different from failing.
      return { entityType, entityId, events: [], message: "Nothing has been recorded against this record." };
    }

    const actorIds = [
      ...new Set(rows.map((r: (typeof rows)[number]) => r.actorUserId).filter((id): id is string => id !== null)),
    ];
    const actors = await this.prisma.asSystem((db) =>
      db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } }),
    );
    const nameOf = new Map(actors.map((a: (typeof actors)[number]) => [a.id, a.fullName]));

    return {
      entityType,
      entityId,
      events: rows.map((r: (typeof rows)[number]) => ({
        occurredAt: r.occurredAt,
        action: r.action,
        actor: r.actorUserId ? (nameOf.get(r.actorUserId) ?? "Deleted account") : "System",
        actorRole: r.actorRole,
        before: r.beforeValue,
        after: r.afterValue,
        correlationId: r.correlationId,
      })),
    };
  }

  /**
   * FR-LOG-014 — everything that happened in one REQUEST.
   *
   * ARC-008 stamps every write in a request with the same correlation id, so an
   * approval that created a user, a student, six enrolments and a payment reads
   * as one act rather than nine unrelated lines.
   */
  async forCorrelation(correlationId: string) {
    const rows = await this.prisma.scoped.auditLog.findMany({
      where: { correlationId },
      orderBy: { occurredAt: "asc" },
    });
    if (rows.length === 0) throw new AppError("RESOURCE_NOT_FOUND");

    return {
      correlationId,
      occurredAt: rows[0]?.occurredAt,
      events: rows.map((r: (typeof rows)[number]) => ({
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        after: r.afterValue,
      })),
    };
  }

  /** FR-LOG-016 — what kinds of thing are in the log, for the filter. */
  async actions() {
    const rows = await this.prisma.scoped.auditLog.groupBy({
      by: ["action"],
      _count: { _all: true },
      orderBy: { _count: { action: "desc" } },
      take: 60,
    });
    return rows.map((r: (typeof rows)[number]) => ({
      action: r.action,
      count: r._count._all,
    }));
  }
}
