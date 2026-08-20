import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { CourseMediaService, MAX_THUMBNAIL_BYTES } from "./course-media.service";
import { Public, RequirePermission } from "../rbac/permissions.guard";

/**
 * Course pictures — SRS §9.7.
 *
 * ONE ENDPOINT HERE IS PUBLIC AND THE REST ARE NOT, which is the whole shape of
 * this controller. A thumbnail is shown to visitors who have never signed in;
 * uploading one is an act of the Institute. Reading needs no permission
 * because the picture is meant to be seen — that is what distinguishes a
 * MediaAsset from every other file the System holds.
 */
@Controller()
export class CourseMediaController {
  constructor(private readonly media: CourseMediaService) {}

  /**
   * The picture itself, to anybody.
   *
   * WRITTEN TO THE RESPONSE DIRECTLY, bypassing the envelope interceptor. Every
   * other route in this System answers `{data, meta}`; an `<img>` tag needs
   * bytes, and a JPEG base64'd into a JSON field is not an image any browser
   * will render.
   *
   * CACHED HARD, AND SAFELY. The URL contains the asset id and an asset is
   * immutable — replacing a course's picture points it at a DIFFERENT id
   * rather than changing these bytes — so a year is honest rather than
   * optimistic, and `immutable` stops the browser revalidating on every visit
   * to the landing page.
   */
  @Public()
  @Get("public/course-media/:id")
  async serve(@Param("id") id: string, @Res() res: Response): Promise<void> {
    const found = await this.media.read(id);

    if (!found) {
      // 404 as a status and nothing else. A JSON error envelope inside an image
      // tag is a broken image with extra steps, and this is reached by a
      // stranger's browser rather than by code that will read the body.
      res.status(404).end();
      return;
    }

    res.setHeader("Content-Type", found.contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    // The System decides how this is rendered, not the file. Belt and braces
    // against a crafted upload that got past the signature check.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", String(found.body.byteLength));
    res.end(found.body);
  }

  /**
   * Upload one — `course_media:create`, held by Admin and Super Admin.
   *
   * The multer ceiling is applied before any of our validation runs, so a
   * 900MB upload is refused at the socket rather than buffered into memory and
   * then declined politely.
   */
  @RequirePermission("course_media", "create")
  @Post("course-media")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_THUMBNAIL_BYTES, files: 1 } }),
  )
  upload(@UploadedFile() file?: Express.Multer.File) {
    return this.media.upload(file);
  }

  @RequirePermission("course_media", "delete")
  @Delete("course-media/:id")
  remove(@Param("id") id: string) {
    return this.media.remove(id);
  }
}
