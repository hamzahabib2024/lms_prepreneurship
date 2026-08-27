-- What the teacher said about the work — FR-ASG-027.
--
-- THE GAP THIS CLOSES. `assignment_grades.feedback` already existed, and it is
-- welded to a mark: a row cannot exist without raw_marks and final_marks, and
-- a student does not see it until the cohort's grades are released. So a
-- teacher who opened a submission, saw the wrong file type, and wanted to say
-- "send me a PDF and I will mark it" had to either invent a score or leave the
-- System and send a WhatsApp message. The most useful thing a marker can do —
-- tell somebody what is wrong while there is still time to fix it — was the
-- one thing there was nowhere to record.
--
-- A COMMENT IS THEREFORE ITS OWN TABLE, and it is not a grade. Nothing here
-- carries marks, nothing here is gated on release, and nothing here changes
-- what a student scored.

CREATE TABLE "submission_comments" (
    "id"             UUID         NOT NULL,
    "submission_id"  UUID         NOT NULL,

    -- NULL means the comment is about the submission as a whole. Set, it is
    -- about ONE file, and the screen shows it beside that file — a student who
    -- handed in four files and is told "this is the wrong format" should not
    -- have to guess which of the four.
    "file_id"        UUID,

    "author_user_id" UUID         NOT NULL,
    -- Snapshotted like an audit entry's, so a teacher who is later made an
    -- administrator does not turn last term's feedback into a ruling.
    "author_role"    VARCHAR(20)  NOT NULL,

    "body"           TEXT         NOT NULL,

    -- Stamped when the text changes, so a student can see that what they are
    -- reading is not what was first written.
    "edited_at"      TIMESTAMP(3),
    -- Withdrawn from view, kept on the record. A student who was told
    -- something and later disputes it is entitled to find it.
    "deleted_at"     TIMESTAMP(3),

    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submission_comments_pkey" PRIMARY KEY ("id")
);

-- ON DELETE CASCADE from the submission: a comment about work that no longer
-- exists is about nothing. The AUTHOR is RESTRICT — the same rule the rest of
-- the schema uses for a person named on a record — so removing a teacher
-- cannot silently erase the feedback they gave.
ALTER TABLE "submission_comments"
  ADD CONSTRAINT "submission_comments_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "submission_comments"
  ADD CONSTRAINT "submission_comments_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "submission_files"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "submission_comments"
  ADD CONSTRAINT "submission_comments_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The thread, in the order it was written. Every read of this table is
-- "the comments on this submission, oldest first".
CREATE INDEX "submission_comments_submission_id_created_at_idx"
  ON "submission_comments"("submission_id", "created_at");

-- The comments hanging off one file, for the panel beside it.
CREATE INDEX "submission_comments_file_id_idx"
  ON "submission_comments"("file_id");

-- A comment must be about something a person can read. An empty body is a
-- mis-save, and it reaches the student's screen as a blank speech bubble.
ALTER TABLE "submission_comments"
  ADD CONSTRAINT "submission_comments_body_not_blank"
  CHECK (length(btrim("body")) > 0);
