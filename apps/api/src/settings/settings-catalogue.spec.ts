import {
  CATALOGUE,
  UPLOAD_HARD_LIMIT_MB,
  definitionFor,
  isKnownKey,
  resolve,
  resolveAll,
  validateCoherence,
  validateValue,
  type StoredSetting,
} from "./settings-catalogue";

describe("the catalogue itself", () => {
  it("has no duplicate keys", () => {
    const keys = CATALOGUE.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every setting a description that says what changes", () => {
    for (const def of CATALOGUE) {
      expect(def.description.length).toBeGreaterThan(20);
    }
  });

  it("gives every setting a default that is itself valid", () => {
    // The defaults are what a fresh install runs on. A default that fails its
    // own validation would make the System invalid until configured.
    for (const def of CATALOGUE) {
      expect(validateValue(def.key, def.default)).toEqual([]);
    }
  });

  it("never lets the upload size default exceed the parser's hard limit", () => {
    const def = definitionFor("upload.maxFileSizeMb");
    expect(def?.max).toBe(UPLOAD_HARD_LIMIT_MB);
    expect(def?.default as number).toBeLessThanOrEqual(UPLOAD_HARD_LIMIT_MB);
  });

  it("keeps every allowed file type verifiable by content", () => {
    const def = definitionFor("upload.allowedFileTypes");
    for (const t of def?.default as string[]) {
      expect(def?.allowed).toContain(t);
    }
  });
});

describe("unknown keys", () => {
  it("are refused rather than stored", () => {
    // The failure this exists to prevent: a typo is accepted, the screen says
    // saved, and nothing ever reads it.
    const problems = validateValue("attendance.warningThresold", 80);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("not a setting");
  });

  it("are reported by isKnownKey", () => {
    expect(isKnownKey("attendance.warningThreshold")).toBe(true);
    expect(isKnownKey("attendance.nonsense")).toBe(false);
  });
});

describe("numbers and percentages", () => {
  it("accept a value in range", () => {
    expect(validateValue("attendance.warningThreshold", 80)).toEqual([]);
    expect(validateValue("attendance.warningThreshold", 0)).toEqual([]);
    expect(validateValue("attendance.warningThreshold", 100)).toEqual([]);
  });

  it("refuse one below the minimum", () => {
    expect(validateValue("attendance.warningThreshold", -1)).toHaveLength(1);
  });

  it("refuse one above the maximum", () => {
    expect(validateValue("attendance.warningThreshold", 101)).toHaveLength(1);
  });

  it("refuse text that looks like a number", () => {
    expect(validateValue("attendance.warningThreshold", "80")).toHaveLength(1);
  });

  it("refuse NaN and Infinity", () => {
    expect(validateValue("attendance.lateWeight", Number.NaN)).toHaveLength(1);
    expect(validateValue("attendance.lateWeight", Number.POSITIVE_INFINITY)).toHaveLength(1);
  });

  it("refuse an upload size above the parser's hard limit", () => {
    // 50 MB would be accepted here and then fail at upload with a parser error
    // naming nothing an administrator could act on.
    const problems = validateValue("upload.maxFileSizeMb", 50);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain(String(UPLOAD_HARD_LIMIT_MB));
  });
});

