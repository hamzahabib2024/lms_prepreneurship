-- DB-009 — a foreign key with no constraint is not a foreign key.
--
-- A sweep of columns ending in _id found 27 with no FOREIGN KEY constraint.
-- Most are not references at all: correlation_id on the logs, entity_id on the
-- polymorphic audit row, national_id (a person's CNIC), token_family_id,
-- scope_id, and the provider's external_id.
--
-- These three are real, and all three point at students:
--
--   assignment_submissions.student_id   a student's submitted work
--   assignment_extensions.student_id    a deadline granted to one student
--   quiz_attempts.student_id            a sat quiz
--
-- Without the constraint, deleting a student left their work behind pointing
-- at nothing. Nothing would report it, and every count over those tables would
-- keep including the orphans — which is how an "average score" ends up
-- computed over people who are no longer enrolled.
--
-- RESTRICT on submissions and attempts, because a student with marked work
-- must not be deletable at all — BR-DAT-02 makes deletion a soft operation for
-- exactly this reason, and the constraint enforces it rather than trusting
-- every future code path to remember.
--
-- CASCADE on extensions, because an extension is a grant made TO a student and
-- has no meaning without them. It carries no record of work done.

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_extensions" ADD CONSTRAINT "assignment_extensions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
