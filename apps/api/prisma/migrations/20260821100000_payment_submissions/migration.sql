-- A student saying they have paid.
--
-- THE GAP THIS CLOSES. `payments` is verified money by construction —
-- verified_amount, verified_by and verified_at are all NOT NULL — and the only
-- two things that ever inserted a row were an administrator approving an
-- admission and an administrator typing at the fee screen. A student who
-- transferred their second instalment had NOWHERE IN THE SYSTEM TO SAY SO.
-- The slip went to somebody's personal WhatsApp, the ledger went on saying the
-- money was owed, and the record of the payment began whenever a human got
-- round to typing it in.
--
-- A CLAIM IS THEREFORE ITS OWN TABLE, and never becomes a payment until
-- somebody with authority has opened the proof. claimed_amount is evidence,
-- not money: nothing here touches students.outstanding_balance. Verifying a
-- submission INSERTS a payment, and that payment is what the ledger sees.

-- ------------------------------------------------------------- methods ----
-- EasyPaisa and JazzCash are how Pakistan pays. Filing a mobile-wallet receipt
-- as BANK_TRANSFER or OTHER meant the office could not tell a wallet transfer
-- from a counter deposit without opening the image, and "OTHER" on a printed
-- receipt names no transaction the holder can look up.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'EASYPAISA';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'JAZZCASH';

CREATE TYPE "PaymentSubmissionStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'CANCELLED');

-- --------------------------------------------------------- submissions ----
CREATE TABLE "payment_submissions" (
    "id"                            UUID                      NOT NULL,
    -- What the student quotes to the office. Allocated from the same atomic
    -- series as a receipt number, so two students submitting at the same
    -- moment cannot be handed one reference.
    "reference"                     VARCHAR(50)               NOT NULL,
    "student_id"                    UUID                      NOT NULL,
    "status"                        "PaymentSubmissionStatus" NOT NULL DEFAULT 'PENDING',

    -- THE CLAIM. Not money.
    "claimed_amount"                DECIMAL(12,2)             NOT NULL,
    "currency"                      CHAR(3)                   NOT NULL DEFAULT 'PKR',
    "payment_date"                  DATE                      NOT NULL,
    "method"                        "PaymentMethod"           NOT NULL,
    "bank_reference"                VARCHAR(100),
    "student_note"                  TEXT,
    -- What they were told they still owed when they submitted, so a
    -- disagreement months later can be read as it stood.
    "outstanding_at_submission"     DECIMAL(12,2),

    -- Snapshots (BR-DAT-02). A receipt states what was true when the money
    -- changed hands; a later transfer or name correction must not rewrite a
    -- document the Institute has already issued.
    "student_name_at_submission"    VARCHAR(200)              NOT NULL,
    "registration_no_at_submission" VARCHAR(50)               NOT NULL,
    "programme_at_submission"       VARCHAR(200),
    "section_at_submission"         VARCHAR(150),
    "roll_no_at_submission"         SMALLINT,

    "reviewed_by"                   UUID,
    "reviewed_at"                   TIMESTAMP(3),
    -- Shown to the student. A rejection with no reason is an instruction to
    -- telephone the office.
    "review_note"                   TEXT,
    "verified_amount"               DECIMAL(12,2),
    "payment_id"                    UUID,

    "submitted_at"                  TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                    TIMESTAMP(3)              NOT NULL,

    CONSTRAINT "payment_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_submissions_reference_key"  ON "payment_submissions" ("reference");
CREATE UNIQUE INDEX "payment_submissions_payment_id_key" ON "payment_submissions" ("payment_id");
-- The office's queue, oldest first: the order it has to be worked in.
CREATE INDEX "payment_submissions_status_submitted_at_idx"  ON "payment_submissions" ("status", "submitted_at");
CREATE INDEX "payment_submissions_student_id_submitted_at_idx" ON "payment_submissions" ("student_id", "submitted_at");

-- RESTRICT on both. A submission is a financial record: deleting a student
-- must fail rather than quietly erase the evidence that they paid, and the
-- payment a verification produced must outlive nothing.
ALTER TABLE "payment_submissions"
    ADD CONSTRAINT "payment_submissions_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "students" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_submissions"
    ADD CONSTRAINT "payment_submissions_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- --------------------------------------------------------------- proof ----
-- The same table as an admission slip, because it is the same object: a
-- photograph of a bank or wallet receipt, typed by content, stored under a key
-- the client never sees. A parallel proofs table would mean two upload
-- pipelines and two chances for one of them to skip a check.
ALTER TABLE "registration_documents" ADD COLUMN "payment_submission_id" UUID;

ALTER TABLE "registration_documents"
    ADD CONSTRAINT "registration_documents_payment_submission_id_fkey"
    FOREIGN KEY ("payment_submission_id") REFERENCES "payment_submissions" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "registration_documents_payment_submission_id_idx"
    ON "registration_documents" ("payment_submission_id");
