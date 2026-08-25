import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { DiscussionService } from "./discussion.service";
import { RequirePermission } from "../rbac/permissions.guard";

const createSchema = z.object({
  title: z.string().trim().max(200).optional().default(""),
  /** Hidden from classmates, never from staff. */
  isAnonymous: z.boolean().default(false),
  body: z.string().max(20_000),
});
const bodySchema = z.object({ body: z.string().max(20_000) });
/** A reply may be anonymous too — the fear of looking foolish is not
 *  confined to asking. */
const replySchema = z.object({
  body: z.string().max(20_000),
  isAnonymous: z.boolean().default(false),
});
const removeSchema = z.object({ reason: z.string().trim().max(500).optional() });
const moderateSchema = z.object({
  isPinned: z.boolean().optional(),
  isLocked: z.boolean().optional(),
});

/**
 * SRS §9.9 — discussion.
 *
 * Every route is `discussion_post`, which §4.5 grants a student at OWN scope.
 * That is read here as OWN for the WRITES — your post is yours to edit and
 * yours to withdraw — while reading is scoped to the offerings a student is
 * enrolled in. A discussion in which you can see only your own posts is a
 * diary; the reasoning is in discussion-rules.ts and the scope policy.
 *
 * The body bound is NOT `.min()`: zod would answer "String must contain at
 * least 2 character(s)" and shadow refuseEmpty, which says "Write something
 * first" — the same reason the rubric, bulk and timetable schemas stay quiet.
 */

/** One switch, both ways — endorsing and un-endorsing are the same act. */
const flagSchema = z.object({ on: z.boolean() });

@Controller()
export class DiscussionController {
  constructor(private readonly discussion: DiscussionService) {}

  /** FR-DSC-002 — the threads on an offering. */
  @RequirePermission("discussion_post", "read")
  @Get("section-subjects/:id/discussions")
  list(@Param("id") id: string) {
    return this.discussion.list(id);
  }

  /** FR-DSC-003 — one thread and its answers. */
  @RequirePermission("discussion_post", "read")
  @Get("discussions/:id")
  thread(@Param("id") id: string) {
    return this.discussion.thread(id);
  }

  /** FR-DSC-004 — ask a question. */
  @RequirePermission("discussion_post", "create")
  @Post("section-subjects/:id/discussions")
  create(@Param("id") id: string, @Body() body: unknown) {
    const input = createSchema.parse(body);
    return this.discussion.create(id, input.title, input.body, input.isAnonymous);
  }

  /** FR-DSC-005 — answer one. */
  @RequirePermission("discussion_post", "create")
  @Post("discussions/:id/replies")
  reply(@Param("id") id: string, @Body() body: unknown) {
    const reply = replySchema.parse(body);
    return this.discussion.reply(id, reply.body, reply.isAnonymous);
  }

  /** FR-DSC-006 — change what you wrote. */
  @RequirePermission("discussion_post", "update")
  @Patch("discussions/:id")
  edit(@Param("id") id: string, @Body() body: unknown) {
    return this.discussion.edit(id, bodySchema.parse(body).body);
  }

  /** FR-DSC-007 — take it down. */
  @RequirePermission("discussion_post", "delete")
  @Delete("discussions/:id")
  remove(@Param("id") id: string, @Body() body: unknown) {
    return this.discussion.remove(id, removeSchema.parse(body ?? {}).reason);
  }

  /** FR-DSC-008/009 — pin a thread, or close it. */
  @RequirePermission("discussion_post", "update")
  @Post("discussions/:id/moderate")
  @HttpCode(200)
  moderate(@Param("id") id: string, @Body() body: unknown) {
    return this.discussion.moderate(id, moderateSchema.parse(body));
  }

  /**
   * FR-DSC — mark the reply that answers the question.
   *
   * `discussion_post:moderate` — a teacher's judgement, not a vote. A student
   * upvote measures agreement among people who do not yet know the answer.
   */
  @RequirePermission("discussion_post", "approve")
  @Post("discussions/:id/endorse")
  endorse(@Param("id") id: string, @Body() body: unknown) {
    return this.discussion.endorse(id, flagSchema.parse(body).on);
  }

  /** FR-DSC — this question is settled, or it is open again. */
  @RequirePermission("discussion_post", "approve")
  @Post("discussions/:id/resolve")
  resolve(@Param("id") id: string, @Body() body: unknown) {
    return this.discussion.resolve(id, flagSchema.parse(body).on);
  }

}
