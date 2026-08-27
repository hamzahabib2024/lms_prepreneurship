-- Spoken feedback moves from the GRADE to the SUBMISSION.
--
-- WHY IT MOVED, one migration after it arrived. On the grade, a teacher had to
-- award a mark before they could say anything out loud — so the commonest
-- thing a marker actually wants to record ("this is the wrong export, send me
-- a PDF and I will mark it") was the one thing they could not, because there
-- was no grade row to attach it to yet. The barrier was invisible until a
-- teacher opened an unmarked student and found the recorder replaced by an
-- instruction to mark first.
--
-- AND IT IS NOW IMMEDIATE, like the written comment thread beside it, rather
-- than released with the cohort. A spoken note is a conversation about the
-- work; the MARK is still released together (BR-ASG-09), and this is not the
-- mark.

ALTER TABLE "assignment_submissions" ADD COLUMN "feedback_audio_key"     VARCHAR(500);
ALTER TABLE "assignment_submissions" ADD COLUMN "feedback_audio_type"    VARCHAR(100);
ALTER TABLE "assignment_submissions" ADD COLUMN "feedback_audio_seconds" SMALLINT;
ALTER TABLE "assignment_submissions" ADD COLUMN "feedback_audio_at"      TIMESTAMP(3);

-- Carry across anything already recorded, so a teacher who used the feature in
-- the hour it existed on the grade does not lose it.
UPDATE "assignment_submissions" s
   SET "feedback_audio_key"     = g."feedback_audio_key",
       "feedback_audio_type"    = g."feedback_audio_type",
       "feedback_audio_seconds" = g."feedback_audio_seconds",
       "feedback_audio_at"      = CURRENT_TIMESTAMP
  FROM "assignment_grades" g
 WHERE g."submission_id" = s."id"
   AND g."feedback_audio_key" IS NOT NULL;

ALTER TABLE "assignment_grades" DROP CONSTRAINT IF EXISTS "assignment_grades_feedback_audio_complete";
ALTER TABLE "assignment_grades" DROP COLUMN IF EXISTS "feedback_audio_key";
ALTER TABLE "assignment_grades" DROP COLUMN IF EXISTS "feedback_audio_type";
ALTER TABLE "assignment_grades" DROP COLUMN IF EXISTS "feedback_audio_seconds";

-- A catalogued recording must say what it is and how long it runs: a player
-- with no duration cannot draw a progress bar, and a stored object with no
-- media type is one the browser has to guess at.
ALTER TABLE "assignment_submissions"
  ADD CONSTRAINT "assignment_submissions_feedback_audio_complete"
  CHECK (
    "feedback_audio_key" IS NULL
    OR ("feedback_audio_type" IS NOT NULL AND "feedback_audio_seconds" IS NOT NULL)
  );
