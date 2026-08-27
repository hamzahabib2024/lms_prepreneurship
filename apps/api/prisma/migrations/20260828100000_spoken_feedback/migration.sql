-- Spoken feedback on a marked submission — FR-ASG-027.
--
-- WHY. For design and language work a marker says in forty seconds what takes
-- ten minutes to write, and says it better: tone carries encouragement a
-- written line cannot, and "this bit here" spoken over a drawing is clearer
-- than any description of where it is. Teachers already record a spoken BRIEF
-- for the same reason; this is the answering half of it.
--
-- IT NEVER REPLACES THE WRITTEN FEEDBACK. A recording is unusable to a deaf
-- student, unsearchable, and unreadable on a metered connection. Optional
-- addition, never a substitute — the same rule the spoken brief follows.
--
-- ON THE GRADE, DELIBERATELY. It is the mark's feedback, so every path that
-- withholds an unreleased grade withholds this with it (BR-ASG-09). A student
-- hearing "well done, 8 out of 10" before the cohort is released would defeat
-- the point of releasing together.
ALTER TABLE "assignment_grades" ADD COLUMN "feedback_audio_key"     VARCHAR(500);
ALTER TABLE "assignment_grades" ADD COLUMN "feedback_audio_type"    VARCHAR(100);
ALTER TABLE "assignment_grades" ADD COLUMN "feedback_audio_seconds" SMALLINT;

-- A recording that is catalogued must say what it is and how long it runs:
-- a player with no duration cannot draw a progress bar, and a stored object
-- with no media type is one the browser has to guess at.
ALTER TABLE "assignment_grades"
  ADD CONSTRAINT "assignment_grades_feedback_audio_complete"
  CHECK (
    "feedback_audio_key" IS NULL
    OR ("feedback_audio_type" IS NOT NULL AND "feedback_audio_seconds" IS NOT NULL)
  );
