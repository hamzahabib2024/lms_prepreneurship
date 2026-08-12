-- The applicant's education level, from a fixed list (FR-REG-003).
--
-- `qualification` stays as free text beside it for the detail — the subject,
-- the board, the year. The LEVEL is what gets counted, and free text cannot be
-- counted: "FSc", "F.Sc", "F.Sc." and "Intermediate" are one answer typed four
-- ways.
--
-- Dars-e-Nizami and Hifz-e-Quran are values in their own right rather than
-- OTHER. A madrasah graduate applying for a web development track is a normal
-- applicant here, and they are the two the Institute most needs to count
-- honestly — a programme that works for them is a different claim from one
-- that works for FSc leavers.
CREATE TYPE "EducationLevel" AS ENUM (
    'MATRIC',
    'FSC',
    'BACHELORS',
    'DARS_E_NIZAMI',
    'HIFZ_E_QURAN',
    'OTHER'
);

-- Nullable, and stays nullable: applications submitted before this existed are
-- not going to acquire an answer, and defaulting them to OTHER would invent
-- data that nobody gave.
ALTER TABLE "registration_requests" ADD COLUMN "education_level" "EducationLevel";

CREATE INDEX "registration_requests_education_level_idx"
    ON "registration_requests" ("education_level");