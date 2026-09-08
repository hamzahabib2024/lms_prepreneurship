#!/bin/sh
# The API's start-up sequence, in the order the System requires.
set -e

# 1. Signing keys (SEC-AUT-005). Generated into a VOLUME if absent, never baked
#    into the image — an image containing a private key is a private key on
#    every machine that pulls it. Keeping them on a volume also means restarting
#    the container does not invalidate every session.
if [ ! -f "${JWT_PRIVATE_KEY_PATH:-/app/keys/jwt-private.pem}" ]; then
  echo "→ no signing keys found; generating a pair"
  node scripts/generate-keys.mjs
fi

# 2. The schema.
echo "→ applying migrations"
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma

# 3. The half of the schema Prisma cannot express: partial unique indexes, CHECK
#    constraints, and the trigger that makes the audit log append-only
#    (FR-LOG-004). Skipping this leaves a System that looks fine and silently
#    permits duplicates. It is idempotent, so it runs on every start.
echo "→ applying constraints and triggers"
node scripts/apply-sql.mjs apps/api/prisma/sql/01_constraints_and_indexes.sql

# 4. Somewhere for the recorder to put a lecture.
#
#    The Egress container writes finished recordings straight into this volume,
#    so that a recording IS a lecture with nothing copying it afterwards. But it
#    runs as a DIFFERENT USER — uid 1001 there against node's 1000 here — and
#    the volume root is owned by node with 755, so Egress cannot create anything
#    in it. Measured: `mkdir /out/lectures` fails with permission denied, and
#    the recording dies at the last step with the whole lesson already encoded.
#
#    So this side creates the directory and opens it, rather than the recorder
#    being run as root to work around it. Confined to one directory inside a
#    private volume shared by exactly these two services.
echo "→ ensuring the lecture directory is writable by the recorder"
mkdir -p "${LOCAL_STORAGE_ROOT:-/app/storage}/lectures"
chmod 0777 "${LOCAL_STORAGE_ROOT:-/app/storage}/lectures"

# NO SEED. A seed writes development accounts with published passwords, and an
# entrypoint that runs it would put them on a production server. Seed manually
# and deliberately, or not at all.

exec "$@"
