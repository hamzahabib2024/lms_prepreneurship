-- A playback ticket belongs to a USER, not to a student.
--
-- It was student-bound and required, so `issuePlaybackTicket` opened with
-- "only a student can watch a lecture" and refused three of the four roles
-- that §4.5 grants lecture_playback:read to. A teacher could publish a
-- recording to their class and never once watch it back; an administrator
-- could not check any recording in the Institute.
--
-- studentId stays, nullable, because watch progress hangs off it
-- (FR-VID-008/010). Staff viewing records nothing: a teacher checking their
-- own recording is not coursework, and counting it would put their viewing
-- into a student's completion figures, which decide certification (BR-PRG-02).

ALTER TABLE playback_tickets ADD COLUMN user_id uuid;

-- Existing tickets are all students'. Backfill from the student they were
-- issued to rather than dropping them: a ticket lives fifteen minutes, but
-- deleting the live ones would sign every current viewer out of their video
-- mid-lecture during the deployment.
UPDATE playback_tickets t
   SET user_id = s.user_id
  FROM students s
 WHERE s.id = t.student_id;

-- Anything that could not be matched has no owner and can never be redeemed,
-- so it is expired rather than left as a row with a null owner.
DELETE FROM playback_tickets WHERE user_id IS NULL;

ALTER TABLE playback_tickets ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE playback_tickets ALTER COLUMN student_id DROP NOT NULL;

DROP INDEX IF EXISTS "playback_tickets_student_id_created_at_idx";
CREATE INDEX IF NOT EXISTS "playback_tickets_user_id_created_at_idx"
  ON playback_tickets (user_id, created_at);
