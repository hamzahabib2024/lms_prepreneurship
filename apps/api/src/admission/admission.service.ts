import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomInt } from "node:crypto";
import {
  AppError,
  buildPagination,
  clampPageSize,
  type RegistrationApproveInput,
  type RegistrationRejectInput,
  type RegistrationSubmitInput,
} from "@lms/shared";
import type { AcquisitionSource, Prisma, RegistrationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthService } from "../auth/auth.service";
import { ActorService } from "../auth/actor.service";
import { getActor } from "../prisma/actor-context";
import { RegistrationNumberService } from "./registration-number.service";
import { StorageRegistry } from "../content/storage/storage.registry";
import { SettingsService } from "../settings/settings.service";
import { parseImageLinks, parseVideoLinks } from "./video-links";
import { parseFeatures } from "../public-page/public-page.keys";
import { AdmissionMailer } from "./admission-mailer";
import { CredentialsMailer } from "../notification/credentials-mailer";

/** Unambiguous alphabet — no O/0, I/l/1 — because these are read aloud
 *  over WhatsApp and mis-transcribed characters generate support calls. */
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

@Injectable()
export class AdmissionService {
  private readonly logger = new Logger(AdmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly actors: ActorService,
    private readonly numbers: RegistrationNumberService,
    private readonly storage: StorageRegistry,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly mailer: AdmissionMailer,
    // For the public base URL only. One implementation of "where is this
    // System reachable", shared with every other email that carries a link.
    private readonly credentials: CredentialsMailer,
  ) {}

  /**
   * What the public page shows besides the prospectus — FR-PUB.
   *
   * Videos and social links, typed by the Institute into Settings so a new reel
   * does not need a deployment. Everything here is already published elsewhere
   * by the Institute; there is nothing about any person in it, which is the
   * test for anything served without an account.
   */
  async showcase() {
    /*
     * ONE RESOLUTION, NOT TWENTY-FOUR AWAITS.
     *
     * This used to be nine parallel calls, each of which resolved the whole
     * settings map to pull one value out of it. The page now carries its own
     * headline, its paragraph, its six feature cards, four section headings
     * and two buttons — so the same pattern would have meant two dozen
     * resolutions of the same cached map per visitor, on the one route in this
     * System that is hit by people who have never signed in.
     *
     * `resolveFor()` returns that map once, from the same per-process cache the
     * rest of the System reads. Each value is checked for its type on the way
     * out, so a row stored as the wrong shape costs one sentence rather than
     * rendering "[object Object]" across the Institute's front page.
     */
    const [resolved, news] = await Promise.all([this.settings.resolveFor(), this.publicNews()]);

    /*
     * EVERY KEY IS WRITTEN OUT AS A LITERAL INDEX, and that is not verbosity.
     *
     * settings-used.spec.ts reads this source and asserts that every settings
     * key the code reads is one the catalogue declares — the guard that stops a
     * misspelled key from falling back to a default forever while the Institute
     * cannot find the setting to change. It recognises a quoted key indexed
 * straight off the resolved map, and only that shape. A
     * helper taking the key as an argument would hide all seventeen of these
     * from it, and a typo in one would show an empty headline on the front page
     * with nothing anywhere saying why.
     *
     * So the helpers take the VALUE, not the key.
     */
    const str = (value: unknown, fallback = ""): string =>
      typeof value === "string" ? value : fallback;
    const bool = (value: unknown, fallback: boolean): boolean =>
      typeof value === "boolean" ? value : fallback;
    const strings = (value: unknown): string[] =>
      Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : [];

    return {
      instituteName: str(resolved["institute.name"]),
      tagline: str(resolved["public.tagline"]).trim() || null,
      videos: parseVideoLinks(strings(resolved["public.videoUrls"])),
      images: parseImageLinks(strings(resolved["public.imageUrls"])),
      news,
      /*
       * THE WORDS, which were literals in the React component until the
       * Institute was given a screen to change them.
       *
       * Sent as one object rather than spread across the top level so the
       * landing page holds it in one piece of state, and so a value the
       * Institute has never touched arrives identical to the one that used to
       * be compiled in — the catalogue's defaults ARE the previous markup.
       */
      copy: {
        heroPill: str(resolved["public.heroPill"]),
        heroHeadline: str(resolved["public.heroHeadline"]),
        heroBody: str(resolved["public.heroBody"]),
        heroPrimaryCta: str(resolved["public.heroPrimaryCta"]),
        heroSecondaryCta: str(resolved["public.heroSecondaryCta"]),
        showStats: bool(resolved["public.showStats"], true),
        showFeatures: bool(resolved["public.showFeatures"], true),
        features: parseFeatures(strings(resolved["public.features"])),
        videosHeading: str(resolved["public.videosHeading"]),
        videosBlurb: str(resolved["public.videosBlurb"]),
        newsHeading: str(resolved["public.newsHeading"]),
        newsBlurb: str(resolved["public.newsBlurb"]),
        programmesHeading: str(resolved["public.programmesHeading"]),
        programmesBlurb: str(resolved["public.programmesBlurb"]),
        closingHeading: str(resolved["public.closingHeading"]),
        closingBody: str(resolved["public.closingBody"]),
        closingCta: str(resolved["public.closingCta"]),
      },
      // Only the ones actually set: an icon linking nowhere is worse than no
      // icon, and a row of dead social buttons is the mark of a template.
      social: [
        { platform: "youtube", url: str(resolved["public.youtubeUrl"]).trim() },
        { platform: "tiktok", url: str(resolved["public.tiktokUrl"]).trim() },
        { platform: "facebook", url: str(resolved["public.facebookUrl"]).trim() },
        { platform: "instagram", url: str(resolved["public.instagramUrl"]).trim() },
      ].filter((s) => s.url !== ""),
    };
  }

