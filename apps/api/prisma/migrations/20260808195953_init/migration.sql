-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'LOCKED', 'SUSPENDED', 'WITHDRAWN', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING_REVIEW', 'UNDER_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AcquisitionSource" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'WHATSAPP', 'WEBSITE', 'REFERRAL', 'WALK_IN', 'OTHER');

-- CreateEnum
CREATE TYPE "RejectionReason" AS ENUM ('PAYMENT_NOT_RECEIVED', 'AMOUNT_INSUFFICIENT', 'SLIP_ILLEGIBLE', 'DUPLICATE_APPLICATION', 'INELIGIBLE', 'SECTION_FULL', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH_DEPOSIT', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PAYMENT_SLIP', 'ID_DOCUMENT', 'QUALIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "Shift" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING', 'WEEKEND');

-- CreateEnum
CREATE TYPE "GenderRestriction" AS ENUM ('MALE', 'FEMALE', 'MIXED');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('ONLINE', 'HYBRID', 'ON_CAMPUS');

-- CreateEnum
CREATE TYPE "SectionStatus" AS ENUM ('PLANNED', 'ACTIVE', 'CLOSED_FOR_ADMISSION', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrolmentStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'COMPLETED', 'WITHDRAWN', 'TRANSFERRED');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('PRIMARY', 'SUPPORTING', 'SUBSTITUTE');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('AVAILABLE', 'MISSING', 'CHECKING');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "AttendancePolicy" AS ENUM ('MANUAL', 'SELF_CHECKIN', 'PROVIDER_DERIVED', 'HYBRID');

-- CreateEnum
CREATE TYPE "BindingStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'NOT_MARKED');

