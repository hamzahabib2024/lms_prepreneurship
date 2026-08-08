import { Global, Injectable, Logger, Module } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { getActor } from "../prisma/actor-context";

export interface AuditEntry {
  action: string; // e.g. "registration.approve"
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * The immutable audit log — §5.21.
 *
 * FR-LOG-004: entries are never updated or deleted. This service exposes only
 * `record()`; there is no update or delete method, and the migration revokes
 * UPDATE and DELETE on the table at the database privilege level so that
 * application-level compromise cannot rewrite history.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an entry. Call INSIDE the transaction that made the change, so a
   * rolled-back change leaves no audit trace and a committed one always does.
   *
   * @param tx pass the transaction client when inside `$transaction`
   */
  async record(entry: AuditEntry, tx?: { auditLog: { create: (a: unknown) => unknown } }) {
    const actor = getActor();
    const client = tx ?? (this.prisma as unknown as typeof tx);

    const data = {
      actorUserId: actor?.userId ?? null, // null = SYSTEM (FR-LOG-005)
      actorRole: actor?.roles?.[0] ?? null, // role held AT THE TIME
      impersonatedBy: actor?.impersonatedBy ?? null, // SEC-AUZ-013
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeValue: (entry.before ?? null) as object | null,
      afterValue: (entry.after ?? null) as object | null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent?.slice(0, 500) ?? null,
      correlationId: actor?.correlationId ?? "00000000-0000-0000-0000-000000000000",
    };

    try {
      await (client as { auditLog: { create: (a: unknown) => Promise<unknown> } }).auditLog.create({
        data,
      });
    } catch (err) {
      // SEC-LOG-011 / FR-LOG-010: if a privileged action cannot be audited,
      // the action must not stand. Refuse rather than proceed unrecorded.
      this.logger.error(
        `AUDIT WRITE FAILED for ${entry.action} on ${entry.entityType}:${entry.entityId}`,
        err as Error,
      );
      throw new AppError("INTERNAL_ERROR", {
        message: "The action could not be completed because it could not be recorded.",
        internal: err,
      });
    }
  }

  /**
   * Reduces a before/after pair to only the fields that actually changed.
   * FR-LOG-003 wants the changed fields, not a copy of the whole row.
   */
  static diff<T extends Record<string, unknown>>(
    before: T,
    after: Partial<T>,
  ): { before: Partial<T>; after: Partial<T> } {
    const b: Partial<T> = {};
    const a: Partial<T> = {};
    for (const key of Object.keys(after) as Array<keyof T>) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        b[key] = before[key];
        a[key] = after[key];
      }
    }
    return { before: b, after: a };
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
