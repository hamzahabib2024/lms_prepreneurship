-- WHICH SUBJECTS A COURSE TEACHES — FR-CRS-004.
--
-- THE GAP. The System could only ever attach a subject to a BATCH
-- (`section_subjects`). There was no way to say "the Diploma in Graphic
-- Designing teaches Photoshop and English" — only "batch A teaches Photoshop
-- and English", said again for batch B, and again for batch C.
--
-- Three consequences, all of which showed on screen:
--
--   A course with no batches yet had no subjects at all, so the Courses page
--   showed "Subjects: none yet" for a course somebody had just spent ten
--   minutes defining.
--
--   Creating the second batch of a course meant re-picking the same six
--   subjects, from memory, with nothing to check against.
--
--   And the two could silently disagree: batch A teaching five subjects and
--   batch B teaching four is a real state the System had no opinion about, so
--   one cohort quietly got less of the course than the other.
--
-- This is the course's OWN list — the answer to "what is this course?" — and
-- the batches are seeded from it. It does not replace `section_subjects`:
-- a batch still owns what it actually teaches, because a batch legitimately
-- differs (a subject dropped for one intake), and every register, assignment
-- and recording hangs off the batch's row rather than this one.
CREATE TABLE "programme_subjects" (
    "id"           UUID         NOT NULL,
    "programme_id" UUID         NOT NULL,
    "subject_id"   UUID         NOT NULL,
    -- The order they are taught in, which is how a prospectus lists them.
    "sort_order"   INTEGER      NOT NULL DEFAULT 0,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "programme_subjects_pkey" PRIMARY KEY ("id")
);

-- A subject appears in a course once. Without this, adding the same subject
-- twice from two browser tabs gives a course that teaches Photoshop twice.
CREATE UNIQUE INDEX "programme_subjects_programme_id_subject_id_key"
    ON "programme_subjects" ("programme_id", "subject_id");

CREATE INDEX "programme_subjects_programme_id_sort_order_idx"
    ON "programme_subjects" ("programme_id", "sort_order");
CREATE INDEX "programme_subjects_subject_id_idx"
    ON "programme_subjects" ("subject_id");

-- CASCADE from the programme: the list has no meaning without the course, and
-- a deleted course leaving its subject list behind is rows nothing can reach.
ALTER TABLE "programme_subjects"
    ADD CONSTRAINT "programme_subjects_programme_id_fkey"
    FOREIGN KEY ("programme_id") REFERENCES "programmes" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT from the subject, and the asymmetry is deliberate: deleting a
-- SUBJECT that a course still teaches should be refused and looked at, not
-- quietly removed from every syllabus that named it.
ALTER TABLE "programme_subjects"
    ADD CONSTRAINT "programme_subjects_subject_id_fkey"
    FOREIGN KEY ("subject_id") REFERENCES "subjects" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- BACKFILL, so no existing course loses what it already teaches.
--
-- Every distinct subject taught by any live batch of a course becomes that
-- course's list. This is the honest reading of the data that exists: it is
-- exactly what the Courses screen was already deriving and showing, now
-- recorded rather than recomputed.
-- ---------------------------------------------------------------------------
INSERT INTO "programme_subjects" ("id", "programme_id", "subject_id", "sort_order")
SELECT
    gen_random_uuid(),
    p."id",
    ss."subject_id",
    ROW_NUMBER() OVER (PARTITION BY p."id" ORDER BY MIN(sub."code")) - 1
FROM "programmes" p
JOIN "academic_sessions" a  ON a."programme_id" = p."id" AND a."deleted_at" IS NULL
JOIN "batches" b            ON b."academic_session_id" = a."id" AND b."deleted_at" IS NULL
JOIN "sections" s           ON s."batch_id" = b."id" AND s."deleted_at" IS NULL
JOIN "section_subjects" ss  ON ss."section_id" = s."id" AND ss."deleted_at" IS NULL
JOIN "subjects" sub         ON sub."id" = ss."subject_id"
WHERE p."deleted_at" IS NULL
GROUP BY p."id", ss."subject_id"
ON CONFLICT DO NOTHING;
