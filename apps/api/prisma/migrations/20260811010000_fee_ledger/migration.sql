-- The fee ledger: what a student owes (FR-PAY-020..032).
--
-- Student.outstanding_balance has existed since the first migration and
-- nothing ever wrote to it. The personal-data export therefore told every
-- student they owed nothing, and the erasure refusal that checks for an
-- outstanding balance could never fire. Payments were recorded at admission
-- and set against nothing at all.
--
-- A charge is never deleted (BR-DAT-02). It is WAIVED, which keeps the
-- decision to write it off in the record, with who made it and why.
CREATE TABLE "fee_charges" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PKR',
    "due_date" DATE NOT NULL,
    "academic_session_id" UUID,
    "waived_at" TIMESTAMP(3),
    "waived_by" UUID,
    "waiver_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fee_charges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fee_charges_student_id_due_date_idx" ON "fee_charges"("student_id", "due_date");
CREATE INDEX "fee_charges_due_date_waived_at_idx" ON "fee_charges"("due_date", "waived_at");

ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_academic_session_id_fkey"
    FOREIGN KEY ("academic_session_id") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A charge for nothing is a mistake, not a policy. Zero would produce a
-- statement line that changes no balance and explains nothing.
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_amount_positive"
    CHECK ("amount" > 0);

-- A waiver is a decision somebody made: it cannot be half-recorded.
ALTER TABLE "fee_charges" ADD CONSTRAINT "fee_charges_waiver_complete"
    CHECK (("waived_at" IS NULL AND "waived_by" IS NULL)
        OR ("waived_at" IS NOT NULL AND "waived_by" IS NOT NULL));
