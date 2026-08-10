-- FR-ASG-013 — a file is uploaded first and attached when the student submits.
--
-- Three changes, all in service of one question the table could not previously
-- answer: "may this caller attach this file?"
--
--   submission_id becomes NULLABLE, so an uploaded-but-not-yet-submitted file
--   is representable at all. Until now a SubmissionFile could not exist without
--   a submission, which meant the fileIds parameter on the submit endpoint could
--   never have been populated legitimately.
--
--   student_id records the owner at upload time. Without it, attachment by id
--   alone would let one student pull another's work into their own submission —
--   and because a file has a single parent, that would REMOVE it from the
--   victim's submission at the same time.
--
--   assignment_id records what it was uploaded FOR, so a file cannot be moved
--   between assignments.
--
-- The table is empty in every environment (there was no upload endpoint), so
-- the NOT NULL additions need no backfill. If that is ever untrue, this
-- migration will fail loudly rather than inventing an owner — which is the
-- correct outcome for a column that decides who may read a student's work.

-- AlterTable
ALTER TABLE "submission_files" ADD COLUMN     "assignment_id" UUID NOT NULL,
ADD COLUMN     "student_id" UUID NOT NULL,
ALTER COLUMN "submission_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "submission_files_student_id_assignment_id_submission_id_idx" ON "submission_files"("student_id", "assignment_id", "submission_id");

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A file may only ever be attached to a submission belonging to the same
-- student and the same assignment. The application enforces this, but the
-- database is where it becomes true regardless of which code path runs.
CREATE OR REPLACE FUNCTION check_submission_file_ownership() RETURNS TRIGGER AS $$
DECLARE
  sub_student UUID;
  sub_assignment UUID;
BEGIN
  IF NEW.submission_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT student_id, assignment_id INTO sub_student, sub_assignment
  FROM assignment_submissions WHERE id = NEW.submission_id;

  IF sub_student IS DISTINCT FROM NEW.student_id THEN
    RAISE EXCEPTION 'submission_file % belongs to student %, but submission % belongs to student %',
      NEW.id, NEW.student_id, NEW.submission_id, sub_student;
  END IF;

  IF sub_assignment IS DISTINCT FROM NEW.assignment_id THEN
    RAISE EXCEPTION 'submission_file % was uploaded for assignment %, but submission % is for assignment %',
      NEW.id, NEW.assignment_id, NEW.submission_id, sub_assignment;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submission_file_ownership
  BEFORE INSERT OR UPDATE ON "submission_files"
  FOR EACH ROW EXECUTE FUNCTION check_submission_file_ownership();
