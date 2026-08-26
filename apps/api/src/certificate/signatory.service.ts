import { Injectable, Logger } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

/**
 * WHO SIGNS A CERTIFICATE — FR-CRT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A LIBRARY, NOT A PAIR OF SETTINGS KEYS. Until now the foot of every
 * certificate carried exactly two names, one from `certificate.signatoryName`
 * and one from the subject's instructor, and neither could be changed without
 * either editing a setting or reassigning a teacher. An Institute with a
 * Principal, a Director and a Programme Head could not print all three, and a
 * promotion meant a developer.
 *
 * SNAPSHOTTED ONTO THE CERTIFICATE AT ISSUE, never read through afterwards.
 * That is the design decision that matters most here and it is easy to get
 * wrong: it is tempting to store the ids and resolve the names when the
 * document renders, which is one line shorter and quietly rewrites history —
 * the Principal retires, and every certificate she ever signed starts printing
 * her successor's name over her signature.
 *
 * DEACTIVATED RATHER THAN DELETED. Somebody who leaves stops appearing in the
 * picker and keeps appearing on the certificates they signed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The foot of the sheet holds four blocks. A fifth prints off the paper. */
export const MAX_SIGNATORIES = 4;

export interface SignatoryInput {
  name: string;
  designation: string;
  signatureAssetId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

/** What gets frozen onto a certificate. */
export interface SignatorySnapshot {
  name: string;
  designation: string;
  signatureAssetId: string | null;
}

@Injectable()
export class SignatoryService {
  private readonly logger = new Logger(SignatoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Everyone in the library, in the order they would print. */
  async list(includeInactive = true) {
    const rows = await this.prisma.scoped.signatory.findMany({
      where: { deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        designation: true,
        signatureAssetId: true,
        isActive: true,
        sortOrder: true,
      },
    });
    return rows;
  }

  async create(input: SignatoryInput) {
    await this.assertAssetExists(input.signatureAssetId);

    const created = await this.prisma.scoped.signatory.create({
      data: {
        name: input.name.trim(),
        designation: input.designation.trim(),
        signatureAssetId: input.signatureAssetId ?? null,
        isActive: input.isActive ?? true,
        // Appended rather than inserted at the front: somebody adding a fourth
        // name does not mean to reorder the three that are already right.
        sortOrder: input.sortOrder ?? (await this.nextOrder()),
      },
      select: { id: true, name: true, designation: true },
    });

    await this.audit.record({
      action: "signatory.create",
      entityType: "Signatory",
      entityId: created.id,
      after: { name: created.name, designation: created.designation },
    });
    return created;
  }

  async update(id: string, input: Partial<SignatoryInput>) {
    const before = await this.prisma.scoped.signatory.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, designation: true, isActive: true, signatureAssetId: true },
    });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND");
    if (input.signatureAssetId !== undefined) await this.assertAssetExists(input.signatureAssetId);

    const updated = await this.prisma.scoped.signatory.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.designation !== undefined ? { designation: input.designation.trim() } : {}),
        ...(input.signatureAssetId !== undefined
          ? { signatureAssetId: input.signatureAssetId }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
      select: { id: true, name: true, designation: true, isActive: true },
    });

    await this.audit.record({
      action: "signatory.update",
      entityType: "Signatory",
      entityId: id,
      before: { name: before.name, designation: before.designation, isActive: before.isActive },
      after: { name: updated.name, designation: updated.designation, isActive: updated.isActive },
    });
    return updated;
  }

  /**
   * Take somebody out of the library.
   *
   * SOFT, ALWAYS, AND NOT NEGOTIABLE. Certificates hold a snapshot rather than
   * a reference, so removing the row does not damage anything already issued —
   * but the row is also the record of who the Institute's signatories were,
   * and that is worth keeping for the same reason the certificates are.
   */
  async remove(id: string) {
    const row = await this.prisma.scoped.signatory.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!row) throw new AppError("RESOURCE_NOT_FOUND");

    await this.prisma.scoped.signatory.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.record({
      action: "signatory.delete",
      entityType: "Signatory",
      entityId: id,
      before: { name: row.name },
      after: { deleted: true },
    });
    this.logger.log(`signatory ${row.name} removed`);
    return { id, deleted: true };
  }

  /**
   * The panel to print on a certificate being issued now.
   *
   * `chosen` is what the person issuing picked. Empty or absent means "whoever
   * the Institute currently has", which is what a batch of thirty at the end
   * of term wants — nobody is choosing signatories thirty times.
   *
   * REFUSES AN UNKNOWN OR INACTIVE ID rather than quietly dropping it. A
   * certificate with two signatures where three were chosen is a certificate
   * somebody has to notice, and they will not.
   */
  async panelFor(chosen?: readonly string[] | null): Promise<SignatorySnapshot[]> {
    const active = await this.prisma.scoped.signatory.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, designation: true, signatureAssetId: true },
    });

    if (!chosen || chosen.length === 0) {
      return active.slice(0, MAX_SIGNATORIES).map(strip);
    }

    if (chosen.length > MAX_SIGNATORIES) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "signatoryIds",
            code: "TOO_MANY",
            message: `A certificate has room for ${MAX_SIGNATORIES} signatures. Choose no more than that.`,
          },
        ],
      });
    }

    const byId = new Map(active.map((s) => [s.id, s]));
    const panel: SignatorySnapshot[] = [];
    for (const id of chosen) {
      const found = byId.get(id);
      if (!found) {
        throw new AppError("VALIDATION_FAILED", {
          details: [
            {
              field: "signatoryIds",
              code: "NOT_AVAILABLE",
              message:
                "One of the people chosen to sign is no longer available. Refresh the list " +
                "and choose again.",
            },
          ],
        });
      }
      panel.push(strip(found));
    }
    // The order they were chosen in is the order they print, left to right.
    return panel;
  }

  private async nextOrder(): Promise<number> {
    const last = await this.prisma.scoped.signatory.findFirst({
      where: { deletedAt: null },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -1) + 1;
  }

  /**
   * A signature image has to exist before it is pointed at.
   *
   * The column is `ON DELETE SET NULL`, so a bad id would not break the
   * database — it would simply store a reference to nothing and print a name
   * with no signature over it, which nobody would notice until a certificate
   * came out wrong.
   */
  private async assertAssetExists(assetId?: string | null): Promise<void> {
    if (!assetId) return;
    const asset = await this.prisma.asSystem((db) =>
      db.mediaAsset.findUnique({ where: { id: assetId }, select: { id: true } }),
    );
    if (!asset) {
      throw new AppError("VALIDATION_FAILED", {
        details: [
          {
            field: "signatureAssetId",
            code: "NOT_FOUND",
            message: "That signature image could not be found. Upload it again.",
          },
        ],
      });
    }
  }
}

function strip(s: {
  name: string;
  designation: string;
  signatureAssetId: string | null;
}): SignatorySnapshot {
  return {
    name: s.name,
    designation: s.designation,
    signatureAssetId: s.signatureAssetId,
  };
}
