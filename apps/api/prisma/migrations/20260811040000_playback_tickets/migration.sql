-- Playback tickets move from process memory into the database (ARC-049).
--
-- They were a Map on ContentService, which worked exactly as long as there was
-- one process. A ticket minted on one node is invisible to another, so running
-- a second instance would refuse roughly half of all playback with "this link
-- has expired" — and the failure would look like an expiry bug rather than a
-- scaling one.
--
-- No foreign keys, deliberately. A ticket is ephemeral and is swept on expiry;
-- constraining it to a student and a lecture would mean a deleted lecture could
-- not be removed until its last ticket had timed out, for no benefit — the
-- redeem path re-checks the actor against the ticket anyway.
CREATE TABLE "playback_tickets" (
    "ticket_id" VARCHAR(80) NOT NULL,
    "student_id" UUID NOT NULL,
    "recorded_lecture_id" UUID NOT NULL,
    "storage_ref" VARCHAR(500) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playback_tickets_pkey" PRIMARY KEY ("ticket_id")
);

CREATE INDEX "playback_tickets_expires_at_idx" ON "playback_tickets"("expires_at");
CREATE INDEX "playback_tickets_student_id_created_at_idx" ON "playback_tickets"("student_id", "created_at");
