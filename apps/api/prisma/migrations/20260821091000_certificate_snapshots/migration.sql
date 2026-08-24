-- A CERTIFICATE IS A PERMANENT RECORD — FR-CRT-008/016, BR-DAT-02.
--
-- THE GAP THIS CLOSES. A certificate row carried the FIGURES as a snapshot —
-- progress, attendance, the criteria that were applied — and every WORD as a
-- foreign key. The name on the document, the course it was for, the teacher
-- who taught it and the Institute that issued it were all joined out to live
-- rows at render time.
--
-- Three consequences, all of which would have reached somebody's hands:
--
--   A student who marries and changes their surname gets a different piece of
--   paper the next time anybody prints their 2026 certificate, and the copy on
--   the employer's file no longer matches the one the System produces.
--
--   A course renamed for the following intake retrospectively renames every
--   certificate ever issued under the old name.
--
--   And erasing a student's personal data was REFUSED outright, because the
--   foreign key was ON DELETE RESTRICT. The System could neither keep the
--   certificate honestly nor honour the erasure.
--
-- So the words become a snapshot beside the figures, and the references become
-- nullable with ON DELETE SET NULL: the document survives everything it points
-- at, and severing the link costs nothing that was being printed.

-- ---------------------------------------------------------------------------
-- The snapshot columns.
--
-- Added nullable, backfilled from whatever live records are still there, and
-- only then made NOT NULL — so an existing installation keeps every certificate
-- it has already issued, with the words it was issued with.
-- ---------------------------------------------------------------------------

ALTER TABLE "certificates"
    ADD COLUMN "kind"                             "CertificateKind" NOT NULL DEFAULT 'COMPLETION',
    ADD COLUMN "issued_manually"                  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "student_name_snapshot"            VARCHAR(200),
    ADD COLUMN "student_registration_no_snapshot" VARCHAR(50),
    ADD COLUMN "student_roll_no_snapshot"         SMALLINT,
    ADD COLUMN "award_title_snapshot"             VARCHAR(250),
    ADD COLUMN "programme_name_snapshot"          VARCHAR(200),
    ADD COLUMN "award_code_snapshot"              VARCHAR(30),
    ADD COLUMN "instructor_name_snapshot"         VARCHAR(200),
    ADD COLUMN "instructor_title_snapshot"        VARCHAR(150),
    ADD COLUMN "institute_name_snapshot"          VARCHAR(200),
    ADD COLUMN "signatory_name_snapshot"          VARCHAR(200),
    ADD COLUMN "signatory_title_snapshot"         VARCHAR(150),
    ADD COLUMN "completion_date"                  TIMESTAMP(3),
    ADD COLUMN "duration_text"                    VARCHAR(80);

-- The holder, from the account the certificate was issued against.
UPDATE "certificates" c
SET "student_name_snapshot"            = u."full_name",
    "student_registration_no_snapshot" = s."registration_no",
    "student_roll_no_snapshot"         = s."current_roll_no"
FROM "students" s
JOIN "users" u ON u."id" = s."user_id"
WHERE s."id" = c."student_id";

-- What it was awarded for: the subject as taught, or the programme.
UPDATE "certificates" c
SET "award_title_snapshot" = sub."name",
    "award_code_snapshot"  = sub."code"
FROM "section_subjects" ss
JOIN "subjects" sub ON sub."id" = ss."subject_id"
WHERE ss."id" = c."section_subject_id";

UPDATE "certificates" c
SET "award_title_snapshot" = p."name",
    "award_code_snapshot"  = p."code"
FROM "programmes" p
WHERE p."id" = c."programme_id";

-- The course a subject certificate sits inside, walked through the structure
-- rather than guessed: it is the secondary line on the printed document.
UPDATE "certificates" c
SET "programme_name_snapshot" = p."name"
FROM "section_subjects" ss
JOIN "sections" sec        ON sec."id" = ss."section_id"
JOIN "batches" b           ON b."id" = sec."batch_id"
JOIN "academic_sessions" a ON a."id" = b."academic_session_id"
JOIN "programmes" p        ON p."id" = a."programme_id"
WHERE ss."id" = c."section_subject_id";

-- Whoever was teaching it. PRIMARY only, and the earliest live assignment, so
-- a class that once had a substitute does not credit the wrong person.
UPDATE "certificates" c
SET "instructor_name_snapshot"  = first_teacher."full_name",
    "instructor_title_snapshot" = 'Course Instructor'
FROM (
    SELECT DISTINCT ON (ta."section_subject_id")
           ta."section_subject_id" AS "section_subject_id",
           u."full_name"           AS "full_name"
    FROM "teacher_assignments" ta
    JOIN "teachers" t ON t."id" = ta."teacher_id"
    JOIN "users" u    ON u."id" = t."user_id"
    WHERE ta."deleted_at" IS NULL
      AND ta."assignment_role" = 'PRIMARY'
    ORDER BY ta."section_subject_id", ta."start_date"
) first_teacher
WHERE first_teacher."section_subject_id" = c."section_subject_id";

