-- Discussion posts: a question thread per subject offering (FR-DSC-001..012).
--
-- `discussion_post` has been in the section 4.5 matrix since the first commit
-- with no endpoint and no table.
--
-- ONE LEVEL OF REPLIES. Arbitrary nesting makes a thread unreadable on a phone
-- and makes "which question is this answering" ambiguous, which is the only
-- thing a course forum has to get right.
CREATE TABLE "discussion_posts" (
    "id" UUID NOT NULL,
    "section_subject_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "parent_post_id" UUID,
    "title" VARCHAR(200),
    "body" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "edited_at" TIMESTAMP(3),
    "removed_by_moderator" BOOLEAN NOT NULL DEFAULT false,
    "removal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "discussion_posts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "discussion_posts_offering_pinned_idx"
    ON "discussion_posts"("section_subject_id", "is_pinned", "created_at");
CREATE INDEX "discussion_posts_parent_idx"
    ON "discussion_posts"("parent_post_id", "created_at");

ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_section_subject_id_fkey"
    FOREIGN KEY ("section_subject_id") REFERENCES "section_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_author_user_id_fkey"
    FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_parent_post_id_fkey"
    FOREIGN KEY ("parent_post_id") REFERENCES "discussion_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A reply is an answer to a question, not a thread of its own: it has no title,
-- and it cannot be pinned or locked independently of the thread it belongs to.
ALTER TABLE "discussion_posts" ADD CONSTRAINT "discussion_posts_reply_shape"
    CHECK ("parent_post_id" IS NULL
        OR ("title" IS NULL AND "is_pinned" = false AND "is_locked" = false));

-- ONE LEVEL. Enforced by a trigger because a CHECK cannot see another row: a
-- reply whose parent is itself a reply would be the second level, and the
-- interface has nowhere to put it.
CREATE OR REPLACE FUNCTION discussion_posts_one_level() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_post_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM discussion_posts p
      WHERE p.id = NEW.parent_post_id AND p.parent_post_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'A reply cannot be answered directly; reply to the question instead.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS discussion_posts_one_level_trg ON discussion_posts;
CREATE TRIGGER discussion_posts_one_level_trg
  BEFORE INSERT OR UPDATE ON discussion_posts
  FOR EACH ROW EXECUTE FUNCTION discussion_posts_one_level();
