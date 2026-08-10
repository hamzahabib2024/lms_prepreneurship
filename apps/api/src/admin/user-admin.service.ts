import { Injectable, Logger } from "@nestjs/common";
import { randomInt } from "node:crypto";
import { AppError, resolvePermission } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { getActor } from "../prisma/actor-context";

/** Unambiguous by design — these are read aloud and typed by hand (FR-REG-042). */
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface CreateStaffInput {
  email: string;
  fullName: string;
  phone?: string;
  role: "teacher" | "admin";
  /** §4.2.2 — granted individually, never implied by the role. */
  subPermissions?: string[];
  employeeCode?: string;
}

/**
 * User administration — SRS §5.2, FR-USR-001..020, §4.5.1.
 *
 * The Institute could admit students and could not onboard the people who
 * teach them: there was no way to create a teacher, suspend anybody, reset a
 * forgotten password or grant a sub-permission. Every one of those was in the
 * §4.5 matrix and none had an endpoint.
 *
 * BR-ACC-02 governs the whole module: THE INSTITUTE MUST ALWAYS HAVE AT LEAST
 * ONE ACTIVE SUPER ADMIN. Every operation that could remove the last one is
 * refused, because the alternative is a system nobody can administer and no
 * way back in short of editing the database by hand.
 */
