-- THE TARGET RULE, WIDENED FOR THE THREE NEW AUDIENCES.
--
-- `announcements_audience_target` enumerates which audiences name a target and
-- which do not: INSTITUTE names neither a section nor a subject, SECTION names
-- a section, SECTION_SUBJECT names a subject. Anything else is refused.
--
-- THAT STRICTNESS IS THE POINT, and it caught this: adding TEACHERS, STAFF and
-- PUBLIC_ONLY to the enum was not enough, because the database had never been
-- told what shape they are. Every insert failed with a constraint violation
-- until it was, which is exactly the right way round — a new audience has to be
-- deliberately classified rather than quietly inheriting whatever the column
-- happens to allow.
--
-- All three address the INSTITUTE AS A WHOLE and name no target: a notice to
-- the teaching staff is not a notice to a section of it, and one written for
-- the public page is addressed to people who are in no section at all. So they
-- join the first branch, and the rule that a sectional notice must name its
-- section is untouched.
ALTER TABLE "announcements"
  DROP CONSTRAINT IF EXISTS "announcements_audience_target";

ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_audience_target"
  CHECK (
    ("audience" IN ('INSTITUTE', 'TEACHERS', 'STAFF', 'PUBLIC_ONLY')
       AND "section_id" IS NULL AND "section_subject_id" IS NULL)
    OR ("audience" = 'SECTION'         AND "section_id" IS NOT NULL AND "section_subject_id" IS NULL)
    OR ("audience" = 'SECTION_SUBJECT' AND "section_subject_id" IS NOT NULL AND "section_id" IS NULL)
  );
