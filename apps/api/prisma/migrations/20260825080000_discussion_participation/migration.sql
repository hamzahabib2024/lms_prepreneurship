-- WHAT ACTUALLY GOES WRONG WITH A COURSE FORUM — FR-DSC.
--
-- The threading, the pinning, the locking and the moderation were already
-- here, and they are the right foundation. What was missing is everything that
-- decides whether the forum is USED, and the research on course forums is
-- consistent about what that is.
--
--   THE FAILURE MODE IS SILENCE, NOT DISORDER. Students do not stay away
--   because threads are untidy. They stay away because they are afraid of
--   looking ignorant in front of the class — "freeing themselves from others'
--   eyes and evaluations" is how students describe the appeal of posting
--   anonymously, and the effect on participation is large. That is one column.
--
--   A READER WANTS THE ANSWER, NOT THE ARGUMENT. The reason wiki-style Q&A
--   beats a chat log is that somebody arriving with the same question reads
--   one good answer instead of sifting forty replies for it. That is a second
--   column: a reply the teacher has endorsed, which floats to the top.
--
--   AND A TEACHER NEEDS A WORKLIST. "Which questions has nobody answered?" is
--   unanswerable without somewhere to record that a question is settled. That
--   is the third.
--
-- ANONYMITY HERE IS TO CLASSMATES ONLY, NEVER TO STAFF. The author is stored
-- exactly as before and the column merely decides whether their name is shown
-- to other students. A forum where nobody can be identified at all is one
-- where nobody can be held to anything, and it stops being usable within a
-- term. This is the arrangement every serious course forum uses, and it is the
-- one that raises participation without giving up accountability.
ALTER TABLE "discussion_posts"
  ADD COLUMN "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
  -- Set on a REPLY by a teacher: this is the answer worth reading.
  ADD COLUMN "endorsed_by" UUID REFERENCES "users"(id) ON DELETE SET NULL,
  ADD COLUMN "endorsed_at" TIMESTAMPTZ,
  -- Set on a QUESTION: somebody decided it is settled.
  ADD COLUMN "resolved_by" UUID REFERENCES "users"(id) ON DELETE SET NULL,
  ADD COLUMN "resolved_at" TIMESTAMPTZ;

-- Both halves of each pair arrive together or not at all. A timestamp with no
-- name records that something happened and not who did it, which is the half
-- that matters when somebody asks later.
ALTER TABLE "discussion_posts"
  ADD CONSTRAINT "discussion_posts_endorsement_complete"
  CHECK (("endorsed_by" IS NULL) = ("endorsed_at" IS NULL));

ALTER TABLE "discussion_posts"
  ADD CONSTRAINT "discussion_posts_resolution_complete"
  CHECK (("resolved_by" IS NULL) = ("resolved_at" IS NULL));

-- ONLY A REPLY CAN BE ENDORSED, and only a QUESTION can be resolved.
-- Endorsing a question means nothing, and resolving a reply means nothing;
-- both would render as a badge on the wrong thing, which is the sort of
-- wrongness nobody reports and everybody stops trusting.
ALTER TABLE "discussion_posts"
  ADD CONSTRAINT "discussion_posts_endorse_replies_only"
  CHECK ("endorsed_by" IS NULL OR "parent_post_id" IS NOT NULL);

ALTER TABLE "discussion_posts"
  ADD CONSTRAINT "discussion_posts_resolve_questions_only"
  CHECK ("resolved_by" IS NULL OR "parent_post_id" IS NULL);

-- The teacher's worklist: unanswered questions in a class, newest first.
-- Partial, because a resolved question is never in it and an index carrying
-- them all would be mostly rows nobody queries.
CREATE INDEX "discussion_posts_unresolved"
  ON "discussion_posts" ("section_subject_id", "created_at")
  WHERE "parent_post_id" IS NULL AND "resolved_at" IS NULL AND "deleted_at" IS NULL;
