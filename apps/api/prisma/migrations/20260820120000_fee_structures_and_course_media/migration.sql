-- Course media and fee structures.
--
-- TWO THINGS THE SYSTEM COULD NOT DO, and both were visible from the public
-- application form.
--
-- An applicant was asked "the amount you paid" and given nowhere to find out
-- what that amount should be. Fees existed only as charges raised against a
-- student who was ALREADY enrolled, so the number was known to the office and
-- to nobody else. AMOUNT_INSUFFICIENT — a rejection reason the admission module
-- has always carried — is what that gap looks like from the other end.
--
-- And a course had no picture that the Institute could set. `subjects` has
-- carried `thumbnail_url` since the beginning; nothing anywhere ever wrote to
-- it, and `programmes` had no such column at all, so every card on the landing
-- page fell back to generated artwork.

-- ---------------------------------------------------------------- media ----
-- Deliberately NOT another registration_documents row. Everything in that table
-- is reached through an authenticated request and a storage key that never
-- leaves the server (SEC-FIL-009); a course thumbnail is shown to anonymous
-- visitors by design. Keeping the public one in its own table means the rule
-- protecting the private ones has no exception carved into it.
CREATE TABLE "media_assets" (
    "id"                UUID         NOT NULL,
    "kind"              VARCHAR(40)  NOT NULL DEFAULT 'COURSE_THUMBNAIL',
    "storage_key"       VARCHAR(500) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "content_type"      VARCHAR(100) NOT NULL,
    "size_bytes"        BIGINT       NOT NULL,
    "content_hash"      VARCHAR(64)  NOT NULL,
    "created_by"        UUID         NOT NULL,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"        TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- Uploading the same picture twice reuses the row rather than filling storage
-- with copies of one logo.
CREATE UNIQUE INDEX "media_assets_content_hash_key" ON "media_assets" ("content_hash");
CREATE INDEX "media_assets_kind_idx" ON "media_assets" ("kind");

-- ----------------------------------------------------------- thumbnails ----
ALTER TABLE "programmes" ADD COLUMN "thumbnail_asset_id" UUID;
ALTER TABLE "subjects"   ADD COLUMN "thumbnail_asset_id" UUID;

-- SET NULL rather than RESTRICT: deleting a picture must not be blocked by the
-- course that used it, and a course with no picture renders its generated cover
-- exactly as it did before anybody uploaded one.
ALTER TABLE "programmes"
    ADD CONSTRAINT "programmes_thumbnail_asset_id_fkey"
    FOREIGN KEY ("thumbnail_asset_id") REFERENCES "media_assets" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "subjects"
    ADD CONSTRAINT "subjects_thumbnail_asset_id_fkey"
    FOREIGN KEY ("thumbnail_asset_id") REFERENCES "media_assets" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "programmes_thumbnail_asset_id_idx" ON "programmes" ("thumbnail_asset_id");
CREATE INDEX "subjects_thumbnail_asset_id_idx"   ON "subjects" ("thumbnail_asset_id");

-- -------------------------------------------------------- fee structures ---
CREATE TABLE "fee_structures" (
    "id"                  UUID           NOT NULL,
    "programme_id"        UUID           NOT NULL,
    -- NULL = the programme's standing fee, used by any term without its own.
    "academic_session_id" UUID,
    "name"                VARCHAR(150)   NOT NULL,
    "currency"            CHAR(3)        NOT NULL DEFAULT 'PKR',
    "total_amount"        DECIMAL(12,2)  NOT NULL,
    "due_at_application"  DECIMAL(12,2)  NOT NULL,
    "notes"               TEXT,
    "status"              VARCHAR(20)    NOT NULL DEFAULT 'DRAFT',
    "superseded_at"       TIMESTAMP(3),
    "created_by"          UUID           NOT NULL,
    "created_at"          TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)   NOT NULL,
    "deleted_at"          TIMESTAMP(3),

    CONSTRAINT "fee_structures_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fee_structure_lines" (
    "id"               UUID          NOT NULL,
    "fee_structure_id" UUID          NOT NULL,
    -- COMPONENT (what the money is for) or INSTALMENT (when it is due).
    "kind"             VARCHAR(20)   NOT NULL,
    "label"            VARCHAR(120)  NOT NULL,
    "amount"           DECIMAL(12,2) NOT NULL,
    -- INSTALMENT only. Days after enrolment, because one structure serves every
    -- applicant and each of them enrols on a different day.
    "due_after_days"   INTEGER,
    "sort_order"       INTEGER       NOT NULL DEFAULT 0,

    CONSTRAINT "fee_structure_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "fee_structures"
    ADD CONSTRAINT "fee_structures_programme_id_fkey"
    FOREIGN KEY ("programme_id") REFERENCES "programmes" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fee_structures"
    ADD CONSTRAINT "fee_structures_academic_session_id_fkey"
    FOREIGN KEY ("academic_session_id") REFERENCES "academic_sessions" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CASCADE, and it is the one place in this schema where that is right: a line
-- has no meaning apart from its table, and orphaned rows would be counted by
-- the arithmetic check against a structure that no longer exists.
ALTER TABLE "fee_structure_lines"
    ADD CONSTRAINT "fee_structure_lines_fee_structure_id_fkey"
    FOREIGN KEY ("fee_structure_id") REFERENCES "fee_structures" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "fee_structures_programme_id_status_idx"
    ON "fee_structures" ("programme_id", "status");
CREATE INDEX "fee_structures_academic_session_id_idx"
    ON "fee_structures" ("academic_session_id");
CREATE INDEX "fee_structure_lines_fee_structure_id_kind_sort_order_idx"
    ON "fee_structure_lines" ("fee_structure_id", "kind", "sort_order");

-- AT MOST ONE PUBLISHED STRUCTURE PER PROGRAMME PER TERM, enforced here rather
-- than in the service. Two published structures for one course means the apply
-- page picks one arbitrarily and half the applicants are quoted the wrong fee —
-- a race between two administrators publishing at once, which no amount of
-- checking-then-writing in application code prevents.
--
-- Two partial indexes rather than one, because SQL does not consider two NULLs
-- equal: without the second, any number of published programme-wide structures
-- could exist side by side.
CREATE UNIQUE INDEX "fee_structures_one_published_per_session"
    ON "fee_structures" ("programme_id", "academic_session_id")
    WHERE "status" = 'PUBLISHED' AND "deleted_at" IS NULL AND "academic_session_id" IS NOT NULL;

CREATE UNIQUE INDEX "fee_structures_one_published_programme_wide"
    ON "fee_structures" ("programme_id")
    WHERE "status" = 'PUBLISHED' AND "deleted_at" IS NULL AND "academic_session_id" IS NULL;

-- A line is one kind or the other, and an amount is never negative. Both are
-- invariants the editor relies on when it sums the table.
ALTER TABLE "fee_structure_lines"
    ADD CONSTRAINT "fee_structure_lines_kind_check"
    CHECK ("kind" IN ('COMPONENT', 'INSTALMENT'));

ALTER TABLE "fee_structure_lines"
    ADD CONSTRAINT "fee_structure_lines_amount_check"
    CHECK ("amount" >= 0);

ALTER TABLE "fee_structures"
    ADD CONSTRAINT "fee_structures_status_check"
    CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'));

-- What the applicant pays now cannot exceed what the course costs. Caught here
-- because the number reaches a member of the public, on a page that is telling
-- them how much money to transfer.
ALTER TABLE "fee_structures"
    ADD CONSTRAINT "fee_structures_amounts_check"
    CHECK ("total_amount" >= 0 AND "due_at_application" >= 0
           AND "due_at_application" <= "total_amount");
