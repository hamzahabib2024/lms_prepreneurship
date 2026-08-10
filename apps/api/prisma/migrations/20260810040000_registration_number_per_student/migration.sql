-- One student, one registration number, one or many courses.
--
-- created_student_id was UNIQUE, on the assumption that one registration
-- request produces one new student. A student may take more than one course,
-- and their second admission points at the record they already hold — so the
-- constraint made the second approval impossible. The administrator was told
-- "a record with that value already exists" and had no way forward.
--
-- The column stays, and is now read as "the student this request resulted in"
-- rather than "created": for a returning student the request enrolled them.
-- A plain index replaces the unique one, because the lookup is still wanted.

DROP INDEX "registration_requests_created_student_id_key";

-- The lookup "which request admitted this student" is still wanted; only its
-- uniqueness was wrong.
CREATE INDEX "registration_requests_created_student_id_idx"
  ON "registration_requests" ("created_student_id");
