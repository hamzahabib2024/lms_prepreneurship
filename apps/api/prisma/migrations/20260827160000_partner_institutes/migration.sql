-- Partner institutes — the System's first multi-party boundary.
--
-- Everything before this assumed one institute: one settings row, one name on
-- the certificate, one set of books. A partner sends us students who become
-- fully ours — we enrol, teach, mark and certify them — and their staff need to
-- watch how their people are doing without seeing anybody else's.
--
-- TWO THINGS FOLLOW FROM THE LINK AND NOTHING ELSE DOES: who may look, and who
-- pays. A Student carrying a partner_institute_id has the same enrolments, the
-- same grades and the same certificate as any other.

CREATE TYPE "PartnerBillingMode" AS ENUM ('PARTNER_PAYS', 'STUDENT_PAYS');
CREATE TYPE "FeePayer" AS ENUM ('STUDENT', 'PARTNER');
CREATE TYPE "PartnerInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PART_PAID', 'PAID', 'CANCELLED');

-- ------------------------------------------------------------- institutes --
CREATE TABLE "partner_institutes" (
    "id"            UUID                 NOT NULL,
    "name"          VARCHAR(200)         NOT NULL,
    -- Short and human: it prints on an invoice number the partner has to quote
    -- back to us, and a uuid on a document is a uuid nobody reads aloud.
    "code"          VARCHAR(20)          NOT NULL,

    "contact_name"  VARCHAR(200),
    "contact_email" VARCHAR(320),
    "contact_phone" VARCHAR(20),
    "city"          VARCHAR(100),
    "address"       VARCHAR(500),

    -- The DEFAULT for students imported under this partner. Each student
    -- snapshots their own payer, so changing this never rewrites what an
    -- existing student owes.
    "billing_mode"  "PartnerBillingMode" NOT NULL DEFAULT 'PARTNER_PAYS',

    -- Withdrawn without being deleted: a partner whose students hold
    -- certificates in the world is a partner whose name must keep resolving.
    "is_active"     BOOLEAN              NOT NULL DEFAULT true,
    "notes"         TEXT,

    "created_at"    TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3)         NOT NULL,
    "deleted_at"    TIMESTAMP(3),

    CONSTRAINT "partner_institutes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_institutes_name_key" ON "partner_institutes"("name");
CREATE UNIQUE INDEX "partner_institutes_code_key" ON "partner_institutes"("code");
CREATE INDEX "partner_institutes_is_active_idx" ON "partner_institutes"("is_active");

-- ------------------------------------------------------------------ staff --
-- A partner_admin's ENTIRE reach derives from this one column. Null means they
-- reach nothing, which is the correct direction to fail in.
ALTER TABLE "users" ADD COLUMN "partner_institute_id" UUID;

ALTER TABLE "users"
  ADD CONSTRAINT "users_partner_institute_id_fkey"
  FOREIGN KEY ("partner_institute_id") REFERENCES "partner_institutes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "users_partner_institute_id_idx" ON "users"("partner_institute_id");

-- --------------------------------------------------------------- students --
-- ON THE STUDENT AND NOT ON THE SECTION: a partner's students routinely sit in
-- a class beside our own, so a section cannot answer "whose student is this".
ALTER TABLE "students" ADD COLUMN "partner_institute_id" UUID;

-- WHO PAYS — snapshotted, never read live from the partner. A partner that
-- switches billing mode next term must not retrospectively rewrite who owed
-- what last term (BR-DAT-02).
--
-- PARTNER means no fee_charge row is ever raised against this student, so
-- students.outstanding_balance stays 0 BY CONSTRUCTION rather than by a filter
-- somebody has to remember. That is what keeps debtors() — which is literally
-- outstanding_balance > 0 — from chasing them for their institute's bill.
ALTER TABLE "students" ADD COLUMN "fee_payer" "FeePayer" NOT NULL DEFAULT 'STUDENT';