-- The Institute's own name, from the setting where one has been saved and from
-- the documented default otherwise. Both are what the certificate WOULD have
-- printed, which is the honest reading of a row issued before this column.
UPDATE "certificates"
SET "institute_name_snapshot" = COALESCE(
    (SELECT s."value" #>> '{}'
     FROM "settings" s
     WHERE s."key" = 'institute.name'
       AND (s."scope_type" IS NULL OR s."scope_type" = 'INSTITUTE')
     ORDER BY s."scope_type" NULLS FIRST
     LIMIT 1),
    'The Institute'
);

-- Last resort for a row whose student, subject or programme has already gone.
-- A certificate with no holder name is unprintable, and refusing to migrate it
-- would be worse than saying plainly that the name is no longer on file.
UPDATE "certificates"
SET "student_name_snapshot" = COALESCE("student_name_snapshot", 'Name no longer on file'),
    "award_title_snapshot"  = COALESCE("award_title_snapshot", 'Course no longer on file');

ALTER TABLE "certificates"
    ALTER COLUMN "student_name_snapshot"   SET NOT NULL,
    ALTER COLUMN "award_title_snapshot"    SET NOT NULL,
    ALTER COLUMN "institute_name_snapshot" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- The references become severable.
-- ---------------------------------------------------------------------------

ALTER TABLE "certificates" ALTER COLUMN "student_id" DROP NOT NULL;

ALTER TABLE "certificates" DROP CONSTRAINT "certificates_student_id_fkey";
ALTER TABLE "certificates"
    ADD CONSTRAINT "certificates_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "students" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "certificates" DROP CONSTRAINT "certificates_section_subject_id_fkey";
ALTER TABLE "certificates"
    ADD CONSTRAINT "certificates_section_subject_id_fkey"
    FOREIGN KEY ("section_subject_id") REFERENCES "section_subjects" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "certificates" DROP CONSTRAINT "certificates_programme_id_fkey";
ALTER TABLE "certificates"
    ADD CONSTRAINT "certificates_programme_id_fkey"
    FOREIGN KEY ("programme_id") REFERENCES "programmes" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- The figures become optional.
--
-- A workshop certificate for somebody who was never enrolled has no progress
-- figure. Writing 0 would be a lie, and it is a lie that PRINTS.
-- ---------------------------------------------------------------------------

ALTER TABLE "certificates"
    ALTER COLUMN "progress_percent" DROP NOT NULL,
    ALTER COLUMN "criteria_applied" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- The check constraints, restated for the three new facts: a reference may be
-- severed, a type may be CUSTOM, and a status may be ARCHIVED.
-- ---------------------------------------------------------------------------

-- A certificate is still about exactly one thing — but "the thing it was about
-- has since been deleted" is now a legal state, so the constraint bounds which
-- reference may be PRESENT rather than demanding one be.
ALTER TABLE "certificates" DROP CONSTRAINT "certificates_subject_xor_programme";
ALTER TABLE "certificates"
    ADD CONSTRAINT "certificates_subject_xor_programme"
    CHECK (
        ("type" = 'SUBJECT'   AND "programme_id" IS NULL)
        OR
        ("type" = 'PROGRAMME' AND "section_subject_id" IS NULL)
        OR
        ("type" = 'CUSTOM'    AND "section_subject_id" IS NULL AND "programme_id" IS NULL)
    );

-- Revocation still travels with its evidence. ARCHIVED joins ISSUED on the
-- side that carries none: archiving says nothing about whether the document is
-- genuine, so it has nothing to justify.
ALTER TABLE "certificates" DROP CONSTRAINT "certificates_revocation_complete";
ALTER TABLE "certificates"
    ADD CONSTRAINT "certificates_revocation_complete"
    CHECK (
        ("status" IN ('ISSUED', 'ARCHIVED') AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
        OR
        ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL AND "revocation_reason" IS NOT NULL)
    );

-- The percentages are still percentages, and are now allowed to be absent.
ALTER TABLE "certificates" DROP CONSTRAINT "certificates_percent_ranges";
ALTER TABLE "certificates"
    ADD CONSTRAINT "certificates_percent_ranges"
    CHECK (
        ("progress_percent" IS NULL OR "progress_percent" BETWEEN 0 AND 100)
        AND ("attendance_percent" IS NULL OR "attendance_percent" BETWEEN 0 AND 100)
        AND ("average_grade_percent" IS NULL OR "average_grade_percent" BETWEEN 0 AND 100)
    );

-- ---------------------------------------------------------------------------
-- Indexes the register needs.
--
-- The certificate list is filtered by status and sorted by issue date on every
-- single load, and searched by holder name whenever somebody rings the office
-- about a document they are holding.
-- ---------------------------------------------------------------------------

CREATE INDEX "certificates_status_issued_at_idx" ON "certificates" ("status", "issued_at");
CREATE INDEX "certificates_student_name_snapshot_idx" ON "certificates" ("student_name_snapshot");
