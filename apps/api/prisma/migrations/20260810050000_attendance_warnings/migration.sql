-- Attendance warnings -- SRS FR-ATT-020/022, Appendix F.
--
-- One row per student per subject, holding the level they currently sit at.
--
-- It exists to tell a TRANSITION from a STATE. Thresholds are re-evaluated on
-- every register a teacher marks, so without somewhere to remember what was
-- already said, a struggling student would be notified after every class until
-- they stopped reading -- and the message that mattered would be lost among the
-- ones that did not.

-- CreateEnum
CREATE TYPE "WarningSeverity" AS ENUM ('WARNING', 'CRITICAL');
DROP INDEX "registration_requests_created_student_id_idx";
-- CreateTable
CREATE TABLE "attendance_warnings" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "section_subject_id" UUID NOT NULL,
    "severity" "WarningSeverity" NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "threshold_applied" DECIMAL(5,2) NOT NULL,
    "raised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleared_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "attendance_warnings_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "attendance_warnings_section_subject_id_severity_cleared_at_idx" ON "attendance_warnings"("section_subject_id", "severity", "cleared_at");
-- CreateIndex
CREATE UNIQUE INDEX "attendance_warnings_student_id_section_subject_id_key" ON "attendance_warnings"("student_id", "section_subject_id");
-- AddForeignKey
ALTER TABLE "attendance_warnings" ADD CONSTRAINT "attendance_warnings_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "attendance_warnings" ADD CONSTRAINT "attendance_warnings_section_subject_id_fkey" FOREIGN KEY ("section_subject_id") REFERENCES "section_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A percentage is a percentage.
ALTER TABLE "attendance_warnings"
  ADD CONSTRAINT "attendance_warnings_percent_range"
  CHECK ("percentage" BETWEEN 0 AND 100 AND "threshold_applied" BETWEEN 0 AND 100);

-- A student cannot recover before they were warned.
ALTER TABLE "attendance_warnings"
  ADD CONSTRAINT "attendance_warnings_cleared_after_raised"
  CHECK ("cleared_at" IS NULL OR "cleared_at" >= "raised_at");

-- An acknowledgement records WHO acted, so "somebody dealt with it" is always
-- answerable (FR-ATT-022).
ALTER TABLE "attendance_warnings"
  ADD CONSTRAINT "attendance_warnings_acknowledgement_complete"
  CHECK (
    ("acknowledged_at" IS NULL AND "acknowledged_by" IS NULL)
    OR ("acknowledged_at" IS NOT NULL AND "acknowledged_by" IS NOT NULL)
  );

-- The teacher's at-risk list is "live warnings in my sections", and the cleared
-- rows are the ones that accumulate.
CREATE INDEX "attendance_warnings_live"
  ON "attendance_warnings" ("section_subject_id", "severity")
  WHERE "cleared_at" IS NULL;
