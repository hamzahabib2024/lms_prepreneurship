-- Receipt numbers on payments (FR-PAY-039..042).
--
-- Nullable: every payment already recorded predates receipts and has none
-- until one is asked for. Allocated once and never changed, because a student
-- holding a printed receipt and the Institute's copy must agree.
ALTER TABLE "payments" ADD COLUMN "receipt_no" VARCHAR(50);
ALTER TABLE "payments" ADD COLUMN "receipt_issued_at" TIMESTAMP(3);

-- Postgres allows many NULLs under a UNIQUE index, so unissued payments do not
-- collide with each other while issued ones cannot share a number.
CREATE UNIQUE INDEX "payments_receipt_no_key" ON "payments" ("receipt_no");
