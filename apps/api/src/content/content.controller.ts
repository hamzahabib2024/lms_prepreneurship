import { Body, Controller, Get, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { z } from "zod";
import type { Response } from "express";
import { ContentService } from "./content.service";
import { StorageRegistry } from "./storage/storage.registry";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";

const moduleSchema = z.object({
  subjectId: z.string().uuid(),
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().max(5000).optional(),
});

const lessonSchema = z.object({
  moduleId: z.string().uuid(),
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().max(5000).optional(),
  estimatedMinutes: z.coerce.number().int().positive().max(600).optional(),
});

const reorderSchema = z.object({
  orderedLessonIds: z.array(z.string().uuid()).min(1),
});

const publishSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED", "SCHEDULED"]),
  publishAt: z.coerce.date().optional(),
});

const catalogueSchema = z.object({
  sectionSubjectId: z.string().uuid(),
  lessonId: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(255),
  storageRef: z.string().trim().min(1).max(255),
  recordedOn: z.coerce.date(),
  teacherId: z.string().uuid().optional(),
  durationSeconds: z.coerce.number().int().positive().optional(),
});

const progressSchema = z.object({
  positionSeconds: z.coerce.number().min(0),
  watchedIntervals: z
    .array(z.tuple([z.coerce.number(), z.coerce.number()]))
    // A client cannot flood the server with millions of fragments; the merge
    // is cheap but not free.
    .max(500)
    .default([]),
});

/** SRS §9.6 — content and recorded lectures. */
@Controller()
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly storage: StorageRegistry,
  ) {}

  // -------------------------------------------------------------- structure

  @RequirePermission("module", "read")
  @Get("subjects/:id/content")
  tree(@Param("id") id: string) {
    return this.content.subjectContent(id);
  }

  @RequirePermission("module", "create")
  @Post("modules")
  createModule(@Body(zodBody(moduleSchema)) dto: z.infer<typeof moduleSchema>) {
    return this.content.createModule(dto);
  }

  @RequirePermission("lesson", "create")
  @Post("lessons")
  createLesson(@Body(zodBody(lessonSchema)) dto: z.infer<typeof lessonSchema>) {
    return this.content.createLesson(dto);
  }

  @RequirePermission("lesson", "update")
  @Patch("modules/:id/lesson-order")
  reorder(@Param("id") id: string, @Body(zodBody(reorderSchema)) dto: z.infer<typeof reorderSchema>) {
    return this.content.reorderLessons(id, dto.orderedLessonIds);
  }

  @RequirePermission("content_publication", "update")
  @Post("modules/:id/publication")
  publishModule(@Param("id") id: string, @Body(zodBody(publishSchema)) dto: z.infer<typeof publishSchema>) {
    return this.content.setPublication("module", id, dto.status, dto.publishAt);
  }

  @RequirePermission("content_publication", "update")
  @Post("lessons/:id/publication")
  publishLesson(@Param("id") id: string, @Body(zodBody(publishSchema)) dto: z.infer<typeof publishSchema>) {
    return this.content.setPublication("lesson", id, dto.status, dto.publishAt);
  }

  // ---------------------------------------------------------------- lectures

  @RequirePermission("recorded_lecture", "read")
  @Get("storage/browse")
  browse(@Query("folder") folder?: string) {
    return this.content.browseStorage(folder);
  }

  @RequirePermission("recorded_lecture", "create")
  @Post("recorded-lectures")
  catalogue(@Body(zodBody(catalogueSchema)) dto: z.infer<typeof catalogueSchema>) {
    return this.content.catalogueLecture(dto);
  }

  /** ARC-039/040 — a short-lived, user-bound ticket. Never a storage link. */
  @RequirePermission("lecture_playback", "read")
  @Post("recorded-lectures/:id/playback-ticket")
  ticket(@Param("id") id: string) {
    return this.content.issuePlaybackTicket(id);
  }

  /**
   * ARC-052 — redirects to a short-lived signed URL.
   *
   * The bytes flow storage → browser directly. Streaming them through here
   * would consume the capacity provisioned for the whole System (§3.8) and
   * breach NFR-PRF-002 for every other user.
   */
  @RequirePermission("lecture_playback", "read")
  @Get("lectures/stream/:ticketId")
  async stream(@Param("ticketId") ticketId: string, @Res() res: Response): Promise<void> {
    const { redirectTo } = await this.content.resolveTicket(ticketId);
    // 302 rather than 301: the target expires, and a permanent redirect would
    // be cached by the browser long after the signature is dead.
    res.redirect(302, redirectTo);
  }

  @RequirePermission("watch_progress", "update")
  @Patch("recorded-lectures/:id/progress")
  progress(@Param("id") id: string, @Body(zodBody(progressSchema)) dto: z.infer<typeof progressSchema>) {
    return this.content.recordWatchProgress(id, {
      positionSeconds: dto.positionSeconds,
      watchedIntervals: dto.watchedIntervals as Array<[number, number]>,
    });
  }

  @RequirePermission("recorded_lecture", "update")
  @Post("recorded-lectures/:id/verify")
  verify(@Param("id") id: string) {
    return this.content.verifyAvailability(id);
  }

  @RequirePermission("system_health", "read")
  @Get("storage/providers")
  providers() {
    return this.storage.listWithHealth();
  }
}
