import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { SettingsService } from "../settings/settings.service";
import {
  problemsWith,
  publicPageDefinitions,
  type PublicPageField,
} from "./public-page.keys";

/**
 * The public page, as something the Institute edits — FR-PUB, SRS §13.2.
 *
 * WHAT THIS IS FOR. The landing page is the only screen in the System a
 * stranger sees, and until now most of it could not be changed by anybody who
 * works here. The videos and the social links were settings, reachable through
 * a screen an Admin may read and only a Super Admin may write; the headline,
 * the paragraph under it, the six claims, the heading over the programme list
 * and the closing band were string literals in a React component, changeable
 * only by a developer with a deployment. So the Institute's front page said
 * whatever it said on the day it was written.
 *
 * THE SHAPE OF THE FIX is a narrower door onto the settings that already
 * existed, rather than a second content store beside them. Nothing here owns a
 * value: every read goes through SettingsService and every write goes through
 * SettingsService.set(), which means this screen inherits the catalogue's
 * validation, the audit entry, the cache invalidation and the "this applies
 * from now on" semantics without repeating any of it. What it adds is the
 * allow-list (public-page.keys.ts) and an Admin's right to use it.
 *
 * WHAT IT DELIBERATELY CANNOT EDIT, because these are not marketing copy:
 *
 *   the programme list — it is the Institute's real records, and a section is
 *   advertised because it is open. Typing it here is how a page comes to
 *   promise a course that closed last year;
 *
 *   the public notices — they are real announcements, marked to show publicly
 *   by the person who wrote them. A second list here would drift from what the
 *   Institute actually told its students;
 *
 *   the Institute's own name — it is printed on receipts and certificates, so
 *   it is governance rather than a heading. It is shown here, read-only, with
 *   a note saying where it is changed.
 */
@Injectable()
export class PublicPageService {
  private readonly logger = new Logger(PublicPageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Everything the editor needs, in one request.
   *
   * The fields, the default beside each value so the way back is never lost,
   * and the two things the editor may NOT change but must still be able to see
   * — the Institute's name, and the notices currently on the page. A screen
   * that edits a front page while hiding half of what is on it sends somebody
   * to a second tab to find out what they are working on.
   */
  async document() {
    const [stored, name] = await Promise.all([
      this.settings.catalogue(),
      this.settings.text("institute.name"),
    ]);

    // The catalogue is grouped for the settings screen; this route wants the
    // Public page group flattened, with the catalogue's own metadata carried
    // through so the editor can render a textarea where a value is prose and a
    // one-line box where it is a button's wording.
    const byKey = new Map<string, Record<string, unknown>>();
    for (const group of stored) {
      for (const setting of group.settings) {
        byKey.set(setting["key"] as string, setting);
      }
    }

    const fields: PublicPageField[] = publicPageDefinitions().map((def) => {
      const row = byKey.get(def.key);
      return {
        key: def.key,
        type: def.type,
        description: def.description,
        default: def.default,
        value: row ? row["value"] : def.default,
        isOverridden: row ? row["isOverridden"] === true : false,
        ...(def.maxLength !== undefined ? { maxLength: def.maxLength } : {}),
        ...(def.multiline !== undefined ? { multiline: def.multiline } : {}),
      };
    });

    return {
      fields,
      instituteName: name,
      news: await this.publicNotices(),
      /*
       * The address of the real thing.
       *
       * Sent by the server rather than written into the screen so that the one
       * place that decides where the public page lives is the one that serves
       * it. An editor with a preview button pointing at a stale path is worse
       * than one with no preview button.
       */
      previewPath: "/home",
    };
  }

  /**
   * Save a set of changes as one act.
   *
   * NOTHING IS WRITTEN UNTIL EVERYTHING VALIDATES. Somebody editing this
   * screen has usually changed six things; writing the four that were fine and
   * refusing the two that were not leaves a front page in a state nobody chose,
   * and no way to tell from looking at it which half took effect.
   *
   * `null` means "remove the override", which restores the wording that was
   * there when the System was installed. That is not the same as typing the
   * default back in: deleting the row means a later change to the default
   * reaches this Institute, and an identical stored value would not.
   */
  async save(values: Record<string, unknown>) {
    const entries = Object.entries(values);
    if (entries.length === 0) {
      throw new AppError("VALIDATION_FAILED", {
        message: "Nothing was changed.",
        details: [
          { field: "values", code: "REQUIRED", message: "Change something before saving." },
        ],
      });
    }

    const problems = problemsWith(values);
    if (problems.length > 0) {
      throw new AppError("VALIDATION_FAILED", {
        message:
          problems.length === 1
            ? "That change could not be saved."
            : `${problems.length} of these changes could not be saved. Nothing was changed.`,
        // Keyed by the setting, so the editor can put each message under the
        // box it belongs to rather than in a banner at the top.
        details: problems.map((p) => ({ field: p.key, code: "INVALID", message: p.message })),
      });
    }

    const changed: string[] = [];
    const restored: string[] = [];

    for (const [key, value] of entries) {
      if (value === null) {
        try {
          await this.settings.clear(key);
          restored.push(key);
        } catch (err) {
          // There was no override to remove — the field was already at its
          // default. Restoring a default that is already in force is a no-op,
          // not a failure, and reporting it as one would make "Restore" look
          // broken on exactly the fields where it had nothing to do.
          if (err instanceof AppError && err.code === "RESOURCE_NOT_FOUND") continue;
          throw err;
        }
      } else {
        await this.settings.set(key, value);
        changed.push(key);
      }
    }

    this.logger.log(
      `Public page updated: ${changed.length} changed, ${restored.length} restored to default.`,
    );

    return {
      changed,
      restored,
      // Said plainly, because the whole point of this screen is that the change
      // is visible to strangers immediately.
      note: "The public page shows this now. Open the preview to see it.",
    };
  }

  /**
   * The notices currently on the public page.
   *
   * THE SAME QUERY THE PUBLIC PAGE ITSELF RUNS, deliberately: isPublic, to the
   * whole Institute, not withdrawn, not expired. An editor that showed a
   * different list would be a second opinion about what strangers can see, and
   * the one that matters is the page's.
   *
   * Read as the System because this is a projection of what is ALREADY public
   * — the same rows, to the same depth, that /public/showcase serves to
   * somebody with no account at all.
   */
  private async publicNotices() {
    return this.prisma.asSystem((db) =>
      db.announcement.findMany({
        where: {
          isPublic: true,
          audience: "INSTITUTE",
          deletedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }],
        take: 6,
        select: { id: true, title: true, publishedAt: true, isPinned: true, expiresAt: true },
      }),
    );
  }
}