@Injectable()
export class UserAdminService {
  private readonly logger = new Logger(UserAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /**
   * FR-USR-003 — the directory.
   *
   * NEVER selects passwordHash, mfaSecret or mfaRecoveryCodes. They are omitted
   * by the projection rather than deleted afterwards, so a careless spread can
   * never carry them out.
   */
  async list(filter: { role?: string; status?: string; q?: string; page?: number }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = 25;

    const where = {
      deletedAt: null,
      ...(filter.status ? { status: filter.status as "ACTIVE" } : {}),
      ...(filter.role ? { roles: { some: { role: { key: filter.role } } } } : {}),
      ...(filter.q
        ? {
            OR: [
              { fullName: { contains: filter.q, mode: "insensitive" as const } },
              { email: { contains: filter.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.scoped.user.findMany({
        where,
        orderBy: { fullName: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          status: true,
          lastLoginAt: true,
          mustChangePassword: true,
          createdAt: true,
          roles: { select: { subPermissions: true, role: { select: { key: true, name: true } } } },
          student: { select: { registrationNo: true } },
          teacher: { select: { employeeCode: true } },
        },
      }),
      this.prisma.scoped.user.count({ where }),
    ]);

    return {
      // §9.2 names this `data`; the envelope interceptor reads that key.
      data: rows.map((u: (typeof rows)[number]) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        phone: u.phone,
        status: u.status,
        lastLoginAt: u.lastLoginAt,
        mustChangePassword: u.mustChangePassword,
        roles: u.roles.map((r: (typeof u.roles)[number]) => r.role.key),
        subPermissions: u.roles.flatMap((r: (typeof u.roles)[number]) => r.subPermissions),
        registrationNo: u.student?.registrationNo ?? null,
        employeeCode: u.teacher?.employeeCode ?? null,
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
   * FR-USR-005 — provisions a member of staff.
   *
   * Same shape as student provisioning: a temporary password shown ONCE on
   * screen and a forced change at first login (FR-REG-040/042). Email delivery
   * may be delayed or fail, and an administrator reading a password aloud is
   * the reality the Institute works in.
   */
  async createStaff(input: CreateStaffInput) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    // The ROUTE is guarded by `teacher_account:create`, which is ordinary
    // administration. Creating an ADMIN is not: §4.5 puts it behind
    // `admin_account:create`, which an Admin holds only WITH the admin_manager
    // sub-permission and a Super Admin only after re-authenticating.
    //
    // The role comes from the request body, so the route guard cannot know
    // which resource applies. Checking here is the only place it can be done —
    // without it, any Admin could promote themselves a colleague.
    if (input.role === "admin") {
      const decision = resolvePermission(
        {
          roles: actor.roles,
          subPermissions: actor.subPermissions,
          steppedUp: actor.steppedUpAt != null && Date.now() - actor.steppedUpAt * 1000 < 600_000,
        },
        "admin_account",
        "create",
      );
      if (!decision.allowed) {
        throw new AppError("AUTH_FORBIDDEN", {
          message:
            "Creating an administrator needs the admin_manager permission, and a Super Admin " +
            "must re-authenticate first.",
        });
      }
    }

    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.asSystem((db) =>
      db.user.findUnique({ where: { email }, select: { id: true } }),
    );
    if (existing) {
      throw new AppError("DUPLICATE_RESOURCE", {
        message: "Somebody already has that email address.",
      });
    }

    const temporaryPassword = this.temporaryPassword();
    const passwordHash = await this.auth.hashPassword(temporaryPassword);

    const created = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            fullName: input.fullName.trim(),
            phone: input.phone ?? null,
            status: "ACTIVE",
            mustChangePassword: true,
            roles: {
              create: {
                role: { connect: { key: input.role } },
                // §4.2.2 — an admin's sub-permissions are granted one by one.
                // A teacher has none, so anything sent is dropped rather than
                // silently stored against a role that cannot use it.
                subPermissions: input.role === "admin" ? (input.subPermissions ?? []) : [],
                grantedBy: actor.userId,
              },
            },
          },
          select: { id: true },
        });

        if (input.role === "teacher") {
          await tx.teacher.create({
            data: {
              userId: user.id,
              employeeCode: input.employeeCode ?? `T-${String(randomInt(1000, 9999))}`,
              joinedAt: new Date(),
            },
          });
        }

        return user;
      }),
    );

    // SEC-LOG-009 — creating an account is a privileged change.
    await this.audit.record({
      action: "user.create",
      entityType: "User",
      entityId: created.id,
      after: { email, role: input.role, subPermissions: input.subPermissions ?? [] },
    });

    return {
      id: created.id,
      email,
      fullName: input.fullName,
      role: input.role,
      // FR-REG-042 — shown once, here, and never retrievable again.
      temporaryPassword,
      mustChangePassword: true,
    };
  }

  /**
   * FR-USR-010 — suspend or reactivate.
   *
   * BR-ACC-02: suspending the last active Super Admin is refused. The System
   * would otherwise be left with nobody able to administer it and no way back
   * short of editing the database by hand.
   */
  async setStatus(userId: string, status: "ACTIVE" | "SUSPENDED", reason: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const user = await this.prisma.scoped.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        fullName: true,
        roles: { select: { role: { select: { key: true } } } },
      },
    });
    if (!user) throw new AppError("RESOURCE_NOT_FOUND");

    if (status === "SUSPENDED") {
      await this.refuseIfLastSuperAdmin(user.id, user.roles.map((r) => r.role.key));

      // Suspending yourself is always a mistake — you lose the session that was
      // making the change, and if you are the only administrator awake nobody
      // can undo it.
      if (userId === actor.userId) {
        throw new AppError("VALIDATION_FAILED", {
          details: [
            {
              field: "userId",
              code: "SELF",
              message: "You cannot suspend your own account.",
            },
          ],
        });
      }
    }

    const updated = await this.prisma.scoped.user.update({
      where: { id: userId },
      data: { status, statusReason: reason },
    });

    if (status === "SUSPENDED") {
      // SEC-AUT — a suspended account must not keep working until its access
      // token expires. Revoking the refresh family ends it now.
      await this.prisma.asSystem((db) =>
        db.userSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      );
    }

    await this.audit.record({
      action: status === "SUSPENDED" ? "user.suspend" : "user.reactivate",
      entityType: "User",
      entityId: userId,
      before: { status: user.status },
      after: { status, reason },
    });

    return { id: updated.id, status: updated.status, sessionsRevoked: status === "SUSPENDED" };
  }

  /**
   * FR-USR-012 — reset somebody else's password.
   *
   * Issues a temporary password and forces a change. It does NOT reveal the old
   * one, because nobody holds it: passwords are stored as Argon2id hashes and
   * an administrator who could read one would be a worse problem than a
   * forgotten password.
   */
  async resetPassword(userId: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const user = await this.prisma.scoped.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, fullName: true },
    });
    if (!user) throw new AppError("RESOURCE_NOT_FOUND");

    const temporaryPassword = this.temporaryPassword();
    const passwordHash = await this.auth.hashPassword(temporaryPassword);

    await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            passwordHash,
            mustChangePassword: true,
            passwordChangedAt: new Date(),
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });
        // Every existing session ends: a reset is what you do when you think
        // somebody else has the account.
        await tx.userSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }),
    );

    await this.audit.record({
      action: "user.password_reset",
      entityType: "User",
      entityId: userId,
      // The password itself is never recorded, only that it was reset.
      after: { by: actor.userId, sessionsRevoked: true },
    });

    return {
      id: user.id,
      fullName: user.fullName,
      temporaryPassword,
      mustChangePassword: true,
    };
  }

  /** FR-USR-015 — end every session a user holds, without changing anything else. */
  async revokeSessions(userId: string) {
    const user = await this.prisma.scoped.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw new AppError("RESOURCE_NOT_FOUND");

    const result = await this.prisma.asSystem((db) =>
      db.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );

    await this.audit.record({
      action: "user.sessions_revoked",
      entityType: "User",
      entityId: userId,
      after: { count: result.count },
    });

    return { id: userId, revoked: result.count };
  }

  /**
   * FR-RBAC-010 — change what an administrator may do.
   *
   * `role_assignment:configure` is Super Admin only AND demands step-up, which
   * the permission guard enforces. Sub-permissions are the difference between
   * an administrator who can run the Institute and one who can also read every
   * student's finances, so re-authentication is proportionate.
   */
  async setSubPermissions(userId: string, subPermissions: string[]) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const user = await this.prisma.scoped.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        roles: { select: { id: true, subPermissions: true, role: { select: { key: true } } } },
      },
    });
    if (!user) throw new AppError("RESOURCE_NOT_FOUND");

    const adminRole = user.roles.find((r) => r.role.key === "admin");
    if (!adminRole) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "userId",
            code: "NOT_ADMIN",
            // Granting one to a teacher would store a permission their role can
            // never use, which reads in the audit log as a privilege they hold.
            message: "Sub-permissions belong to administrators. This account is not one.",
          },
        ],
      });
    }

    await this.prisma.asSystem((db) =>
      db.userRole.update({
        where: { id: adminRole.id },
        data: { subPermissions, grantedBy: actor.userId },
      }),
    );

    await this.audit.record({
      action: "user.sub_permissions",
      entityType: "User",
      entityId: userId,
      before: { subPermissions: adminRole.subPermissions },
      after: { subPermissions },
    });

    return { id: userId, subPermissions };
  }

  // ------------------------------------------------------------ internals --

  /**
   * BR-ACC-02 — the Institute must always have at least one active Super Admin.
   *
   * Counted at the moment of the change rather than trusted from a cached
   * figure: two administrators suspending the last two super admins at the same
   * moment would each see one remaining.
   */
  private async refuseIfLastSuperAdmin(userId: string, roleKeys: string[]): Promise<void> {
    if (!roleKeys.includes("super_admin")) return;

    const others = await this.prisma.asSystem((db) =>
      db.user.count({
        where: {
          id: { not: userId },
          status: "ACTIVE",
          deletedAt: null,
          roles: { some: { role: { key: "super_admin" } } },
        },
      }),
    );

    if (others === 0) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "userId",
            code: "LAST_SUPER_ADMIN",
            message:
              "This is the only active Super Admin. Appoint another before suspending this one, " +
              "or nobody will be able to administer the System.",
          },
        ],
      });
    }
  }

  private temporaryPassword(): string {
    const pick = (n: number): string =>
      Array.from(
        { length: n },
        () => TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)],
      ).join("");
    return `${pick(4)}-${pick(4)}-${pick(4)}`;
  }
}
