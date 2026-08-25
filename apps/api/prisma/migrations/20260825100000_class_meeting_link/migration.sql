-- A STANDING ROOM FOR THE CLASS — FR-LIV.
--
-- A join link already exists PER SESSION, on the provider binding: a new Meet
-- created for each scheduled occurrence. That is the right model when the
-- System is creating the meetings.
--
-- It is not how most institutes actually teach. A class has ONE room, the same
-- link every week, pasted into the timetable at the start of term and used
-- until it ends. Under the per-session model a teacher with no Google
-- integration has nowhere to put that link at all, and ends up sending it on
-- WhatsApp — where a student who joined in week three has to scroll back to
-- find it every Tuesday.
--
-- SO THE LINK BELONGS TO THE SECTION-SUBJECT — the subject as taught to one
-- group — and NOT to the subject itself. Graphic Designing is taught to four
-- sections at four different times; one link on the subject would put every
-- section in the same room. This is the distinction the request names, and it
-- is the one that matters.
--
-- OPAQUE, PER ARC-025. The System stores it, shows it and never parses it. It
-- is not required to be a Google link: an institute using Zoom or Teams pastes
-- theirs and everything works, because nothing here reads the URL beyond
-- checking it is one.
--
-- NEVER PUBLIC. A meeting link is a key to the room. It is served only to
-- people the scope predicate already lets into this class — the enrolled
-- students and the teaching staff — and appears in no public projection.
ALTER TABLE "section_subjects"
  ADD COLUMN "meeting_url" VARCHAR(1000),
  -- What a student needs to know before they click: "we use the waiting room,
  -- join five minutes early", or a passcode. Free text, deliberately: the
  -- Institute knows what its own students need told and the System does not.
  ADD COLUMN "meeting_note" VARCHAR(500);

-- https ONLY, and the reason is not tidiness.
--
-- A link rendered into an anchor is a link somebody clicks. `javascript:` and
-- `data:` URLs in that position are a stored cross-site scripting hole, and an
-- http link hands the room's address to anybody on the same café wifi. The
-- interface refuses these too; this is the guarantee, because the interface is
-- one of several ways a row can be written and the database is the only one
-- everything goes through.
ALTER TABLE "section_subjects"
  ADD CONSTRAINT "section_subjects_meeting_url_https"
  CHECK ("meeting_url" IS NULL OR "meeting_url" LIKE 'https://%');

-- A note about a meeting that does not exist would be shown against nothing.
ALTER TABLE "section_subjects"
  ADD CONSTRAINT "section_subjects_meeting_note_needs_url"
  CHECK ("meeting_note" IS NULL OR "meeting_url" IS NOT NULL);
