import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "@lms/shared";
import { BackupService } from "./backup.service";
import { ArchiveService } from "./archive.service";
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
  constructor(
    private readonly backups: BackupService,
    private readonly archives: ArchiveService,
  ) {}

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

  /**
   * FR-OPS-034 — take a copy OFF this machine.
   *
   * `backup:export` at step-up. The archive is every CNIC, address and bank
   * slip the Institute holds, in one file; carrying it out of the building is
   * the act here, and it is the one that cannot be undone afterwards.
   */
  @RequirePermission("backup", "export")
  @Get("admin/backups/:id/download")
  async download(
    @Param("id") id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, body } = await this.backups.download(id, req.ip);
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // Never a shared cache: this is the whole Institute in one file.
    res.setHeader("Cache-Control", "private, no-store");
    res.send(body);
  }

  /**
   * How long since a copy actually left this server.
   *
   * Its own route rather than a field on `list`, because the answer is about
   * the INSTITUTE and not about any one archive — and the page shows it
   * whether or not there are backups to list.
   */
  @RequirePermission("backup", "read")
  @Get("admin/backups/off-server")
  offServer() {
    return this.backups.lastTakenOffServer();
  }

  /**
   * THE RECORDS ARCHIVE — the slips, the fee records and the registrations, in
   * a ZIP the Institute keeps on its own machine.
   *
   * A GET so it is an ordinary download the browser handles, and streamed —
   * a term of photographed slips is hundreds of megabytes and must never be
   * assembled in memory first. `backup:export` at step-up: this file is every
   * CNIC, address and bank slip the Institute holds.
   */
  @RequirePermission("backup", "export")
  @Get("admin/archive")
  archive(
    @Req() req: Request,
    @Res() res: Response,
    @Query("sessionId") sessionId?: string,
  ): Promise<void> {
    return this.archives.export(res, sessionId ? { sessionId } : {}, req.ip);
  }

  /**
   * Putting one back — the whole System, from the folder on somebody's laptop.
   *
   * `restore:create`, the same grant and the same step-up as restoring a plain
   * backup, because it is the same act with more in it. The service verifies
   * every checksum BEFORE emptying a single table, and refuses with the three
   * migration commands when the database has no structure to load into.
   */
  @RequirePermission("restore", "create")
  @Post("admin/archive/restore")
  @HttpCode(200)
  @UseInterceptors(
    // The archive is the largest thing this System ever accepts. The ceiling
    // matches what the ZIP writer can address at all.
    FileInterceptor("file", { limits: { fileSize: 3.5 * 1024 * 1024 * 1024, files: 1 } }),
  )
  restoreArchive(
    @Body() body: unknown,
    @Req() req: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new AppError("VALIDATION_FAILED", {
        message: "No archive was uploaded.",
        details: [{ field: "file", code: "REQUIRED", message: "Choose the archive ZIP." }],
      });
    }
    return this.archives.restore(
      file.buffer,
      restoreSchema.parse(body).confirmation,
      req.ip,
    );
  }

  /** FR-OPS-036 — load one back over everything. */
  @RequirePermission("restore", "create")
  @Post("admin/backups/:id/restore")
  @HttpCode(200)
  restore(@Param("id") id: string, @Body() body: unknown) {
    return this.backups.restore(id, restoreSchema.parse(body).confirmation);
  }
}
