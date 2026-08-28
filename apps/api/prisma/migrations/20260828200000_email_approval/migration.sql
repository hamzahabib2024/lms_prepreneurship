-- Outgoing account mail waits for a person, when the Institute asks it to.
--
-- WHY THIS IS NOT THE SAME THING AS THE RETRY QUEUE, though it uses the same
-- table. A message held here has NOT been refused by anybody: the mail server
-- was never asked. It is waiting on a decision, and no amount of time or
-- retrying will move it — only somebody looking at it and saying yes.
--
-- Keeping the two states apart matters because they read completely
-- differently on a screen. "The mail account is full, this will go on its own"
-- is a thing to ignore. "Twelve messages are waiting for you" is a thing to do.
-- A single PENDING covering both would have the second quietly disappear into
-- the first, which is how a queue of unsent student passwords sits unnoticed
-- for a week.

ALTER TYPE "PendingEmailStatus" ADD VALUE IF NOT EXISTS 'AWAITING_APPROVAL' BEFORE 'PENDING';

-- Who released it. "Who let this go out" is the question asked after a message
-- reaches somebody it should not have, and the answer has to come from a
-- record rather than from memory (SEC-LOG-009).
ALTER TABLE "pending_emails" ADD COLUMN "approved_by" UUID;
ALTER TABLE "pending_emails" ADD COLUMN "approved_at" TIMESTAMP(3);

-- What the message actually says, for the person deciding whether to send it.
-- Approving something described only as "CREDENTIALS to a@b.com" is approving
-- a category rather than a message.
ALTER TABLE "pending_emails" ADD COLUMN "subject" VARCHAR(300);

-- A released message names who released it, and an unreleased one names
-- nobody. Neither is expressible in the schema language, and both are the kind
-- of thing a half-written approval flow gets wrong.
ALTER TABLE "pending_emails"
    ADD CONSTRAINT "pending_emails_approved_together"
    CHECK (("approved_by" IS NULL) = ("approved_at" IS NULL));
