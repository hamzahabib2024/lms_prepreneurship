import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { AppError, type LoginInput, type Role } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ActorService } from "./actor.service";

/** §4.6 — risk is not uniform across roles, so neither are the controls. */
const ROLE_POLICY: Record<Role, { maxFailed: number; lockoutMinutes: number; minLength: number }> = {
  super_admin: { maxFailed: 3, lockoutMinutes: 30, minLength: 14 },
  admin: { maxFailed: 5, lockoutMinutes: 15, minLength: 12 },
  teacher: { maxFailed: 5, lockoutMinutes: 15, minLength: 10 },
  student: { maxFailed: 8, lockoutMinutes: 10, minLength: 8 },
};

const DEFAULT_POLICY = ROLE_POLICY.student;

/**
 * A fixed hash used to equalise timing when no account exists.
 *
 * SEC-AUT-009: the failure message AND the response time must be
 * indistinguishable whether or not the account exists, so accounts cannot be
 * enumerated by measuring how fast we say no.
 */
const TIMING_EQUALISER_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly actors: ActorService,
  ) {}

  // ------------------------------------------------------------ hashing ----

  /** SEC-AUT-006 — Argon2id with a unique per-user salt. */
  hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  private async verifyPassword(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------- login ----

  async login(input: LoginInput, ip?: string, userAgent?: string) {
    const user = await this.prisma.asSystem((db) =>
      db.user.findUnique({
        where: { email: input.email },
        include: { roles: { include: { role: true } }, student: true },
      }),
    );

    // Burn equivalent CPU when the account does not exist (SEC-AUT-009).
    if (!user) {
      await this.verifyPassword(TIMING_EQUALISER_HASH, input.password);
      await this.recordSecurityEvent("login.failed", null, input.email, ip, userAgent, {
        reason: "no_such_account",
      });
      throw new AppError("AUTH_INVALID_CREDENTIALS");
    }

    const roles = user.roles.map((r) => r.role.key as Role);
    const policy = this.policyFor(roles);

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordSecurityEvent("login.locked", user.id, input.email, ip, userAgent, {});
      throw new AppError("AUTH_ACCOUNT_LOCKED");
    }

    const ok = await this.verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      await this.registerFailure(user.id, user.failedLoginCount + 1, policy);
      await this.recordSecurityEvent("login.failed", user.id, input.email, ip, userAgent, {
        attempt: user.failedLoginCount + 1,
      });
      throw new AppError("AUTH_INVALID_CREDENTIALS");
    }

    if (user.status === "SUSPENDED") {
      // FR-ENR-008: tell them why rather than presenting an unexplained block.
      throw new AppError("AUTH_ACCOUNT_SUSPENDED", {
        message: user.statusReason
          ? `This account is suspended: ${user.statusReason}`
          : undefined,
      });
    }
    if (user.status === "ARCHIVED") {
      throw new AppError("AUTH_INVALID_CREDENTIALS");
    }

    // Successful login clears the failure counter and activates an invited
    // account (Figure 4-3).
    await this.prisma.asSystem((db) =>
      db.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
          status: user.status === "INVITED" ? "ACTIVE" : user.status,
        },
      }),
    );

    await this.recordSecurityEvent("login.success", user.id, user.email, ip, userAgent, {});

    const tokens = await this.issueTokens(user.id, roles, ip, userAgent, input.deviceLabel);

    return {
      ...tokens,
      mustChangePassword: user.mustChangePassword, // FR-REG-040
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        roles,
        photoUrl: user.photoUrl,
        student: user.student
          ? {
              registrationNo: user.student.registrationNo,
              rollNo: user.student.currentRollNo,
              sectionId: user.student.currentSectionId,
              sectionName: null,
            }
          : null,
      },
    };
  }

  private policyFor(roles: readonly Role[]) {
    // Where several roles are held, apply the strictest.
    let policy = DEFAULT_POLICY;
    for (const r of roles) {
      const p = ROLE_POLICY[r];
      if (p && p.maxFailed < policy.maxFailed) policy = p;
    }
    return policy;
  }

  private async registerFailure(
    userId: string,
    attempt: number,
    policy: { maxFailed: number; lockoutMinutes: number },
  ): Promise<void> {
    const locked = attempt >= policy.maxFailed;
    await this.prisma.asSystem((db) =>
      db.user.update({
        where: { id: userId },
        data: {
          failedLoginCount: attempt,
          // SEC-AUT-008 — lockout after the per-role threshold.
          lockedUntil: locked
            ? new Date(Date.now() + policy.lockoutMinutes * 60_000)
            : null,
          status: locked ? "LOCKED" : undefined,
        },
      }),
    );
  }

  // ------------------------------------------------------------- tokens ----

  /**
   * SEC-AUT-002/003/004 — a short-lived RS256 access token paired with a
   * rotating refresh token. The refresh token is stored only as a hash.
   */
  private async issueTokens(
    userId: string,
    roles: readonly Role[],
    ip?: string,
    userAgent?: string,
    deviceLabel?: string,
    familyId?: string,
  ) {
    const sessionId = randomUUID();
    const family = familyId ?? randomUUID();

    const accessTtl = this.config.get<string>("JWT_ACCESS_TTL", "15m");
    const refreshDays = 30;

    const actor = await this.actors.resolve(userId, randomUUID());

    const accessToken = await this.jwt.signAsync(
      {
        sub: userId,
        roles,
        subPerms: actor.subPermissions,
        sid: sessionId,
      },
      { expiresIn: accessTtl },
    );

    // Opaque, high-entropy refresh token — not a JWT, so it cannot be
    // introspected or replayed against another audience.
    const refreshToken = `${family}.${randomUUID()}${randomUUID()}`.replace(/-/g, "");
    const refreshHash = createHash("sha256").update(refreshToken).digest("hex");

    await this.prisma.asSystem((db) =>
      db.userSession.create({
        data: {
          id: sessionId,
          userId,
          refreshTokenHash: refreshHash,
          tokenFamilyId: family,
          deviceLabel: deviceLabel ?? null,
          ipAddress: ip ?? null,
          userAgent: userAgent?.slice(0, 500) ?? null,
          expiresAt: new Date(Date.now() + refreshDays * 86_400_000),
        },
      }),
    );

    await this.enforceConcurrentSessionLimit(userId, roles, sessionId);

    return {
      accessToken,
      tokenType: "Bearer" as const,
      expiresIn: this.ttlToSeconds(accessTtl),
      refreshToken,
      refreshExpiresIn: refreshDays * 86_400,
    };
  }

  /**
   * SEC-AUT-004 — rotation with reuse detection.
   *
   * If a consumed refresh token is presented again, the entire family is
   * invalidated: either the token was stolen, or the legitimate client is
   * replaying. Both warrant ending every session in that chain.
   */
  async refresh(refreshToken: string, ip?: string, userAgent?: string) {
    const hash = createHash("sha256").update(refreshToken).digest("hex");

    const session = await this.prisma.asSystem((db) =>
      db.userSession.findUnique({
        where: { refreshTokenHash: hash },
        include: { user: { include: { roles: { include: { role: true } } } } },
      }),
    );

    if (!session) throw new AppError("AUTH_TOKEN_INVALID");

    if (session.revokedAt) {
      await this.prisma.asSystem((db) =>
        db.userSession.updateMany({
          where: { tokenFamilyId: session.tokenFamilyId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      );
      await this.recordSecurityEvent(
        "refresh.reused",
        session.userId,
        null,
        ip,
        userAgent,
        { familyId: session.tokenFamilyId },
      );
      throw new AppError("AUTH_REFRESH_REUSED");
    }

    if (session.expiresAt < new Date()) throw new AppError("AUTH_TOKEN_EXPIRED");

    // Consume this token, then mint the next in the same family.
    await this.prisma.asSystem((db) =>
      db.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
    );

    const roles = session.user.roles.map((r) => r.role.key as Role);
    return this.issueTokens(
      session.userId,
      roles,
      ip,
      userAgent,
      session.deviceLabel ?? undefined,
      session.tokenFamilyId,
    );
  }

  /** SEC-SES-004 — logout invalidates server-side, not just on the client. */
  async logout(sessionId: string): Promise<void> {
    await this.prisma.asSystem((db) =>
      db.userSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  /** SEC-SES-008 — a password change ends every other session. */
  async changePassword(userId: string, current: string, next: string, keepSessionId?: string) {
    const user = await this.prisma.asSystem((db) =>
      db.user.findUnique({
        where: { id: userId },
        include: { roles: { include: { role: true } } },
      }),
    );
    if (!user) throw new AppError("AUTH_TOKEN_INVALID");

    if (!(await this.verifyPassword(user.passwordHash, current))) {
      throw new AppError("AUTH_INVALID_CREDENTIALS", {
        message: "Your current password is not correct.",
      });
    }

    const roles = user.roles.map((r) => r.role.key as Role);
    const minLength = this.policyFor(roles).minLength;
    if (next.length < minLength) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "newPassword",
            code: "TOO_SHORT",
            message: `Use at least ${minLength} characters for this account type.`,
          },
        ],
      });
    }

    await this.prisma.asSystem(async (db) => {
      await db.user.update({
        where: { id: userId },
        data: {
          passwordHash: await this.hashPassword(next),
          passwordChangedAt: new Date(),
          mustChangePassword: false,
        },
      });
      await db.userSession.updateMany({
        where: { userId, revokedAt: null, ...(keepSessionId ? { NOT: { id: keepSessionId } } : {}) },
        data: { revokedAt: new Date() },
      });
    });

    await this.recordSecurityEvent("password.changed", userId, user.email, undefined, undefined, {});
  }

  /**
   * The profile fields the interface needs to identify the signed-in user.
   *
   * Deliberately narrow: no identity number, no phone, no payment data. This
   * is called on every page load, and §4.7 keeps sensitive fields to the
   * screens that genuinely need them.
   */
  async profileFor(userId: string) {
    const user = await this.prisma.asSystem((db) =>
      db.user.findUnique({
        where: { id: userId },
        select: {
          fullName: true,
          email: true,
          photoUrl: true,
          mustChangePassword: true,
          student: {
            select: {
              registrationNo: true,
              currentRollNo: true,
              currentSection: { select: { id: true, name: true } },
            },
          },
        },
      }),
    );
    if (!user) return null;

    return {
      fullName: user.fullName,
      email: user.email,
      photoUrl: user.photoUrl,
      mustChangePassword: user.mustChangePassword,
      student: user.student
        ? {
            registrationNo: user.student.registrationNo,
            rollNo: user.student.currentRollNo,
            sectionId: user.student.currentSection?.id ?? null,
            sectionName: user.student.currentSection?.name ?? null,
          }
        : null,
    };
  }

  /** SEC-AUZ-011 — confirm identity immediately before a privileged action. */
  /**
   * SEC-AUZ-011 — re-authenticate, and get a token that PROVES it.
   *
   * This used to verify the password, record the event, and return Date.now()
   * to the caller — a number with nowhere to go. The freshness check reads
   * `actor.steppedUpAt`, which comes from the `sua` JWT claim; login does not
   * set it and nothing re-issued a token carrying it, so isStepUpFresh() was
   * false for everybody, always.
   *
   * The effect was that EVERY resource marked requiresStepUp was unreachable by
   * anyone, permanently: granting sub-permissions, impersonation, restoring a
   * backup and configuring integration credentials. Each refused with "please
   * confirm your password", and confirming it changed nothing.
   *
   * The new token keeps the SAME session id, so revoking the session still
   * revokes this, and carries the same roles — stepping up proves who you are,
   * it does not change what you may do.
   */
  async stepUp(userId: string, password: string, sessionId: string) {
    const user = await this.prisma.asSystem((db) =>
      db.user.findUnique({ where: { id: userId } }),
    );
    if (!user || !(await this.verifyPassword(user.passwordHash, password))) {
      await this.recordSecurityEvent("stepup.failed", userId, null, undefined, undefined, {});
      throw new AppError("AUTH_INVALID_CREDENTIALS");
    }
    await this.recordSecurityEvent("stepup.success", userId, null, undefined, undefined, {});

    const steppedUpAt = Date.now();
    const accessTtl = this.config.get<string>("JWT_ACCESS_TTL", "15m");
    const actor = await this.actors.resolve(userId, randomUUID());

    const accessToken = await this.jwt.signAsync(
      {
        sub: userId,
        roles: actor.roles,
        subPerms: actor.subPermissions,
        sid: sessionId,
        sua: steppedUpAt,
      },
      { expiresIn: accessTtl },
    );

    return {
      accessToken,
      tokenType: "Bearer" as const,
      expiresIn: this.ttlToSeconds(accessTtl),
      steppedUpAt,
      // The step-up window, which is shorter than the token's own life: the
      // token stays valid after the window closes, it simply stops satisfying
      // the freshness check.
      validForSeconds: 600,
    };
  }

  // ------------------------------------------------------------ helpers ----

  /** §4.6 — oldest session is dropped when the per-role limit is exceeded. */
  private async enforceConcurrentSessionLimit(
    userId: string,
    roles: readonly Role[],
    keepSessionId: string,
  ): Promise<void> {
    const limits: Record<Role, number> = {
      super_admin: 2,
      admin: 3,
      teacher: 3,
      student: 2,
    };
    const limit = Math.min(...roles.map((r) => limits[r] ?? 2), 3);

    await this.prisma.asSystem(async (db) => {
      const live = await db.userSession.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const excess = live.filter((s) => s.id !== keepSessionId).slice(limit - 1);
      if (excess.length > 0) {
        await db.userSession.updateMany({
          where: { id: { in: excess.map((s) => s.id) } },
          data: { revokedAt: new Date() },
        });
      }
    });
  }

  /** SEC-LOG-002 — security events are recorded separately from the audit log. */
  private async recordSecurityEvent(
    eventType: string,
    userId: string | null,
    email: string | null,
    ip?: string,
    userAgent?: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.asSystem((db) =>
        db.securityEvent.create({
          data: {
            eventType,
            userId,
            email,
            outcome: eventType.endsWith(".failed") ? "FAILURE" : "SUCCESS",
            detail: (detail ?? {}) as object,
            ipAddress: ip ?? null,
            userAgent: userAgent?.slice(0, 500) ?? null,
          },
        }),
      );
    } catch (err) {
      // Never let logging failure break authentication, but make it loud.
      this.logger.error(`Failed to record security event ${eventType}`, err as Error);
    }
  }

  private ttlToSeconds(ttl: string): number {
    const m = /^(\d+)([smhd])$/.exec(ttl);
    if (!m) return 900;
    const n = Number(m[1]);
    const unit = m[2];
    return unit === "s" ? n : unit === "m" ? n * 60 : unit === "h" ? n * 3600 : n * 86400;
  }
}
