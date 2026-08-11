-- A payment slip exists BEFORE the application it belongs to (FR-REG-008).
--
-- This column was NOT NULL, which made an unattached slip impossible to
-- create. The public submit schema demands between one and five slip ids and
-- nothing in the System could produce one, so the public application endpoint
-- could not be reached by anybody. Nullable, and claimed on submission.
ALTER TABLE "registration_documents"
  ALTER COLUMN "registration_request_id" DROP NOT NULL;

-- An unattached slip is rubbish after a day: somebody started an application
-- and abandoned it. This index is what makes finding them cheap.
CREATE INDEX "registration_documents_unattached_idx"
  ON "registration_documents" ("created_at")
  WHERE "registration_request_id" IS NULL;
