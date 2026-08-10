-- Announcements and notifications -- SRS section 5.16, FR-COM-001..020.
--
-- Three tables where one might look sufficient, and the split is the point.
--
--   announcements           what was said, to WHICH AUDIENCE
--   notifications           one person's copy, and whether they have read it
--   notification_deliveries an attempt to push that copy down a channel
--
-- An announcement names an audience, never a list of people. Who is enrolled at
-- the moment of sending is a question the System answers, so a student who
-- enrols the next day still sees it; a frozen recipient list would exclude them
-- silently.
--
-- A delivery is separate from the notification because the channel is a
-- configuration choice, not a fact about the message. The in-app copy is the
-- record; WhatsApp and email are deliveries OF it. A failed send therefore
-- never loses anything.

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('INSTITUTE', 'SECTION', 'SECTION_SUBJECT');
-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'WHATSAPP', 'EMAIL', 'SMS');
-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED');
-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL,
    "section_id" UUID,
    "section_subject_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "author_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "link_path" VARCHAR(500),
    "announcement_id" UUID,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "detail" TEXT,
    "attempted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY['WHATSAPP']::TEXT[],
    "muted_kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quiet_hours_start" SMALLINT,
    "quiet_hours_end" SMALLINT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "announcements_audience_published_at_idx" ON "announcements"("audience", "published_at");
-- CreateIndex
CREATE INDEX "announcements_section_subject_id_published_at_idx" ON "announcements"("section_subject_id", "published_at");
-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_at_created_at_idx" ON "notifications"("recipient_id", "read_at", "created_at");
-- CreateIndex
CREATE INDEX "notification_deliveries_notification_id_idx" ON "notification_deliveries"("notification_id");
-- CreateIndex
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries"("status");
-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");
-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_section_subject_id_fkey" FOREIGN KEY ("section_subject_id") REFERENCES "section_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An announcement is addressed to exactly one audience, and the columns must
-- agree with the audience named. Without this a row could claim INSTITUTE and
-- still carry a section id, and every reader would have to guess which to
-- believe.
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_audience_target"
  CHECK (
    ("audience" = 'INSTITUTE'       AND "section_id" IS NULL     AND "section_subject_id" IS NULL)
    OR ("audience" = 'SECTION'         AND "section_id" IS NOT NULL AND "section_subject_id" IS NULL)
    OR ("audience" = 'SECTION_SUBJECT' AND "section_subject_id" IS NOT NULL AND "section_id" IS NULL)
  );

-- An expiry before publication would hide the announcement the moment it was
-- made, which looks like the System losing it.
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_expiry_after_publish"
  CHECK ("expires_at" IS NULL OR "expires_at" > "published_at");

-- Quiet hours are hours of a day, and are set together or not at all.
ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_quiet_hours"
  CHECK (
    ("quiet_hours_start" IS NULL AND "quiet_hours_end" IS NULL)
    OR (
      "quiet_hours_start" BETWEEN 0 AND 23
      AND "quiet_hours_end" BETWEEN 0 AND 23
      AND "quiet_hours_start" <> "quiet_hours_end"
    )
  );

-- The inbox is almost always read as "my unread, newest first". A partial index
-- keeps that query off the read rows, which are the ones that accumulate.
CREATE INDEX "notifications_unread"
  ON "notifications" ("recipient_id", "created_at" DESC)
  WHERE "read_at" IS NULL;
