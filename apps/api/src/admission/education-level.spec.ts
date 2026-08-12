import { EDUCATION_LEVEL, EDUCATION_LEVEL_LABEL, registrationSubmitSchema } from "@lms/shared";

/**
 * What an applicant has already studied — FR-REG-003.
 *
 * The point of a fixed list is that the answers can be COUNTED, so these tests
 * are mostly about the list staying a list: nothing added without a label,
 * nothing renamed underneath a report, and the two values that exist because
 * somebody would otherwise have been filed under "other" still present.
 */

const valid = {
  fullName: "Ayesha Khan",
  fatherName: "Imran Khan",
  dateOfBirth: "2005-04-11",
  gender: "FEMALE" as const,
  nationalId: "35202-1234567-8",
  phone: "+923001234567",
  email: "ayesha@example.com",
  address: "12 Jail Road, Lahore",
  city: "Lahore",
  educationLevel: "FSC" as const,
  qualification: "FSc Pre-Engineering, 2024",
  desiredProgrammeId: "018f2b04-0000-7000-8000-000000000000",
  desiredSectionId: "018f2b04-0000-7000-8000-000000000001",
  acquisitionSource: "FACEBOOK" as const,
  claimedAmount: 30000,
  claimedPaymentDate: "2026-01-15",
  consentVersion: "2026-01",
  consentAccepted: true,
  documentIds: ["018f2b04-0000-7000-8000-000000000002"],
};

describe("the education levels the form offers", () => {
  it("includes the ones a Pakistani applicant actually has", () => {
    expect(EDUCATION_LEVEL).toContain("MATRIC");
    expect(EDUCATION_LEVEL).toContain("FSC");
    expect(EDUCATION_LEVEL).toContain("BACHELORS");
  });

  it("LISTS Dars-e-Nizami and Hifz-e-Quran rather than folding them into OTHER", () => {
    // The reason the list exists. A madrasah graduate applying for a web
    // development track is a normal applicant here, and a form that files them
    // under "other" says what it thinks of their education before they have
    // finished applying. They are also the two the Institute most needs to
    // count honestly.
    expect(EDUCATION_LEVEL).toContain("DARS_E_NIZAMI");
    expect(EDUCATION_LEVEL).toContain("HIFZ_E_QURAN");
  });

  it("keeps OTHER, because a list of six cannot cover everybody", () => {
    expect(EDUCATION_LEVEL).toContain("OTHER");
  });

  it("gives every value a label a person would recognise", () => {
    // A screen showing DARS_E_NIZAMI has leaked a database value into the
    // interface.
    for (const level of EDUCATION_LEVEL) {
      const label = EDUCATION_LEVEL_LABEL[level];
      expect(label).toBeTruthy();
      expect(label).not.toBe(level);
      expect(label).not.toMatch(/_/);
    }
  });

  it("has no duplicates and no label used twice", () => {
    expect(new Set(EDUCATION_LEVEL).size).toBe(EDUCATION_LEVEL.length);
    const labels = EDUCATION_LEVEL.map((l) => EDUCATION_LEVEL_LABEL[l]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("what the application accepts", () => {
  it("takes a valid level", () => {
    for (const level of EDUCATION_LEVEL) {
      expect(() => registrationSubmitSchema.parse({ ...valid, educationLevel: level })).not.toThrow();
    }
  });

  it("REFUSES a level that is not on the list", () => {
    // Free text is what this replaced: "FSc", "F.Sc" and "Intermediate" are
    // one answer typed three ways, and a report grouping them is one nobody
    // can trust.
    expect(() =>
      registrationSubmitSchema.parse({ ...valid, educationLevel: "Intermediate" }),
    ).toThrow();
    expect(() => registrationSubmitSchema.parse({ ...valid, educationLevel: "fsc" })).toThrow();
  });

  it("requires it — an application with no level cannot be counted", () => {
    const { educationLevel, ...without } = valid;
    void educationLevel;
    expect(() => registrationSubmitSchema.parse(without)).toThrow();
  });

  it("still requires the free-text detail beside it", () => {
    // The level is what gets counted; the detail is what a reviewer reads.
    expect(() => registrationSubmitSchema.parse({ ...valid, qualification: "" })).toThrow();
  });
});