-- CreateEnum
CREATE TYPE "MarkingSource" AS ENUM ('MANUAL', 'SELF_CHECKIN', 'PROVIDER_DERIVED', 'AUTOMATED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "LatePolicy" AS ENUM ('NOT_ACCEPTED', 'FLAG_ONLY', 'FIXED_DEDUCTION', 'PER_DAY_PERCENT');

-- CreateEnum
CREATE TYPE "SubmissionType" AS ENUM ('FILE', 'TEXT', 'BOTH');

-- CreateEnum
CREATE TYPE "ResubmissionPolicy" AS ENUM ('NONE', 'UNLIMITED_UNTIL_DUE', 'LIMITED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ_SINGLE', 'MCQ_MULTI', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY', 'NUMERIC', 'MATCHING', 'FILL_BLANK');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "NegativeMarking" AS ENUM ('NONE', 'FIXED', 'PROPORTIONAL');

-- CreateEnum
CREATE TYPE "AttemptScoring" AS ENUM ('HIGHEST', 'LATEST', 'FIRST', 'AVERAGE');

-- CreateEnum
CREATE TYPE "ResultReleasePolicy" AS ENUM ('IMMEDIATE', 'AFTER_CLOSE', 'AFTER_GRADING', 'MANUAL');

-- CreateEnum
CREATE TYPE "AnswerReviewPolicy" AS ENUM ('NEVER', 'AFTER_RELEASE', 'AFTER_CLOSE');

-- CreateEnum
CREATE TYPE "QuizPresentation" AS ENUM ('ONE_PER_PAGE', 'ALL_ON_PAGE');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'GRADING', 'GRADED', 'ABANDONED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(20),
    "phone_is_whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "status_reason" TEXT,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "password_changed_at" TIMESTAMP(3),
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" TEXT,
    "mfa_recovery_codes" JSONB,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "photo_url" VARCHAR(500),
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Karachi',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "sub_permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "granted_by" UUID,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "token_family_id" UUID NOT NULL,
    "device_label" VARCHAR(200),
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_requests" (
    "id" UUID NOT NULL,
    "tracking_ref" VARCHAR(20) NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "full_name" VARCHAR(200) NOT NULL,
    "father_name" VARCHAR(200) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "national_id" VARCHAR(20) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "phone_is_whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "alt_phone" VARCHAR(20),
    "email" TEXT NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "qualification" VARCHAR(120) NOT NULL,
    "occupation" VARCHAR(120),
    "desired_programme_id" UUID,
    "desired_section_id" UUID,
    "acquisition_source" "AcquisitionSource" NOT NULL,
    "acquisition_detail" VARCHAR(255),
    "campaign_ref" JSONB,
    "claimed_amount" DECIMAL(12,2) NOT NULL,
    "claimed_payment_date" DATE NOT NULL,
    "claimed_bank_ref" VARCHAR(100),
    "consent_version" VARCHAR(20) NOT NULL,
    "consent_at" TIMESTAMP(3) NOT NULL,
    "claimed_by_user_id" UUID,
    "claimed_until" TIMESTAMP(3),
    "decision" "RegistrationStatus",
    "decision_reason_code" "RejectionReason",
    "decision_note" TEXT,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "created_student_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "registration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_documents" (
    "id" UUID NOT NULL,
    "registration_request_id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL DEFAULT 'PAYMENT_SLIP',
    "storage_key" VARCHAR(500) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "registration_request_id" UUID,
    "verified_amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PKR',
    "payment_date" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "bank_reference" VARCHAR(100),
    "verified_by" UUID NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "variance_reason" TEXT,
    "is_reversed" BOOLEAN NOT NULL DEFAULT false,
    "reversed_by" UUID,
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "registration_no" VARCHAR(50) NOT NULL,
    "registration_no_previous" VARCHAR(50),
    "current_section_id" UUID,
    "current_roll_no" SMALLINT,
    "national_id" VARCHAR(20) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "guardian_name" VARCHAR(200),
    "guardian_phone" VARCHAR(20),
    "admission_date" DATE NOT NULL,
    "outstanding_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teachers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "employee_code" VARCHAR(50),
    "qualifications" TEXT,
    "joined_at" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programmes" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "description" TEXT,
    "duration_weeks" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "programmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_sessions" (
    "id" UUID NOT NULL,
    "programme_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "academic_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "academic_session_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "delivery_pattern" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "capacity" SMALLINT NOT NULL,
    "enrolled_count" SMALLINT NOT NULL DEFAULT 0,
    "gender_restriction" "GenderRestriction" NOT NULL DEFAULT 'MIXED',
    "shift" "Shift" NOT NULL,
    "delivery_mode" "DeliveryMode" NOT NULL DEFAULT 'ONLINE',
    "attributes" JSONB,
    "whatsapp_channel_url" VARCHAR(500),
    "whatsapp_group_url" VARCHAR(500),
    "status" "SectionStatus" NOT NULL DEFAULT 'PLANNED',
    "live_provider_key" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "credits" SMALLINT,
    "thumbnail_url" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_subjects" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "is_compulsory" BOOLEAN NOT NULL DEFAULT true,
    "start_date" DATE,
    "end_date" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
    "progress_weights" JSONB,
    "completion_criteria" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "section_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_assignments" (
    "id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "section_subject_id" UUID NOT NULL,
    "assignment_role" "AssignmentRole" NOT NULL DEFAULT 'PRIMARY',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "teacher_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrolments" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "section_subject_id" UUID NOT NULL,
    "status" "EnrolmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "roll_no_at_enrolment" SMALLINT,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "status_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "enrolments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "display_order" INTEGER NOT NULL,
    "publication_status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publish_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "module_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "display_order" INTEGER NOT NULL,
    "estimated_minutes" SMALLINT,
    "publication_status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "publish_at" TIMESTAMP(3),
    "prerequisite_lesson_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recorded_lectures" (
    "id" UUID NOT NULL,
    "lesson_id" UUID,
    "section_subject_id" UUID NOT NULL,
    "live_session_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "storage_provider" VARCHAR(50) NOT NULL DEFAULT 'google_drive',
    "storage_ref" VARCHAR(255) NOT NULL,
    "duration_seconds" INTEGER,
    "recorded_on" DATE NOT NULL,
    "teacher_id" UUID,
    "publication_status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "availability_status" "AvailabilityStatus" NOT NULL DEFAULT 'AVAILABLE',
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "recorded_lectures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_sessions" (
    "id" UUID NOT NULL,
    "section_subject_id" UUID NOT NULL,
    "lesson_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "scheduled_start" TIMESTAMP(3) NOT NULL,
    "scheduled_end" TIMESTAMP(3) NOT NULL,
    "actual_start" TIMESTAMP(3),
    "actual_end" TIMESTAMP(3),
    "host_teacher_id" UUID NOT NULL,
    "substitute_teacher_id" UUID,
    "status" "SessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "session_type" "SessionType" NOT NULL DEFAULT 'ONLINE',
    "join_window_minutes_before" SMALLINT NOT NULL DEFAULT 15,
    "attendance_policy" "AttendancePolicy" NOT NULL DEFAULT 'MANUAL',
    "timetable_slot_id" UUID,
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_session_provider_bindings" (
    "id" UUID NOT NULL,
    "live_session_id" UUID NOT NULL,
    "provider_key" VARCHAR(50) NOT NULL,
    "external_id" VARCHAR(255),
    "join_url" VARCHAR(1000),
    "host_url" VARCHAR(1000),
    "provider_metadata" JSONB,
    "status" "BindingStatus" NOT NULL DEFAULT 'PENDING',
    "is_manual_fallback" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_session_provider_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "live_session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'NOT_MARKED',
    "marking_source" "MarkingSource" NOT NULL DEFAULT 'MANUAL',
    "proposed_status" "AttendanceStatus",
    "participation_seconds" INTEGER,
    "marked_by" UUID,
    "marked_at" TIMESTAMP(3),
    "corrected_from" "AttendanceStatus",
    "correction_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "actor_role" VARCHAR(50),
    "impersonated_by" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" VARCHAR(64) NOT NULL,
    "before_value" JSONB,
    "after_value" JSONB,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "correlation_id" UUID NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_type" VARCHAR(60) NOT NULL,
    "user_id" UUID,
    "email" TEXT,
    "outcome" VARCHAR(20) NOT NULL,
    "detail" JSONB,
    "ip_address" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "correlation_id" UUID,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,
    "scope_type" VARCHAR(30),
    "scope_id" UUID,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_series" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubrics" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "owner_teacher_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubric_criteria" (
    "id" UUID NOT NULL,
    "rubric_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "max_marks" DECIMAL(6,2) NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "levels" JSONB,

    CONSTRAINT "rubric_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "section_subject_id" UUID NOT NULL,
    "lesson_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "instructions" TEXT NOT NULL,
    "marks_available" DECIMAL(6,2) NOT NULL,
    "opens_at" TIMESTAMP(3) NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "hard_close_at" TIMESTAMP(3),
    "grace_minutes" SMALLINT NOT NULL DEFAULT 0,
    "late_policy" "LatePolicy" NOT NULL DEFAULT 'FLAG_ONLY',
    "late_penalty_value" DECIMAL(6,2),
    "late_penalty_floor" DECIMAL(6,2),
    "submission_type" "SubmissionType" NOT NULL DEFAULT 'FILE',
    "allowed_file_types" JSONB NOT NULL,
    "max_file_size_mb" SMALLINT NOT NULL DEFAULT 10,
    "max_file_count" SMALLINT NOT NULL DEFAULT 5,
    "resubmission_policy" "ResubmissionPolicy" NOT NULL DEFAULT 'NONE',
    "max_attempts" SMALLINT,
    "rubric_id" UUID,
    "publication_status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "grades_released" BOOLEAN NOT NULL DEFAULT false,
    "grades_released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "version" SMALLINT NOT NULL DEFAULT 1,
    "is_latest" BOOLEAN NOT NULL DEFAULT true,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_late" BOOLEAN NOT NULL DEFAULT false,
    "minutes_late" INTEGER NOT NULL DEFAULT 0,
    "text_response" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_files" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_grades" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "raw_marks" DECIMAL(6,2) NOT NULL,
    "penalty_applied" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "final_marks" DECIMAL(6,2) NOT NULL,
    "rubric_scores" JSONB,
    "feedback" TEXT,
    "internal_notes" TEXT,
    "graded_by" UUID NOT NULL,
    "graded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "revision_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_extensions" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "extended_to" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "granted_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_banks" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "subject_id" UUID,
    "owner_teacher_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "question_banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "question_bank_id" UUID NOT NULL,
    "subject_id" UUID,
    "question_type" "QuestionType" NOT NULL,
    "stem" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',
    "default_marks" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "explanation" TEXT,
    "accepted_answers" JSONB,
    "tolerance" DECIMAL(12,4),
    "case_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "tags" JSONB,
    "version" SMALLINT NOT NULL DEFAULT 1,
    "is_retired" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "option_text" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "match_key" VARCHAR(100),
    "display_order" INTEGER NOT NULL,
    "feedback" TEXT,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" UUID NOT NULL,
    "section_subject_id" UUID NOT NULL,
    "lesson_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "instructions" TEXT,
    "total_marks" DECIMAL(6,2) NOT NULL,
    "opens_at" TIMESTAMP(3) NOT NULL,
    "closes_at" TIMESTAMP(3) NOT NULL,
    "time_limit_minutes" SMALLINT,
    "max_attempts" SMALLINT NOT NULL DEFAULT 1,
    "attempt_scoring" "AttemptScoring" NOT NULL DEFAULT 'HIGHEST',
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT false,
    "shuffle_options" BOOLEAN NOT NULL DEFAULT false,
    "negative_marking" "NegativeMarking" NOT NULL DEFAULT 'NONE',
    "negative_marking_value" DECIMAL(6,2),
    "passing_marks" DECIMAL(6,2),
    "presentation" "QuizPresentation" NOT NULL DEFAULT 'ONE_PER_PAGE',
    "allow_backward_navigation" BOOLEAN NOT NULL DEFAULT true,
    "result_release_policy" "ResultReleasePolicy" NOT NULL DEFAULT 'AFTER_CLOSE',
    "answer_review_policy" "AnswerReviewPolicy" NOT NULL DEFAULT 'AFTER_RELEASE',
    "publication_status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "results_released_at" TIMESTAMP(3),
    "selection_rules" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "marks" DECIMAL(6,2) NOT NULL,
    "display_order" INTEGER NOT NULL,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attempt_number" SMALLINT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "submission_mode" VARCHAR(30),
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "question_order" JSONB NOT NULL,
    "auto_score" DECIMAL(6,2),
    "manual_score" DECIMAL(6,2),
    "final_score" DECIMAL(6,2),
    "is_passed" BOOLEAN,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_answers" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "question_version" SMALLINT NOT NULL DEFAULT 1,
    "response" JSONB,
    "is_correct" BOOLEAN,
    "marks_awarded" DECIMAL(6,2),
    "is_manually_graded" BOOLEAN NOT NULL DEFAULT false,
    "graded_by" UUID,
    "grader_comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_token_family_id_idx" ON "user_sessions"("token_family_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "registration_requests_tracking_ref_key" ON "registration_requests"("tracking_ref");

-- CreateIndex
CREATE UNIQUE INDEX "registration_requests_created_student_id_key" ON "registration_requests"("created_student_id");

-- CreateIndex
CREATE INDEX "registration_requests_status_created_at_idx" ON "registration_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "registration_requests_national_id_idx" ON "registration_requests"("national_id");

-- CreateIndex
CREATE INDEX "registration_requests_email_idx" ON "registration_requests"("email");

-- CreateIndex
CREATE INDEX "registration_requests_phone_idx" ON "registration_requests"("phone");

-- CreateIndex
CREATE INDEX "registration_documents_registration_request_id_idx" ON "registration_documents"("registration_request_id");

-- CreateIndex
CREATE INDEX "registration_documents_content_hash_idx" ON "registration_documents"("content_hash");

-- CreateIndex
CREATE INDEX "payments_student_id_payment_date_idx" ON "payments"("student_id", "payment_date");

-- CreateIndex
CREATE UNIQUE INDEX "students_user_id_key" ON "students"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_registration_no_key" ON "students"("registration_no");

-- CreateIndex
CREATE UNIQUE INDEX "students_national_id_key" ON "students"("national_id");

-- CreateIndex
CREATE INDEX "students_current_section_id_current_roll_no_idx" ON "students"("current_section_id", "current_roll_no");

-- CreateIndex
CREATE INDEX "students_registration_no_previous_idx" ON "students"("registration_no_previous");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_user_id_key" ON "teachers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_employee_code_key" ON "teachers"("employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "programmes_code_key" ON "programmes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "academic_sessions_programme_id_code_key" ON "academic_sessions"("programme_id", "code");

-- CreateIndex
CREATE INDEX "batches_academic_session_id_idx" ON "batches"("academic_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "sections_code_key" ON "sections"("code");

-- CreateIndex
CREATE INDEX "sections_batch_id_idx" ON "sections"("batch_id");

-- CreateIndex
CREATE INDEX "sections_status_idx" ON "sections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_code_key" ON "subjects"("code");

-- CreateIndex
CREATE INDEX "section_subjects_section_id_idx" ON "section_subjects"("section_id");

-- CreateIndex
CREATE INDEX "section_subjects_subject_id_idx" ON "section_subjects"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "section_subjects_section_id_subject_id_key" ON "section_subjects"("section_id", "subject_id");

-- CreateIndex
CREATE INDEX "teacher_assignments_teacher_id_end_date_idx" ON "teacher_assignments"("teacher_id", "end_date");

-- CreateIndex
CREATE INDEX "teacher_assignments_section_subject_id_idx" ON "teacher_assignments"("section_subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_assignments_teacher_id_section_subject_id_start_dat_key" ON "teacher_assignments"("teacher_id", "section_subject_id", "start_date");

-- CreateIndex
CREATE INDEX "enrolments_student_id_status_idx" ON "enrolments"("student_id", "status");

-- CreateIndex
CREATE INDEX "enrolments_section_subject_id_status_idx" ON "enrolments"("section_subject_id", "status");

-- CreateIndex
CREATE INDEX "modules_subject_id_display_order_idx" ON "modules"("subject_id", "display_order");

-- CreateIndex
CREATE INDEX "lessons_module_id_display_order_idx" ON "lessons"("module_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "recorded_lectures_live_session_id_key" ON "recorded_lectures"("live_session_id");

-- CreateIndex
CREATE INDEX "recorded_lectures_section_subject_id_publication_status_idx" ON "recorded_lectures"("section_subject_id", "publication_status");

-- CreateIndex
CREATE INDEX "recorded_lectures_recorded_on_idx" ON "recorded_lectures"("recorded_on");

-- CreateIndex
CREATE INDEX "live_sessions_section_subject_id_scheduled_start_idx" ON "live_sessions"("section_subject_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "live_sessions_scheduled_start_status_idx" ON "live_sessions"("scheduled_start", "status");

-- CreateIndex
CREATE UNIQUE INDEX "live_session_provider_bindings_live_session_id_key" ON "live_session_provider_bindings"("live_session_id");

-- CreateIndex
CREATE INDEX "attendance_records_student_id_status_idx" ON "attendance_records"("student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_live_session_id_student_id_key" ON "attendance_records"("live_session_id", "student_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_occurred_at_idx" ON "audit_log"("entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_occurred_at_idx" ON "audit_log"("actor_user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_action_occurred_at_idx" ON "audit_log"("action", "occurred_at");

-- CreateIndex
CREATE INDEX "security_events_event_type_occurred_at_idx" ON "security_events"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "security_events_user_id_occurred_at_idx" ON "security_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "security_events_ip_address_occurred_at_idx" ON "security_events"("ip_address", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_scope_type_scope_id_key" ON "settings"("key", "scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "number_series_key_key" ON "number_series"("key");

-- CreateIndex
CREATE INDEX "rubric_criteria_rubric_id_display_order_idx" ON "rubric_criteria"("rubric_id", "display_order");

-- CreateIndex
CREATE INDEX "assignments_section_subject_id_publication_status_idx" ON "assignments"("section_subject_id", "publication_status");

-- CreateIndex
CREATE INDEX "assignments_due_at_idx" ON "assignments"("due_at");

-- CreateIndex
CREATE INDEX "assignment_submissions_assignment_id_is_latest_idx" ON "assignment_submissions"("assignment_id", "is_latest");

-- CreateIndex
CREATE INDEX "assignment_submissions_student_id_idx" ON "assignment_submissions"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_assignment_id_student_id_version_key" ON "assignment_submissions"("assignment_id", "student_id", "version");

-- CreateIndex
CREATE INDEX "submission_files_submission_id_idx" ON "submission_files"("submission_id");

-- CreateIndex
CREATE INDEX "submission_files_content_hash_idx" ON "submission_files"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_grades_submission_id_key" ON "assignment_grades"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_extensions_assignment_id_student_id_key" ON "assignment_extensions"("assignment_id", "student_id");

-- CreateIndex
CREATE INDEX "questions_question_bank_id_is_retired_idx" ON "questions"("question_bank_id", "is_retired");

-- CreateIndex
CREATE INDEX "questions_subject_id_question_type_difficulty_idx" ON "questions"("subject_id", "question_type", "difficulty");

-- CreateIndex
CREATE INDEX "question_options_question_id_display_order_idx" ON "question_options"("question_id", "display_order");

-- CreateIndex
CREATE INDEX "quizzes_section_subject_id_publication_status_idx" ON "quizzes"("section_subject_id", "publication_status");

-- CreateIndex
CREATE INDEX "quizzes_opens_at_closes_at_idx" ON "quizzes"("opens_at", "closes_at");

-- CreateIndex
CREATE INDEX "quiz_questions_quiz_id_display_order_idx" ON "quiz_questions"("quiz_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_questions_quiz_id_question_id_key" ON "quiz_questions"("quiz_id", "question_id");

-- CreateIndex
CREATE INDEX "quiz_attempts_student_id_status_idx" ON "quiz_attempts"("student_id", "status");

-- CreateIndex
CREATE INDEX "quiz_attempts_status_idx" ON "quiz_attempts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempts_quiz_id_student_id_attempt_number_key" ON "quiz_attempts"("quiz_id", "student_id", "attempt_number");

-- CreateIndex
CREATE INDEX "quiz_answers_attempt_id_idx" ON "quiz_answers"("attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_answers_attempt_id_question_id_key" ON "quiz_answers"("attempt_id", "question_id");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_desired_programme_id_fkey" FOREIGN KEY ("desired_programme_id") REFERENCES "programmes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_desired_section_id_fkey" FOREIGN KEY ("desired_section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_created_student_id_fkey" FOREIGN KEY ("created_student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_documents" ADD CONSTRAINT "registration_documents_registration_request_id_fkey" FOREIGN KEY ("registration_request_id") REFERENCES "registration_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_registration_request_id_fkey" FOREIGN KEY ("registration_request_id") REFERENCES "registration_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_current_section_id_fkey" FOREIGN KEY ("current_section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_sessions" ADD CONSTRAINT "academic_sessions_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_academic_session_id_fkey" FOREIGN KEY ("academic_session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_subjects" ADD CONSTRAINT "section_subjects_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_subjects" ADD CONSTRAINT "section_subjects_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_section_subject_id_fkey" FOREIGN KEY ("section_subject_id") REFERENCES "section_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_section_subject_id_fkey" FOREIGN KEY ("section_subject_id") REFERENCES "section_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorded_lectures" ADD CONSTRAINT "recorded_lectures_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorded_lectures" ADD CONSTRAINT "recorded_lectures_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_section_subject_id_fkey" FOREIGN KEY ("section_subject_id") REFERENCES "section_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_host_teacher_id_fkey" FOREIGN KEY ("host_teacher_id") REFERENCES "teachers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_session_provider_bindings" ADD CONSTRAINT "live_session_provider_bindings_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_rubric_id_fkey" FOREIGN KEY ("rubric_id") REFERENCES "rubrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_rubric_id_fkey" FOREIGN KEY ("rubric_id") REFERENCES "rubrics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_grades" ADD CONSTRAINT "assignment_grades_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_extensions" ADD CONSTRAINT "assignment_extensions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_question_bank_id_fkey" FOREIGN KEY ("question_bank_id") REFERENCES "question_banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
