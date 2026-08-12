-- An announcement may also be shown on the public page (FR-COM, FR-PUB).
--
-- Defaults to false: an announcement is written for people inside the
-- Institute, and publishing is a deliberate second act rather than the absence
-- of a decision.
ALTER TABLE "announcements" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT false;

-- Only an institute-wide announcement may be public. One addressed to a
-- section is addressed to those students, and the database refuses the
-- combination rather than trusting every future caller to remember.
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_public_is_institute_wide"
    CHECK ("is_public" = false OR "audience" = 'INSTITUTE');

-- The public page asks for "recent, public, not expired" and nothing else.
CREATE INDEX "announcements_public_idx"
    ON "announcements" ("is_public", "published_at" DESC)
    WHERE "deleted_at" IS NULL;