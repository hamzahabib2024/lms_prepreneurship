import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { BackupService } from "./backup.service";
import { RequirePermission } from "../rbac/permissions.guard";

const restoreSchema = z.object({ confirmation: z.string() });

/**
 * SRS §9.19 — backup and restore.
 *
 * `backup` is Super Admin (create, read, configure). `restore` is Super Admin
 * AND demands step-up (§4.5) — it is the only operation in the System that
 * destroys data belonging to everybody at once.
 *
 * Restore additionally refuses unless maintenance mode is on, which is checked
 * in the service rather than trusted to whoever presses the button.
 */
@Controller()
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  /** FR-OPS-032 — what there is, newest first. */
  @RequirePermission("backup", "read")
  @Get("admin/backups")
  list() {
    return this.backups.list();
  }

  /** FR-OPS-031 — take one, and verify it immediately. */
  @RequirePermission("backup", "create")
  @Post("admin/backups")
  create() {
    return this.backups.create();
  }

  /**
   * FR-OPS-033 — read one back and check it.
   *
   * The most useful route here. A backup that has never been read is not yet
   * known to be a backup.
   */
  @RequirePermission("backup", "read")
  @Post("admin/backups/:id/verify")
  @HttpCode(200)
  verify(@Param("id") id: string) {
    return this.backups.verify(id);
  }

  /** FR-OPS-036 — load one back over everything. */
  @RequirePermission("restore", "create")
  @Post("admin/backups/:id/restore")
  @HttpCode(200)
  restore(@Param("id") id: string, @Body() body: unknown) {
    return this.backups.restore(id, restoreSchema.parse(body).confirmation);
  }
}
