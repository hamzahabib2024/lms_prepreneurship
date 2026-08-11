import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
import { AssignmentService } from "./assignment.service";
import { SubmissionFileService } from "./submission-file.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";

/**
 * The hard ceiling multer will accept, in bytes.
 *
 * Appendix H caps a single file at 10 MB and an assignment may narrow that
 * further, but multer must decide before any policy is loaded. A generous
 * ceiling here stops a 2 GB request being buffered while the per-assignment
 * limit does the real work.
 */
const UPLOAD_HARD_LIMIT_BYTES = 12 * 1024 * 1024;

const createSchema = z
  .object({
    sectionSubjectId: z.string().uuid(),
    lessonId: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(255),
    instructions: z.string().trim().min(10).max(20000),
    marksAvailable: z.coerce.number().positive().max(1000),
    opensAt: z.coerce.date(),
    dueAt: z.coerce.date(),
    hardCloseAt: z.coerce.date().optional(),
    graceMinutes: z.coerce.number().int().min(0).max(10080).default(0),
    latePolicy: z
      .enum(["NOT_ACCEPTED", "FLAG_ONLY", "FIXED_DEDUCTION", "PER_DAY_PERCENT"])
      .default("FLAG_ONLY"),
    latePenaltyValue: z.coerce.number().min(0).optional(),
    latePenaltyFloor: z.coerce.number().min(0).max(100).optional(),
    submissionType: z.enum(["FILE", "TEXT", "BOTH"]).default("FILE"),
    allowedFileTypes: z.array(z.string()).optional(),
    maxFileSizeMb: z.coerce.number().int().positive().max(100).optional(),
    maxFileCount: z.coerce.number().int().positive().max(20).optional(),
    resubmissionPolicy: z.enum(["NONE", "UNLIMITED_UNTIL_DUE", "LIMITED"]).default("NONE"),
    maxAttempts: z.coerce.number().int().positive().max(20).optional(),
    rubricId: z.string().uuid().optional(),
  })
  // A penalty policy without a value would silently deduct nothing, which
  // looks like a working policy and is not.
  .refine(
    (v) =>
      !["FIXED_DEDUCTION", "PER_DAY_PERCENT"].includes(v.latePolicy) ||
      v.latePenaltyValue != null,
    { path: ["latePenaltyValue"], message: "State the penalty for this late policy." },
  );

const submitSchema = z.object({
  textResponse: z.string().trim().max(50000).optional(),
  fileIds: z.array(z.string().uuid()).max(20).optional(),
});

const gradeSchema = z.object({
  rawMarks: z.coerce.number().min(0),
  rubricScores: z.record(z.string(), z.coerce.number()).optional(),
  feedback: z.string().trim().max(10000).optional(),
  internalNotes: z.string().trim().max(10000).optional(),
  revisionReason: z.string().trim().max(1000).optional(),
});

/** SRS §9.8 — assignment endpoints. */
@Controller()
export class AssessmentController {
  constructor(
    private readonly assignments: AssignmentService,
    private readonly files: SubmissionFileService,
  ) {}

  @RequirePermission("assignment", "create")
  @Post("assignments")
  create(@Body(zodBody(createSchema)) dto: z.infer<typeof createSchema>) {
    return this.assignments.create(dto);
  }

  @RequirePermission("assignment", "update")
  @Post("assignments/:id/publish")
  publish(@Param("id") id: string) {
    return this.assignments.publish(id);
  }

  /**
   * FR-ASG-011 — the student's assignments for one subject.
   *
   * `assignment:read` rather than `submission:read`: this lists the WORK SET,
   * and a student's own standing is folded in. The scope policy limits it to
   * published assignments in their own sections.
   */
  @RequirePermission("assignment", "read")
  @Get("section-subjects/:id/my-assignments")
  myAssignments(@Param("id") id: string) {
    return this.assignments.listForStudent(id);
  }

