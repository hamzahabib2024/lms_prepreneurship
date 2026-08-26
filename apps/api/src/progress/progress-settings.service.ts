import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";
import { DEFAULT_WEIGHTS, type ComponentKey } from "./progress-formula";

/**
 * HOW PROGRESS IS MEASURED IN ONE CLASS — FR-PRG.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `progressWeights` and `completionCriteria` have been columns on SectionSubject
 * since the beginning and NOTHING COULD SET THEM. The progress service reads
 * both, falls back to institute policy when they are null, and they were null
 * for every class the Institute has ever run — because there was no route and
 * no screen, only a column.
 *
 * The effect was that "80% progress" meant the same thing for a workshop that
 * is nine tenths practical assignments and for a lecture course with no
 * coursework at all. A teacher could see the figure and could not touch what it
 * was made of, which is the wrong way round: they are the only person who knows
 * whether attendance or submitted work says more about their subject.
 *
 * WEIGHTS ARE PERCENTAGES HERE AND FRACTIONS IN THE DATABASE. The column has
 * always held fractions summing to 1, and it still does; a teacher types 40,
 * not 0.4. Converting at the edge keeps the arithmetic and the interface each
 * in the units that suit them.
 *
 * THEY MUST TOTAL 100. Not because a total of 90 would crash — the progress
 * service is defensive and falls back to the institute weighting when the sum
 * is wrong — but because falling back SILENTLY is how somebody spends a term
 * believing they changed something they did not.
 *
 * CLEARING IS A FIRST-CLASS ACTION. Send nothing and the class goes back to
 * following the Institute, which is both the sensible default and the thing a
 * teacher wants when they have made a mess of it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const KEYS: ComponentKey[] = ["video", "assignment", "quiz", "attendance"];

export interface ProgressSettingsInput {
  /** Percentages totalling 100. Omit to follow the Institute. */
  weights?: Partial<Record<ComponentKey, number>>;
  /** Omit to follow the Institute. */
  criteria?: {
    minProgressPercent?: number;
    minAttendancePercent?: number;
    minAverageGradePercent?: number;
  };
}

