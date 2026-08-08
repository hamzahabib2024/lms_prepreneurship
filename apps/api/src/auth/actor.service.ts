import { Injectable } from "@nestjs/common";
import type { Role, SubPermission } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { Actor } from "../prisma/actor-context";

/**
 * Resolves the reach of a user — the section-subjects and sections their scope
 * covers — so the Prisma extension can build its predicate.
 *
 * FR-RBAC-002: everything here derives from the server-side identity. Nothing
 * a client sends is consulted.
 *
 * FR-RBAC-003 / ARC-047: results may be cached for at most 15 minutes, and
 * MUST be purged synchronously when roles, assignments, or enrolments change.
 * The in-memory map below is a development stand-in; move it to Redis before
 * running more than one instance, or a stale entry on one node will outlive
 * the purge issued on another.
 */
@Injectable()
export class ActorService {
  private readonly cache = new Map<string, { actor: Omit<Actor, "correlationId">; at: number }>();
  private readonly ttlMs = 15 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string, correlationId: string): Promise<Actor> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.at < this.ttlMs) {
      return { ...cached.actor, correlationId };
    }

    // Unscoped by necessity: we are establishing who the actor is, so there is
    // no actor yet to scope by. This is one of the four legitimate bypasses.
    const resolved = await this.prisma.asSystem(async (db) => {
      const user = await db.user.findUnique({
        where: { id: userId },
        include: {
          roles: { include: { role: true } },
          student: true,
          teacher: true,
        },
      });
      if (!user) return null;

      const now = new Date();
      const roles = user.roles
        .filter((ur) => !ur.expiresAt || ur.expiresAt > now) // FR-RBAC-013
        .map((ur) => ur.role.key as Role);

      const subPermissions = user.roles.flatMap(
        (ur) => (ur.subPermissions ?? []) as SubPermission[],
      );

      let sectionSubjectIds: string[] = [];
      let sectionIds: string[] = [];

      if (user.teacher) {
        // BR-ACC-04: reach follows the ACTIVE assignment to a subject WITHIN a
        // section. An assignment that has ended grants nothing (FR-CRS-023).
        const assignments = await db.teacherAssignment.findMany({
          where: {
            teacherId: user.teacher.id,
            deletedAt: null,
            startDate: { lte: now },
            OR: [{ endDate: null }, { endDate: { gte: now } }],
          },
          select: { sectionSubject: { select: { id: true, sectionId: true } } },
        });
        sectionSubjectIds = assignments.map((a) => a.sectionSubject.id);
        sectionIds = [...new Set(assignments.map((a) => a.sectionSubject.sectionId))];
      }

      if (user.student) {
        // BR-ENR-03: only ACTIVE enrolments grant reach. A suspended student
        // keeps read access to their own history, which the OWN-scoped
        // policies already permit.
        const enrolments = await db.enrolment.findMany({
          where: { studentId: user.student.id, status: "ACTIVE", deletedAt: null },
          select: { sectionSubject: { select: { id: true, sectionId: true } } },
        });
        sectionSubjectIds = [
          ...sectionSubjectIds,
          ...enrolments.map((e) => e.sectionSubject.id),
        ];
        sectionIds = [
          ...new Set([...sectionIds, ...enrolments.map((e) => e.sectionSubject.sectionId)]),
        ];
      }

      return {
        userId: user.id,
        roles,
        subPermissions: [...new Set(subPermissions)],
        studentId: user.student?.id,
        teacherId: user.teacher?.id,
        sectionSubjectIds,
        sectionIds,
      } satisfies Omit<Actor, "correlationId">;
    });

    if (!resolved) {
      // The token referenced a user that no longer exists.
      return {
        userId,
        roles: [],
        subPermissions: [],
        sectionSubjectIds: [],
        sectionIds: [],
        correlationId,
      };
    }

    this.cache.set(userId, { actor: resolved, at: Date.now() });
    return { ...resolved, correlationId };
  }

  /**
   * ARC-047 / SEC-SES-009 — called synchronously whenever a user's roles,
   * assignments, or enrolments change, so the change takes effect on the very
   * next request rather than after the TTL.
   */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}
