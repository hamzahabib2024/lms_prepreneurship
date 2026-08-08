-- ---------------------------------------------------------------------------
-- Constraints and indexes that Prisma schema cannot express.
--
-- These are NOT optional. Section 8.4 and DB-017 depend on them, and they are
-- the reason PostgreSQL is mandated over MySQL in section 3.11.
--
-- Run after `prisma migrate deploy`:
--     npm run db:constraints
-- ---------------------------------------------------------------------------

-- gen_random_uuid() is used by the number-series allocation.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- PARTIAL UNIQUE INDEXES
--
-- Prisma's @@unique is unconditional. These rules are conditional, which is
-- the whole point: a withdrawn student frees their roll number, and a closed
-- enrolment must not block re-enrolment.
-- ---------------------------------------------------------------------------

-- FR-REG-057 / BR-REG-08: a roll number is unique within a section, but only
-- among live students. Withdrawal frees it for reuse.
CREATE UNIQUE INDEX IF NOT EXISTS students_section_roll_live_uq
  ON students (current_section_id, current_roll_no)
  WHERE deleted_at IS NULL
    AND current_section_id IS NOT NULL
    AND current_roll_no IS NOT NULL;

-- FR-ENR-016: no duplicate ACTIVE enrolment for the same student and
-- section-subject. Prior TRANSFERRED or WITHDRAWN rows are retained
-- (BR-ENR-10) and must not prevent a new enrolment.
CREATE UNIQUE INDEX IF NOT EXISTS enrolments_active_uq
  ON enrolments (student_id, section_subject_id)
  WHERE status = 'ACTIVE' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- PARTIAL INDEXES FOR HOT PATHS (section 8.4)
-- ---------------------------------------------------------------------------

-- The review queue: pending applications, oldest first (FR-REG-022).
CREATE INDEX IF NOT EXISTS registration_requests_queue_idx
  ON registration_requests (created_at)
  WHERE status IN ('PENDING_REVIEW', 'UNDER_REVIEW', 'NEEDS_INFO')
    AND deleted_at IS NULL;

-- Scope resolution reads this on EVERY request, so it is the hottest index in
-- the System. Only live assignments grant reach (BR-ACC-04).
CREATE INDEX IF NOT EXISTS teacher_assignments_live_idx
  ON teacher_assignments (teacher_id, section_subject_id)
  WHERE deleted_at IS NULL AND (end_date IS NULL OR end_date >= CURRENT_DATE);

-- The session reminder job sweeps upcoming sessions only (section 3.6).
CREATE INDEX IF NOT EXISTS live_sessions_upcoming_idx
  ON live_sessions (scheduled_start)
  WHERE status = 'SCHEDULED' AND deleted_at IS NULL;

-- Unmarked registers drive the teacher's action queue (FR-TCH-002).
CREATE INDEX IF NOT EXISTS attendance_unmarked_idx
  ON attendance_records (live_session_id)
  WHERE status = 'NOT_MARKED';

-- BRIN rather than B-tree: audit_log is append-only and physically ordered by
-- time, so BRIN gives range scans at a fraction of the size (section 8.4).
CREATE INDEX IF NOT EXISTS audit_log_occurred_brin
  ON audit_log USING BRIN (occurred_at);

CREATE INDEX IF NOT EXISTS security_events_occurred_brin
  ON security_events USING BRIN (occurred_at);

-- ---------------------------------------------------------------------------
-- DATA INTEGRITY CHECKS
--
-- Enforced by the database, so a bug in application code cannot write a state
-- the business considers impossible.
-- ---------------------------------------------------------------------------

ALTER TABLE sections
  DROP CONSTRAINT IF EXISTS sections_capacity_positive,
  ADD  CONSTRAINT sections_capacity_positive CHECK (capacity > 0);

ALTER TABLE sections
  DROP CONSTRAINT IF EXISTS sections_enrolled_not_negative,
  ADD  CONSTRAINT sections_enrolled_not_negative CHECK (enrolled_count >= 0);

-- BR-PAY-05: a payment is never negative, and a reversal must record who and
-- when rather than merely flipping a flag.
ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_amount_positive,
  ADD  CONSTRAINT payments_amount_positive CHECK (verified_amount > 0);

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_reversal_complete,
  ADD  CONSTRAINT payments_reversal_complete
       CHECK (is_reversed = false OR (reversed_by IS NOT NULL AND reversed_at IS NOT NULL));

-- FR-REG-034: a rejection must carry a reason code.
ALTER TABLE registration_requests
  DROP CONSTRAINT IF EXISTS registration_rejection_has_reason,
  ADD  CONSTRAINT registration_rejection_has_reason
       CHECK (status <> 'REJECTED' OR decision_reason_code IS NOT NULL);

-- FR-REG-052 / BR-REG-07: a registration number is permanent. Blank is not a
-- value, and an empty string would slip past NOT NULL.
ALTER TABLE students
  DROP CONSTRAINT IF EXISTS students_registration_no_present,
  ADD  CONSTRAINT students_registration_no_present CHECK (length(trim(registration_no)) > 0);

-- ---------------------------------------------------------------------------
-- AUDIT LOG IMMUTABILITY  (FR-LOG-004)
--
-- The application has no update or delete path, but that is a promise about
-- code. This is a guarantee about data: even a compromised application, or an
-- operator at a psql prompt using the application role, cannot rewrite
-- history.
--
-- A trigger is used rather than only a privilege GRANT so the protection
-- survives a role change and reports why the write was refused.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only (FR-LOG-004): % is not permitted', TG_OP
    USING HINT = 'Correct a mistaken entry by appending a compensating record.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

-- ---------------------------------------------------------------------------
-- FULL-TEXT SEARCH (FR-SRCH-004, NFR-PRF-008)
--
-- Students are searchable by name, registration number, identity number and
-- contact number, by exact and partial match, within one second.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS students_registration_no_trgm
  ON students USING gin (registration_no gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_full_name_trgm
  ON users USING gin (full_name gin_trgm_ops);