@Injectable()
export class ProgressSettingsService {
  private readonly logger = new Logger(ProgressSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * What is in force for this class, and WHERE EACH NUMBER CAME FROM.
   *
   * The source matters more than the number. A teacher looking at "40%" needs
   * to know whether that is their decision or the Institute's, because those
   * are different conversations — one they can change here, the other they
   * have to ask the office about.
   */
  async get(sectionSubjectId: string) {
    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: sectionSubjectId, deletedAt: null },
      select: {
        id: true,
        progressWeights: true,
        completionCriteria: true,
        sectionId: true,
        subject: { select: { id: true, code: true, name: true } },
        section: { select: { code: true, name: true } },
      },
    });
    if (!offering) throw new AppError("RESOURCE_NOT_FOUND");

    const policy = await this.settings.resolveFor({
      SUBJECT: offering.subject.id,
      SECTION: offering.sectionId,
    });

    const instituteWeights = this.asWeights(policy["progress.weights"]) ?? DEFAULT_WEIGHTS;
    const own = this.asWeights(offering.progressWeights);
    const criteria = (offering.completionCriteria ?? null) as ProgressSettingsInput["criteria"];

    const instituteCriteria = {
      minProgressPercent: num(policy["completion.minProgressPercent"], 80),
      minAttendancePercent: num(policy["completion.minAttendancePercent"], 75),
      minAverageGradePercent: num(policy["completion.minAverageGradePercent"], 50),
    };

    return {
      sectionSubjectId: offering.id,
      subject: offering.subject,
      section: offering.section,
      weights: {
        // Percentages, because that is what a person reads and types.
        inForce: pct(own ?? instituteWeights),
        institute: pct(instituteWeights),
        ownedByThisClass: own !== null,
      },
      criteria: {
        inForce: { ...instituteCriteria, ...(criteria ?? {}) },
        institute: instituteCriteria,
        ownedByThisClass: criteria !== null && criteria !== undefined,
      },
    };
  }

  /** Set them, or clear both back to the Institute's. */
  async set(sectionSubjectId: string, input: ProgressSettingsInput) {
    const offering = await this.prisma.scoped.sectionSubject.findFirst({
      where: { id: sectionSubjectId, deletedAt: null },
      select: { id: true, progressWeights: true, completionCriteria: true },
    });
    if (!offering) throw new AppError("RESOURCE_NOT_FOUND");

    let weights: Record<ComponentKey, number> | null = null;
    if (input.weights) {
      const given = KEYS.map((k) => input.weights?.[k] ?? 0);
      for (const [i, v] of given.entries()) {
        if (!Number.isFinite(v) || v < 0 || v > 100) {
          throw new AppError("VALIDATION_FAILED", {
            details: [
              {
                field: `weights.${KEYS[i]}`,
                code: "OUT_OF_RANGE",
                message: "Each part must be between 0 and 100.",
              },
            ],
          });
        }
      }
      const total = given.reduce((a, b) => a + b, 0);
      if (Math.abs(total - 100) > 0.01) {
        throw new AppError("VALIDATION_FAILED", {
          details: [
            {
              field: "weights",
              code: "MUST_TOTAL_100",
              message:
                `The four parts must add up to 100. They currently add up to ${round(total)}. ` +
                `A total that is not 100 would be ignored and the Institute's weighting used ` +
                `instead, which is worse than being told now.`,
            },
          ],
        });
      }
      weights = Object.fromEntries(
        KEYS.map((k, i) => [k, (given[i] ?? 0) / 100]),
      ) as Record<ComponentKey, number>;
    }

    let criteria: ProgressSettingsInput["criteria"] | null = null;
    if (input.criteria) {
      for (const [k, v] of Object.entries(input.criteria)) {
        if (v === undefined) continue;
        if (!Number.isFinite(v) || v < 0 || v > 100) {
          throw new AppError("VALIDATION_FAILED", {
            details: [
              { field: `criteria.${k}`, code: "OUT_OF_RANGE", message: "Must be between 0 and 100." },
            ],
          });
        }
      }
      /*
       * STORED WHOLE, NEVER IN PART.
       *
       * A caller may send one threshold, and the obvious thing — storing what
       * they sent — writes `{minProgressPercent: 60}` with the other two
       * absent. Prisma serialises the absent ones as JSON null, and the
       * progress service spreads the stored document over the institute
       * defaults: `{...defaults, minAttendancePercent: null}`. The default is
       * not kept, it is REPLACED BY NULL, and a class silently stops having an
       * attendance requirement at all.
       *
       * Found by inspecting a row this service had written, not by a test —
       * which is why the fix is to make the shape impossible rather than to
       * remember not to do it.
       */
      const current = await this.get(sectionSubjectId);
      criteria = {
        minProgressPercent:
          input.criteria.minProgressPercent ?? current.criteria.institute.minProgressPercent,
        minAttendancePercent:
          input.criteria.minAttendancePercent ?? current.criteria.institute.minAttendancePercent,
        minAverageGradePercent:
          input.criteria.minAverageGradePercent ??
          current.criteria.institute.minAverageGradePercent,
      };
    }

    /*
     * `Prisma.DbNull`, not `null`. On a nullable Json column `null` is the JSON
     * VALUE null — a stored document that happens to be null — and DbNull is
     * the absent column. They read the same in TypeScript and behave entirely
     * differently: the progress service asks `typeof configured === "object"`,
     * and a JSON null passes that test while meaning nothing.
     *
     * Omitting a half is how a class goes back to following the Institute, so
     * this is the ordinary path rather than an edge case.
     */
    const updated = await this.prisma.scoped.sectionSubject.update({
      where: { id: sectionSubjectId },
      data: {
        progressWeights: weights ?? Prisma.DbNull,
        completionCriteria: criteria ? (criteria as Prisma.InputJsonObject) : Prisma.DbNull,
      },
      select: { id: true },
    });

    await this.audit.record({
      action: "progress.configure",
      entityType: "SectionSubject",
      entityId: sectionSubjectId,
      before: {
        weights: offering.progressWeights,
        criteria: offering.completionCriteria,
      },
      after: { weights, criteria },
    });
    this.logger.log(`progress settings changed for ${sectionSubjectId}`);
    return this.get(updated.id);
  }

  private asWeights(value: unknown): Record<ComponentKey, number> | null {
    if (!value || typeof value !== "object") return null;
    const v = value as Partial<Record<ComponentKey, number>>;
    if (!KEYS.every((k) => typeof v[k] === "number")) return null;
    return { video: v.video!, assignment: v.assignment!, quiz: v.quiz!, attendance: v.attendance! };
  }
}

/** Fractions out of the database, percentages onto the screen. */
function pct(w: Record<ComponentKey, number>): Record<ComponentKey, number> {
  return Object.fromEntries(KEYS.map((k) => [k, round(w[k] * 100)])) as Record<
    ComponentKey,
    number
  >;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
