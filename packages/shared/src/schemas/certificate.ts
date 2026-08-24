/**
 * Certificate contracts — SRS §5.15, FR-CRT-001..020.
 */

import { z } from "zod";
import { CERTIFICATE_KIND, CERTIFICATE_STATUS, CERTIFICATE_TYPE } from "../enums";

/**
 * Issuing a certificate by hand — FR-CRT-002, and the deliberate exception to
 * "a certificate is earned, not granted".
 *
 * ONLY THREE THINGS ARE REQUIRED: who it is for, what it is for, and which
 * kind it is. Everything else is optional and everything else has a sensible
 * answer already — the issue date is today, the institute name comes from
 * settings, the instructor comes from whoever teaches the subject that was
 * picked. An office issuing forty workshop certificates should type forty
 * names, not four hundred and forty fields.
 *
 * THE STUDENT LINK IS OPTIONAL, AND THAT IS THE WHOLE POINT of manual issue.
 * A weekend workshop attended by people who are not enrolled in anything is a
 * real thing an institute certifies, and requiring a Student row would mean
 * inventing accounts for people who will never sign in. When a student IS
 * named the certificate joins their "My certificates", which is why the field
 * exists at all.
 */
export const certificateIssueSchema = z
  .object({
    /** Links the certificate to a student record when there is one. */
    studentId: z.string().uuid().optional(),
    /** Printed on the document. Pre-filled from the student when one is picked. */
    studentName: z.string().trim().min(2).max(200),
    registrationNo: z.string().trim().max(50).optional(),
    rollNo: z.coerce.number().int().min(1).max(32767).optional(),

    /** What the certificate is for — the course, subject or workshop name. */
    title: z.string().trim().min(2).max(250),
    kind: z.enum(CERTIFICATE_KIND).default("COMPLETION"),

    /** Anchors the certificate to real structure. At most one. */
    sectionSubjectId: z.string().uuid().optional(),
    programmeId: z.string().uuid().optional(),

    instructorName: z.string().trim().max(200).optional(),
    instructorTitle: z.string().trim().max(150).optional(),

    /** ISO dates. Issue defaults to today, completion to the issue date. */
    issueDate: z.string().datetime({ offset: true }).optional(),
    completionDate: z.string().datetime({ offset: true }).optional(),

    /** Free text, e.g. "12 weeks · 60 hours". Printed if present. */
    durationText: z.string().trim().max(80).optional(),

    /** Recorded in the audit entry, never printed. */
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => !(v.sectionSubjectId && v.programmeId), {
    message: "A certificate is for a subject or for a programme, not both.",
    path: ["programmeId"],
  });
export type CertificateIssueInput = z.infer<typeof certificateIssueSchema>;

/** FR-CRT-012 — revocation always carries its reason. */
export const certificateRevokeSchema = z
  .object({
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();
export type CertificateRevokeInput = z.infer<typeof certificateRevokeSchema>;

/** The register's filters. Everything optional; nothing set means everything. */
export const certificateQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    status: z.enum(CERTIFICATE_STATUS).optional(),
    kind: z.enum(CERTIFICATE_KIND).optional(),
    type: z.enum(CERTIFICATE_TYPE).optional(),
    issuedFrom: z.string().optional(),
    issuedTo: z.string().optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
  })
  .strict();
export type CertificateQueryInput = z.infer<typeof certificateQuerySchema>;

/**
 * The rendered document — everything a certificate needs to be drawn, and
 * nothing that would have to be looked up a second time.
 *
 * IT IS SERVED FROM THE SNAPSHOT, not from today's records. A student who
 * changes their name, a course that is renamed, a teacher who leaves: none of
 * them may alter a document already in somebody's hands.
 */
export interface CertificateDocument {
  id: string;
  certificateNo: string;
  type: (typeof CERTIFICATE_TYPE)[number];
  kind: (typeof CERTIFICATE_KIND)[number];
  status: (typeof CERTIFICATE_STATUS)[number];

  issuedAt: string;
  completionDate: string | null;
  durationText: string | null;

  student: {
    /** Null once the student record is erased. The certificate survives it. */
    id: string | null;
    name: string;
    registrationNo: string | null;
    rollNo: number | null;
  };

  award: {
    title: string;
    programme: string | null;
    /** The subject or programme code, when the certificate is anchored to one. */
    code: string | null;
  };

  instructor: { name: string; title: string } | null;

  institute: {
    name: string;
    tagline: string;
    website: string;
    signatoryName: string;
    signatoryTitle: string;
  };

  verification: { code: string; url: string };

  /** Present only for an earned certificate; a manual one has no figures. */
  standing: {
    progressPercent: number;
    attendancePercent: number | null;
    averageGradePercent: number | null;
  } | null;

  revokedAt: string | null;
  revocationReason: string | null;
  issuedManually: boolean;
}
