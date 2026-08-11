import {
  MAX_BODY,
  MAX_TITLE,
  TEMPLATES,
  definitionFor,
  isTemplated,
  placeholdersIn,
  previewValues,
  refuseTemplate,
  render,
} from "./templates";

describe("the catalogue", () => {
  it("declares a kind, a label and a description for each", () => {
    for (const t of TEMPLATES) {
      expect(t.kind).toMatch(/^[a-z][a-z._]*$/);
      expect(t.label.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(10);
    }
  });

  it("has no duplicate kinds", () => {
    expect(new Set(TEMPLATES.map((t) => t.kind)).size).toBe(TEMPLATES.length);
  });

  it("EVERY placeholder in a default is one that default declares", () => {
    // The catalogue policing itself. A default wording using {studentNmae}
    // would be refused if an administrator typed it, and shipping it in the
    // System's own text would be worse.
    for (const t of TEMPLATES) {
      for (const used of [...placeholdersIn(t.defaultTitle), ...placeholdersIn(t.defaultBody)]) {
        expect(t.placeholders).toContain(used);
      }
    }
  });

  it("every default would be ACCEPTED by the validator", () => {
    // If the System's own wording could not be saved, the Institute could not
    // restore it after an edit.
    for (const t of TEMPLATES) {
      expect(refuseTemplate(t.kind, t.defaultTitle, t.defaultBody)).toEqual([]);
    }
  });

  it("every default renders with nothing missing, given its example values", () => {
    for (const t of TEMPLATES) {
      const r = render(t.defaultTitle, t.defaultBody, previewValues(t));
      expect(r.missing).toEqual([]);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(0);
    }
  });

  it("knows which kinds it covers", () => {
    expect(isTemplated("certificate.issued")).toBe(true);
    // Already sent by the System and deliberately not templated — an
    // announcement's title IS the announcement.
    expect(isTemplated("announcement.posted")).toBe(false);
    expect(definitionFor("nonsense")).toBeUndefined();
  });
});

describe("finding placeholders", () => {
  it("finds them", () => {
    expect(placeholdersIn("Hello {name}, you owe {amount}.")).toEqual(["name", "amount"]);
  });

  it("finds none where there are none", () => {
    expect(placeholdersIn("Nothing here.")).toEqual([]);
  });

  it("ignores something that is not a placeholder", () => {
    expect(placeholdersIn("{ }")).toEqual([]);
    expect(placeholdersIn("{123}")).toEqual([]);
    expect(placeholdersIn("{with space}")).toEqual([]);
  });

  it("reports a repeated placeholder each time it appears", () => {
    expect(placeholdersIn("{a} and {a}")).toEqual(["a", "a"]);
  });
});

describe("refusing a template the System could never fill", () => {
  const kind = "certificate.issued";

  it("accepts a good one", () => {
    expect(refuseTemplate(kind, "Well done {studentName}", "Your certificate {certificateNo}.")).toEqual([]);
  });

  it("REFUSES A MISSPELLED PLACEHOLDER", () => {
    // The whole point of validating on save. A message goes out once, to a
    // person, and "Dear {studentNmae}" cannot be recalled.
    const problems = refuseTemplate(kind, "Dear {studentNmae}", "Body");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe("UNKNOWN_PLACEHOLDER");
    expect(problems[0]?.field).toBe("title");
  });

  it("lists what IS available, so the writer can correct it", () => {
    const problems = refuseTemplate(kind, "Dear {nope}", "Body");
    expect(problems[0]?.message).toContain("{studentName}");
    expect(problems[0]?.message).toContain("{certificateNo}");
  });

  it("catches an unfinished placeholder", () => {
    const problems = refuseTemplate(kind, "Dear {studentName", "Body");
    expect(problems.some((p) => p.code === "UNBALANCED")).toBe(true);
  });

  it("refuses an empty title or body, and says how to get the original back", () => {
    const problems = refuseTemplate(kind, "   ", "Body");
    expect(problems[0]?.code).toBe("EMPTY");
    expect(problems[0]?.message).toContain("reset");
  });

  it("refuses one that is too long", () => {
    const problems = refuseTemplate(kind, "x".repeat(MAX_TITLE + 1), "Body");
    expect(problems.some((p) => p.code === "TOO_LONG")).toBe(true);
    expect(refuseTemplate(kind, "x".repeat(MAX_TITLE), "Body")).toEqual([]);
    expect(refuseTemplate(kind, "Title", "x".repeat(MAX_BODY + 1)).some((p) => p.code === "TOO_LONG")).toBe(true);
  });

  it("reports problems in BOTH title and body, not just the first", () => {
    const problems = refuseTemplate(kind, "{nope}", "{alsoNope}");
    expect(problems.map((p) => p.field).sort()).toEqual(["body", "title"]);
  });

  it("refuses every placeholder for a kind the catalogue does not know", () => {
    const problems = refuseTemplate("not.a.kind", "Hello {studentName}", "Body");
    expect(problems[0]?.code).toBe("UNKNOWN_PLACEHOLDER");
    expect(problems[0]?.message).toContain("no placeholders");
  });
});

describe("rendering — which never sends a brace", () => {
  it("fills the values", () => {
    const r = render("Hello {name}", "You owe {amount}.", { name: "Ayesha", amount: "Rs 500" });
    expect(r.title).toBe("Hello Ayesha");
    expect(r.body).toBe("You owe Rs 500.");
    expect(r.missing).toEqual([]);
  });

  it("NEVER leaves a brace when a value is missing", () => {
    // The one outcome that tells a student the software is broken.
    const r = render("Hello {name}", "You owe {amount}.", {});
    expect(r.title).not.toContain("{");
    expect(r.body).not.toContain("{");
    expect(r.title).not.toContain("}");
  });

  it("reports which values were missing, without putting them in the message", () => {
    const r = render("Hello {name}", "You owe {amount}.", { name: "Ayesha" });
    expect(r.missing).toEqual(["amount"]);
    expect(r.body).not.toContain("amount");
  });

  it("treats null, undefined and blank the same as missing", () => {
    for (const value of [null, undefined, "", "   "]) {
      const r = render("{x}", "Body", { x: value as string });
      expect(r.missing).toEqual(["x"]);
      expect(r.title).toBe("");
    }
  });

  it("accepts a number, which is what a percentage arrives as", () => {
    const r = render("Attendance {p}%", "Body", { p: 68 });
    expect(r.title).toBe("Attendance 68%");
    expect(r.missing).toEqual([]);
  });

  it("does NOT treat zero as missing", () => {
    // A student owing 0 or scoring 0 is a real value, and dropping it would
    // send "Your attendance is %".
    const r = render("Attendance {p}%", "Body", { p: 0 });
    expect(r.title).toBe("Attendance 0%");
    expect(r.missing).toEqual([]);
  });

  it("tidies the quotes left behind by a missing value", () => {
    // 'Your mark for "{assignment}" is available' with no assignment must not
    // become 'Your mark for "" is available'.
    const r = render('Your mark for "{assignment}" is available', "Body", {});
    expect(r.title).toBe("Your mark for is available");
    expect(r.title).not.toContain('""');
  });

  it("tidies doubled spaces", () => {
    const r = render("A {gone} B", "Body", {});
    expect(r.title).toBe("A B");
  });

  it("does not leave punctuation stranded", () => {
    expect(render("Due {when}.", "Body", {}).title).toBe("Due.");
    expect(render("{who}, please pay", "Body", {}).title).toBe("please pay");
  });

  it("lists each missing placeholder ONCE however often it appears", () => {
    const r = render("{x} and {x}", "{x}", {});
    expect(r.missing).toEqual(["x"]);
  });

  it("leaves text with no placeholders exactly alone", () => {
    const r = render("Plain title", "Plain body.", {});
    expect(r.title).toBe("Plain title");
    expect(r.body).toBe("Plain body.");
  });

  it("does not re-render a value that itself contains braces", () => {
    // A student named "{admin}" — absurd, and exactly the kind of thing that
    // turns a templating system into an injection.
    const r = render("Hello {name}", "Body", { name: "{certificateNo}" });
    expect(r.title).toBe("Hello {certificateNo}");
    expect(r.missing).toEqual([]);
  });
});

describe("the preview an Institute sees before saving", () => {
  it("gives an example for every placeholder the kind declares", () => {
    for (const t of TEMPLATES) {
      const values = previewValues(t);
      for (const p of t.placeholders) {
        expect(values[p]).toBeDefined();
        expect(String(values[p]).length).toBeGreaterThan(0);
      }
    }
  });

  it("uses invented people, not a real student", () => {
    // A preview needing a real recipient could only be shown by picking one,
    // and picking one means reading their marks and their fees.
    const values = previewValues(definitionFor("certificate.issued")!);
    expect(values["studentName"]).toBe("Ayesha Khan");
  });
});
