-- A PERSON SAYING THE STUDENT HAS FINISHED — FR-CRT, FR-PRG.
--
-- Completion has always been COMPUTED: attendance, work submitted, marks and
-- lectures watched, weighed against criteria. That figure is evidence, and
-- evidence is not a decision.
--
-- It cannot know that a student sat a viva, made up a missed brief over the
-- summer, or did everything asked of them in a term that lost two weeks. Nor
-- can it know that somebody scraped past every threshold by a point and is
-- plainly not ready to be handed a certificate with the Institute's name on it.
--
-- So the judgement is recorded beside the arithmetic rather than instead of it,
-- and the arithmetic AT THE MOMENT OF THE DECISION is copied onto the row. That
-- is the column that makes this worth having: it is the difference between "the
-- teacher agreed with the System" and "the teacher overrode it", and six months
-- later, when somebody asks why a certificate was issued to a student whose
-- attendance reads 61%, the answer is on the record rather than in somebody's
-- memory.
--
-- ONE DECISION PER STUDENT PER SUBJECT, replaced rather than accumulated: the
-- question "has this student finished?" has one current answer. The history of
-- how that answer changed is the audit log's job, and it already keeps it.
CREATE TYPE "CompletionDecision" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'NOT_COMPLETED');

CREATE TABLE "subject_completions" (
  "id"                 UUID PRIMARY KEY,
  "student_id"         UUID NOT NULL REFERENCES "students"(id) ON DELETE CASCADE,
  "section_subject_id" UUID NOT NULL REFERENCES "section_subjects"(id) ON DELETE CASCADE,

  "decision" "CompletionDecision" NOT NULL,
  -- Why. Required when overriding the computed answer, because "the teacher
  -- decided" is not a reason anybody can act on later.
  "note" TEXT,

  -- THE ARITHMETIC AS IT STOOD. Nullable because a subject with nothing
  -- recorded yet has no meaningful figure, and 0 would be a lie about a course
  -- that has not started.
  "computed_percent"    NUMERIC(5,2),
  "criteria_met"        BOOLEAN NOT NULL DEFAULT false,

  "decided_by" UUID NOT NULL REFERENCES "users"(id) ON DELETE RESTRICT,
  "decided_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One current answer per student per subject.
CREATE UNIQUE INDEX "subject_completions_student_subject"
  ON "subject_completions" ("student_id", "section_subject_id");

-- The worklist query: everybody in a class, and where each stands.
CREATE INDEX "subject_completions_by_subject"
  ON "subject_completions" ("section_subject_id", "decision");

-- A DECISION AGAINST THE ARITHMETIC MUST SAY WHY.
--
-- Agreeing with the System needs no explanation. Overriding it does, and the
-- moment to ask is while the person still knows the reason — not when a query
-- reaches them a year later.
ALTER TABLE "subject_completions"
  ADD CONSTRAINT "subject_completions_override_needs_reason"
  CHECK (
    "criteria_met" = ("decision" = 'COMPLETED')
    OR ("note" IS NOT NULL AND length(btrim("note")) >= 10)
  );
