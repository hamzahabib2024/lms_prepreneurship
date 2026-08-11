import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import { AppError } from "@lms/shared";
import {
  TEMPLATES,
  definitionFor,
  previewValues,
  refuseTemplate,
  render,
  type Rendered,
} from "./templates";

/**
 * The Institute's wording for the messages the System sends — FR-NOT-020..026.
 *
 * STORED ONLY WHERE IT HAS BEEN CHANGED. There is no row per kind by default:
 * a table pre-filled with the System's own defaults would make every message
 * look deliberately chosen, and nobody could tell which the Institute had
 * actually edited. `source` on the way out says which is which, exactly as the
 * settings catalogue does.
 *
 * RESETTING IS DELETING THE ROW, not writing the default back into it. Same
 * reason: an Institute that resets a message should be back to inheriting it,
 * not holding a copy that stops tracking future improvements to the wording.
 */
@Injectable()
export class TemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every message the Institute can word, with what it currently says. */
  async catalogue() {
    const overrides = await this.prisma.asSystem((db) => db.notificationTemplate.findMany());
    const byKind = new Map(overrides.map((o) => [o.kind, o]));

    return TEMPLATES.map((t) => {
      const custom = byKind.get(t.kind);
      const title = custom?.title ?? t.defaultTitle;
      const body = custom?.body ?? t.defaultBody;
      return {
        kind: t.kind,
        label: t.label,
        description: t.description,
        placeholders: t.placeholders,
        title,
        body,
        defaultTitle: t.defaultTitle,
        defaultBody: t.defaultBody,
        source: custom ? ("INSTITUTE" as const) : ("DEFAULT" as const),
        updatedAt: custom?.updatedAt ?? null,
        // What a student would actually receive, filled with invented people
        // rather than a real recipient's marks and fees.
        preview: render(title, body, previewValues(t)),
      };
    });
  }

  /**
   * Changes the wording.
   *
   * The template is validated HERE, when it is written, and not when it is
   * sent. A message goes out once, to a person, and "Dear {studentNmae}"
   * cannot be recalled.
   */
  async set(kind: string, title: string, body: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const definition = definitionFor(kind);
    if (!definition) {
      throw new AppError("VALIDATION_FAILED", {
        message: `"${kind}" is not a message this System sends.`,
        details: [
          {
            field: "kind",
            code: "UNKNOWN",
            message:
              "Only the messages in the catalogue can be worded by the Institute. " +
              "An announcement's own text is written by whoever posts it.",
          },
        ],
      });
    }

    const problems = refuseTemplate(kind, title, body);
    if (problems.length > 0) {
      throw new AppError("VALIDATION_FAILED", {
        message: `That wording cannot be used for "${definition.label}".`,
        details: problems.map((p) => ({ field: p.field, code: p.code, message: p.message })),
      });
    }

    const before = await this.prisma.asSystem((db) =>
      db.notificationTemplate.findUnique({ where: { kind } }),
    );

    const saved = await this.prisma.asSystem((db) =>
      db.notificationTemplate.upsert({
        where: { kind },
        create: { kind, title, body, updatedBy: actor.userId },
        update: { title, body, updatedBy: actor.userId },
      }),
    );

    await this.audit.record({
      action: "notification.template.set",
      entityType: "NotificationTemplate",
      entityId: saved.id,
      // The old wording matters: somebody asking why a student received a
      // particular sentence needs what it said at the time.
      before: before ? { title: before.title, body: before.body } : { source: "DEFAULT" },
      after: { kind, title, body },
    });

    return this.one(kind);
  }

  /** Back to the System's own wording, by removing the override entirely. */
  async reset(kind: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
    if (!definitionFor(kind)) throw new AppError("RESOURCE_NOT_FOUND");

    const existing = await this.prisma.asSystem((db) =>
      db.notificationTemplate.findUnique({ where: { kind } }),
    );
    if (existing) {
      await this.prisma.asSystem((db) => db.notificationTemplate.delete({ where: { kind } }));
      await this.audit.record({
        action: "notification.template.reset",
        entityType: "NotificationTemplate",
        entityId: existing.id,
        before: { title: existing.title, body: existing.body },
        after: { source: "DEFAULT" },
      });
    }
    return this.one(kind);
  }

  private async one(kind: string) {
    const all = await this.catalogue();
    const found = all.find((t) => t.kind === kind);
    if (!found) throw new AppError("RESOURCE_NOT_FOUND");
    return found;
  }

  /**
   * The wording to send, filled in.
   *
   * Called by the services that raise notifications. A kind the catalogue does
   * not know returns null, and the caller keeps its own literal — so a message
   * this catalogue has not adopted degrades to today's behaviour rather than
   * to an empty one.
   */
  async renderFor(
    kind: string,
    values: Record<string, string | number | null | undefined>,
  ): Promise<Rendered | null> {
    const definition = definitionFor(kind);
    if (!definition) return null;

    const custom = await this.prisma.asSystem((db) =>
      db.notificationTemplate.findUnique({ where: { kind } }),
    );
    return render(
      custom?.title ?? definition.defaultTitle,
      custom?.body ?? definition.defaultBody,
      values,
    );
  }
}
