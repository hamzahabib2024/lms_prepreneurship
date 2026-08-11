-- The Institute's own wording for the messages the System sends (FR-NOT-020).
--
-- A row exists only where the Institute has ACTUALLY edited the wording.
-- Pre-filling this with the defaults would make every message look
-- deliberately chosen and leave nobody able to tell which had been changed.
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_templates_kind_key" ON "notification_templates" ("kind");