  /**
   * The Institute's news, for people with no account — FR-PUB.
   *
   * REAL ANNOUNCEMENTS, not a second list somebody has to remember to update.
   * A separate "news" table would drift from what the Institute actually told
   * its students, and the front page would show last term's notice forever.
   *
   * The filter is the whole security of this. isPublic is opt-in per
   * announcement and the database refuses it on anything but an INSTITUTE
   * audience, so a notice addressed to one section cannot reach here even by
   * mistake. Expired ones drop off by themselves, because an event that has
   * happened is not news and a stale front page is worse than a bare one.
   */
  private async publicNews() {
    const rows = await this.prisma.asSystem((db) =>
      db.announcement.findMany({
        where: {
          isPublic: true,
          audience: "INSTITUTE",
          deletedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }],
        take: 6,
        // Deliberately narrow. Not the author, not the audience, not the id of
        // anything — a stranger gets the notice and the date it was posted.
        select: { id: true, title: true, body: true, publishedAt: true, isPinned: true },
      }),
    );
    return rows;
  }

  // ============================================================ UC-01 ======

  /**
   * Public application submission — FR-REG-001..021.
   *
   * Unauthenticated by design (SEC-AUT-001): most applicants reach this from a
   * Meta advertisement on a phone and have no account yet.
   */
  /**
   * FR-REG-002 — the prospectus a stranger sees.
   *
   * Unscoped by necessity: there is no actor. This is one of the four
   * legitimate bypasses, and the protection is in WHAT IS SELECTED rather than
   * in who is asking — no counts, no names, no capacity.
   *
   * Only sections a person could actually join: PLANNED or ACTIVE, and
   * belonging to a session that has not finished. Listing a section that
   * closed last year gives an applicant a choice the approval step will then
   * refuse, which is a worse experience than not offering it.
   */
  async prospectus() {
    const programmes = await this.prisma.asSystem((db) =>
      db.programme.findMany({
        where: { isActive: true, deletedAt: null },
        select: {
          id: true,
          name: true,
          code: true,
          description: true,
          durationWeeks: true,
          thumbnailAssetId: true,
          sessions: {
            where: { deletedAt: null },
            select: {
              id: true,
              name: true,
              batches: {
                where: { deletedAt: null },
                select: {
                  sections: {
                    where: { status: { in: ["PLANNED", "ACTIVE"] }, deletedAt: null },
                    select: {
                      id: true,
                      name: true,
                      code: true,
                      shift: true,
                      genderRestriction: true,
                    },
                    orderBy: { name: "asc" },
                  },
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      }),
    );

    /*
     * THE FEE, WITH THE PROSPECTUS — FR-PAY-033.
     *
     * Until now the application form asked "the amount you paid" and the
     * System had no idea what that should be: fees existed only as charges
     * raised against students who were ALREADY enrolled. An applicant was
     * asked to transfer a number nobody had told them, and the office found
     * out whether they had guessed right by reading the slip afterwards. Every
     * AMOUNT_INSUFFICIENT rejection is a consequence of that.
     *
     * ONE QUERY FOR ALL OF THEM, not one per programme. The prospectus is the
     * busiest unauthenticated route in the System, and a per-programme lookup
     * is a database round trip per card on the landing page.
     *
     * PUBLISHED ONLY, never a draft. An administrator part-way through next
     * year's fee table must not have it quoted to the public; that is the
     * whole reason the status column exists.
     */
    const fees = await this.prisma.asSystem((db) =>
      db.feeStructure.findMany({
        where: {
          status: "PUBLISHED",
          deletedAt: null,
          supersededAt: null,
          programmeId: { in: programmes.map((p) => p.id) },
        },
        select: {
          programmeId: true,
          academicSessionId: true,
          currency: true,
          totalAmount: true,
          dueAtApplication: true,
          notes: true,
          lines: {
            select: { kind: true, label: true, amount: true, dueAfterDays: true, sortOrder: true },
          },
        },
      }),
    );

    // A session-specific structure beats the programme's standing one. Both can
    // be published at once — that is the point of the nullable session id — so
    // the more specific has to win rather than whichever the query returned first.
    const feeFor = new Map<string, (typeof fees)[number]>();
    for (const f of fees) {
      const held = feeFor.get(f.programmeId);
      if (!held || (held.academicSessionId === null && f.academicSessionId !== null)) {
        feeFor.set(f.programmeId, f);
      }
    }

    return programmes
      .map((p) => {
        const fee = feeFor.get(p.id);
        return {
          id: p.id,
          name: p.name,
          code: p.code,
          description: p.description,
          durationWeeks: p.durationWeeks,
          // The URL, not the id. A landing page should not have to know how
          // this System addresses its own files.
          thumbnailUrl: p.thumbnailAssetId
            ? `/api/v1/public/course-media/${p.thumbnailAssetId}`
            : null,
          /*
           * NULL WHEN NO FEE IS PUBLISHED, rather than a zero.
           *
           * "Rs 0" is a price, and it is one no institute charges. A programme
           * whose fee has not been set yet must say so — the apply page then
           * tells the applicant to ask the office, which is true, instead of
           * inviting them to transfer nothing.
           */
          fee: fee
            ? {
                currency: fee.currency,
                totalAmount: Number(fee.totalAmount),
                dueAtApplication: Number(fee.dueAtApplication),
                notes: fee.notes,
                components: fee.lines
                  .filter((l) => l.kind === "COMPONENT")
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((l) => ({ label: l.label, amount: Number(l.amount) })),
                instalments: fee.lines
                  .filter((l) => l.kind === "INSTALMENT")
                  .sort(
                    (a, b) =>
                      (a.dueAfterDays ?? 0) - (b.dueAfterDays ?? 0) || a.sortOrder - b.sortOrder,
                  )
                  .map((l) => ({
                    label: l.label,
                    amount: Number(l.amount),
                    dueAfterDays: l.dueAfterDays ?? 0,
                  })),
              }
            : null,
          sections: p.sessions.flatMap((session) =>
            session.batches.flatMap((batch) =>
              batch.sections.map((sec) => ({
                id: sec.id,
                name: sec.name,
                code: sec.code,
                shift: sec.shift,
                genderRestriction: sec.genderRestriction,
                session: session.name,
              })),
            ),
          ),
        };
      })
      // A programme with nowhere to enrol is not on offer, whatever the
      // prospectus says.
      .filter((p) => p.sections.length > 0);
  }

  /**
   * Where to send the money — FR-REG-007.
   *
   * THE OTHER HALF OF THE FEE, and the half that was missing altogether.
   * Knowing a course costs 90,000 is useless without an account to pay it
   * into, and the application form has been telling applicants to "pay the fee
   * into the Institute's account" without ever naming one. In practice they
   * telephoned to ask, which is the support call this removes.
   *
   * FROM SETTINGS, so the Institute can change bank without a deployment, and
   * every field is optional — an institute that takes cash at the desk fills
   * in the instructions and leaves the account blank.
   */
  async paymentDetails() {
    const [bankName, accountName, accountNumber, iban, instructions] = await Promise.all([
      this.settings.text("finance.bankName"),
      this.settings.text("finance.bankAccountName"),
      this.settings.text("finance.bankAccountNumber"),
      this.settings.text("finance.bankIban"),
      this.settings.text("finance.paymentInstructions"),
    ]);

    return {
      bankName: bankName.trim() || null,
      accountName: accountName.trim() || null,
      accountNumber: accountNumber.trim() || null,
      iban: iban.trim() || null,
      instructions: instructions.trim() || null,
      // So the page can say "ask the office" rather than rendering an empty
      // panel that looks like it failed to load.
      configured: Boolean(accountNumber.trim() || iban.trim() || instructions.trim()),
    };
  }

  async submit(input: RegistrationSubmitInput, campaignRef?: Record<string, unknown>) {
    const submitted = await this.prisma.asSystem(async (db) => {
      // FR-REG-016 — a probable duplicate returns the EXISTING application's
      // status rather than creating a second record. Re-submitting because the
      // first attempt seemed not to work is normal applicant behaviour, not an
      // error to punish.
      const existing = await db.registrationRequest.findFirst({
        where: {
          deletedAt: null,
          status: { in: ["PENDING_REVIEW", "UNDER_REVIEW", "NEEDS_INFO"] },
          OR: [
            { nationalId: input.nationalId },
            { email: input.email },
            { phone: input.phone },
          ],
        },
        select: { trackingRef: true, status: true, createdAt: true },
      });

      if (existing) {
        return {
          duplicate: true as const,
          trackingRef: existing.trackingRef,
          status: existing.status,
          submittedAt: existing.createdAt,
          email: input.email,
          message:
            "We already have an application from you. Use the reference below to check its status.",
        };
      }

      const trackingRef = await this.generateTrackingRef(db);

      const created = await db.registrationRequest.create({
        data: {
          trackingRef,
          status: "PENDING_REVIEW",
          fullName: input.fullName,
          fatherName: input.fatherName,
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          nationalId: input.nationalId,
          phone: input.phone,
          phoneIsWhatsapp: input.phoneIsWhatsapp,
          altPhone: input.altPhone ?? null,
          email: input.email,
          address: input.address,
          city: input.city,
          educationLevel: input.educationLevel,
          qualification: input.qualification,
          occupation: input.occupation ?? null,
          desiredProgrammeId: input.desiredProgrammeId,
          desiredSectionId: input.desiredSectionId,
          acquisitionSource: input.acquisitionSource,
          acquisitionDetail: input.acquisitionDetail ?? null,
          // FR-REG-006/007 — captured without applicant action so advertising
          // spend can be attributed to enrolment (OBJ-07).
          campaignRef: (campaignRef ?? {}) as object,
          claimedAmount: input.claimedAmount,
          claimedPaymentDate: input.claimedPaymentDate,
          claimedBankRef: input.claimedBankRef ?? null,
          consentVersion: input.consentVersion, // SEC-PRV-003
          consentAt: new Date(),
        },
        select: { id: true, trackingRef: true, createdAt: true },
      });

      // Attach the already-uploaded slips to this application.
      //
      // THIS PREVIOUSLY DID NOTHING. It matched documents whose
      // registrationRequestId was ALREADY this request — impossible, the
      // request had just been created — and then set `data: {}`, which is no
      // change. Every application was filed with no slips attached, and the
      // reviewer had nothing to verify the payment against.
      //
      // `registrationRequestId: null` is the security half: a slip id is
      // handed to whoever uploaded it, and claiming only UNATTACHED slips
      // means a guessed id cannot staple somebody else's bank slip to this
      // application.
      const attached = await db.registrationDocument.updateMany({
        where: { id: { in: input.documentIds }, registrationRequestId: null },
        data: { registrationRequestId: created.id },
      });

      if (attached.count === 0) {
        // FR-REG-008 requires at least one. Reaching here means every id named
        // was already claimed or never existed, and an application with no
        // proof of payment cannot be reviewed.
        throw new AppError("VALIDATION_FAILED", {
          message: "The payment slips could not be attached to this application.",
          details: [
            {
              field: "documentIds",
              code: "NOT_AVAILABLE",
              message:
                "Please upload the slip again — the previous upload has expired or was already used.",
            },
          ],
        });
      }

      await this.audit.record(
        {
          action: "registration.submit",
          entityType: "RegistrationRequest",
          entityId: created.id,
          after: { trackingRef: created.trackingRef, status: "PENDING_REVIEW" },
        },
        db as unknown as Parameters<AuditService["record"]>[1],
      );

      return {
        duplicate: false as const,
        trackingRef: created.trackingRef,
        status: "PENDING_REVIEW" as const,
        submittedAt: created.createdAt,
        email: input.email,
        message:
          "Your application has been received. We usually review payment within 48 hours " +
          "and will email you the outcome.",
      };
    });

    /*
     * FR-REG-018 — the reference, emailed.
     *
     * AFTER the transaction, deliberately. Sending inside it would hold a
     * database transaction open across a network call to a mail server, and a
     * slow SMTP handshake would then hold locks on the registration tables
     * while the next applicant waits.
     *
     * NOT AWAITED INTO THE RESULT either: an application that has been
     * accepted has been accepted. The reference is on the screen in front of
     * them regardless, which is why that screen tells them to write it down.
     *
     * A DUPLICATE IS NOT EMAILED, and that is a security decision rather than
     * a courtesy. The duplicate test above matches on national id OR email OR
     * phone, so a submission carrying a DIFFERENT email address can match
     * somebody else's application by phone or CNIC — and mailing the existing
     * reference to the address that was just typed would hand a stranger a
     * reference they can use to read that applicant's name, programme and
     * status. The reference goes to the address that owns it, once, or to the
     * screen of whoever already knows the details.
     */
    if (!submitted.duplicate) {
      const posted = await this.mailer.sendTrackingReference({
        to: submitted.email,
        fullName: input.fullName,
        trackingRef: submitted.trackingRef,
        // FR-REG-020 — the reference is only useful with somewhere to type it.
        // Before this the email said "you can check at any time" and named no
        // way to, which is the whole complaint the tracking page answers.
        trackUrl: `${this.credentials.signInUrl()}/track/${submitted.trackingRef}`,
      });
      return { ...submitted, emailSent: posted.sent };
    }

    return submitted;
  }

  /**
   * Public status lookup — FR-REG-020.
   *
   * SEC-PRV-012: discloses only the state, when it last changed, and any
   * message directed at the applicant. Nothing else, because this endpoint is
   * unauthenticated and a tracking reference is not a credential.
   */
  async publicStatus(trackingRef: string) {
    const req = await this.prisma.asSystem((db) =>
      db.registrationRequest.findUnique({
        where: { trackingRef },
        select: {
          status: true,
          updatedAt: true,
          decisionNote: true,
          decisionReasonCode: true,
        },
      }),
    );

    if (!req) throw new AppError("RESOURCE_NOT_FOUND");

    return {
      status: req.status,
      lastUpdatedAt: req.updatedAt,
      message: req.decisionNote ?? null,
      reasonCode: req.status === "REJECTED" ? req.decisionReasonCode : null,
    };
  }

  // ============================================================ queue ======

  /** FR-REG-022/023 — the review queue, oldest first. */
  async listQueue(params: {
    status?: string;
    sectionId?: string;
    source?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = clampPageSize(params.pageSize);

    const where: Prisma.RegistrationRequestWhereInput = {
      deletedAt: null,
      status: params.status
        ? (params.status as RegistrationStatus)
        : { in: ["PENDING_REVIEW", "UNDER_REVIEW", "NEEDS_INFO"] },
      ...(params.sectionId ? { desiredSectionId: params.sectionId } : {}),
      ...(params.source ? { acquisitionSource: params.source as AcquisitionSource } : {}),
      ...(params.q
        ? {
            OR: [
              { fullName: { contains: params.q, mode: "insensitive" } },
              { trackingRef: { contains: params.q, mode: "insensitive" } },
              { nationalId: { contains: params.q } },
              { email: { contains: params.q, mode: "insensitive" } },
              { phone: { contains: params.q } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.scoped.registrationRequest.findMany({
        where,
        orderBy: { createdAt: "asc" }, // oldest first — nobody waits unnoticed
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          trackingRef: true,
          status: true,
          fullName: true,
          gender: true,
          phone: true,
          email: true,
          claimedAmount: true,
          acquisitionSource: true,
          createdAt: true,
          claimedByUserId: true,
          claimedUntil: true,
          desiredSection: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.scoped.registrationRequest.count({ where }),
    ]);

    const overdueHours = Number(this.config.get<string>("REG_OVERDUE_HOURS", "48"));
    const now = Date.now();

    return {
      data: rows.map((r: (typeof rows)[number]) => ({
        ...r,
        // FR-REG-038 — surface the ones that have been waiting too long.
        isOverdue: now - r.createdAt.getTime() > overdueHours * 3_600_000,
        isClaimed: !!r.claimedUntil && r.claimedUntil > new Date(),
      })),
      pagination: buildPagination(page, pageSize, total),
      appliedFilters: params,
    };
  }

  /**
   * FR-REG-026 — claim for review, so two administrators cannot act on the
   * same application. The claim expires, so an administrator who closes their
   * laptop does not block the queue indefinitely.
   */
  /**
   * FR-REG-025 — one application, as the reviewer sees it.
   *
   * THE QUEUE LIST DELIBERATELY DOES NOT CARRY DOCUMENTS — fifty applications
   * do not need fifty slips in one payload — so without this the reviewer
   * could see that an application existed and never see the payment slip it
   * turns on. That is the whole decision they are being asked to make.
   */
  async detail(id: string) {
    const request = await this.prisma.scoped.registrationRequest.findFirst({
      where: { id, deletedAt: null },
      include: {
        desiredProgramme: { select: { id: true, name: true, code: true } },
        desiredSection: { select: { id: true, name: true, code: true } },
        documents: {
          // The scope predicate does NOT reach into a nested include, so the
          // child policy is restated here (see scope.extension.ts). It is
          // redundant in practice — the parent request has already been
          // scoped, so its documents are by definition ones this caller may
          // see — but "redundant today" is how a nested include becomes a leak
          // the day the parent's policy widens.
          where: { registrationRequestId: id },
          select: {
            id: true,
            documentType: true,
            originalFilename: true,
            contentType: true,
            sizeBytes: true,
            scanStatus: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!request) throw new AppError("RESOURCE_NOT_FOUND");

    return {
      ...request,
      // BigInt does not survive JSON, and a slip whose size renders as
      // "[object Object]" reads as a broken file rather than a large one.
      documents: request.documents.map((d) => ({
        ...d,
        sizeBytes: Number(d.sizeBytes),
      })),
    };
  }

  /**
   * FR-REG-024 — the slip itself.
   *
   * Streamed through the API rather than handed out as a storage URL
   * (SEC-FIL-009): the object is somebody's bank record, and a URL that works
   * without a session is a URL that works after it ends.
   *
   * Scoped through the request, not the document: asking for a slip you may
   * not see must fail because the APPLICATION is not yours to read, which is
   * the same rule the queue is under.
   */
  async slip(requestId: string, documentId: string) {
    const request = await this.prisma.scoped.registrationRequest.findFirst({
      where: { id: requestId, deletedAt: null },
      select: { id: true },
    });
    if (!request) throw new AppError("RESOURCE_NOT_FOUND");

    const doc = await this.prisma.asSystem((db) =>
      db.registrationDocument.findFirst({
        where: { id: documentId, registrationRequestId: request.id },
        select: { storageKey: true, contentType: true, originalFilename: true },
      }),
    );
    if (!doc) throw new AppError("RESOURCE_NOT_FOUND");

    const body = await this.storage.forDocuments().get(doc.storageKey);
    return { body, contentType: doc.contentType, filename: doc.originalFilename };
  }

  async claim(id: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const minutes = Number(this.config.get<string>("REG_CLAIM_MINUTES", "30"));

    return this.prisma.asSystem(async (db) => {
      const now = new Date();

      // Conditional update: succeeds only if unclaimed, or claimed by us, or
      // the previous claim has lapsed. Doing it as one statement means two
      // administrators racing cannot both win.
      const result = await db.registrationRequest.updateMany({
        where: {
          id,
          status: { in: ["PENDING_REVIEW", "UNDER_REVIEW", "NEEDS_INFO"] },
          OR: [
            { claimedByUserId: null },
            { claimedByUserId: actor.userId },
            { claimedUntil: { lt: now } },
          ],
        },
        data: {
          status: "UNDER_REVIEW",
          claimedByUserId: actor.userId,
          claimedUntil: new Date(now.getTime() + minutes * 60_000),
        },
      });

      if (result.count === 0) {
        const holder = await db.registrationRequest.findUnique({
          where: { id },
          select: { claimedByUserId: true, claimedUntil: true, status: true },
        });
        if (!holder) throw new AppError("RESOURCE_NOT_FOUND");
        if (["APPROVED", "REJECTED", "WITHDRAWN"].includes(holder.status)) {
          throw new AppError("RESOURCE_CONFLICT", {
            message: "This application has already been decided.",
          });
        }
        const by = holder.claimedByUserId
          ? await db.user.findUnique({
              where: { id: holder.claimedByUserId },
              select: { fullName: true },
            })
          : null;
        throw new AppError("REGISTRATION_ALREADY_CLAIMED", {
          message: by
            ? `${by.fullName} is reviewing this application.`
            : "Another administrator is reviewing this application.",
        });
      }

      return { claimed: true, until: new Date(now.getTime() + minutes * 60_000) };
    });
  }

  async releaseClaim(id: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");
    await this.prisma.asSystem((db) =>
      db.registrationRequest.updateMany({
        where: { id, claimedByUserId: actor.userId },
        data: { claimedByUserId: null, claimedUntil: null, status: "PENDING_REVIEW" },
      }),
    );
  }

  // ============================================================ UC-02 ======

  /**
   * Approve and provision — FR-REG-039, the System's most consequential
   * transaction.
   *
   * BR-REG-09: everything below happens in ONE transaction. If any step fails
   * the whole approval rolls back, the request stays PENDING_REVIEW, and no
   * registration number is consumed — the sequence increment rolls back with
   * everything else.
   */
  async approve(id: string, input: RegistrationApproveInput, ip?: string, userAgent?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const tempPassword = this.generateTempPassword();
    const passwordHash = await this.auth.hashPassword(tempPassword);
    const format = await this.numbers.resolveFormat();

    const result = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        // -- 0. Serialise concurrent approvals into this section ------------
        // Without the lock, two administrators can both pass the capacity
        // check and both claim the same roll number.
        await this.numbers.lockSection(tx, input.sectionId);

        const req = await tx.registrationRequest.findUnique({
          where: { id },
          include: { desiredProgramme: true },
        });
        if (!req) throw new AppError("RESOURCE_NOT_FOUND");
        if (req.status === "APPROVED") {
          throw new AppError("RESOURCE_CONFLICT", {
            message: "This application has already been approved.",
          });
        }
        if (["REJECTED", "WITHDRAWN"].includes(req.status)) {
          throw new AppError("RESOURCE_CONFLICT", {
            message: "This application has already been closed.",
          });
        }
        if (req.claimedByUserId && req.claimedByUserId !== actor.userId && req.claimedUntil && req.claimedUntil > new Date()) {
          throw new AppError("REGISTRATION_ALREADY_CLAIMED");
        }

        // -- 1. Section eligibility ----------------------------------------
        const section = await tx.section.findUnique({
          where: { id: input.sectionId },
          include: {
            batch: { include: { academicSession: { include: { programme: true } } } },
            sectionSubjects: {
              where: { isCompulsory: true, status: { in: ["PLANNED", "ACTIVE"] } },
              select: { id: true },
            },
          },
        });
        if (!section) {
          throw new AppError("VALIDATION_FAILED", {
            details: [
              { field: "sectionId", code: "NOT_FOUND", message: "That section does not exist." },
            ],
          });
        }

        // FR-CRS-009 / BR-ENR-05 — absolute. There is deliberately no
        // override path for this, unlike capacity.
        if (
          section.genderRestriction !== "MIXED" &&
          section.genderRestriction !== req.gender
        ) {
          throw new AppError("SECTION_GENDER_RESTRICTED", {
            message: `${section.name} admits ${section.genderRestriction.toLowerCase()} students only.`,
          });
        }

        // FR-REG-031 / BR-ENR-04 — capacity warns and requires an explicit,
        // audited override rather than being silently exceeded.
        if (section.enrolledCount >= section.capacity && !input.capacityOverride) {
          throw new AppError("SECTION_AT_CAPACITY", {
            message: `${section.name} is full (${section.enrolledCount} of ${section.capacity}).`,
            details: [
              {
                field: "sectionId",
                code: "AT_CAPACITY",
                message: `capacity ${section.capacity}, enrolled ${section.enrolledCount}`,
              },
            ],
          });
        }

        // FR-REG-028 — a variance between claim and verification needs a reason.
        if (
          Number(req.claimedAmount) !== Number(input.payment.verifiedAmount) &&
          !input.payment.varianceReason
        ) {
          throw new AppError("VALIDATION_FAILED", {
            details: [
              {
                field: "payment.varianceReason",
                code: "REQUIRED",
                message:
                  `The verified amount (${input.payment.verifiedAmount}) differs from the ` +
                  `claimed amount (${req.claimedAmount}). Record why.`,
              },
            ],
          });
        }

        // -- 2. Is this somebody we already have? --------------------------
        //
        // A student may take MORE THAN ONE COURSE, and when they do they keep
        // the account and the registration number they already hold. Without
        // this the approval simply failed: User.email is unique, so a returning
        // student's second admission collided and an administrator was told
        // "duplicate resource" with no way forward.
        //
        // Matched on email, which is what the applicant used to apply and what
        // they sign in with. National id is a stronger identifier but is
        // optional on the form, so it corroborates rather than decides.
        const existing = await tx.user.findFirst({
          where: { email: req.email, deletedAt: null },
          select: { id: true, student: { select: { id: true, registrationNo: true } } },
        });

        const returning = existing?.student ?? null;

        // -- 3. Registration number, atomically (FR-REG-051, RSK-07) -------
        //
        // Allocated ONLY for somebody new. A returning student keeps the number
        // they already have: it is permanent and public (BR-REG-07), it is on
        // certificates already issued, and a second one would make the same
        // person two people in every report.
        const registrationNo =
          returning?.registrationNo ??
          (
            await this.numbers.allocate(tx, {
              instituteCode: format.instituteCode,
              sessionCode: section.batch.academicSession.code,
              campusCode: format.campusCode,
            })
          ).registrationNo;

        // -- 4. Roll number — lowest unused in THIS section ----------------
        //
        // Per section, so a student in two courses holds two roll numbers. That
        // is correct: a roll number is a position in one classroom register,
        // not an identity (BR-REG-08).
        const rollNo = await this.numbers.allocateRollNumber(tx, section.id);

        // -- 5. Account and profile ----------------------------------------
        let studentId: string;
        let userId: string;

        if (returning) {
          studentId = returning.id;
          userId = existing!.id;
          // currentSection and currentRollNo are denormalised "where are they
          // now" fields (§8.5); the authoritative answer is the Enrolment rows.
          // Pointing them at the newest admission keeps the register views
          // sensible without claiming the earlier course has ended.
          await tx.student.update({
            where: { id: studentId },
            data: { currentSectionId: section.id, currentRollNo: rollNo },
          });
        } else {
          // FR-REG-040: temporary password, must change at first login.
          const user = await tx.user.create({
            data: {
              email: req.email,
              passwordHash,
              fullName: req.fullName,
              phone: req.phone,
              phoneIsWhatsapp: req.phoneIsWhatsapp,
              status: "INVITED",
              mustChangePassword: true,
              roles: {
                create: { role: { connect: { key: "student" } } },
              },
            },
            select: { id: true },
          });

          const created = await tx.student.create({
            data: {
              userId: user.id,
              registrationNo,
              currentSectionId: section.id,
              currentRollNo: rollNo,
              nationalId: req.nationalId,
              dateOfBirth: req.dateOfBirth,
              gender: req.gender,
              admissionDate: new Date(),
            },
            select: { id: true },
          });
          studentId = created.id;
          userId = user.id;
        }

        const student = { id: studentId };

        // -- 6. Enrolments in every compulsory active subject (BR-ENR-02) ---
        if (section.sectionSubjects.length > 0) {
          await tx.enrolment.createMany({
            data: section.sectionSubjects.map((ss) => ({
              studentId: student.id,
              sectionSubjectId: ss.id,
              status: "ACTIVE" as const,
              rollNoAtEnrolment: rollNo,
            })),
            // A returning student re-admitted to a section they already hold
            // must not gain a second enrolment in the same subject.
            skipDuplicates: true,
          });
        }

        // -- 7. Verified payment (BR-REG-10: ours, not the applicant's claim)
        await tx.payment.create({
          data: {
            studentId: student.id,
            registrationRequestId: req.id,
            verifiedAmount: input.payment.verifiedAmount,
            currency: input.payment.currency,
            paymentDate: input.payment.paymentDate,
            method: input.payment.method,
            bankReference: input.payment.bankReference ?? null,
            verifiedBy: actor.userId,
            varianceReason: input.payment.varianceReason ?? null,
          },
        });

        // -- 8. Section occupancy, in the same transaction (§8.5) ----------
        await tx.section.update({
          where: { id: section.id },
          data: { enrolledCount: { increment: 1 } },
        });

        // -- 9. Close the application ---------------------------------------
        await tx.registrationRequest.update({
          where: { id: req.id },
          data: {
            status: "APPROVED",
            decision: "APPROVED",
            decisionNote: input.note ?? null,
            decidedBy: actor.userId,
            decidedAt: new Date(),
            createdStudentId: student.id, // FR-REG-045 — permanently linked
            claimedByUserId: null,
            claimedUntil: null,
          },
        });

        // -- 10. Audit (FR-LOG-003, inside the transaction) -----------------
        await this.audit.record(
          {
            action: "registration.approve",
            entityType: "RegistrationRequest",
            entityId: req.id,
            before: { status: req.status },
            after: {
              status: "APPROVED",
              studentId: student.id,
              registrationNo,
              rollNo,
              sectionId: section.id,
              verifiedAmount: String(input.payment.verifiedAmount),
              capacityOverride: input.capacityOverride,
            },
            ipAddress: ip,
            userAgent,
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        return {
          studentId: student.id,
          userId,
          registrationNo,
          rollNo,
          // So the administrator is told they enrolled somebody who was already
          // here, rather than believing they created a new record.
          returningStudent: returning !== null,
          section: { id: section.id, code: section.code, name: section.name },
          subjectCount: section.sectionSubjects.length,
          whatsappLinks: {
            channel: section.whatsappChannelUrl,
            group: section.whatsappGroupUrl,
          },
          // Carried out of the transaction so the email can be sent after it
          // commits — see below.
          applicantEmail: req.email,
          applicantName: req.fullName,
        };
      }),
    );

    this.logger.log(`Approved ${id} → ${result.registrationNo} (roll ${result.rollNo})`);

    /*
     * FR-REG-042 — the credentials, emailed.
     *
     * AFTER the transaction commits, and never inside it. A mail server is a
     * network call; holding the admission transaction open across one would
     * keep locks on the student, enrolment and numbering tables while SMTP
     * negotiates — and an approval that rolled back because Gmail was slow
     * would be a far worse fault than an email that did not arrive.
     *
     * A RETURNING STUDENT GETS A DIFFERENT MESSAGE, NOT NO MESSAGE. Their
     * account was not touched and there is no temporary password, so sending
     * them the credentials mail would be a lie about their sign-in. But saying
     * nothing at all — which is what this did — leaves somebody who has just
     * filled in a form, paid a fee and attached a slip hearing absolutely
     * nothing back, while a first-time applicant doing the same thing gets a
     * welcome. Silence after payment reads as a lost application, and the next
     * thing that happens is a telephone call. They get the news without the
     * password, and are told in as many words to use the sign-in they have.
     *
     * The password is still shown on the administrator's screen either way,
     * which is the point of FR-REG-042: delivery is not certain, so the
     * Institute always holds a copy it can read out.
     */
    const sent: string[] = [];
    if (!result.returningStudent && tempPassword) {
      const posted = await this.mailer.sendCredentials({
        to: result.applicantEmail,
        fullName: result.applicantName,
        registrationNo: result.registrationNo,
        temporaryPassword: tempPassword,
        // PUBLIC_WEB_URL, then WEB_ORIGIN, then localhost. Reading only
        // PUBLIC_WEB_URL — which nothing but docker-compose sets — emailed
        // every new student a sign-in link to http://localhost:5173.
        signInUrl: this.credentials.signInUrl(),
      });
      if (posted.sent) sent.push(`Sign-in details emailed to ${result.applicantEmail}.`);
      else sent.push(`Could NOT email ${result.applicantEmail} — ${posted.detail}`);
    } else if (result.returningStudent) {
      const posted = await this.mailer.sendCourseAdded({
        to: result.applicantEmail,
        fullName: result.applicantName,
        registrationNo: result.registrationNo,
        sectionName: result.section.name,
        subjectCount: result.subjectCount,
        signInUrl: this.credentials.signInUrl(),
      });
      if (posted.sent) {
        sent.push(
          `${result.applicantEmail} was emailed to say they are enrolled and should use ` +
            `their existing sign-in.`,
        );
      } else {
        sent.push(`Could NOT email ${result.applicantEmail} — ${posted.detail}`);
      }
    }

    return {
      student: {
        id: result.studentId,
        registrationNo: result.registrationNo,
        rollNo: result.rollNo,
        sectionId: result.section.id,
        sectionName: result.section.name,
        // A student taking a second course keeps the number they already hold.
        returningStudent: result.returningStudent,
      },
      account: result.returningStudent
        ? {
            email: undefined as string | undefined,
            // No password for somebody who already has one. Their account was
            // not touched, so printing a temporary password would hand the
            // administrator something that does not work — and would read as
            // though the existing credentials had been reset.
            temporaryPassword: null,
            mustChangePassword: false,
            note:
              "This student already has an account, and their existing sign-in is unchanged. " +
              "They have been emailed to say they are enrolled and should use the password " +
              "they already have — see the delivery line below.",
          }
        : {
            email: undefined as string | undefined,
            // FR-REG-042 — shown ONCE, on screen, because credentials are
            // relayed by WhatsApp and email delivery may be delayed or fail.
            temporaryPassword: tempPassword as string | null,
            mustChangePassword: true,
            note: undefined as string | undefined,
          },
      enrolments: { count: result.subjectCount },
      whatsappLinks: result.whatsappLinks, // FR-REG-044
      notificationsSent: sent,
    };
  }

  /** FR-REG-033/034/046 — reject with a mandatory reason code. */
  async reject(id: string, input: RegistrationRejectInput, ip?: string, userAgent?: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const rejected = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const req = await tx.registrationRequest.findUnique({ where: { id } });
        if (!req) throw new AppError("RESOURCE_NOT_FOUND");
        if (["APPROVED", "REJECTED"].includes(req.status)) {
          throw new AppError("RESOURCE_CONFLICT", {
            message: "This application has already been decided.",
          });
        }

        await tx.registrationRequest.update({
          where: { id },
          data: {
            status: "REJECTED",
            decision: "REJECTED",
            decisionReasonCode: input.reasonCode,
            decisionNote: input.note ?? null,
            decidedBy: actor.userId,
            decidedAt: new Date(),
            claimedByUserId: null,
            claimedUntil: null,
          },
        });

        await this.audit.record(
          {
            action: "registration.reject",
            entityType: "RegistrationRequest",
            entityId: id,
            before: { status: req.status },
            after: { status: "REJECTED", reasonCode: input.reasonCode },
            ipAddress: ip,
            userAgent,
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        // BR-REG-11 — the request and its evidence are retained, and the
        // applicant may reapply.
        return {
          status: "REJECTED" as const,
          reasonCode: input.reasonCode,
          email: req.email,
          fullName: req.fullName,
          trackingRef: req.trackingRef,
        };
      }),
    );

    /*
     * FR-REG-046 — tell them.
     *
     * A decision the applicant is never told about is not a decision from
     * where they are sitting: they wait, then telephone the office, and the
     * office looks it up. Several of the reason codes are things they can fix
     * and reapply on the same day, which they cannot do while nobody has said
     * so. After the transaction, and unable to fail it, exactly as above.
     */
    const posted = await this.mailer.sendRejection({
      to: rejected.email,
      fullName: rejected.fullName,
      trackingRef: rejected.trackingRef,
      reasonCode: input.reasonCode,
      note: input.note ?? null,
    });

    return {
      status: rejected.status,
      reasonCode: rejected.reasonCode,
      // So the screen can say "and we have told them", or not.
      notificationsSent: posted.sent
        ? [`The applicant was emailed at ${rejected.email}.`]
        : [`Could NOT email ${rejected.email} — ${posted.detail}`],
    };
  }

  /** FR-REG-035 — ask for more, without discarding what was supplied. */
  async requestInfo(id: string, message: string) {
    const actor = getActor();
    if (!actor) throw new AppError("AUTH_TOKEN_INVALID");

    const asked = await this.prisma.asSystem((db) =>
      db.$transaction(async (tx) => {
        const req = await tx.registrationRequest.findUnique({ where: { id } });
        if (!req) throw new AppError("RESOURCE_NOT_FOUND");
        if (["APPROVED", "REJECTED"].includes(req.status)) {
          throw new AppError("RESOURCE_CONFLICT", {
            message: "This application has already been decided.",
          });
        }

        await tx.registrationRequest.update({
          where: { id },
          data: {
            status: "NEEDS_INFO",
            decisionNote: message,
            claimedByUserId: null,
            claimedUntil: null,
          },
        });

        await this.audit.record(
          {
            action: "registration.request_info",
            entityType: "RegistrationRequest",
            entityId: id,
            before: { status: req.status },
            after: { status: "NEEDS_INFO" },
          },
          tx as unknown as Parameters<AuditService["record"]>[1],
        );

        return {
          status: "NEEDS_INFO" as const,
          email: req.email,
          fullName: req.fullName,
          trackingRef: req.trackingRef,
        };
      }),
    );

    /*
     * The state NEEDS_INFO only means anything if the applicant is told.
     * Otherwise both sides are waiting for the other, and the application sits
     * in the queue until somebody clears it out by hand.
     */
    const posted = await this.mailer.sendInfoRequest({
      to: asked.email,
      fullName: asked.fullName,
      trackingRef: asked.trackingRef,
      message,
    });

    return {
      status: asked.status,
      notificationsSent: posted.sent
        ? [`The applicant was emailed at ${asked.email}.`]
        : [`Could NOT email ${asked.email} — ${posted.detail}. Telephone them instead.`],
    };
  }

  // =========================================================== helpers ======

  /**
   * FR-REG-040 — a temporary password meeting the Student policy, generated
   * with a CSPRNG (SEC-CRY-007). Grouped for legibility because an
   * administrator reads it aloud or types it into WhatsApp.
   */
  private generateTempPassword(): string {
    const pick = (n: number): string =>
      Array.from({ length: n }, () => TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)]).join("");
    return `${pick(4)}-${pick(4)}-${pick(4)}`;
  }

  /** FR-REG-018 — short, unambiguous, and unique. */
  private async generateTrackingRef(db: {
    registrationRequest: {
      findUnique: (args: { where: { trackingRef: string } }) => Promise<unknown>;
    };
  }): Promise<string> {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 8; attempt++) {
      const suffix = String(randomInt(100_000, 999_999));
      const ref = `REG-${year}-${suffix}`;
      const clash = await db.registrationRequest.findUnique({ where: { trackingRef: ref } });
      if (!clash) return ref;
    }
    throw new AppError("INTERNAL_ERROR", {
      message: "Could not allocate a tracking reference. Please try again.",
    });
  }
}
