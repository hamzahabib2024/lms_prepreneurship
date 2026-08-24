-- THREE AUDIENCES THE INSTITUTE HAD NO WAY TO ADDRESS — FR-COM, FR-PUB.
--
-- Until now an announcement went to the whole Institute, one section, or one
-- class, and "the whole Institute" meant every student as well. So there was
-- no way to say any of these:
--
--   TEACHERS   "staff meeting Thursday" — of no interest to a student, and
--              posting it to everybody trains students to ignore notices,
--              which is expensive the week something matters.
--
--   STAFF      the same, plus the office. Teachers and administrators share
--              far more than either shares with a student.
--
--   PUBLIC_ONLY  a notice for VISITORS and nobody else — an open day, an
--              admissions deadline. Today the only way onto the public page is
--              an INSTITUTE notice with isPublic set, which also lands in
--              every enrolled student's inbox. Advertising an intake to the
--              students who are already on it is noise they did not ask for.
--
-- WHY AN ENUM VALUE RATHER THAN A FLAG. Audience is already the one field that
-- decides who may read a notice, and the scope predicate reads it (see
-- scope.extension.ts). A parallel boolean would be a second answer to the same
-- question, and the two would disagree the first time somebody set one and not
-- the other. Postgres cannot remove an enum value later, which is a real cost
-- and the right trade: this is a closed set of audiences an institute has.
ALTER TYPE "AnnouncementAudience" ADD VALUE IF NOT EXISTS 'TEACHERS';
ALTER TYPE "AnnouncementAudience" ADD VALUE IF NOT EXISTS 'STAFF';
ALTER TYPE "AnnouncementAudience" ADD VALUE IF NOT EXISTS 'PUBLIC_ONLY';
