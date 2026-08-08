-- FR-VID-008/009/010 — persisted watch progress.
--
-- NOTE FOR THE NEXT PERSON TO RUN `prisma migrate diff`.
--
-- The generated diff also wanted to DROP four indexes:
--
--     audit_log_occurred_brin, security_events_occurred_brin,
--     students_registration_no_trgm, users_full_name_trgm
--
-- They are NOT drift. They are the BRIN and pg_trgm GIN indexes from SRS
-- section 8.4, created by prisma/sql/01_constraints_and_indexes.sql because
-- Prisma cannot express those index types. Prisma reports anything absent from
-- schema.prisma as drift, so it proposes dropping them on every diff. Deleting
-- them would silently turn the name and registration-number searches into
-- sequential scans and breach NFR-PRF-004.
--
-- Always strip the DropIndex statements from a generated diff in this project.

-- CreateTable
CREATE TABLE "watch_progress" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "recorded_lecture_id" UUID NOT NULL,
    "watched_intervals" JSONB NOT NULL DEFAULT '[]',
    "watched_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "last_position_seconds" INTEGER NOT NULL DEFAULT 0,
    "is_complete" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "first_watched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watch_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "watch_progress_recorded_lecture_id_is_complete_idx" ON "watch_progress"("recorded_lecture_id", "is_complete");

-- CreateIndex
CREATE UNIQUE INDEX "watch_progress_student_id_recorded_lecture_id_key" ON "watch_progress"("student_id", "recorded_lecture_id");

-- AddForeignKey
ALTER TABLE "watch_progress" ADD CONSTRAINT "watch_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_progress" ADD CONSTRAINT "watch_progress_recorded_lecture_id_fkey" FOREIGN KEY ("recorded_lecture_id") REFERENCES "recorded_lectures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A percentage is a percentage. The server computes this from merged intervals,
-- but a bad deployment must not be able to persist 340% and hand a student a
-- certificate (BR-PRG-02).
ALTER TABLE "watch_progress"
  ADD CONSTRAINT "watch_progress_percent_range"
  CHECK ("watched_percent" >= 0 AND "watched_percent" <= 100);

ALTER TABLE "watch_progress"
  ADD CONSTRAINT "watch_progress_position_non_negative"
  CHECK ("last_position_seconds" >= 0);

-- is_complete and completed_at travel together, so "when did they finish?" is
-- always answerable for a completed lecture.
ALTER TABLE "watch_progress"
  ADD CONSTRAINT "watch_progress_completed_at_present"
  CHECK (("is_complete" = false AND "completed_at" IS NULL)
      OR ("is_complete" = true  AND "completed_at" IS NOT NULL));