describe("lists", () => {
  it("accept a subset of the permitted types", () => {
    expect(validateValue("upload.allowedFileTypes", ["pdf", "docx"])).toEqual([]);
  });

  it("refuse an empty list", () => {
    // Reads as "no restriction", means "nothing is permitted".
    const problems = validateValue("upload.allowedFileTypes", []);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("refuse every file");
  });

  it("refuse a type the System cannot verify by content", () => {
    const problems = validateValue("upload.allowedFileTypes", ["pdf", "exe"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("exe");
  });

  it("refuse a list that is not a list", () => {
    expect(validateValue("upload.allowedFileTypes", "pdf")).toHaveLength(1);
  });

  it("refuse a list of non-strings", () => {
    expect(validateValue("upload.allowedFileTypes", [1, 2])).toHaveLength(1);
  });
});

describe("progress weights", () => {
  it("accept four shares adding up to one", () => {
    expect(
      validateValue("progress.weights", {
        video: 0.25, assignment: 0.25, quiz: 0.25, attendance: 0.25,
      }),
    ).toEqual([]);
  });

  it("accept a component set to zero", () => {
    // A subject with no video is legitimate; BR-PRG-03 redistributes.
    expect(
      validateValue("progress.weights", {
        video: 0, assignment: 0.5, quiz: 0.3, attendance: 0.2,
      }),
    ).toEqual([]);
  });

  it("refuse shares that do not add up", () => {
    // The defect this prevents: every student's progress reads 10% low,
    // uniformly and invisibly, and the figure gates certificates.
    const problems = validateValue("progress.weights", {
      video: 0.3, assignment: 0.3, quiz: 0.2, attendance: 0.1,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("90%");
  });

  it("says the total in percent, which is how it was typed", () => {
    const problems = validateValue("progress.weights", {
      video: 0.5, assignment: 0.5, quiz: 0.5, attendance: 0.5,
    });
    expect(problems[0]?.message).toContain("200%");
  });

  it("refuse a missing component", () => {
    expect(
      validateValue("progress.weights", { video: 0.5, assignment: 0.5, quiz: 0 }),
    ).not.toEqual([]);
  });

  it("refuse an unknown component", () => {
    const problems = validateValue("progress.weights", {
      video: 0.25, assignment: 0.25, quiz: 0.25, attendance: 0.25, homework: 0,
    });
    expect(problems.some((p) => p.message.includes("homework"))).toBe(true);
  });

  it("refuse a negative share", () => {
    expect(
      validateValue("progress.weights", {
        video: -0.1, assignment: 0.4, quiz: 0.4, attendance: 0.3,
      }),
    ).not.toEqual([]);
  });

  it("tolerate floating-point drift", () => {
    expect(
      validateValue("progress.weights", {
        video: 0.1, assignment: 0.2, quiz: 0.3, attendance: 0.4,
      }),
    ).toEqual([]);
  });

  it("refuse a list where an object is required", () => {
    expect(validateValue("progress.weights", [0.25, 0.25, 0.25, 0.25])).toHaveLength(1);
  });
});

describe("coherence between settings", () => {
  it("accepts critical below warning", () => {
    expect(
      validateCoherence({
        "attendance.warningThreshold": 75,
        "attendance.criticalThreshold": 60,
      }),
    ).toEqual([]);
  });

  it("accepts them being equal", () => {
    expect(
      validateCoherence({
        "attendance.warningThreshold": 60,
        "attendance.criticalThreshold": 60,
      }),
    ).toEqual([]);
  });

  it("refuses critical ABOVE warning", () => {
    // A student escalated before ever being warned reads as a skipped step.
    const problems = validateCoherence({
      "attendance.warningThreshold": 60,
      "attendance.criticalThreshold": 75,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("before ever being warned");
  });

  it("says nothing when a value is absent", () => {
    expect(validateCoherence({})).toEqual([]);
  });
});

describe("resolution", () => {
  const stored: StoredSetting[] = [
    { key: "attendance.warningThreshold", value: 70, scopeType: "INSTITUTE", scopeId: null },
    { key: "attendance.warningThreshold", value: 65, scopeType: "PROGRAMME", scopeId: "prog-1" },
    { key: "attendance.warningThreshold", value: 80, scopeType: "SECTION", scopeId: "sec-1" },
  ];

  it("falls back to the code default when nothing is stored", () => {
    const r = resolve("attendance.warningThreshold", []);
    expect(r.value).toBe(75);
    expect(r.source).toBe("default");
  });

  it("uses the institute override when that is all there is", () => {
    const r = resolve("attendance.warningThreshold", stored);
    expect(r.value).toBe(70);
    expect(r.source).toBe("INSTITUTE");
  });

  it("prefers the programme when that programme is in context", () => {
    const r = resolve("attendance.warningThreshold", stored, { PROGRAMME: "prog-1" });
    expect(r.value).toBe(65);
    expect(r.source).toBe("PROGRAMME");
  });

  it("prefers the section over the programme", () => {
    const r = resolve("attendance.warningThreshold", stored, {
      PROGRAMME: "prog-1",
      SECTION: "sec-1",
    });
    expect(r.value).toBe(80);
    expect(r.source).toBe("SECTION");
  });

  it("does not let ANOTHER section's override apply", () => {
    // The whole point of scopeId. One section's threshold must never leak.
    const r = resolve("attendance.warningThreshold", stored, { SECTION: "sec-2" });
    expect(r.value).toBe(70);
    expect(r.source).toBe("INSTITUTE");
  });

  it("does not let another programme's override apply", () => {
    const r = resolve("attendance.warningThreshold", stored, { PROGRAMME: "prog-2" });
    expect(r.value).toBe(70);
  });

  it("treats a null scopeType as institute-wide", () => {
    // Rows written before scoping existed carry null rather than "INSTITUTE".
    const r = resolve("attendance.warningThreshold", [
      { key: "attendance.warningThreshold", value: 55, scopeType: null, scopeId: null },
    ]);
    expect(r.value).toBe(55);
    expect(r.source).toBe("INSTITUTE");
  });

  it("reports where the value came from, so a no-op change is explicable", () => {
    // An administrator who changes the institute value and sees nothing happen
    // needs to be told a section overrides it.
    const r = resolve("attendance.warningThreshold", stored, { SECTION: "sec-1" });
    expect(r.source).toBe("SECTION");
    expect(r.scopeId).toBe("sec-1");
  });

  it("ignores an override for a different key", () => {
    const r = resolve("attendance.criticalThreshold", stored);
    expect(r.source).toBe("default");
    expect(r.value).toBe(60);
  });
});

describe("resolveAll", () => {
  it("returns every catalogued key", () => {
    const all = resolveAll([]);
    expect(Object.keys(all).sort()).toEqual(CATALOGUE.map((d) => d.key).sort());
  });

  it("uses defaults for everything on a fresh install", () => {
    const all = resolveAll([]);
    expect(all["attendance.warningThreshold"]).toBe(75);
    expect(all["progress.weights"]).toEqual({
      video: 0.3, assignment: 0.3, quiz: 0.25, attendance: 0.15,
    });
  });

  it("produces a set that passes its own coherence check", () => {
    expect(validateCoherence(resolveAll([]))).toEqual([]);
  });

  it("applies overrides where they exist and defaults elsewhere", () => {
    const all = resolveAll([
      { key: "attendance.warningThreshold", value: 65, scopeType: "INSTITUTE", scopeId: null },
    ]);
    expect(all["attendance.warningThreshold"]).toBe(65);
    expect(all["attendance.criticalThreshold"]).toBe(60);
  });
});
