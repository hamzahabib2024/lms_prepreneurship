-- A SPOKEN BRIEF — FR-ASG, the other half of a spoken answer.
--
-- An assignment's instructions have always been text, and for a design or a
-- language course that is the wrong medium for the part that matters. A tutor
-- explaining what they want from a logo says it in forty seconds and says it
-- better than four paragraphs; typing it loses the emphasis, and the emphasis
-- IS the brief.
--
-- STORED LIKE A SUBMISSION FILE, NOT LIKE A COURSE THUMBNAIL. It goes through
-- the ordinary document storage the Institute has configured (ARC-043) and is
-- reached only through an authenticated route: a brief belongs to the students
-- enrolled in that class and to nobody else. There is deliberately no public
-- endpoint for it, which is what separates this from MediaAsset.
--
-- THREE COLUMNS RATHER THAN A TABLE. One assignment has at most one spoken
-- brief — a second recording replaces the first — so a row of its own would
-- carry a foreign key, a soft-delete and a uniqueness constraint to express
-- "zero or one", which three nullable columns already say.
ALTER TABLE "assignments"
  ADD COLUMN "brief_audio_key" VARCHAR(500),
  -- REPORTED BY THE BROWSER, AND CLAMPED. Measuring the length of an Opus
  -- stream server-side needs ffmpeg, which this System does not ship, so this
  -- is the recorder's own count of the seconds it ran. It is a display hint --
  -- "0:42" on a card, so a student knows whether to press play -- and NOTHING
  -- is decided by it: no mark, no deadline, no progress. A wrong value costs a
  -- wrong label, which is why a value that cannot be verified is acceptable
  -- here and would not be on a lecture.
  ADD COLUMN "brief_audio_seconds" SMALLINT,
  -- The container the browser recorded in — webm on Chrome and Firefox, m4a
  -- on Safari. Kept so playback can answer with the right Content-Type rather
  -- than guessing from an extension the System generated itself.
  ADD COLUMN "brief_audio_type" VARCHAR(100);

-- All three arrive together or not at all. A key with no type cannot be
-- served, and a type with no key describes nothing — both are states that can
-- only come from a half-finished write, and the constraint makes that
-- impossible rather than something to remember.
ALTER TABLE "assignments"
  ADD CONSTRAINT "assignments_brief_audio_complete"
  CHECK (
    ("brief_audio_key" IS NULL AND "brief_audio_type" IS NULL)
    OR ("brief_audio_key" IS NOT NULL AND "brief_audio_type" IS NOT NULL)
  );
