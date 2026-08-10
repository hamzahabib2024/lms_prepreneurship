-- Lesson resources: a file attached to a lesson (FR-CRS-035).
--
-- `lesson_resource` has been in the section 4.5 matrix since the first commit
-- with no endpoint behind it and no table to hold anything.
--
-- Distinct from recorded_lectures, which is the video and lives per OFFERING.
-- A lesson belongs to a module and a module to a SUBJECT, so a handout is
-- subject-level: every section studying that subject gets it.
CREATE TABLE "lesson_resources" (
    "id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "storage_key" VARCHAR(500) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "publication_status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lesson_resources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lesson_resources_lesson_id_display_order_idx"
    ON "lesson_resources"("lesson_id", "display_order");

ALTER TABLE "lesson_resources" ADD CONSTRAINT "lesson_resources_lesson_id_fkey"
    FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A file of no bytes is a failed upload, not a resource. Storing one produces a
-- row a student can see and download to nothing.
ALTER TABLE "lesson_resources" ADD CONSTRAINT "lesson_resources_size_positive"
    CHECK ("size_bytes" > 0);
