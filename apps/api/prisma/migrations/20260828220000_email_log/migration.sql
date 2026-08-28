-- Every message this System tried to send, and what became of it.
--
-- WHY: "the mail account is full" is only half an answer. The other half —
-- WHAT filled it — could not be answered at all, because a message that sent
-- successfully left no trace anywhere. Only failures were recorded, which is
-- precisely backwards for this question: an allowance is spent by the mail
-- that WORKED.
--
-- Two hundred sign-in details from an import re-run by mistake look completely
-- different from two hundred announcements, and until this table existed
-- neither was distinguishable from the other after the fact.
--
-- NO BODY, EVER. The subject and the kind, which is what "where did it go"
-- needs, and never the message itself — those carry temporary passwords, marks
-- and balances.

CREATE TYPE "EmailLogStatus" AS ENUM ('SENT', 'FAILED', 'SUPPRESSED');

CREATE TABLE "email_log" (
    "id"          UUID             NOT NULL,
    "occurred_at" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "to_address"  VARCHAR(320)     NOT NULL,
    -- The message's own category — "account.created", "announcement". Stable
    -- across wording changes, which is what makes it worth grouping by.
    "kind"        VARCHAR(80)      NOT NULL,
    "subject"     VARCHAR(300)     NOT NULL,

    "status"      "EmailLogStatus" NOT NULL,
    -- The mail server's own words when it refused. Absent on a success.
    "detail"      TEXT,

    CONSTRAINT "email_log_pkey" PRIMARY KEY ("id")
);

-- The rolling-24-hour question, which is the only one anybody asks of this.
CREATE INDEX "email_log_occurred_at_idx" ON "email_log"("occurred_at");
CREATE INDEX "email_log_status_occurred_at_idx" ON "email_log"("status", "occurred_at");

-- NO FOREIGN KEY TO users, deliberately. Mail goes to people who have no
-- account here — an applicant being told their application was received, an
-- address that turns out to be a typo. A foreign key would refuse to record
-- exactly the sends that are most worth having a record of.
