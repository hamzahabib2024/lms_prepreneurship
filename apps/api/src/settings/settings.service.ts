import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { getActor } from "../prisma/actor-context";
import {
  CATALOGUE,
  definitionFor,
  resolve,
  resolveAll,
  validateCoherence,
  validateValue,
  type ScopeType,
  type StoredSetting,
} from "./settings-catalogue";

export interface SettingContext {
  PROGRAMME?: string;
  SECTION?: string;
  SUBJECT?: string;
}

/**
 * Institute settings — SRS §5.20, CFG-*.
 *
 * The `settings` table has existed since the first migration with nothing
 * reading or writing it, so every value it was meant to hold lived somewhere an
 * administrator cannot reach: attendance thresholds in ENVIRONMENT VARIABLES,
 * needing a redeploy to change; progress weights, completion criteria and
 * upload limits as constants in the source. The Institute could not alter its
 * own policy without a developer.
 *
 * Two audiences, deliberately different:
 *
 *   catalogue()   the screen. Every setting with its value, where that value
 *                 came from, and what changing it does.
 *   resolveFor()  the rest of the System. A plain map, cached, read under
 *                 asSystem because a student's progress calculation depends on
 *                 the institute weighting and a student cannot read settings.
 *
 * READING IS CACHED. Attendance recalculates thresholds per student per
 * register; settings change perhaps monthly. The cache is invalidated on every
 * write. It is per-process, which is correct for one instance and would need
 * moving alongside the playback tickets before a second — noted in the same
 * place as that one so both are found together.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  /** All stored overrides. Small — one row per deliberate change. */
  private cache: StoredSetting[] | null = null;
  /** When this process last read them. Null whenever `cache` is null. */
  private cachedAt = 0;

  /**
   * HOW LONG A SETTING MAY BE WRONG ON A NODE THAT DID NOT CHANGE IT.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * THE BUG THIS CLOSES, AND IT ONLY APPEARS BEHIND A LOAD BALANCER.
   *
   * The cache was invalidated on write and never otherwise. On ONE process
   * that is exactly right: the only way a setting changes is through this
   * service, which clears its own cache immediately.
   *
   * Behind a load balancer it is silently, permanently wrong. A Super Admin
   * changes the attendance threshold; the node that served the request clears
   * its cache; every OTHER node keeps the old value until it is restarted.
   * Not for fifteen minutes — FOREVER. Half the Institute is then warned at
   * 75% and half at 70%, the screen shows the new number, and the audit log
   * says it changed. There is nothing to see and nothing to blame.
   *
   * A time-to-live turns "forever" into "within a minute", with no Redis and
   * no coordination: each node re-reads a table of a dozen rows once a minute.
   * The immediate invalidation on write is kept, so the node that made the
   * change is still correct instantly.
   *
   * IT IS NOT A SUBSTITUTE FOR SHARED STATE, and the deployment notes say so.
   * It is the difference between a wrong value that heals and one that does
   * not.
   * ─────────────────────────────────────────────────────────────────────────
   */
  private readonly ttlMs = Number(process.env["SETTINGS_CACHE_TTL_MS"] ?? 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async stored(): Promise<StoredSetting[]> {
    if (this.cache && Date.now() - this.cachedAt < this.ttlMs) return this.cache;
    const rows = await this.prisma.asSystem((db) =>
      db.setting.findMany({
        select: { key: true, value: true, scopeType: true, scopeId: true },
      }),
    );
    this.cache = rows as StoredSetting[];
    this.cachedAt = Date.now();
    return this.cache;
  }

  private invalidate(): void {
    this.cache = null;
    this.cachedAt = 0;
  }

  /**
   * The resolved values for a context — what the System should actually use.
   *
   * Runs under asSystem on purpose. Progress is calculated FOR a student, and a
   * student holds no `system_setting:read`; scoping this to the caller would
   * hand every student the institute defaults and quietly ignore their own
   * programme's weighting.
   */
  async resolveFor(context: SettingContext = {}): Promise<Record<string, unknown>> {
    return resolveAll(await this.stored(), context);
  }

  /** One value, typed. The overwhelmingly common case. */
  async number(key: string, context: SettingContext = {}): Promise<number> {
    const value = resolve(key, await this.stored(), context).value;
    if (typeof value === "number") return value;
    // A stored value of the wrong type would otherwise become NaN and travel
    // silently into a percentage on somebody's record.
    const fallback = definitionFor(key)?.default;
    this.logger.error(`Setting "${key}" is not a number; using the default.`);
    return typeof fallback === "number" ? fallback : 0;
  }

  async text(key: string, context: SettingContext = {}): Promise<string> {
    const value = resolve(key, await this.stored(), context).value;
    if (typeof value === "string") return value;
    // The declared default, only if it is text. A setting whose default is a
    // number or an object would otherwise be handed back as "[object Object]"
    // to a caller that asked for a string.
    const fallback = definitionFor(key)?.default;
    return typeof fallback === "string" ? fallback : "";
  }

  async list(key: string, context: SettingContext = {}): Promise<string[]> {
    const value = resolve(key, await this.stored(), context).value;
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value as string[];
    const fallback = definitionFor(key)?.default;
    return Array.isArray(fallback) ? (fallback as string[]) : [];
  }

  /**
   * FR-CFG-001 — the settings screen.
   *
   * Every setting, whether or not it has been changed, with its default, its
   * current value and WHERE THAT VALUE CAME FROM. The last is what makes the
   * screen usable: an administrator who changes an institute value and sees
   * nothing happen has almost always hit a more specific override, and without
   * being told they conclude the feature is broken.
   */
  async catalogue(context: SettingContext = {}) {
    const stored = await this.stored();
    const groups = new Map<string, Array<Record<string, unknown>>>();

    for (const def of CATALOGUE) {
      const r = resolve(def.key, stored, context);
      const entry: Record<string, unknown> = {
        key: def.key,
        type: def.type,
        description: def.description,
        default: def.default,
        source: r.source,
        scopeId: r.scopeId,
        isOverridden: r.source !== "default",
        overridableAt: def.overridableAt ?? [],
        ...(def.min !== undefined ? { min: def.min } : {}),
        ...(def.max !== undefined ? { max: def.max } : {}),
        ...(def.allowed ? { allowed: def.allowed } : {}),
        // Shape, so the screen can draw a box the size of the value. Without
        // these a 400-character paragraph is edited through a one-line input
        // that shows forty characters of it at a time.
        ...(def.maxLength !== undefined ? { maxLength: def.maxLength } : {}),
        ...(def.multiline !== undefined ? { multiline: def.multiline } : {}),
      };

      // SEC-CRY-010 — a secret is write-only. Not masked, not truncated:
      // absent, with a flag saying whether one is set, because "••••••" is
      // still a statement about the length of the real thing.
      if (def.isSecret) {
        entry["isSecret"] = true;
        entry["isSet"] = r.source !== "default";
      } else {
        entry["value"] = r.value;
      }

      const list = groups.get(def.group) ?? [];
      list.push(entry);
      groups.set(def.group, list);
    }

    return [...groups.entries()].map(([group, settings]) => ({ group, settings }));
  }

  /**
   * FR-CFG-004 — change a setting.
   *
   * Validated against the catalogue, then against the resulting SET, because a
   * value that is fine alone can be incoherent beside its neighbour and the
   * administrator changing one has no reason to be looking at the other.
   */
  async set(key: string, value: unknown, scopeType: ScopeType = "INSTITUTE", scopeId?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const def = definitionFor(key);
    if (!def) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "key",
            code: "UNKNOWN_SETTING",
            message: `"${key}" is not a setting this System has. Nothing would read it.`,
          },
        ],
      });
    }

    if (scopeType !== "INSTITUTE" && !(def.overridableAt ?? []).includes(scopeType)) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "scopeType",
            code: "SCOPE_NOT_ALLOWED",
            message:
              `${key} is set for the whole Institute` +
              ((def.overridableAt ?? []).length
                ? `, or per ${(def.overridableAt ?? []).join(" or ").toLowerCase()}.`
                : " only."),
          },
        ],
      });
    }

    if (scopeType !== "INSTITUTE" && !scopeId) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          { field: "scopeId", code: "REQUIRED", message: `Name the ${scopeType.toLowerCase()}.` },
        ],
      });
    }

    const problems = validateValue(key, value);
    if (problems.length > 0) {
      throw new AppError("VALIDATION_FAILED", {
        details: problems.map((p) => ({ field: "value", code: "INVALID", message: p.message })),
      });
    }

    // Coherence is checked against what the set WOULD BE, not what it is.
    const stored = await this.stored();
    const would = resolveAll(
      [
        ...stored.filter(
          (s) => !(s.key === key && s.scopeType === scopeType && s.scopeId === (scopeId ?? null)),
        ),
        { key, value, scopeType, scopeId: scopeId ?? null },
      ],
      scopeId ? ({ [scopeType]: scopeId } as SettingContext) : {},
    );
    const incoherent = validateCoherence(would);
    if (incoherent.length > 0) {
      throw new AppError("VALIDATION_FAILED", {
        details: incoherent.map((p) => ({ field: "value", code: "INCOHERENT", message: p.message })),
      });
    }

    const before = resolve(key, stored, scopeId ? ({ [scopeType]: scopeId } as SettingContext) : {});

    // NOT upsert. The compound unique is (key, scopeType, scopeId) and scopeId
    // is NULL for an institute-wide setting — which is every setting, most of
    // the time. Prisma refuses null in a compound unique lookup, and it is
    // right to: SQL never matches NULL to NULL, so the lookup could not find
    // the row even if the client allowed it. An institute-scope write failed
    // outright with "Argument `scopeId` must not be null" while a section-scope
    // write, carrying a real id, succeeded.
    //
    // The same NULL rule means the constraint does not prevent DUPLICATE
    // institute rows either, so a partial unique index enforces that half
    // (migration 20260810_settings_unique_institute_scope).
    const saved = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const existing = await tx.setting.findFirst({
          where: { key, scopeType, scopeId: scopeId ?? null },
        });
        if (existing) {
          return tx.setting.update({
            where: { id: existing.id },
            data: { value: value as object, updatedBy: actor.userId },
          });
        }
        return tx.setting.create({
          data: {
            key,
            value: value as object,
            scopeType,
            scopeId: scopeId ?? null,
            isSecret: def.isSecret ?? false,
            updatedBy: actor.userId,
          },
        });
      }),
    );

    this.invalidate();

    await this.audit.record({
      action: "setting.change",
      entityType: "Setting",
      entityId: saved.id,
      // A secret's value never reaches the log either — the log is readable.
      before: def.isSecret ? { key, changed: true } : { key, value: before.value, source: before.source },
      after: def.isSecret ? { key, changed: true } : { key, value, scopeType, scopeId: scopeId ?? null },
    });

    this.logger.log(`Setting "${key}" changed at ${scopeType}${scopeId ? ` ${scopeId}` : ""}.`);

    return {
      key,
      ...(def.isSecret ? { isSet: true } : { value }),
      scopeType,
      scopeId: scopeId ?? null,
      // Said explicitly, because an administrator moving a threshold expects
      // something to happen to the students already past it.
      note: "This applies from now on. Decisions already made are unchanged.",
    };
  }

  /**
   * FR-CFG-005 — remove an override, restoring what it was overriding.
   *
   * Not "set it back to the default": deleting the row means the next change to
   * the institute value reaches this scope again, which setting an identical
   * value would not.
   */
  async clear(key: string, scopeType: ScopeType = "INSTITUTE", scopeId?: string) {
    if (!definitionFor(key)) throw new AppError("RESOURCE_NOT_FOUND");

    const existing = await this.prisma.asSystem((db) =>
      db.setting.findFirst({ where: { key, scopeType, scopeId: scopeId ?? null } }),
    );
    if (!existing) throw new AppError("RESOURCE_NOT_FOUND");

    await this.prisma.asSystem((db) => db.setting.delete({ where: { id: existing.id } }));
    this.invalidate();

    await this.audit.record({
      action: "setting.clear",
      entityType: "Setting",
      entityId: existing.id,
      before: { key, value: existing.value, scopeType, scopeId: scopeId ?? null },
      after: null,
    });

    const now = resolve(key, await this.stored(), scopeId ? ({ [scopeType]: scopeId } as SettingContext) : {});
    return {
      key,
      cleared: true,
      // What it fell back TO, which is the thing the administrator wants to see.
      value: now.value,
      source: now.source,
    };
  }
}
