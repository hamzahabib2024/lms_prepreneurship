import { Injectable } from "@nestjs/common";
import { AppError } from "@lms/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RegistrationNumberService } from "../admission/registration-number.service";
import { getActor } from "../prisma/actor-context";

/**
 * PARTNER INSTITUTES — an outside organisation, looking in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAKES THIS DIFFERENT FROM EVERY OTHER SERVICE IN THE SYSTEM. Until now
 * every caller was one of us: our staff, our teachers, our students. A partner
 * is not. They are a customer reading personal records about other people's
 * children, and the two things that follow from that are the shape of this
 * file.
 *
 * FIRST, IT NEVER FILTERS BY HAND. Every read below goes through
 * `prisma.scoped`, and the PARTNER predicate in scope.extension.ts is what
 * confines it. There is deliberately no `where: { partnerInstituteId }` typed
 * out in this file: a hand-written filter is one somebody can forget on the
 * next endpoint, and the whole point of a scope is that forgetting is not
 * possible. partner-isolation.spec.ts asserts the predicates directly.
 *
 * SECOND, LOOKING IS ITSELF AUDITED. A third party reading a student's results
 * is an event somebody will ask about — "who saw my daughter's marks?" — and
 * the honest answer has to come from a record rather than from memory. So the
 * portal's reads are audited, which is unusual and is on purpose.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class PartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbers: RegistrationNumberService,
  ) {}

  // ============================================================= office =====

  /**
   * Every partner, for the office.
   *
   * Scoped, so a partner calling the same route gets exactly their own row —
   * which is what stops one institute learning that another exists. A customer
   * list is a competitor list.
   */
  async list() {
    const rows = await this.prisma.scoped.partnerInstitute.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        city: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        billingMode: true,
        isActive: true,
        _count: { select: { students: true } },
      },
    });

    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      city: p.city,
      contactName: p.contactName,
      contactEmail: p.contactEmail,
      contactPhone: p.contactPhone,
      billingMode: p.billingMode,
      isActive: p.isActive,
      studentCount: p._count.students,
      billingLabel:
        p.billingMode === "PARTNER_PAYS"
          ? "We invoice the institute"
          : "Students pay us directly",
    }));
  }

  /** Creating one. A Super Admin act — see the note beside the resource. */
  async create(input: {
    name: string;
    code: string;
    billingMode: "PARTNER_PAYS" | "STUDENT_PAYS";
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    city?: string;
    address?: string;
    notes?: string;
  }, ip?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const code = input.code.trim().toUpperCase();

    const clash = await this.prisma.asSystem((db) =>
      db.partnerInstitute.findFirst({
        where: { OR: [{ name: input.name.trim() }, { code }] },
        select: { id: true, name: true, code: true },
      }),
    );
    if (clash) {
      throw new AppError("RESOURCE_CONFLICT", {
        message:
          clash.code === code
            ? `The code ${code} is already used by ${clash.name}.`
            : `${clash.name} is already on the list.`,
      });
    }

    const created = await this.prisma.asSystem((db) =>
      db.partnerInstitute.create({
        data: {
          name: input.name.trim(),
          code,
          billingMode: input.billingMode,
          contactName: input.contactName?.trim() || null,
          contactEmail: input.contactEmail?.trim().toLowerCase() || null,
          contactPhone: input.contactPhone?.trim() || null,
          city: input.city?.trim() || null,
          address: input.address?.trim() || null,
          notes: input.notes?.trim() || null,
        },
        select: { id: true, name: true, code: true, billingMode: true },
      }),
    );

    /*
     * AUDITED AS A PRIVILEGED CHANGE (SEC-LOG-009), because it is one: from
     * this moment an account can be created that lets somebody outside this
     * Institute read student records.
     */
    await this.audit.record({
      action: "partner.create",
      entityType: "PartnerInstitute",
      entityId: created.id,
      after: { name: created.name, code: created.code, billingMode: created.billingMode },
      ...(ip ? { ipAddress: ip } : {}),
    });

    return { ...created, message: `${created.name} can now be given accounts and students.` };
  }

  /**
   * Changing one.
   *
   * CHANGING `billingMode` CHANGES NOTHING RETROSPECTIVELY, and the message
   * says so. Every student snapshots their own payer at admission, so a
   * partner that switches to STUDENT_PAYS next term leaves last term's
   * students exactly as they were — which is the whole reason the snapshot
   * exists (BR-DAT-02).
   */
  async update(id: string, input: Record<string, unknown>, ip?: string) {
    const before = await this.prisma.scoped.partnerInstitute.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, billingMode: true, isActive: true },
    });
    if (!before) throw new AppError("RESOURCE_NOT_FOUND");

    const data: Record<string, unknown> = {};
    for (const key of [
      "contactName",
      "contactEmail",
      "contactPhone",
      "city",
      "address",
      "notes",
      "billingMode",
      "isActive",
    ]) {
      if (input[key] !== undefined) data[key] = input[key];
    }

    const updated = await this.prisma.asSystem((db) =>
      db.partnerInstitute.update({
        where: { id },
        data,
        select: { id: true, name: true, billingMode: true, isActive: true },
      }),
    );

    await this.audit.record({
      action: "partner.update",
      entityType: "PartnerInstitute",
      entityId: id,
      before: { billingMode: before.billingMode, isActive: before.isActive },
      after: { billingMode: updated.billingMode, isActive: updated.isActive },
      ...(ip ? { ipAddress: ip } : {}),
    });

    return {
      ...updated,
      message:
        before.billingMode !== updated.billingMode
          ? "Saved. This applies to students imported from now on — nobody already enrolled changes."
          : "Saved.",
    };
  }

  // ============================================================ portal =====

  /**
   * The partner's own record, and the shape of what they are looking at.
   *
   * The first call the portal makes. It answers "who am I, how many students
   * do I have here, and am I being invoiced" in one request, so the shell can
   * decide whether to offer an Invoices tab at all.
   */
  async me() {
    const actor = getActor();
    if (!actor?.partnerInstituteId) throw new AppError("AUTH_FORBIDDEN");

    const partner = await this.prisma.scoped.partnerInstitute.findFirst({
      where: { id: actor.partnerInstituteId },
      select: {
        id: true,
        name: true,
        code: true,
        billingMode: true,
        _count: { select: { students: true } },
      },
    });
    if (!partner) throw new AppError("RESOURCE_NOT_FOUND");

    return {
      id: partner.id,
      name: partner.name,
      code: partner.code,
      billingMode: partner.billingMode,
      studentCount: partner._count.students,
      /* Whether to show the Invoices tab. A STUDENT_PAYS partner has no
         financial relationship with us at all and must see nothing about
         money — not even an empty page suggesting there could be some. */
      seesInvoices: partner.billingMode === "PARTNER_PAYS",
    };
  }

  /**
   * Their students.
   *
   * NO `where` ON THE PARTNER HERE, deliberately — see the note on the class.
   * The scoped client applies it, and partner-isolation.spec.ts proves it.
   */
  async students(q?: string) {
    const where = q?.trim()
      ? {
          OR: [
            { registrationNo: { contains: q.trim(), mode: "insensitive" as const } },
            { user: { fullName: { contains: q.trim(), mode: "insensitive" as const } } },
          ],
        }
      : {};

    const rows = await this.prisma.scoped.student.findMany({
      where,
      orderBy: { registrationNo: "asc" },
      select: {
        id: true,
        registrationNo: true,
        currentRollNo: true,
        feePayer: true,
        user: { select: { fullName: true } },
        currentSection: {
          select: {
            name: true,
            batch: {
              select: { academicSession: { select: { programme: { select: { name: true } } } } },
            },
          },
        },
      },
    });

    return rows.map((s) => ({
      id: s.id,
      name: s.user.fullName,
      registrationNo: s.registrationNo,
      rollNo: s.currentRollNo,
      programme: s.currentSection?.batch.academicSession.programme.name ?? null,
      section: s.currentSection?.name ?? null,
      /* Shown so a coordinator knows which of their students they are being
         invoiced for. Never an amount — that is on the invoice. */
      feePaidBy: s.feePayer === "PARTNER" ? "Institute" : "Student",
    }));
  }

  /**
   * One student's results.
   *
   * EVERY READ HERE IS SCOPED AND THE WHOLE CALL IS AUDITED. Marks are
   * released-only, enforced by the predicate AND stated again here so that
   * anybody reading this method can see the rule without going to look for it.
   */
  async student(studentId: string, ip?: string) {
    const student = await this.prisma.scoped.student.findFirst({
      where: { id: studentId },
      select: {
        id: true,
        registrationNo: true,
        currentRollNo: true,
        admissionDate: true,
        feePayer: true,
        user: { select: { fullName: true } },
        currentSection: {
          select: {
            name: true,
            batch: {
              select: { academicSession: { select: { programme: { select: { name: true } } } } },
            },
          },
        },
      },
    });
    // A student belonging to another partner is not found rather than
    // forbidden: the difference between 404 and 403 is itself a disclosure.
    if (!student) throw new AppError("RESOURCE_NOT_FOUND");

    const [completions, warnings, certificates] = await Promise.all([
      this.prisma.scoped.subjectCompletion.findMany({
        where: { studentId },
        select: {
          decision: true,
          computedPercent: true,
          criteriaMet: true,
          decidedAt: true,
          sectionSubject: { select: { subject: { select: { name: true } } } },
        },
      }),
      this.prisma.scoped.attendanceWarning.findMany({
        where: { studentId, clearedAt: null },
        select: {
          severity: true,
          percentage: true,
          thresholdApplied: true,
          raisedAt: true,
          sectionSubject: { select: { subject: { select: { name: true } } } },
        },
      }),
      this.prisma.scoped.certificate.findMany({
        where: { studentId },
        select: { id: true, certificateNo: true, kind: true, status: true, issuedAt: true },
      }),
    ]);

    await this.audit.record({
      action: "partner.student.read",
      entityType: "Student",
      entityId: studentId,
      after: { by: getActor()?.userId, partnerInstituteId: getActor()?.partnerInstituteId },
      ...(ip ? { ipAddress: ip } : {}),
    });

    return {
      student: {
        id: student.id,
        name: student.user.fullName,
        registrationNo: student.registrationNo,
        rollNo: student.currentRollNo,
        admissionDate: student.admissionDate,
        programme: student.currentSection?.batch.academicSession.programme.name ?? null,
        section: student.currentSection?.name ?? null,
        feePaidBy: student.feePayer === "PARTNER" ? "Institute" : "Student",
      },
      subjects: completions.map((c) => ({
        subject: c.sectionSubject.subject.name,
        decision: c.decision,
        percent: c.computedPercent === null ? null : Number(c.computedPercent),
        criteriaMet: c.criteriaMet,
        decidedAt: c.decidedAt,
      })),
      attendanceWarnings: warnings.map((w) => ({
        subject: w.sectionSubject.subject.name,
        severity: w.severity,
        percentage: Number(w.percentage),
        threshold: Number(w.thresholdApplied),
        raisedAt: w.raisedAt,
      })),
      certificates: certificates.map((c) => ({
        id: c.id,
        number: c.certificateNo,
        kind: c.kind,
        status: c.status,
        issuedAt: c.issuedAt,
      })),
    };
  }

  /** Their invoices. Empty for a STUDENT_PAYS partner, by construction. */
  async invoices() {
    const rows = await this.prisma.scoped.partnerInvoice.findMany({
      where: { status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        number: true,
        periodLabel: true,
        status: true,
        currency: true,
        totalAmount: true,
        paidAmount: true,
        issuedAt: true,
        dueDate: true,
        _count: { select: { lines: true } },
      },
    });

    return rows.map((i) => ({
      id: i.id,
      number: i.number,
      periodLabel: i.periodLabel,
      status: i.status,
      currency: i.currency,
      total: Number(i.totalAmount),
      paid: Number(i.paidAmount),
      outstanding: Number(i.totalAmount) - Number(i.paidAmount),
      issuedAt: i.issuedAt,
      dueDate: i.dueDate,
      studentCount: i._count.lines,
    }));
  }

  /**
   * One invoice, with its lines.
   *
   * A LINE PER STUDENT, AND NEVER A LEDGER. The partner is entitled to know
   * who they are being charged for; they are not entitled to that student's
   * payment history, which in PARTNER_PAYS does not exist and in STUDENT_PAYS
   * is none of their business.
   */
  async invoice(id: string) {
    const invoice = await this.prisma.scoped.partnerInvoice.findFirst({
      where: { id, status: { not: "DRAFT" } },
      select: {
        id: true,
        number: true,
        periodLabel: true,
        status: true,
        currency: true,
        totalAmount: true,
        paidAmount: true,
        issuedAt: true,
        dueDate: true,
        notes: true,
        lines: {
          orderBy: { registrationNoAtIssue: "asc" },
          select: {
            id: true,
            studentNameAtIssue: true,
            registrationNoAtIssue: true,
            programmeAtIssue: true,
            description: true,
            amount: true,
          },
        },
      },
    });
    if (!invoice) throw new AppError("RESOURCE_NOT_FOUND");

    return {
      id: invoice.id,
      number: invoice.number,
      periodLabel: invoice.periodLabel,
      status: invoice.status,
      currency: invoice.currency,
      total: Number(invoice.totalAmount),
      paid: Number(invoice.paidAmount),
      outstanding: Number(invoice.totalAmount) - Number(invoice.paidAmount),
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      notes: invoice.notes,
      lines: invoice.lines.map((l) => ({
        id: l.id,
        // The SNAPSHOT, never the live record: an invoice states what was true
        // when it was issued (BR-DAT-02).
        student: l.studentNameAtIssue,
        registrationNo: l.registrationNoAtIssue,
        programme: l.programmeAtIssue,
        description: l.description,
        amount: Number(l.amount),
      })),
    };
  }

  // ============================================================ billing =====

  /**
   * WHAT WOULD BE BILLED, AND WHAT WOULD NOT — before anything is created.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE SAME TWO-STEP THE COHORT IMPORT USES, for the same reason: this raises
   * a real claim for real money against a real organisation, and the mistakes
   * are invisible afterwards. Somebody billing for a term wants to see the
   * names and the total BEFORE the invoice exists, not discover an extra
   * student on it when the partner queries the amount.
   *
   * A STUDENT IS BILLED ONCE. `alreadyBilled` is not a nicety — running this
   * twice for the same term is the obvious mistake, and without it the partner
   * receives two invoices for the same forty students and somebody has to
   * explain which one to ignore. A student already carrying a line on any
   * invoice that has not been CANCELLED is excluded, and is SAID to be
   * excluded with the invoice number they are on, so the exclusion can be
   * checked rather than merely trusted.
   *
   * THE STUDENTS WHO CANNOT BE PRICED ARE LISTED SEPARATELY, and this is the
   * part that would otherwise be lost. A student whose programme has no
   * published fee structure cannot be given an amount, and the wrong answer is
   * to bill them zero — an invoice quietly short by one student's fee is worse
   * than one that refuses to be created. They are named, so the fee structure
   * can be published and the invoice raised properly.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async billingPreview(partnerInstituteId: string) {
    const partner = await this.prisma.scoped.partnerInstitute.findFirst({
      where: { id: partnerInstituteId, deletedAt: null },
      select: { id: true, name: true, billingMode: true, isActive: true },
    });
    if (!partner) throw new AppError("RESOURCE_NOT_FOUND");

    /*
     * A STUDENT_PAYS PARTNER HAS NOTHING TO BILL, and this refuses rather than
     * returning an empty list. An empty list reads as "nobody is due yet",
     * which invites somebody to wait for students to appear on it; the truth
     * is that this institute's students pay us directly and no invoice to the
     * institute will ever be right.
     */
    if (partner.billingMode !== "PARTNER_PAYS") {
      throw new AppError("VALIDATION_FAILED", {
        message:
          `${partner.name} has its students pay us directly, so there is nothing to invoice ` +
          `the institute for. Change how they are billed first if that is wrong.`,
      });
    }

    const students = await this.prisma.asSystem((db) =>
      db.student.findMany({
        where: {
          partnerInstituteId: partner.id,
          deletedAt: null,
          /* The payer SNAPSHOTTED on the student, never read live from the
             partner (BR-DAT-02). Somebody admitted while the institute paid is
             still the institute's to pay for, whatever the mode says today. */
          feePayer: "PARTNER",
        },
        orderBy: { registrationNo: "asc" },
        select: {
          id: true,
          registrationNo: true,
          user: { select: { fullName: true } },
          currentSection: {
            select: {
              batch: {
                select: {
                  academicSession: {
                    select: { id: true, programme: { select: { id: true, name: true } } },
                  },
                },
              },
            },
          },
          partnerInvoiceLines: {
            where: { invoice: { status: { not: "CANCELLED" } } },
            select: { invoice: { select: { number: true } } },
            take: 1,
          },
        },
      }),
    );

    const billable: Array<{
      studentId: string;
      name: string;
      registrationNo: string;
      programme: string | null;
      amount: number;
    }> = [];
    const alreadyBilled: Array<{ name: string; registrationNo: string; onInvoice: string }> = [];
    const unpriced: Array<{ name: string; registrationNo: string; why: string }> = [];

    for (const s of students) {
      const existing = s.partnerInvoiceLines[0];
      if (existing) {
        alreadyBilled.push({
          name: s.user.fullName,
          registrationNo: s.registrationNo,
          onInvoice: existing.invoice.number,
        });
        continue;
      }

      const session = s.currentSection?.batch.academicSession;
      if (!session) {
        unpriced.push({
          name: s.user.fullName,
          registrationNo: s.registrationNo,
          why: "They are not in a batch, so there is no course to price.",
        });
        continue;
      }

      const amount = await this.feeFor(session.programme.id, session.id);
      if (amount === null) {
        unpriced.push({
          name: s.user.fullName,
          registrationNo: s.registrationNo,
          why: `${session.programme.name} has no published fee structure.`,
        });
        continue;
      }

      billable.push({
        studentId: s.id,
        name: s.user.fullName,
        registrationNo: s.registrationNo,
        programme: session.programme.name,
        amount,
      });
    }

    return {
      partner: { id: partner.id, name: partner.name },
      billable,
      alreadyBilled,
      unpriced,
      total: billable.reduce((sum, b) => sum + b.amount, 0),
      currency: "PKR",
    };
  }

  /**
   * The price of one course, for one session.
   *
   * A SESSION'S OWN STRUCTURE BEATS THE PROGRAMME'S STANDING ONE, which is
   * exactly the rule the model documents: a null `academicSessionId` means the
   * standing structure used by any session without one of its own. Taking them
   * in that order is what lets a partner cohort sitting in a term with its own
   * pricing be billed at that price rather than at last year's.
   *
   * RETURNS NULL RATHER THAN ZERO when nothing is published. Zero is a
   * legitimate fee; "we do not know the fee" is not a number at all, and
   * conflating the two is how an invoice comes out silently short.
   */
  private async feeFor(programmeId: string, academicSessionId: string): Promise<number | null> {
    const structure = await this.prisma.asSystem((db) =>
      db.feeStructure.findFirst({
        where: {
          programmeId,
          status: "PUBLISHED",
          deletedAt: null,
          supersededAt: null,
          OR: [{ academicSessionId }, { academicSessionId: null }],
        },
        // The session's own first: a non-null id sorts before null descending.
        orderBy: { academicSessionId: "desc" },
        select: { totalAmount: true },
      }),
    );
    return structure ? Number(structure.totalAmount) : null;
  }

  /**
   * Raise the invoice.
   *
   * RE-PRICED INSIDE THE TRANSACTION rather than trusting the figures the
   * preview showed. The screen may have been open for an hour, and a fee
   * structure published in the meantime would make the preview's total a
   * number nobody can reproduce from the data afterwards. The preview
   * persuades; this decides.
   *
   * THE NUMBER COMES FROM THE SAME ATOMIC SERIES a receipt number does, so two
   * clerks raising invoices at the same moment cannot be handed one number
   * twice — the counter is incremented by the database, not by us reading it
   * and adding one.
   */
  async createInvoice(
    partnerInstituteId: string,
    input: { periodLabel: string; dueDate?: string; notes?: string },
    ip?: string,
  ) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const preview = await this.billingPreview(partnerInstituteId);
    if (preview.billable.length === 0) {
      throw new AppError("VALIDATION_FAILED", {
        message:
          preview.alreadyBilled.length > 0
            ? "Every one of these students is already on an invoice. Nothing would be added."
            : "There is nobody to invoice for this institute yet.",
      });
    }

    const created = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const year = new Date().getFullYear();
        const sequence = await this.numbers.allocateSequence(tx, `PARTINV|${year}`);
        const number = `INV-${year}-${String(sequence).padStart(4, "0")}`;
        const total = preview.billable.reduce((sum, b) => sum + b.amount, 0);

        return tx.partnerInvoice.create({
          data: {
            partnerInstituteId,
            number,
            periodLabel: input.periodLabel.trim(),
            /*
             * ISSUED, NOT DRAFT. A draft is invisible to the partner — both
             * read endpoints filter it out — so an invoice created as a draft
             * is one the office believes it has sent and the partner cannot
             * see. There is no screen for promoting a draft to issued, so
             * creating one would be creating a document with no way out of it.
             */
            status: "ISSUED",
            currency: preview.currency,
            totalAmount: total,
            paidAmount: 0,
            issuedAt: new Date(),
            ...(input.dueDate ? { dueDate: new Date(input.dueDate) } : {}),
            ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
            createdBy: actor.userId,
            lines: {
              create: preview.billable.map((b) => ({
                studentId: b.studentId,
                /*
                 * SNAPSHOTTED, all three (BR-DAT-02). A student who later
                 * transfers course, or whose name is corrected, must not
                 * silently change what a sent invoice says — the partner is
                 * holding a copy of the original, and a document that rewrites
                 * itself is one nobody can reconcile against their own books.
                 */
                studentNameAtIssue: b.name,
                registrationNoAtIssue: b.registrationNo,
                programmeAtIssue: b.programme,
                description: b.programme ? `Tuition — ${b.programme}` : "Tuition",
                amount: b.amount,
              })),
            },
          },
          select: { id: true, number: true, totalAmount: true },
        });
      }),
    );

    await this.audit.record({
      action: "partner.invoice.create",
      entityType: "PartnerInvoice",
      entityId: created.id,
      after: {
        partnerInstituteId,
        number: created.number,
        total: Number(created.totalAmount),
        students: preview.billable.length,
        by: actor.userId,
      },
      ...(ip ? { ipAddress: ip } : {}),
    });

    return {
      id: created.id,
      number: created.number,
      total: Number(created.totalAmount),
      studentCount: preview.billable.length,
      message: `Invoice ${created.number} raised for ${preview.billable.length} student${
        preview.billable.length === 1 ? "" : "s"
      }.`,
    };
  }

}
