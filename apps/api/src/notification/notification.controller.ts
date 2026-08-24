import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { AnnouncementService } from "./announcement.service";
import { NotificationService } from "./notification.service";
import { TemplateService } from "./template.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";

// Bounds are deliberately absent here. The template rules say the useful
// thing — which placeholder is wrong and what is available instead — and a
// Zod message about string length would shadow it.
const templateSchema = z.object({
  title: z.string(),
  body: z.string(),
});

const announcementSchema = z
  .object({
    audience: z.enum([
      "INSTITUTE",
      "SECTION",
      "SECTION_SUBJECT",
      // Staff-only, and the public page. See the enum in schema.prisma.
      "TEACHERS",
      "STAFF",
      "PUBLIC_ONLY",
    ]),
    sectionId: z.string().uuid().optional(),
    sectionSubjectId: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().min(1).max(20000),
    isPinned: z.boolean().default(false),
    /**
     * How much this matters — NORMAL, IMPORTANT or URGENT.
     *
     * `isUrgent` is still accepted so nothing that already posts announcements
     * breaks, and the service reconciles the two: URGENT and isUrgent mean the
     * same thing, and whichever is given decides both. Two ways to say one
     * thing is a transitional cost, not a design.
     */
    priority: z.enum(["NORMAL", "IMPORTANT", "URGENT"]).optional(),
    isUrgent: z.boolean().default(false),
    /** FR-PUB — also shown to people with no account. Off unless asked for. */
    isPublic: z.boolean().default(false),
    expiresAt: z.coerce.date().optional(),
  })
  .refine((v) => !v.expiresAt || v.expiresAt > new Date(), {
    path: ["expiresAt"],
    // An expiry in the past would hide the announcement the moment it was made,
    // which reads as the System losing it.
    message: "An expiry must be in the future.",
  })
  .refine((v) => !v.isPublic || v.audience === "INSTITUTE" || v.audience === "PUBLIC_ONLY", {
    path: ["isPublic"],
    // The database refuses this too. Refusing it here as well means the author
    // is told why while they are still writing, rather than getting a
    // constraint violation naming a table.
    message:
      "Only an announcement to the whole Institute, or one written for the public page, can be shown publicly. One addressed to a section was written for those students.",
  })
  /*
   * A PUBLIC_ONLY NOTICE THAT IS NOT PUBLIC REACHES NOBODY AT ALL — it is
   * excluded from every inbox by construction, so without this it would be a
   * notice somebody wrote and no one ever saw. Set rather than refused: the
   * author asked for the public page, and asking twice would be pedantry.
   */
  .transform((v) => (v.audience === "PUBLIC_ONLY" ? { ...v, isPublic: true } : v));

const markReadSchema = z.object({
  notificationIds: z.array(z.string().uuid()).min(1).max(200),
});

const preferenceSchema = z.object({
  channels: z.array(z.enum(["WHATSAPP", "EMAIL", "SMS"])).optional(),
  mutedKinds: z.array(z.string().max(60)).max(50).optional(),
  quietHoursStart: z.coerce.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.coerce.number().int().min(0).max(23).nullable().optional(),
});

/** SRS §9.11 — communication endpoints. */
@Controller()
export class NotificationController {
  constructor(
    private readonly announcements: AnnouncementService,
    private readonly notifications: NotificationService,
    // Named with a trailing underscore because `templates` is also the method
    // that lists them, and a property shadowing a method reads as a bug.
    private readonly templates_: TemplateService,
  ) {}

  // ------------------------------------------------------- announcements --

  @RequirePermission("announcement", "create")
  @Post("announcements")
  create(@Body(zodBody(announcementSchema)) dto: z.infer<typeof announcementSchema>) {
    return this.announcements.create(dto);
  }

  /** FR-COM-008 — what this user's audience membership entitles them to see. */
  @RequirePermission("announcement", "read")
  @Get("announcements")
  list() {
    return this.announcements.listForMe();
  }

  @RequirePermission("announcement", "delete")
  @Post("announcements/:id/withdraw")
  withdraw(@Param("id") id: string) {
    return this.announcements.withdraw(id);
  }

  // ---------------------------------------------------------------- inbox --

  /**
   * FR-COM-014 — the signed-in user's inbox.
   *
   * `own_notification_preference:read` is the closest thing the §4.5 matrix has
   * to "my own communication", and every role holds it over OWN. There is no
   * cohort view of anybody's inbox and there must not be one: a notification is
   * correspondence, not a record to administer.
   */
  @RequirePermission("own_notification_preference", "read")
  @Get("me/notifications")
  inbox(@Query("unreadOnly") unreadOnly?: string, @Query("limit") limit?: string) {
    return this.notifications.inbox({
      unreadOnly: unreadOnly === "true",
      limit: limit ? Number(limit) : undefined,
    });
  }

  @RequirePermission("own_notification_preference", "update")
  @Patch("me/notifications/read")
  markRead(@Body(zodBody(markReadSchema)) dto: z.infer<typeof markReadSchema>) {
    return this.notifications.markRead(dto.notificationIds);
  }

  @RequirePermission("own_notification_preference", "update")
  @Post("me/notifications/read-all")
  markAllRead() {
    return this.notifications.markAllRead();
  }

  // ---------------------------------------------------------- preferences --

  @RequirePermission("own_notification_preference", "read")
  @Get("me/notification-preferences")
  preference() {
    return this.notifications.myPreference();
  }

  @RequirePermission("own_notification_preference", "update")
  @Patch("me/notification-preferences")
  updatePreference(@Body(zodBody(preferenceSchema)) dto: z.infer<typeof preferenceSchema>) {
    return this.notifications.updateMyPreference(dto);
  }

  /**
   * FR-NOT-020 — the messages the Institute can word itself.
   *
   * `notification_config:configure`, which §4.5 grants Super Admin and Admin.
   * The READ uses `configure` too, deliberately: the matrix grants no `read`
   * on this resource, so guarding it with one would make the endpoint
   * unreachable by anybody — the exact defect the reachability guard exists to
   * catch, and it would have caught this.
   */
  @RequirePermission("notification_config", "configure")
  @Get("notification-templates")
  templates() {
    return this.templates_.catalogue();
  }

  /** FR-NOT-021 — change the wording. Validated on save, not on send. */
  @RequirePermission("notification_config", "configure")
  @Put("notification-templates/:kind")
  setTemplate(@Param("kind") kind: string, @Body() body: unknown) {
    const input = templateSchema.parse(body);
    return this.templates_.set(kind, input.title, input.body);
  }

  /** FR-NOT-022 — back to the System's own wording. */
  @RequirePermission("notification_config", "configure")
  @Delete("notification-templates/:kind")
  resetTemplate(@Param("kind") kind: string) {
    return this.templates_.reset(kind);
  }
}
