import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { AnnouncementService } from "./announcement.service";
import { NotificationService } from "./notification.service";
import { zodBody } from "../common/zod-validation.pipe";
import { RequirePermission } from "../rbac/permissions.guard";

const announcementSchema = z
  .object({
    audience: z.enum(["INSTITUTE", "SECTION", "SECTION_SUBJECT"]),
    sectionId: z.string().uuid().optional(),
    sectionSubjectId: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().min(1).max(20000),
    isPinned: z.boolean().default(false),
    isUrgent: z.boolean().default(false),
    expiresAt: z.coerce.date().optional(),
  })
  .refine((v) => !v.expiresAt || v.expiresAt > new Date(), {
    path: ["expiresAt"],
    // An expiry in the past would hide the announcement the moment it was made,
    // which reads as the System losing it.
    message: "An expiry must be in the future.",
  });

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
}
