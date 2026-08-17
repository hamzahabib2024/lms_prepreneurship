import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { SettingsService } from "../settings/settings.service";

/**
 * Registration and roll number allocation — SRS Appendix B, FR-REG-049..058.
 *
 * The registration number is the Institute's permanent public identifier. It
 * appears on certificates, in correspondence, and in every report. Because it
 * is permanent and public, allocation must be correct under concurrency: two
 * students must never receive the same number, and the series must never skip
 * silently. That is RSK-07, and it is the reason this is a separate service
 * with its own tests rather than a helper inside the approval flow.
 */

export interface NumberFormatConfig {
  instituteCode: string;
  campusCode: string;
  padWidth: number;
  /**
   * Default: {INSTITUTE}/{SESSION}-{SEQUENCE}/{CAMPUS}
   *
   * NO {PROGRAMME}. A registration number identifies a STUDENT, and a student
   * may take more than one course — so a number carrying a programme code would
   * either have to change when they enrol in a second one, breaking a permanent
   * public identifier that appears on certificates (BR-REG-07), or would
   * describe them wrongly for the rest of their time here.
   *
   * The placeholder is still substituted if a deployment configures a template
   * that uses it, but nothing supplies it by default.
   */
  template: string;
}

export interface SeriesKeyParts {
  instituteCode: string;
  sessionCode: string; // SP26
  campusCode: string; // ISB
  /**
   * Retained for a deployment whose configured template still uses
   * {PROGRAMME}. It takes no part in the SERIES KEY — see buildSeriesKey.
   */
  programmeCode?: string;
}

/** A minimal transaction client — anything with $queryRaw and the models we touch. */
type Tx = Prisma.TransactionClient;

