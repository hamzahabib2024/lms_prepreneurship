import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { getActor } from "../prisma/actor-context";
import { ChannelRegistry } from "./channel/channel.registry";
import type { OutboundMessage, Recipient } from "./channel/notification.channel";
import { localHourIn, shouldPush, type Preference } from "./delivery-rules";

/** What a caller raises. The recipients are resolved here, not by the caller. */
export interface NotifyInput {
  recipientUserIds: string[];
  kind: string;
  title: string;
  body: string;
  linkPath?: string | null;
  isUrgent?: boolean;
  announcementId?: string | null;
  /**
   * Channels to write the inbox row for but NOT to push over.
   *
   * EXISTS FOR ONE CASE, and it is a real one. A fee receipt is emailed with
   * the PDF attached, by the service that has the PDF in hand. The student
   * should still find the notification in their inbox and still get it on
   * WhatsApp — but not a second, plainer email saying the same thing without
   * the attachment. Naming the channel to hold back is the honest way to say
   * that; the alternative was two notification systems.
   *
   * The suppression is RECORDED as a delivery outcome like any other, so the
   * log says the email was held back on purpose rather than going quiet.
   */
  exceptChannels?: readonly string[];
}

/**
 * What somebody gets before they have chosen anything.
 *
 * EMAIL IS ON BY DEFAULT and WhatsApp stays on beside it. An email address is
 * how an account is identified here — nobody has one without giving it — and a
 * student who enrolled expects the Institute to write to them about their
 * marks and their fees. That is the expectation the account was created under,
 * not a new use of their address.
 *
 * THIS OVERRIDES NOBODY'S CHOICE. The default applies only where no preference
 * row exists; anyone who has been to the preferences screen keeps exactly what
 * they set, including having turned a channel off. Adding a channel here can
 * never re-enable one somebody has switched off.
 *
 * IN_APP is absent because it is implicit and cannot be withdrawn — the inbox
 * is the record of what was sent, not a delivery choice.
 */
const DEFAULT_PREFERENCE: Preference = {
  channels: ["WHATSAPP", "EMAIL"],
  mutedKinds: [],
  quietHoursStart: null,
  quietHoursEnd: null,
};

