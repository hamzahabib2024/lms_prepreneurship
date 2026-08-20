-- How much an announcement matters — FR-COM-006.
--
-- The System already had `is_urgent`, and it does real work: BR-COM-02 makes an
-- urgent announcement ignore a recipient's quiet hours. What it did NOT have was
-- anything between "urgent" and "ordinary", so every notice that mattered more
-- than a room change and less than an emergency had one of two homes: dressed
-- as an emergency, or lost in the list.
--
-- The interface showed neither. Urgent rendered as the word "Urgent · " in
-- small text before the title, which is the same weight as the date beside it.
--
-- ONE COLUMN, THREE LEVELS, and `is_urgent` is kept rather than replaced —
-- deleting it would mean rewriting the quiet-hours rule, the notification
-- fan-out and the delivery record for a change that is about how a card looks.
-- The service keeps them in step: URGENT sets is_urgent, anything else clears
-- it, so there is one decision and two representations of it rather than two
-- decisions that can disagree.
ALTER TABLE "announcements"
    ADD COLUMN "priority" VARCHAR(20) NOT NULL DEFAULT 'NORMAL';

ALTER TABLE "announcements"
    ADD CONSTRAINT "announcements_priority_check"
    CHECK ("priority" IN ('NORMAL', 'IMPORTANT', 'URGENT'));

-- Anything already flagged urgent IS urgent. Defaulting every existing row to
-- NORMAL would quietly demote notices somebody deliberately marked, and the
-- flag is the only record of that decision.
UPDATE "announcements" SET "priority" = 'URGENT' WHERE "is_urgent" = true;

-- The list is read newest-first, pinned above the rest, and now with the
-- loudest first among those. Without this index that ordering is a sort over
-- every announcement the Institute has ever posted, on the screen every student
-- opens.
CREATE INDEX "announcements_priority_published_idx"
    ON "announcements" ("is_pinned" DESC, "priority", "published_at" DESC)
    WHERE "deleted_at" IS NULL;
