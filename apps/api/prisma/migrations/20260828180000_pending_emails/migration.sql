-- A message the mail server would not take yet, kept until it will.
--
-- WHY THIS EXISTS. A mail account has a daily allowance, and Google's is the
-- one that bites here: a free account stops accepting messages after roughly
-- five hundred recipients in a rolling twenty-four hours and answers every
-- further attempt with "550-5.4.5 Daily user sending limit exceeded". That is
-- not a fault in the address, the settings or the message. It is a queue that
-- is full, and it empties on its own.
--
-- Before this table those messages were simply lost. A cohort import reported
-- "not emailed", the operator was expected to read a dozen passwords out by
-- hand, and the message that would have gone through an hour later was never
-- attempted again.
--
-- IT STORES THE INTENT, NEVER THE MESSAGE. The credentials email carries a
-- temporary password, and this System's whole position on those is that they
-- are hashed the moment they are made and nobody — a Super Admin included —
-- can look one up. Keeping a copy here to send later would quietly undo that.
-- So a row records WHO is owed WHAT KIND of message, and the body is built
-- again at the moment it is sent.

CREATE TYPE "PendingEmailKind" AS ENUM ('CREDENTIALS', 'COURSE_ADDED');
CREATE TYPE "PendingEmailStatus" AS ENUM ('PENDING', 'SENT', 'ABANDONED');

CREATE TABLE "pending_emails" (
    "id"              UUID          NOT NULL,
    "kind"            "PendingEmailKind"   NOT NULL,
    "status"          "PendingEmailStatus" NOT NULL DEFAULT 'PENDING',

    "user_id"         UUID          NOT NULL,

    -- Snapshotted, so a queued message still goes somewhere if the address is
    -- changed while it waits, and so the queue reads without a join.
    "to_address"      VARCHAR(320)  NOT NULL,
    "full_name"       VARCHAR(200)  NOT NULL,

    -- The few facts the message needs that are not on the account — which
    -- section a rejoining student was added to, for instance. Never a secret.
    "context"         JSONB,

    "attempts"        INTEGER       NOT NULL DEFAULT 0,
    "last_error"      TEXT,
    -- When this becomes due again. Backed off after each failure, and pushed
    -- well out when the refusal was a daily limit: retrying a full mailbox
    -- every minute achieves nothing and looks like abuse.
    "next_attempt_at" TIMESTAMP(3)  NOT NULL,

    "created_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at"         TIMESTAMP(3),

    CONSTRAINT "pending_emails_pkey" PRIMARY KEY ("id")
);

-- ON DELETE CASCADE: a message owed to an account that has been erased is not
-- a message anybody wants delivered.
ALTER TABLE "pending_emails"
    ADD CONSTRAINT "pending_emails_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The sweep's only query: what is due now. Both columns, in this order,
-- because it filters on status and then orders on the time.
CREATE INDEX "pending_emails_status_next_attempt_at_idx"
    ON "pending_emails"("status", "next_attempt_at");

CREATE INDEX "pending_emails_user_id_idx" ON "pending_emails"("user_id");

-- A row that is still waiting must have a future to wait for, and one that has
-- gone must say when. Neither is expressible in the schema language, and both
-- are the kind of thing a half-written retry loop gets wrong.
ALTER TABLE "pending_emails"
    ADD CONSTRAINT "pending_emails_sent_has_time"
    CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL));

ALTER TABLE "pending_emails"
    ADD CONSTRAINT "pending_emails_attempts_not_negative"
    CHECK ("attempts" >= 0);
