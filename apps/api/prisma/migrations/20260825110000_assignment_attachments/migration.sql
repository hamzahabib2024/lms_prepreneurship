-- THE THIRD WAY A TEACHER CAN SET A BRIEF — FR-ASG.
--
-- An assignment could already carry written instructions and a spoken brief.
-- What it could not carry is the thing most briefs actually need: the FILE.
-- A design task comes with a logo to work from, a language task with a passage
-- to read, an accounting task with the trial balance. Without somewhere to put
-- them the teacher sends them on WhatsApp, and a student who joins in week
-- three has to ask for the attachment every time.
--
-- A TABLE RATHER THAN COLUMNS, unlike the spoken brief. One assignment has at
-- most one recording, so three nullable columns say "zero or one" exactly. It
-- has any number of attachments, and the moment the answer is "many" the
-- columns become attachment_1_key, attachment_2_key, and a ceiling nobody
-- chose.
--
-- STORED LIKE A SUBMISSION, NOT LIKE A COURSE PICTURE. It goes to the
-- Institute's configured document storage and is reached only through an
-- authenticated route: a brief belongs to the students enrolled in that class.
-- There is deliberately no public endpoint, which is what separates this from
-- MediaAsset.
CREATE TABLE "assignment_attachments" (
  "id"            UUID PRIMARY KEY,
  "assignment_id" UUID NOT NULL REFERENCES "assignments"(id) ON DELETE CASCADE,

  "storage_key"       VARCHAR(500) NOT NULL,
  -- The name the TEACHER gave it, shown to students. Never used as a path:
  -- the stored name is generated (SEC-FIL-005).
  "original_filename" VARCHAR(255) NOT NULL,
  -- Determined by CONTENT, not by the extension (SEC-FIL-003).
  "content_type"      VARCHAR(100) NOT NULL,
  "size_bytes"        BIGINT       NOT NULL,
  "content_hash"      VARCHAR(64)  NOT NULL,

  "uploaded_by" UUID NOT NULL REFERENCES "users"(id) ON DELETE RESTRICT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "assignment_attachments_by_assignment"
  ON "assignment_attachments" ("assignment_id", "created_at");

-- THE SAME FILE ATTACHED TWICE IS A MISTAKE, NOT AN INTENTION.
--
-- A teacher who uploads the brief, notices a typo, fixes it and uploads again
-- gets two files with different names and identical contents, and a student
-- has to guess which is current. Deduplicated by content within an assignment;
-- across assignments the same file is legitimately attached to several.
CREATE UNIQUE INDEX "assignment_attachments_unique_content"
  ON "assignment_attachments" ("assignment_id", "content_hash");