@Injectable()
export class RegistrationNumberService {
  private readonly logger = new Logger(RegistrationNumberService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * OPN-01 is still open: the Institute has not confirmed the exact format or
   * the highest number already issued. FR-REG-054 makes the format
   * configurable precisely so that this does not block development — the
   * Appendix B default is used until a setting overrides it.
   */
  /**
   * FR-REG-054 properly: the format an administrator can actually change.
   *
   * Layered over getFormat() rather than replacing it. The environment still
   * supplies the deployment's starting point, and a settings override — set on
   * the Settings screen, under "Registration numbers" — wins over it. Until
   * somebody sets one, this returns exactly what getFormat() always did.
   *
   * NOT CACHED, and deliberately. It is read once per admission and once per
   * cohort import, both of which already do far more work than a settings
   * lookup; a cache here would mean an administrator changing the format and
   * watching the next student get the old one.
   */
  async resolveFormat(): Promise<NumberFormatConfig> {
    const fallback = this.getFormat();
    const [instituteCode, campusCode, template, padWidth] = await Promise.all([
      this.settings.text("registration.instituteCode"),
      this.settings.text("registration.campusCode"),
      this.settings.text("registration.template"),
      this.settings.number("registration.padWidth"),
    ]);

    // A blank string is somebody clearing the field, not a considered value —
    // an empty institute code would silently produce "/SP26-001/ISB".
    return {
      instituteCode: instituteCode.trim() || fallback.instituteCode,
      campusCode: campusCode.trim() || fallback.campusCode,
      template: template.trim() || fallback.template,
      padWidth: Number.isFinite(padWidth) && padWidth > 0 ? padWidth : fallback.padWidth,
    };
  }

  getFormat(): NumberFormatConfig {
    return {
      instituteCode: this.env("INSTITUTE_CODE", "CIIT"),
      campusCode: this.env("CAMPUS_CODE", "ISB"),
      padWidth: Number(this.env("REG_NO_PAD_WIDTH", "3")),
      template: this.env("REG_NO_TEMPLATE", "{INSTITUTE}/{SESSION}-{SEQUENCE}/{CAMPUS}"),
    };
  }

  /**
   * DEFINED-AS-EMPTY IS NOT THE SAME AS UNSET, and ConfigService does not
   * conflate them: a default is returned only for `undefined`, so a variable
   * set to "" beats it and wins.
   *
   * That is not a hypothetical. `docker-compose.yml` passes these through as
   * `${INSTITUTE_CODE:-}` so the Institute can set them in .env — which means
   * that on any machine where they are NOT set, the container receives an
   * empty string rather than nothing, and every registration number allocated
   * there would read "/SP26-001/" with the institute and campus missing.
   * Writing `INSTITUTE_CODE=` in .env does the same on any deployment.
   *
   * The blank-is-not-a-value rule was already applied to the settings layer
   * above; this applies it to the layer the settings fall back to.
   */
  private env(key: string, fallback: string): string {
    return (this.config.get<string>(key, "") ?? "").trim() || fallback;
  }

  /**
   * The tuple over which the sequence is unique.
   *
   * SP26-034/ISB and SP26-034/LHR are different students; the campus runs its
   * own series because the two campuses admit independently.
   *
   * THE PROGRAMME IS DELIBERATELY ABSENT. A per-programme series would hand one
   * person a second number when they took a second course, and the number is
   * meant to identify the person. One student, one number, however many courses
   * they enrol in.
   */
  buildSeriesKey(parts: SeriesKeyParts): string {
    return [parts.instituteCode, parts.sessionCode, parts.campusCode]
      .map((p) => p.trim().toUpperCase())
      .join("|");
  }

  format(parts: SeriesKeyParts, sequence: number, cfg = this.getFormat()): string {
    return cfg.template
      .replace("{INSTITUTE}", parts.instituteCode.toUpperCase())
      .replace("{SESSION}", parts.sessionCode.toUpperCase())
      .replace("{PROGRAMME}", (parts.programmeCode ?? "").toUpperCase())
      .replace("{SEQUENCE}", String(sequence).padStart(cfg.padWidth, "0"))
      .replace("{CAMPUS}", parts.campusCode.toUpperCase());
  }

  /**
   * Allocates the next sequence value for a series, ATOMICALLY.
   *
   * FR-REG-051. The obvious implementation — read the maximum, add one — is
   * FORBIDDEN by Appendix B because it collides under concurrent approval:
   * two administrators approving at the same moment both read the same
   * maximum and both write the same number.
   *
   * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` performs the read and the
   * increment as a single atomic statement, so the database serialises the
   * two callers and each receives a distinct value. Must be called inside the
   * approval transaction, so that a failed approval consumes no number.
   */
  async allocateSequence(tx: Tx, seriesKey: string): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ next_value: number }>>`
      INSERT INTO number_series (id, key, next_value, created_at, updated_at)
      VALUES (gen_random_uuid(), ${seriesKey}, 1, now(), now())
      ON CONFLICT (key)
        DO UPDATE SET next_value = number_series.next_value + 1, updated_at = now()
      RETURNING next_value
    `;

