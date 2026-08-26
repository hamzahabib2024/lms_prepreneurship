-- A single-use ticket for setting a forgotten password (FR-AUT).
--
-- ONLY THE HASH IS STORED. The token itself lives in the email that carried it
-- and in the reader's address bar, nowhere else, so this table is worth
-- nothing to anybody who steals it.
CREATE TABLE "password_reset_tokens" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash"     VARCHAR(64) NOT NULL,
  "expires_at"     TIMESTAMP(3) NOT NULL,
  "used_at"        TIMESTAMP(3),
  "requested_from" VARCHAR(64),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- A hash is 64 hex characters. Anything else did not come from this System.
  CONSTRAINT "password_reset_tokens_hash_is_sha256"
    CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),

  -- A token that expires before it exists cannot be produced by any code path
  -- here, and the constraint is what keeps that true of code written later.
  CONSTRAINT "password_reset_tokens_expiry_after_creation"
    CHECK ("expires_at" > "created_at"),

  -- Spending a token cannot pre-date issuing it.
  CONSTRAINT "password_reset_tokens_used_after_creation"
    CHECK ("used_at" IS NULL OR "used_at" >= "created_at")
);

CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key"
  ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");
