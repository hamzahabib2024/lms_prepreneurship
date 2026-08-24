-- A SEPARATE FILE, AND THAT IS NOT TIDINESS.
--
-- Postgres will not let a newly added enum value be USED in the same
-- transaction that added it, and Prisma runs each migration in one. The
-- previous file adds PUBLIC_ONLY; this one is the first that may refer to it.
--
-- The constraint being replaced said "only an INSTITUTE notice may be public",
-- which was right when INSTITUTE was the only audience the public page could
-- draw from. PUBLIC_ONLY exists precisely to be public and to reach nobody
-- inside the System, so the rule widens to name both — and stays a rule,
-- because the thing it prevents is a notice written for one section appearing
-- on the front page, which is a disclosure rather than an untidiness.
ALTER TABLE "announcements"
  DROP CONSTRAINT IF EXISTS "announcements_public_is_institute_wide";

ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_public_audience"
  CHECK ("is_public" = false OR "audience" IN ('INSTITUTE', 'PUBLIC_ONLY'));

-- A PUBLIC_ONLY notice that is not public is a notice addressed to nobody at
-- all: it reaches no inbox by construction and would not reach the page
-- either. Refused here rather than left to be discovered as a notice somebody
-- wrote and nobody ever saw.
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_public_only_is_public"
  CHECK ("audience" <> 'PUBLIC_ONLY' OR "is_public" = true);
