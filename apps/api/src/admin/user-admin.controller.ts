import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { SUB_PERMISSIONS } from "@lms/shared";
import { UserAdminService } from "./user-admin.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";

const createStaffSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    fullName: z.string().trim().min(2).max(200),
    phone: z.string().trim().max(20).optional(),
    role: z.enum(["teacher", "admin", "partner_admin"]),
    subPermissions: z.array(z.enum(SUB_PERMISSIONS)).optional(),
    employeeCode: z.string().trim().max(30).optional(),
    /*
     * WHICH OUTSIDE INSTITUTE THIS PERSON ACTS FOR — and the single most
     * dangerous field on this form, which is why the refinement below is not
     * optional politeness.
     *
     * A partner_admin's ENTIRE reach is this one column. The PARTNER scope
     * predicates resolve to DENY_ALL when it is null, so an account created
     * without it is not a security hole — it is an account that can see
     * nothing at all, signs in to an empty portal, and produces a support
     * call nobody can explain. Refusing at the edge is kinder than shipping a
     * useless account.
     */
    partnerInstituteId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === "partner_admin" && !v.partnerInstituteId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partnerInstituteId"],
        message: "Choose which institute this person represents.",
      });
    }
    /*
     * AND THE OTHER WAY ROUND. A teacher carrying a partner id would be a
     * member of our own staff whose queries are silently narrowed to one
     * outside institute's students — they would open the marking queue and
     * find most of their class missing, with nothing on screen to say why.
     */
    if (v.role !== "partner_admin" && v.partnerInstituteId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partnerInstituteId"],
        message: "Only a partner account belongs to an outside institute.",
      });
    }
  });

const statusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  /** A suspension somebody has to justify is one somebody has thought about. */
  reason: z.string().trim().min(5).max(1000),
});

const subPermissionSchema = z.object({
  subPermissions: z.array(z.enum(SUB_PERMISSIONS)).max(SUB_PERMISSIONS.length),
});

/**
 * SRS §9.3 — user administration.
 *
 * The permissions here are the finest-grained in the matrix, and they are worth
 * reading as a set: creating a TEACHER is ordinary administration, creating an
 * ADMIN needs the admin_manager sub-permission, and changing what an
 * administrator may do is Super Admin only WITH re-authentication. Nothing in
 * this controller decides that — §4.5 does, and the guard enforces it.
 */
@Controller()
export class UserAdminController {
  constructor(private readonly users: UserAdminService) {}

  /**
   * FR-USR-003 — the directory.
   *
   * `user_directory`, not `student_account`. I guarded it with the latter first
   * and a teacher and a student both got 200: a student holds
   * `student_account:read` over their OWN record and a teacher over the
   * students in their sections. Neither of those is "every account in the
   * Institute, with its roles and sub-permissions".
   *
   * Nothing leaked — the User scope policy returns only the caller for a
   * non-admin — but an administrative directory should refuse rather than
   * answer with a list of one (SEC-AUZ-006).
   */
  @RequirePermission("user_directory", "read")
  @Get("admin/users")
  list(
    @Query("role") role?: string,
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
  ) {
    return this.users.list({ role, status, q, page: page ? Number(page) : undefined });
  }

  /**
   * FR-USR-005 — provision a member of staff.
   *
   * Guarded by `teacher_account:create`, which is ordinary administration.
   *
   * An ADMIN account goes through the same route, and §4.5 puts that behind
   * `admin_account:create` — which needs the admin_manager sub-permission. The
   * role arrives in the BODY, so no route guard can know which resource
   * applies; UserAdminService.createStaff makes the narrower check before it
   * writes anything.
   */
  @RequirePermission("teacher_account", "create")
  @Post("admin/users")
  createStaff(@Body(zodBody(createStaffSchema)) dto: z.infer<typeof createStaffSchema>) {
    return this.users.createStaff(dto);
  }

  /** FR-USR-010 — suspend or reactivate (BR-ACC-02 guards the last Super Admin). */
  @RequirePermission("account_state", "update")
  @Post("admin/users/:id/status")
  @HttpCode(200)
  setStatus(@Param("id") id: string, @Body(zodBody(statusSchema)) dto: z.infer<typeof statusSchema>) {
    return this.users.setStatus(id, dto.status, dto.reason);
  }

  /** FR-USR-012 — issue a new temporary password and end every session. */
  @RequirePermission("other_user_password", "update")
  @Post("admin/users/:id/reset-password")
  @HttpCode(200)
  resetPassword(@Param("id") id: string) {
    return this.users.resetPassword(id);
  }

  /** FR-USR-015 — sign somebody out everywhere, changing nothing else. */
  @RequirePermission("other_user_session", "delete")
  @Post("admin/users/:id/revoke-sessions")
  @HttpCode(200)
  revokeSessions(@Param("id") id: string) {
    return this.users.revokeSessions(id);
  }

  /**
   * SEC-AUT-008 — clear a lockout, changing nothing else.
   *
   * `account_state:update`, which an Admin holds: letting somebody back into
   * their own account after they mistyped a password is ordinary administration
   * and should not need a Super Admin. It is not a password reset, and cannot
   * become one — nothing here touches credentials.
   */
  @RequirePermission("account_state", "update")
  @Post("admin/users/:id/unlock")
  @HttpCode(200)
  unlock(@Param("id") id: string) {
    return this.users.unlock(id);
  }

  /**
   * FR-RBAC-010 — change what an administrator may do.
   *
   * `role_assignment:configure`: Super Admin only, and requiresStepUp, so the
   * caller must have re-authenticated within the last ten minutes.
   */
  @RequirePermission("role_assignment", "configure")
  @Patch("admin/users/:id/sub-permissions")
  setSubPermissions(
    @Param("id") id: string,
    @Body(zodBody(subPermissionSchema)) dto: z.infer<typeof subPermissionSchema>,
  ) {
    return this.users.setSubPermissions(id, dto.subPermissions);
  }
}
