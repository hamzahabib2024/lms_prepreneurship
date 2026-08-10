import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { AppError } from "@lms/shared";
import { LessonResourceService } from "./lesson-resource.service";
import { RequirePermission } from "../rbac/permissions.guard";

/** The multipart parser's own ceiling, above any institute setting. */
const UPLOAD_HARD_LIMIT_BYTES = 12 * 1024 * 1024;

const publishSchema = z.object({ status: z.enum(["DRAFT", "PUBLISHED"]) });

/**
 * SRS §9.6 — lesson resources.
 *
 * `lesson_resource` reaches a STUDENT with read and export at ENROLLED scope
 * (§4.5): the handouts are theirs to download. What they may see is decided by
 * the scope policy, which requires BOTH the resource and its lesson to be
 * published — so no endpoint here has to remember it.
 */
@Controller()
export class LessonResourceController {
  constructor(private readonly resources: LessonResourceService) {}

  /**
   * FR-CRS-036 — attach a file.
   *
   * The interceptor holds it in memory because the validator reads the leading
   * bytes to check the content matches the extension, and a file that fails
   * must never touch disk (SEC-FIL-005).
   */
  @RequirePermission("lesson_resource", "create")
  @Post("lessons/:id/resources")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: UPLOAD_HARD_LIMIT_BYTES, files: 1 } }),
  )
  upload(
    @Param("id") id: string,
    @Body("title") title?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new AppError("VALIDATION_FAILED", {
        message: "No file was received. Choose a file and try again.",
        details: [{ field: "file", code: "REQUIRED", message: "A file is required." }],
      });
    }
    return this.resources.upload(id, title?.trim() || file.originalname, {
      originalname: file.originalname,
      buffer: file.buffer,
      size: file.size,
    });
  }

  /** FR-CRS-037 — what is attached to a lesson. */
  @RequirePermission("lesson_resource", "read")
  @Get("lessons/:id/resources")
  list(@Param("id") id: string) {
    return this.resources.list(id);
  }

  /** FR-CRS-038 — publish it, or hide it again. */
  @RequirePermission("lesson_resource", "update")
  @Post("lesson-resources/:id/publication")
  @HttpCode(200)
  setPublication(@Param("id") id: string, @Body() body: unknown) {
    return this.resources.setPublication(id, publishSchema.parse(body).status);
  }

  @RequirePermission("lesson_resource", "delete")
  @Delete("lesson-resources/:id")
  remove(@Param("id") id: string) {
    return this.resources.remove(id);
  }

  /**
   * FR-CRS-039 — the bytes.
   *
   * `export` rather than `read`, because taking a copy away is a distinct act
   * from seeing that a file exists (§4.1.2). A student holds both.
   *
   * Streams the file itself; the storage location never reaches the client
   * (ARC-041). Content-Disposition carries the original filename, quoted,
   * because an unquoted one containing a space truncates in some browsers.
   */
  @RequirePermission("lesson_resource", "export")
  @Get("lesson-resources/:id/download")
  async download(@Param("id") id: string, @Res() res: Response) {
    const file = await this.resources.download(id);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", String(file.sizeBytes));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.filename.replace(/"/g, "")}"`,
    );
    res.send(file.body);
  }
}
