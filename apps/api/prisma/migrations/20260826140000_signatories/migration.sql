-- WHO SIGNS A CERTIFICATE (FR-CRT).
--
-- A library rather than settings keys: the Institute has a Principal, a
-- Director and a Programme Head, which of them signs depends on the award, and
-- promotions should not need a developer.
CREATE TABLE "signatories" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"               VARCHAR(200) NOT NULL,
  "designation"        VARCHAR(150) NOT NULL,
  "signature_asset_id" UUID REFERENCES "media_assets"("id") ON DELETE SET NULL,
  "is_active"          BOOLEAN NOT NULL DEFAULT TRUE,
  "sort_order"         SMALLINT NOT NULL DEFAULT 0,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"         TIMESTAMP(3),

  -- A signatory with no name is a ruled line with nothing under it.
  CONSTRAINT "signatories_name_not_blank" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "signatories_designation_not_blank" CHECK (length(btrim("designation")) > 0)
);

CREATE INDEX "signatories_active_order_idx" ON "signatories"("is_active", "sort_order");

-- WHO SIGNED ONE, AS THEY WERE AT THE MOMENT OF ISSUE.
--
-- A snapshot, like every other *_snapshot column on this table. The Principal
-- retires and a certificate issued in 2026 must still print in 2031 exactly as
-- it was signed; reading through to the live rows would rewrite history every
-- time somebody was promoted.
ALTER TABLE "certificates" ADD COLUMN "signatories_snapshot" JSONB;

-- At most four. The foot of the certificate has room for four blocks and the
-- fifth would print off the edge of the paper.
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_signatories_at_most_four"
  CHECK (
    "signatories_snapshot" IS NULL
    OR (jsonb_typeof("signatories_snapshot") = 'array'
        AND jsonb_array_length("signatories_snapshot") BETWEEN 0 AND 4)
  );
