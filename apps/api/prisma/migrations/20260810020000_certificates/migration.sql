-- Completion certificates — SRS §5.15, FR-CRT-001..020.
--
-- The figures on a certificate are a SNAPSHOT. Progress is derived and computed
-- on read (ARC-007), so it moves when a teacher publishes another lecture or a
-- register is corrected. A certificate is a statement about a moment, and it
-- carries its own copies of the evidence and of the criteria that were applied
-- — otherwise a document handed to an employer would quietly come to say
-- something different from what was printed on it.

-- CreateEnum
CREATE TYPE "CertificateType" AS ENUM ('SUBJECT', 'PROGRAMME');
-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('ISSUED', 'REVOKED');
-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "certificate_no" VARCHAR(50) NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "CertificateType" NOT NULL,
    "section_subject_id" UUID,
    "programme_id" UUID,
    "progress_percent" DECIMAL(5,2) NOT NULL,
    "attendance_percent" DECIMAL(5,2),
    "average_grade_percent" DECIMAL(5,2),
    "criteria_applied" JSONB NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'ISSUED',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" UUID,
    "revocation_reason" TEXT,
    "verification_code" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "certificates_certificate_no_key" ON "certificates"("certificate_no");
-- CreateIndex
CREATE UNIQUE INDEX "certificates_verification_code_key" ON "certificates"("verification_code");
-- CreateIndex
CREATE INDEX "certificates_student_id_idx" ON "certificates"("student_id");
-- CreateIndex
CREATE INDEX "certificates_issued_at_idx" ON "certificates"("issued_at");
-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_section_subject_id_fkey" FOREIGN KEY ("section_subject_id") REFERENCES "section_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FR-CRT-004 — at most one LIVE certificate per student per subject, and per
-- student per programme.
--
-- PARTIAL, on purpose. A plain unique over (student, subject, status) would
-- also permit only one REVOKED row, so issue -> revoke -> reissue -> revoke would
-- fail on the second revocation. History must be unbounded; only the live
-- certificate is unique.
CREATE UNIQUE INDEX "certificates_one_live_per_subject"
  ON "certificates" ("student_id", "section_subject_id")
  WHERE "status" = 'ISSUED' AND "section_subject_id" IS NOT NULL;

CREATE UNIQUE INDEX "certificates_one_live_per_programme"
  ON "certificates" ("student_id", "programme_id")
  WHERE "status" = 'ISSUED' AND "programme_id" IS NOT NULL;

-- A certificate is about exactly one thing. Without this a row could name both
-- a subject and a programme, or neither, and every reader would have to guess
-- which field to trust.
ALTER TABLE "certificates"
  ADD CONSTRAINT "certificates_subject_xor_programme"
  CHECK (
    ("type" = 'SUBJECT'   AND "section_subject_id" IS NOT NULL AND "programme_id" IS NULL)
    OR
    ("type" = 'PROGRAMME' AND "programme_id" IS NOT NULL AND "section_subject_id" IS NULL)
  );

-- Revocation is a state, and its evidence travels with it. A REVOKED row with
-- no timestamp or no reason is a record nobody can act on.
ALTER TABLE "certificates"
  ADD CONSTRAINT "certificates_revocation_complete"
  CHECK (
    ("status" = 'ISSUED'  AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
    OR
    ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL AND "revocation_reason" IS NOT NULL)
  );

-- Percentages are percentages.
ALTER TABLE "certificates"
  ADD CONSTRAINT "certificates_percent_ranges"
  CHECK (
    "progress_percent" BETWEEN 0 AND 100
    AND ("attendance_percent" IS NULL OR "attendance_percent" BETWEEN 0 AND 100)
    AND ("average_grade_percent" IS NULL OR "average_grade_percent" BETWEEN 0 AND 100)
  );