/**
 * Notifications — SRS §5.16, FR-COM-013..020, ARC-046.
 *
 * THE INBOX COPY IS WRITTEN FIRST AND ALWAYS. Channels are attempted afterwards
 * and their failures are recorded, not raised: a WhatsApp outage must not fail
 * the grade release that triggered the message. This ordering is the whole
 * reason a notification and a delivery are separate rows.
 *
 * Callers name a KIND and a set of users. They never name a channel, never
 * consult a preference, and never learn whether anything was pushed — all of
 * that is resolved here, so adding email later changes this file and no other.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelRegistry,
  ) {}

  /**
   * Raises one notification for each recipient.
   *
   * Runs as the SYSTEM. A notification is raised BY an event, not by a user
   * acting on their own behalf: a teacher releasing grades causes thirty
   * students to be written to, and the scope predicate would correctly refuse
   * to let that teacher write another person's inbox row.
   */
  async notify(input: NotifyInput): Promise<{ raised: number }> {
    const recipientIds = [...new Set(input.recipientUserIds)];
    if (recipientIds.length === 0) return { raised: 0 };

    const users = await this.prisma.asSystem((db) =>
      db.user.findMany({
        where: { id: { in: recipientIds }, deletedAt: null, status: "ACTIVE" },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          phoneIsWhatsapp: true,
          timezone: true,
          notificationPreference: true,
        },
      }),
    );

    const created = await this.prisma.asSystem((db) =>
      db.notification.createManyAndReturn({
        data: users.map((u: (typeof users)[number]) => ({
          recipientId: u.id,
          kind: input.kind,
          title: input.title,
          body: input.body,
          linkPath: input.linkPath ?? null,
          announcementId: input.announcementId ?? null,
        })),
      }),
    );

    const byRecipient = new Map(
      created.map((n: (typeof created)[number]) => [n.recipientId, n.id]),
    );

    const message: OutboundMessage = {
      kind: input.kind,
      title: input.title,
      body: input.body,
      linkPath: input.linkPath ?? null,
      isUrgent: input.isUrgent ?? false,
    };

    // Deliveries are attempted after the inbox rows exist, and every outcome is
    // recorded rather than thrown. Awaiting them keeps the delivery log
    // truthful; a fire-and-forget would report success before anything had been
    // attempted.
    await Promise.all(
      users.map((u: (typeof users)[number]) => {
        const notificationId = byRecipient.get(u.id);
        return notificationId
          ? this.deliver(notificationId, u, message, input.exceptChannels ?? [])
          : Promise.resolve();
      }),
    );

    return { raised: created.length };
  }

  private async deliver(
    notificationId: string,
    user: {
      id: string;
      fullName: string;
      email: string;
      phone: string | null;
      phoneIsWhatsapp: boolean;
      timezone: string;
      notificationPreference: {
        channels: string[];
        mutedKinds: string[];
        quietHoursStart: number | null;
        quietHoursEnd: number | null;
      } | null;
    },
    message: OutboundMessage,
    exceptChannels: readonly string[] = [],
  ): Promise<void> {
    const preference: Preference = user.notificationPreference
      ? {
          channels: user.notificationPreference.channels,
          mutedKinds: user.notificationPreference.mutedKinds,
          quietHoursStart: user.notificationPreference.quietHoursStart,
          quietHoursEnd: user.notificationPreference.quietHoursEnd,
        }
      : DEFAULT_PREFERENCE;

    const localHour = localHourIn(user.timezone, new Date());
    const recipient: Recipient = {
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      phoneIsWhatsapp: user.phoneIsWhatsapp,
    };

    for (const { channel } of this.channels.available()) {
      // Held back by the caller, because it is sending this one itself with a
      // document attached. Recorded rather than skipped silently.
      if (exceptChannels.includes(channel)) {
        await this.recordDelivery(
          notificationId,
          channel,
          "SUPPRESSED",
          "Sent separately by the service that raised this, with the document attached.",
        );
        continue;
      }

      const decision = shouldPush({
        channel,
        kind: message.kind,
        isUrgent: message.isUrgent,
        localHour,
        preference,
      });

      if (!decision.push) {
        await this.recordDelivery(notificationId, channel, "SUPPRESSED", decision.reason);
        continue;
      }

      const adapter = this.channels.get(channel);
      if (!adapter) continue;

      try {
        const outcome = await adapter.send(recipient, message);
        await this.recordDelivery(notificationId, channel, outcome.status, outcome.detail);
      } catch (err) {
        // A channel throwing must not lose the notification, and must not
        // propagate into whatever caused it. The inbox row already exists.
        await this.recordDelivery(
          notificationId,
          channel,
          "FAILED",
          err instanceof Error ? err.message : "The channel raised an unknown error.",
        );
      }
    }
  }

  private async recordDelivery(
    notificationId: string,
    channel: string,
    status: string,
    detail: string,
  ): Promise<void> {
    await this.prisma
      .asSystem((db) =>
        db.notificationDelivery.create({
          data: {
            notificationId,
            channel: channel as "IN_APP" | "WHATSAPP" | "EMAIL" | "SMS",
            status: status as "PENDING" | "SENT" | "FAILED" | "SUPPRESSED",
            detail,
            attemptedAt: new Date(),
          },
        }),
      )
      .catch((err: unknown) => {
        // Losing a delivery RECORD is bad; losing the notification because we
        // could not write the record would be worse.
        this.logger.error(
          `Could not record a ${channel} delivery for notification ${notificationId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  // --------------------------------------------------------------- inbox --

  /** FR-COM-014 — the signed-in user's own inbox. */
  async inbox(options: { unreadOnly?: boolean; limit?: number } = {}) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const rows = await this.prisma.scoped.notification.findMany({
      where: {
        recipientId: actor.userId,
        ...(options.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(options.limit ?? 50, 100),
    });

    const unread = await this.prisma.scoped.notification.count({
      where: { recipientId: actor.userId, readAt: null },
    });

    return {
      unread,
      items: rows.map((n: (typeof rows)[number]) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        body: n.body,
        linkPath: n.linkPath,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
    };
  }

  /**
   * FR-COM-015 — marks as read.
   *
   * updateMany rather than update, with the recipient in the where. The scope
   * predicate constrains updateMany (it is in SCOPED_WRITE_OPS), and naming the
   * recipient as well means a stray id simply matches nothing instead of
   * touching somebody else's row.
   */
  async markRead(notificationIds: string[]) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const result = await this.prisma.scoped.notification.updateMany({
      where: { id: { in: notificationIds }, recipientId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }

  async markAllRead() {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const result = await this.prisma.scoped.notification.updateMany({
      where: { recipientId: actor.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }

  // ---------------------------------------------------------- preferences --

  async myPreference() {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const stored = await this.prisma.scoped.notificationPreference.findFirst({
      where: { userId: actor.userId },
    });

    return {
      channels: stored?.channels ?? DEFAULT_PREFERENCE.channels,
      mutedKinds: stored?.mutedKinds ?? DEFAULT_PREFERENCE.mutedKinds,
      quietHoursStart: stored?.quietHoursStart ?? null,
      quietHoursEnd: stored?.quietHoursEnd ?? null,
      // So the screen can say "WhatsApp is not set up yet" rather than offering
      // a switch that does nothing.
      availableChannels: this.channels.available(),
    };
  }

  async updateMyPreference(input: {
    channels?: string[];
    mutedKinds?: string[];
    quietHoursStart?: number | null;
    quietHoursEnd?: number | null;
  }) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    // Both or neither: a half-set window is rejected by a CHECK constraint, and
    // a 500 from the database is a worse answer than a clear message.
    const startGiven = input.quietHoursStart !== undefined;
    const endGiven = input.quietHoursEnd !== undefined;
    if (startGiven !== endGiven) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "quietHours",
            code: "INCOMPLETE",
            message: "Set both the start and the end of quiet hours, or neither.",
          },
        ],
      });
    }

    await this.prisma.asSystem((db) =>
      db.notificationPreference.upsert({
        where: { userId: actor.userId },
        create: {
          userId: actor.userId,
          channels: input.channels ?? DEFAULT_PREFERENCE.channels,
          mutedKinds: input.mutedKinds ?? [],
          quietHoursStart: input.quietHoursStart ?? null,
          quietHoursEnd: input.quietHoursEnd ?? null,
        },
        update: {
          ...(input.channels ? { channels: input.channels } : {}),
          ...(input.mutedKinds ? { mutedKinds: input.mutedKinds } : {}),
          ...(startGiven
            ? {
                quietHoursStart: input.quietHoursStart ?? null,
                quietHoursEnd: input.quietHoursEnd ?? null,
              }
            : {}),
        },
      }),
    );

    return this.myPreference();
  }
}
