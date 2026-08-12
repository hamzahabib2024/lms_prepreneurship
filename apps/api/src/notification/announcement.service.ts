import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { NotificationService } from "./notification.service";
import {
  assertInstituteWide,
  assertOwnsSection,
  assertOwnsSectionSubject,
} from "../rbac/ownership";

export interface CreateAnnouncementInput {
  audience: "INSTITUTE" | "SECTION" | "SECTION_SUBJECT";
  sectionId?: string;
  sectionSubjectId?: string;
  title: string;
  body: string;
  isPinned?: boolean;
  isUrgent?: boolean;
  /** FR-PUB — also shown on the public page. INSTITUTE audience only. */
  isPublic?: boolean;
  expiresAt?: Date;
}

/**
 * Announcements — SRS §5.16, FR-COM-001..012.
 *
 * An announcement names an AUDIENCE. The recipients are resolved at the moment
 * of sending, and the announcement itself remains readable by whoever is in
 * that audience later — so a student who enrols next week sees what was said,
 * and a student who leaves stops seeing it.
 */
@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * FR-COM-002 — post, and notify the audience.
   *
   * A teacher may address only a subject-section they teach, and only an
   * administrator may address the Institute.
   *
   * Checked HERE, explicitly. I first wrote that the scope policy would handle
   * it — it does not. ARC-051 injects a `where`, and a create has none, so a
   * teacher could post to any class in the Institute. See
   * assertOwnsSectionSubject.
   */
  async create(input: CreateAnnouncementInput) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    this.assertTargetMatchesAudience(input);

    // The scope check the predicate cannot make.
    if (input.audience === "INSTITUTE") assertInstituteWide();
    if (input.audience === "SECTION") assertOwnsSection(input.sectionId as string);
    if (input.audience === "SECTION_SUBJECT") {
      assertOwnsSectionSubject(input.sectionSubjectId as string);
    }

    const announcement = await this.prisma.scoped.announcement.create({
      data: {
        audience: input.audience,
        sectionId: input.sectionId ?? null,
        sectionSubjectId: input.sectionSubjectId ?? null,
        title: input.title,
        body: input.body,
        isPinned: input.isPinned ?? false,
        isUrgent: input.isUrgent ?? false,
        // Belt and braces with the schema and the CHECK constraint. Three
        // places agree that a sectional notice is not public, and the cheapest
        // one to get wrong later is the schema.
        isPublic: (input.isPublic ?? false) && input.audience === "INSTITUTE",
        expiresAt: input.expiresAt ?? null,
        authorUserId: actor.userId,
      },
    });

    const recipientUserIds = await this.resolveAudience(input);

    await this.notifications.notify({
      recipientUserIds,
      kind: "announcement.posted",
      title: input.title,
      // The first line only. An inbox entry is a prompt to go and read the
      // thing, not a copy of it — and a WhatsApp message quoting three
      // paragraphs is worse than one that does not.
      body: firstLine(input.body),
      linkPath: "/announcements",
      isUrgent: input.isUrgent ?? false,
      announcementId: announcement.id,
    });

    await this.audit.record({
      action: "announcement.create",
      entityType: "Announcement",
      entityId: announcement.id,
      after: {
        audience: input.audience,
        title: input.title,
        recipients: recipientUserIds.length,
        urgent: input.isUrgent ?? false,
      },
    });

    return { ...announcement, notified: recipientUserIds.length };
  }

  /**
   * FR-COM-008 — what this person should see.
   *
   * The scope policy already limits the rows to their audience, so this adds
   * only the time window: an expired announcement is history, and one that has
   * not been published yet is not theirs to see.
   */
  async listForMe() {
    const now = new Date();
    const rows = await this.prisma.scoped.announcement.findMany({
      where: {
        deletedAt: null,
        publishedAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      // Pinned first, then newest (FR-COM-006).
      orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }],
      take: 50,
      include: {
        author: { select: { fullName: true } },
        sectionSubject: { include: { subject: { select: { code: true, name: true } } } },
        section: { select: { code: true } },
      },
    });

    return rows.map((a: (typeof rows)[number]) => ({
      id: a.id,
      audience: a.audience,
      title: a.title,
      body: a.body,
      isPinned: a.isPinned,
      isUrgent: a.isUrgent,
      publishedAt: a.publishedAt,
      expiresAt: a.expiresAt,
      authorName: a.author.fullName,
      about:
        a.sectionSubject?.subject.name ?? (a.section ? `Section ${a.section.code}` : "Everyone"),
    }));
  }

  /** FR-COM-011 — withdraw. Soft, so the audit trail keeps what was said. */
  async withdraw(id: string) {
    const existing = await this.prisma.scoped.announcement.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new AppError("RESOURCE_NOT_FOUND");

    await this.prisma.scoped.announcement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: "announcement.withdraw",
      entityType: "Announcement",
      entityId: id,
      before: { title: existing.title },
    });

    // The inbox entries stay. People were told, and pretending otherwise would
    // leave them with a memory the System denies.
    return { withdrawn: true };
  }

  // ------------------------------------------------------------ internals --

  private assertTargetMatchesAudience(input: CreateAnnouncementInput): void {
    const problem =
      input.audience === "INSTITUTE" && (input.sectionId || input.sectionSubjectId)
        ? "An institute-wide announcement cannot name a section."
        : input.audience === "SECTION" && !input.sectionId
          ? "Name the section this is for."
          : input.audience === "SECTION_SUBJECT" && !input.sectionSubjectId
            ? "Name the subject-section this is for."
            : null;

    if (problem) {
      throw new AppError("VALIDATION_FAILED", {
        details: [{ field: "audience", code: "MISMATCH", message: problem }],
      });
    }
  }

  /**
   * Who is in this audience right now.
   *
   * asSystem, because posting to a class means writing to thirty inboxes and
   * the author has no business reading those users through their own scope.
   * Only ACTIVE people are notified: a withdrawn student should not receive
   * next week's homework reminder.
   */
  private async resolveAudience(input: CreateAnnouncementInput): Promise<string[]> {
    return this.prisma.asSystem(async (db) => {
      if (input.audience === "INSTITUTE") {
        const users = await db.user.findMany({
          where: { status: "ACTIVE", deletedAt: null },
          select: { id: true },
        });
        return users.map((u: { id: string }) => u.id);
      }

      const enrolments = await db.enrolment.findMany({
        where: {
          status: "ACTIVE",
          deletedAt: null,
          ...(input.audience === "SECTION_SUBJECT"
            ? { sectionSubjectId: input.sectionSubjectId }
            : { sectionSubject: { sectionId: input.sectionId } }),
        },
        select: { student: { select: { userId: true } } },
      });

      const teachers = await db.teacherAssignment.findMany({
        where: {
          deletedAt: null,
          endDate: null,
          ...(input.audience === "SECTION_SUBJECT"
            ? { sectionSubjectId: input.sectionSubjectId }
            : { sectionSubject: { sectionId: input.sectionId } }),
        },
        select: { teacher: { select: { userId: true } } },
      });

      return [
        ...enrolments.map((e: { student: { userId: string } }) => e.student.userId),
        // The teaching staff too: an announcement to a class that its teacher
        // never sees is how a class and its teacher end up with different
        // information.
        ...teachers.map((t: { teacher: { userId: string } }) => t.teacher.userId),
      ];
    });
  }
}

/** The first line, trimmed, for a preview. */
function firstLine(body: string): string {
  const line = body.split("\n")[0]?.trim() ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}