ALTER TABLE "students"
  ADD CONSTRAINT "students_partner_institute_id_fkey"
  FOREIGN KEY ("partner_institute_id") REFERENCES "partner_institutes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "students_partner_institute_id_idx" ON "students"("partner_institute_id");

-- A student cannot be billed to a partner that does not exist. This is the
-- invariant that stops a PARTNER_PAYS student with no partner: nobody would be
-- invoiced, no charge would be raised, and the tuition would simply evaporate.
ALTER TABLE "students"
  ADD CONSTRAINT "students_partner_payer_needs_partner"
  CHECK ("fee_payer" = 'STUDENT' OR "partner_institute_id" IS NOT NULL);

-- --------------------------------------------------------------- invoices --
CREATE TABLE "partner_invoices" (
    "id"                   UUID                   NOT NULL,
    "partner_institute_id" UUID                   NOT NULL,
    "number"               VARCHAR(50)            NOT NULL,
    "period_label"         VARCHAR(120)           NOT NULL,
    "status"               "PartnerInvoiceStatus" NOT NULL DEFAULT 'DRAFT',

    "currency"             CHAR(3)                NOT NULL DEFAULT 'PKR',
    -- Materialised on issue, so a paid invoice cannot be re-totalled by a
    -- later edit to one of its lines.
    "total_amount"        DECIMAL(12,2)           NOT NULL,
    -- Verified receipts only. Never a claimed figure.
    "paid_amount"         DECIMAL(12,2)           NOT NULL DEFAULT 0,

    "issued_at"           TIMESTAMP(3),
    "due_date"            DATE,
    "notes"               TEXT,

    "created_by"          UUID                    NOT NULL,
    "created_at"          TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)            NOT NULL,

    CONSTRAINT "partner_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_invoices_number_key" ON "partner_invoices"("number");
CREATE INDEX "partner_invoices_partner_status_idx"
  ON "partner_invoices"("partner_institute_id", "status");

ALTER TABLE "partner_invoices"
  ADD CONSTRAINT "partner_invoices_partner_institute_id_fkey"
  FOREIGN KEY ("partner_institute_id") REFERENCES "partner_institutes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money never goes backwards and an invoice is never negative.
ALTER TABLE "partner_invoices"
  ADD CONSTRAINT "partner_invoices_amounts_sane"
  CHECK ("total_amount" >= 0 AND "paid_amount" >= 0);

-- ------------------------------------------------------------------ lines --
CREATE TABLE "partner_invoice_lines" (
    "id"                       UUID          NOT NULL,
    "invoice_id"               UUID          NOT NULL,
    -- Nullable and SET NULL below: the snapshot is what prints, so a purged
    -- student does not take the invoice line with them.
    "student_id"               UUID,

    -- BR-DAT-02. An invoice states what was true when it was issued.
    "student_name_at_issue"    VARCHAR(200)  NOT NULL,
    "registration_no_at_issue" VARCHAR(50)   NOT NULL,
    "programme_at_issue"       VARCHAR(200),

    "description"              VARCHAR(200)  NOT NULL,
    "amount"                   DECIMAL(12,2) NOT NULL,

    "created_at"               TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_invoice_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "partner_invoice_lines"
  ADD CONSTRAINT "partner_invoice_lines_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "partner_invoices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "partner_invoice_lines"
  ADD CONSTRAINT "partner_invoice_lines_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "partner_invoice_lines_invoice_id_idx" ON "partner_invoice_lines"("invoice_id");
CREATE INDEX "partner_invoice_lines_student_id_idx" ON "partner_invoice_lines"("student_id");

-- ------------------------------------------------------------------- role --
-- A NEW ROLE, not an Admin with a narrower scope. An Admin holds FULL on
-- nearly every resource, so one scoping slip on an admin-shaped role would
-- hand an outside organisation the whole Institute. This role starts with
-- nothing and is granted only what §4.5 gives it.
INSERT INTO "roles" ("id", "key", "name", "created_at", "updated_at")
SELECT gen_random_uuid(),
       'partner_admin',
       'Partner institute staff',
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "key" = 'partner_admin');
