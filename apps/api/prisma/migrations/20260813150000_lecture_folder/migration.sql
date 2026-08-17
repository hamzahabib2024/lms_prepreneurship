-- The folder a class's recordings live in.
--
-- When it is set, a lecture appears on the course page as soon as the file
-- appears in the folder. Null means nobody has connected one, and the hourly
-- sweep skips the class rather than guessing.
--
-- A Drive folder id or a path under local storage — the sync reads through the
-- storage provider, so the same column serves both and switching is a setting
-- rather than a migration.
ALTER TABLE "section_subjects" ADD COLUMN "lecture_folder_ref" VARCHAR(255);

-- The sweep asks for exactly this: the classes that have a folder.
CREATE INDEX "section_subjects_lecture_folder_idx"
    ON "section_subjects" ("lecture_folder_ref")
    WHERE "lecture_folder_ref" IS NOT NULL AND "deleted_at" IS NULL;