  /**
   * FR-TCH-018 — the teacher's assignments for one subject-section.
   *
   * `submission_roster`, because the marking counts on each row are cohort
   * figures. Guarding it with `assignment:read` would let a student see how
   * many of their classmates have handed in.
   */
  @RequirePermission("submission_roster", "read")
  @Get("section-subjects/:id/assignments")
  assignmentsForTeacher(@Param("id") id: string) {
    return this.assignments.listForTeacher(id);
  }

  /**
   * FR-TCH-019 — submitted, not submitted, late, ungraded, at a glance.
   *
   * `submission_roster`, not `submission`. This is the whole class with every
   * name, roll number and mark on it; a student holds `submission:read` for
   * their OWN work and must not reach a class list with it.
   */
  @RequirePermission("submission_roster", "read")
  @Get("assignments/:id/submissions")
  status(@Param("id") id: string) {
    return this.assignments.submissionStatus(id);
  }

  @RequirePermission("submission", "create")
  @Post("assignments/:id/submissions")
  submit(@Param("id") id: string, @Body(zodBody(submitSchema)) dto: z.infer<typeof submitSchema>) {
    return this.assignments.submit(id, dto);
  }

  /**
   * A student's own view. Internal notes are absent by construction, and an
   * unreleased grade reports as in-progress rather than leaking the mark
   * (BR-ASG-08, BR-ASG-09).
   */
  @RequirePermission("submission", "read")
  @Get("assignments/:id/my-submission")
  mine(@Param("id") id: string) {
    return this.assignments.studentView(id);
  }

  // ----------------------------------------------------------------- files --

  /**
   * FR-ASG-013 — uploads one file, unattached, before the student submits.
   *
   * `submission:create`, because uploading is the first half of submitting.
   * The interceptor holds the file in memory: the validator has to read the
   * leading bytes to check the content matches the extension, and a file that
   * fails must never touch disk (SEC-FIL-005).
   */
  @RequirePermission("submission", "create")
  @Post("assignments/:id/files")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: UPLOAD_HARD_LIMIT_BYTES, files: 1 } }),
  )
  upload(@Param("id") id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new AppError("VALIDATION_FAILED", {
        message: "No file was received. Choose a file and try again.",
        details: [{ field: "file", code: "REQUIRED", message: "A file is required." }],
      });
    }
    return this.files.upload(id, {
      originalname: file.originalname,
      buffer: file.buffer,
      size: file.size,
      mimetype: file.mimetype,
    });
  }

  /** What the student has uploaded but not yet submitted. */
  @RequirePermission("submission", "read")
  @Get("assignments/:id/files")
  listFiles(@Param("id") id: string) {
    return this.files.listPending(id);
  }

  @RequirePermission("submission", "update")
  @Delete("submission-files/:fileId")
  @HttpCode(200)
  removeFile(@Param("fileId") fileId: string) {
    return this.files.removePending(fileId);
  }

  /**
   * Streams a submitted file to whoever may read it.
   *
   * Unlike lecture video, these bytes DO pass through the application tier.
   * ARC-052 forbids proxying video because 150 concurrent streams would consume
   * the whole capacity budget; a coursework download is a few megabytes read
   * once by one teacher, and routing it through here keeps the storage
   * reference out of the browser entirely (ARC-041).
   */
  @RequirePermission("submission", "read")
  @Get("submission-files/:fileId/download")
  @Header("X-Content-Type-Options", "nosniff")
  async download(@Param("fileId") fileId: string, @Res() res: Response): Promise<void> {
    const file = await this.files.download(fileId);

    // `attachment` on purpose. A student-supplied HTML or SVG rendered inline
    // would execute in the System's origin and read the reader's session.
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Length", String(file.sizeBytes));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    res.end(file.body);
  }

  @RequirePermission("grade", "update")
  @Post("submissions/:id/grade")
  grade(@Param("id") id: string, @Body(zodBody(gradeSchema)) dto: z.infer<typeof gradeSchema>) {
    return this.assignments.grade(id, dto);
  }

  /** FR-ASG-028 — release the cohort together, so nobody sees a mark first. */
  @RequirePermission("grade", "update")
  @Post("assignments/:id/release-grades")
  release(@Param("id") id: string) {
    return this.assignments.releaseGrades(id);
  }
}
