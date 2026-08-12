-- Staff notes about a student (FR-REG-046).
--
-- A separate table rather than a column on students, because the access rule
-- is the opposite of the rest of that row: the student may read their own
-- record and must never read these.
CREATE TABLE "student_notes" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "section_subject_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "student_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "student_notes_student_id_deleted_at_idx" ON "student_notes"("student_id", "deleted_at");
CREATE INDEX "student_notes_section_subject_id_idx" ON "student_notes"("section_subject_id");

-- Restrict everywhere: a note is somebody's written observation and must not
-- disappear because a row it points at was tidied away (BR-DAT-04).
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_section_subject_id_fkey"
    FOREIGN KEY ("section_subject_id") REFERENCES "section_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_author_user_id_fkey"
    FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;