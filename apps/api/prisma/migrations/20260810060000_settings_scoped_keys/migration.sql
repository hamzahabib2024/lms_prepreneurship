-- Settings: a key is unique per SCOPE, not globally.
--
-- The Setting model shipped with three uniqueness rules that contradicted each
-- other: `key` alone was UNIQUE, while scope_type/scope_id and the compound
-- unique (key, scope_type, scope_id) existed to allow the same key to be set
-- again for a programme, a section or a subject. The first made the other two
-- unreachable -- inserting any override failed with a unique violation.
--
-- Nothing had ever written to this table, so the contradiction sat in the
-- schema from the first migration without producing a single error.
DROP INDEX IF EXISTS "settings_key_key";

-- The compound unique is kept and does the work for scoped rows. It does NOT
-- constrain institute-wide rows, where scope_id is NULL and SQL therefore
-- treats every row as distinct; a partial unique index covers that case and
-- lives in prisma/sql/01_constraints_and_indexes.sql with the other
-- constraints Prisma cannot express.
