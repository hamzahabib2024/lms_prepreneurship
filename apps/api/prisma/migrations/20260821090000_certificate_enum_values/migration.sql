-- The certificate enumerations, widened — SRS §5.15.
--
-- ITS OWN MIGRATION, AND THAT IS NOT TIDINESS. PostgreSQL refuses to USE an
-- enum value that was added in the same transaction ("unsafe use of new value
-- of enum type"), and Prisma runs each migration file in one transaction. The
-- CHECK constraint in the migration beside this one names 'CUSTOM' literally,
-- so the value has to be committed before that file runs. Merging the two
-- fails on a fresh database and on an existing one alike.

-- CUSTOM is manual issue: a workshop, a seminar, a short course the LMS never
-- taught. A distinct value rather than a SUBJECT row with the checks skipped,
-- so a reader years later can tell which of the two a certificate was.
ALTER TYPE "CertificateType" ADD VALUE IF NOT EXISTS 'CUSTOM';

-- Withdrawn WITHOUT being discredited: superseded, raised in error, reissued
-- under a new number. It still verifies as genuine; REVOKED does not, and the
-- public page says so in words.
ALTER TYPE "CertificateStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- WHICH certificate it is, as opposed to what it is anchored to. This is the
-- extension point for templates: adding a kind adds a title, a subtitle and a
-- sentence, and touches neither numbering nor verification nor storage.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CertificateKind') THEN
    CREATE TYPE "CertificateKind" AS ENUM ('COMPLETION', 'EXCELLENCE', 'PARTICIPATION', 'TRAINING');
  END IF;
END
$$;