    const value = rows[0]?.next_value;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Number series "${seriesKey}" returned no value`);
    }
    return value;
  }

  /** Allocates and formats in one step. Call inside the approval transaction. */
  /**
   * FR-REG-051, and the case OPN-01 warned about.
   *
   * A NUMBER THAT IS ALREADY IN USE IS NOT FREE, WHATEVER THE COUNTER SAYS.
   * The counter and the students table can disagree, and when they do the
   * counter is the one that is wrong:
   *
   *   - the Institute has been issuing numbers by hand for years, and OPN-01
   *     asks for the highest one already given out. Until somebody supplies
   *     it, a new deployment starts at 1 — on top of every number in use;
   *   - the seed writes eight students with numbers and never advanced the
   *     series, so the first admission on any demonstration database was
   *     refused with "A record with that value already exists". That is how
   *     this was found: a real approval, on a seeded database, over HTTP;
   *   - students imported from a spreadsheet arrive with their numbers.
   *
   * So the allocated number is CHECKED, and a taken one is skipped. Each
   * attempt calls allocateSequence again, which is a single atomic statement,
   * so the counter genuinely advances and two administrators approving at the
   * same instant still cannot be handed the same number (RSK-07) — the retry
   * is not a read-then-write, which is the shape that breaks that guarantee.
   *
   * It is self-healing rather than a permanent cost: the walk happens once,
   * over whatever block is already taken, and afterwards the counter is past
   * it forever.
   *
   * The bound exists so a format that collides on EVERY value — a template
   * with the sequence left out, say — fails loudly at admission instead of
   * spinning inside a transaction holding a section lock.
   */
  async allocate(
    tx: Tx,
    parts: SeriesKeyParts,
  ): Promise<{ registrationNo: string; sequence: number }> {
    const key = this.buildSeriesKey(parts);

    for (let attempt = 0; attempt < 100; attempt++) {
      const sequence = await this.allocateSequence(tx, key);
      const registrationNo = this.format(parts, sequence);

      const taken = await tx.student.findFirst({
        // Deleted students included ON PURPOSE: BR-REG-07 makes the number
        // permanent and public, it is printed on certificates already issued,
        // and the column's unique index does not exclude soft-deleted rows.
        // Reissuing one would make two people the same person in every report.
        where: { registrationNo },
        select: { id: true },
      });

      if (!taken) {
        if (attempt > 0) {
          this.logger.warn(
            `Skipped ${attempt} registration number(s) already in use on series "${key}". ` +
              `The series was behind the students table — expected on a seeded or imported ` +
              `database, and now corrected. If this repeats, set the series deliberately (OPN-01).`,
          );
        }
        return { registrationNo, sequence };
      }
    }

    throw new Error(
      `Could not allocate a free registration number on series "${key}" after 100 attempts. ` +
        `Check the number format — one that omits the sequence collides on every value.`,
    );
  }

  /**
   * Allocates the lowest unused roll number within a section (FR-REG-057).
   *
   * Unlike the registration number, a roll number IS reused: withdrawal frees
   * it (BR-REG-08), because it is a classroom convenience rather than an
   * identity. "Lowest unused" keeps a register contiguous as students come and
   * go.
   *
   * The caller must already hold a row lock on the section (see
   * lockSection) — otherwise two concurrent approvals into the same section
   * can both compute the same gap.
   */
  async allocateRollNumber(tx: Tx, sectionId: string): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ roll: number }>>`
      SELECT COALESCE(MIN(candidate), 1)::int AS roll
      FROM generate_series(
             1,
             COALESCE((SELECT MAX(current_roll_no) FROM students
                        WHERE current_section_id = ${sectionId}::uuid
                          AND deleted_at IS NULL), 0) + 1
           ) AS candidate
      WHERE NOT EXISTS (
        SELECT 1 FROM students s
         WHERE s.current_section_id = ${sectionId}::uuid
           AND s.current_roll_no = candidate
           AND s.deleted_at IS NULL
      )
    `;

    const roll = rows[0]?.roll;
    if (typeof roll !== "number" || roll < 1) {
      throw new Error(`Could not allocate a roll number in section ${sectionId}`);
    }
    return roll;
  }

  /**
   * Takes an exclusive row lock on the section for the rest of the
   * transaction.
   *
   * Serialises concurrent approvals into the SAME section, which is what makes
   * the capacity check (FR-REG-031) and the roll number allocation correct.
   * Approvals into different sections are unaffected, so this does not become
   * a global bottleneck at intake.
   */
  async lockSection(tx: Tx, sectionId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM sections WHERE id = ${sectionId}::uuid FOR UPDATE`;
  }

  /**
   * Seeds a series so numbering continues from the Institute's existing
   * records rather than restarting at 1 (FR-REG-056).
   *
   * Needed once OPN-01 confirms the highest number already issued. Refuses to
   * lower a series, because that would reissue numbers already in use and
   * BR-REG-07 forbids it absolutely.
   */
  async seedSeries(tx: Tx, seriesKey: string, highestIssued: number): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO number_series (id, key, next_value, created_at, updated_at)
      VALUES (gen_random_uuid(), ${seriesKey}, ${highestIssued}, now(), now())
      ON CONFLICT (key)
        DO UPDATE SET next_value = GREATEST(number_series.next_value, ${highestIssued}),
                      updated_at = now()
    `;
    this.logger.log(`Series "${seriesKey}" seeded at ${highestIssued}`);
  }
}
