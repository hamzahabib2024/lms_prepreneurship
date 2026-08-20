import {
  MAX_IMPORT,
  countAgainstSection,
  describePlan,
  importResultMessage,
  parseCsv,
  planImport,
  templateCsv,
} from "./cohort-import";

const HEAD = "fullName,email,gender,phone,dateOfBirth,nationalId";
const ROW = "Ayesha Khan,ayesha@example.com,FEMALE,03001234567,2005-04-03,3520112345671";

describe("parsing the file people actually produce", () => {
  it("reads a plain file", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("survives CRLF, which is what Excel on Windows writes", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips the UTF-8 BOM Excel puts in front of the first heading", () => {
    // Without this the first column is named with a byte-order mark before "fullName", matches nothing,
    // and the file is rejected for having no fullName column while plainly
    // having one — which is impossible to act on.
    const grid = parseCsv("fullName,email\nA,b@c.d");
    expect(grid[0]?.[0]).toBe("fullName");
  });

  it("keeps a comma inside a quoted field", () => {
    // Every address in the country has one.
    expect(parseCsv('name,address\nAyesha,"12 Mall Road, Lahore"')).toEqual([
      ["name", "address"],
      ["Ayesha", "12 Mall Road, Lahore"],
    ]);
  });

  it("handles a doubled quote inside a quoted field", () => {
    expect(parseCsv('a\n"she said ""hello"""')).toEqual([["a"], ['she said "hello"']]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('a,b\n"line one\nline two",x')).toEqual([
      ["a", "b"],
      ["line one\nline two", "x"],
    ]);
  });

  it("does not invent a row from a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n")).toHaveLength(2);
  });

  it("keeps empty fields rather than collapsing them", () => {
    // Dropping them shifts every later column left, so the phone becomes the
    // city and the file imports quietly wrong.
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });
});

describe("the header", () => {
  it("refuses a file with nothing in it", () => {
    expect(planImport("")?.fileProblem?.code).toBe("EMPTY");
  });

  it("refuses headings that name nothing this System uses", () => {
    const p = planImport("a,b,c\n1,2,3");
    expect(p.fileProblem?.code).toBe("NO_HEADER");
    expect(p.fileProblem?.message).toContain("fullName");
  });

  it("names the column that is missing, not just that one is", () => {
    const p = planImport("fullName,email,gender\nA,a@b.cd,MALE");
    expect(p.fileProblem?.code).toBe("MISSING_COLUMNS");
    expect(p.fileProblem?.message).toContain("phone");
  });

  it("accepts headings in any case, because Email is not a mistake", () => {
    const p = planImport("FullName,EMAIL,Gender,Phone,DateOfBirth,NationalID\n" + ROW);
    expect(p.fileProblem).toBeNull();
    expect(p.rows).toHaveLength(1);
  });

  it("accepts the columns in any order", () => {
    const p = planImport(
      "phone,gender,email,fullName,dateOfBirth,nationalId\n" +
        "03001234567,FEMALE,a@b.cd,Ayesha Khan,2005-04-03,3520112345689",
    );
    expect(p.rows[0]?.fullName).toBe("Ayesha Khan");
    expect(p.rows[0]?.email).toBe("a@b.cd");
  });

  it("REPORTS a column it does not recognise instead of ignoring it", () => {
    // A column called "emial" holds every address in the file. Dropping it
    // silently loses them all and the operator finds out from the students.
    const p = planImport(`${HEAD},emial\n${ROW},x@y.zz`);
    expect(p.unknownColumns).toEqual(["emial"]);
  });

  it("refuses headings with no students under them", () => {
    expect(planImport(HEAD).fileProblem?.code).toBe("EMPTY");
  });

  it("ignores blank rows in the middle rather than calling them errors", () => {
    const p = planImport(`${HEAD}\n${ROW}\n\n\nBilal Ahmed,bilal@example.com,MALE,03011234567,2004-01-15,3520112345681`);
    expect(p.rows).toHaveLength(2);
    expect(p.rowProblems).toEqual([]);
  });
});

describe("row numbers point at the operator's spreadsheet", () => {
  it("calls the first student row 2, because the header is row 1", () => {
    // An off-by-one here makes the operator correct the wrong person's row and
    // trust the correction.
    const p = planImport(`${HEAD}\nNoName,,MALE,03001234567,2005-04-03,3520112345685`);
    expect(p.rowProblems[0]?.line).toBe(2);
  });

  it("counts blank rows, so the numbers still match the file", () => {
    const p = planImport(`${HEAD}\n${ROW}\n\nBad,notanemail,MALE,03001234567,2005-04-03,3520112345686`);
    // The bad row is the 4th line of the file.
    expect(p.rowProblems.some((x) => x.line === 4)).toBe(true);
  });
});

describe("each row", () => {
  const one = (row: string) => planImport(`${HEAD}\n${row}`);

  it("accepts a good one", () => {
    const p = one(ROW);
    expect(p.rowProblems).toEqual([]);
    expect(p.rows[0]).toMatchObject({
      fullName: "Ayesha Khan",
      email: "ayesha@example.com",
      gender: "FEMALE",
      phone: "+923001234567",
    });
  });

  it("lower-cases the email, so a returning student is recognised", () => {
    // The System matches a returning student on email. Loading Ayesha@X.com
    // when the account is ayesha@x.com would give her a SECOND registration
    // number, and the same person becomes two people in every report.
    expect(one("Ayesha Khan,Ayesha@Example.COM,FEMALE,03001234567,2005-04-03,3520112345683").rows[0]?.email).toBe(
      "ayesha@example.com",
    );
  });

  it("reports EVERY problem in a row, not only the first", () => {
    const p = one(",notanemail,X,nope,notadate,nope");
    expect(new Set(p.rowProblems.map((x) => x.field))).toEqual(
      new Set(["fullName", "email", "gender", "phone", "dateOfBirth", "nationalId"]),
    );
  });

  it("says what is wrong in terms of the value given", () => {
    const p = one("Ayesha Khan,a@b.cd,FEMALE,12345,2005-04-03,3520112345684");
    expect(p.rowProblems[0]?.message).toContain("12345");
    expect(p.rowProblems[0]?.message).toContain("03001234567");
  });

  it("distinguishes a missing value from a wrong one", () => {
    expect(one("Ayesha Khan,a@b.cd,FEMALE,,2005-04-03,3520112345688").rowProblems[0]?.message).toContain("No phone number");
    expect(one("Ayesha Khan,a@b.cd,FEMALE,12345,2005-04-03,3520112345684").rowProblems[0]?.message).toContain("not a phone number");
  });
});

describe("phone numbers as people type them", () => {
  const phone = (given: string) =>
    planImport(`${HEAD}\nAyesha Khan,a@b.cd,FEMALE,${given},2005-04-03,3520112345690`).rows[0]?.phone ?? null;

  it("accepts the four shapes in ordinary use", () => {
    expect(phone("03001234567")).toBe("+923001234567");
    expect(phone("0300-1234567")).toBe("+923001234567");
    expect(phone("+923001234567")).toBe("+923001234567");
    expect(phone("92 300 1234567")).toBe("+923001234567");
  });

  it("normalises them all to ONE stored form", () => {
    // Otherwise the same person appears twice and a WhatsApp send picks one.
    const forms = ["03001234567", "0300-1234567", "+92 300 1234567", "92-300-1234567"];
    expect(new Set(forms.map(phone)).size).toBe(1);
  });

  it("refuses one that is too short or too long", () => {
    expect(phone("0300123456")).toBeNull();
    expect(phone("030012345678")).toBeNull();
  });
});

describe("gender, which decides which sections they may join", () => {
  const gender = (given: string) =>
    planImport(`${HEAD}\nAyesha Khan,a@b.cd,${given},03001234567,2005-04-03,3520112345691`).rows[0]?.gender ??
    null;

  it("accepts the written word in any case", () => {
    expect(gender("FEMALE")).toBe("FEMALE");
    expect(gender("female")).toBe("FEMALE");
    expect(gender("Male")).toBe("MALE");
  });

  it("accepts a single letter, which is how registers are usually kept", () => {
    expect(gender("F")).toBe("FEMALE");
    expect(gender("m")).toBe("MALE");
  });

  it("refuses anything it cannot be sure of", () => {
    // Guessing here puts a student in a section the Institute segregates by
    // gender, which FR-CRS-009 makes absolute.
    expect(gender("1")).toBeNull();
    expect(gender("unknown")).toBeNull();
  });
});

describe("the date of birth, where a wrong guess is silent", () => {
  const dob = (given: string) =>
    planImport(`${HEAD}\nAyesha Khan,a@b.cd,FEMALE,03001234567,${given},3520112345692`);
  const iso = (given: string) => dob(given).rows[0]?.dateOfBirth?.toISOString().slice(0, 10) ?? null;

  it("reads YYYY-MM-DD as written", () => {
    expect(iso("2005-04-03")).toBe("2005-04-03");
  });

  it("reads DD/MM/YYYY as the local convention", () => {
    // 03/04/2005 is the THIRD OF APRIL here. Reading it as 4 March would be
    // silent: the student exists and the date looks perfectly plausible.
    expect(iso("03/04/2005")).toBe("2005-04-03");
    expect(iso("03-04-2005")).toBe("2005-04-03");
  });

  it("REFUSES a date that can only be month/day, rather than reinterpreting it", () => {
    // 04/25/2005 cannot be DD/MM. That means the file came from a US export,
    // and every OTHER date in it is silently transposed — so the right answer
    // is to refuse the file's convention, not to be clever about one row.
    const p = dob("04/25/2005");
    expect(p.rows).toHaveLength(0);
    expect(p.rowProblems[0]?.message).toContain("month/day/year");
    expect(p.rowProblems[0]?.message).toContain("DD/MM/YYYY");
  });

  it("refuses a date that is not real", () => {
    // The Date constructor rolls 31 February forward to 3 March without a word.
    expect(dob("31/02/2005").rows).toHaveLength(0);
    expect(dob("2005-02-31").rows).toHaveLength(0);
  });

  it("refuses an age the application form would have refused", () => {
    const year = new Date().getUTCFullYear();
    expect(dob(`01/01/${year - 3}`).rowProblems[0]?.message).toContain("age");
    expect(dob("01/01/1850").rows).toHaveLength(0);
  });

  it("refuses a missing one, because the record requires it", () => {
    expect(dob("").rowProblems[0]?.message).toContain("No date of birth");
  });

  it("refuses something that is not a date at all", () => {
    expect(dob("last year").rowProblems[0]?.message).toContain("not a date");
  });
});

describe("the CNIC, which is required and unique", () => {
  const one = (given: string) =>
    planImport(`${HEAD}\nAyesha Khan,a@b.cd,FEMALE,03001234567,2005-04-03,${given}`);

  it("accepts it with or without dashes and stores ONE form", () => {
    // Both forms reaching the database as different strings would let the same
    // person be admitted twice past a UNIQUE column that never noticed.
    expect(one("35201-1234567-1").rows[0]?.nationalId).toBe("3520112345671");
    expect(one("3520112345671").rows[0]?.nationalId).toBe("3520112345671");
  });

  it("refuses a missing one, because the column is NOT NULL and unique", () => {
    // Defaulting an absent CNIC to "" was a real bug: the first student took
    // the empty string and every later one collided with them on the unique
    // index, so a file of thirty loaded exactly one.
    const p = one("");
    expect(p.rows).toHaveLength(0);
    expect(p.rowProblems[0]?.message).toContain("no two may share it");
  });

  it("refuses one that is the wrong shape", () => {
    expect(one("12345").rowProblems[0]?.field).toBe("nationalId");
  });

  it("catches the same CNIC on two rows, naming the earlier one", () => {
    // Left in, both rows reach the database and the second dies on a
    // constraint, which reads as a fault in the System rather than in the file.
    const p = planImport(
      `${HEAD}\n${ROW}\nSomebody Else,other@example.com,FEMALE,03009999999,2004-01-01,3520112345671`,
    );
    expect(p.rows).toHaveLength(1);
    expect(p.rowProblems[0]?.field).toBe("nationalId");
    expect(p.rowProblems[0]?.message).toContain("row 2");
  });

  it("catches it across differing dash placement", () => {
    const p = planImport(
      `${HEAD}\n${ROW}\nSomebody Else,other@example.com,FEMALE,03009999999,2004-01-01,35201-1234567-1`,
    );
    expect(p.rowProblems[0]?.field).toBe("nationalId");
  });
});

describe("the same student twice", () => {
  it("refuses a duplicate email within the file, naming the earlier row", () => {
    const p = planImport(`${HEAD}\n${ROW}\nAyesha K,ayesha@example.com,FEMALE,03009999999,2005-04-03`);
    expect(p.rowProblems[0]?.message).toContain("row 2");
    expect(p.rows).toHaveLength(1);
  });

  it("catches it across differing case", () => {
    const p = planImport(`${HEAD}\n${ROW}\nAyesha K,AYESHA@EXAMPLE.COM,FEMALE,03009999999,2005-04-03,3520112345682`);
    expect(p.rowProblems).toHaveLength(1);
  });

  it("keeps the FIRST of the pair, not the last", () => {
    const p = planImport(`${HEAD}\n${ROW}\nSecond,ayesha@example.com,FEMALE,03009999999,2005-04-03,3520112345687`);
    expect(p.rows[0]?.fullName).toBe("Ayesha Khan");
  });
});

describe("refusing the whole file", () => {
  it("refuses more than it can do at once, and says what to do instead", () => {
    const many = Array.from(
      { length: MAX_IMPORT + 1 },
      (_, i) => `Student ${i},s${i}@example.com,MALE,03001234567,2005-04-03,${String(3520100000000 + i)}`,
    ).join("\n");
    const p = planImport(`${HEAD}\n${many}`);
    expect(p.fileProblem?.code).toBe("TOO_MANY");
    expect(p.fileProblem?.message).toContain("Split");
  });

  it("allows exactly the limit", () => {
    const many = Array.from(
      { length: MAX_IMPORT },
      (_, i) => `Student ${i},s${i}@example.com,MALE,03001234567,2005-04-03,${String(3520100000000 + i)}`,
    ).join("\n");
    expect(planImport(`${HEAD}\n${many}`).fileProblem).toBeNull();
  });

  it("says so ONCE when not a single row could be read", () => {
    // Three hundred separate complaints is not as useful as "this is probably
    // the wrong file, or it is semicolon-separated".
    const bad = Array.from({ length: 20 }, (_, i) => `Bad ${i},notanemail,X,nope,notadate,nope`).join("\n");
    const p = planImport(`${HEAD}\n${bad}`);
    expect(p.fileProblem?.code).toBe("ALL_INVALID");
    expect(p.fileProblem?.message).toContain("semicolon");
  });

  it("does NOT refuse the file when only some rows are bad", () => {
    // The whole point: the good ones load and the rest are reported.
    const p = planImport(
      `${HEAD}\n${ROW}\nBad Row,notanemail,X,nope,notadate,nope\nBilal Ahmed,bilal@example.com,MALE,03011234567,2004-01-15,3520112345681`,
    );
    expect(p.fileProblem).toBeNull();
    expect(p.rows).toHaveLength(2);
    expect(p.rowProblems.length).toBeGreaterThan(0);
  });
});

describe("what the operator is told before anything is written", () => {
  it("says how many are ready when all are", () => {
    expect(describePlan(planImport(`${HEAD}\n${ROW}`))).toBe("1 student ready to load.");
  });

  it("says plainly that the rest are SKIPPED, not that the import failed", () => {
    const p = planImport(`${HEAD}\n${ROW}\nBad Row,notanemail,X,nope,notadate,nope`);
    const said = describePlan(p);
    expect(said).toContain("1 ready to load");
    expect(said).toContain("SKIPPED");
    expect(said).toContain("nothing else is held up");
  });

  it("counts ROWS, not problems, so a row with four faults counts once", () => {
    const p = planImport(`${HEAD}\n${ROW}\n,notanemail,X,nope`);
    expect(describePlan(p)).toContain("1 row will be SKIPPED");
  });

  it("passes the file's own complaint through when there is one", () => {
    expect(describePlan(planImport(""))).toBe("The file has nothing in it.");
  });
});

describe("counting against the section, which the button is labelled with", () => {
  const rows = (...specs: Array<{ gender: string; email: string }>) =>
    specs.map((s, i) => ({
      line: i + 2,
      fullName: `Student ${i}`,
      email: s.email,
      gender: s.gender as "MALE" | "FEMALE",
      phone: "+923001234567",
      dateOfBirth: new Date("2004-01-01"),
      nationalId: String(3520100000000 + i),
    }));
  const none = () => false;

  it("counts new students", () => {
    const c = countAgainstSection(
      rows({ gender: "FEMALE", email: "a@x.cd" }, { gender: "FEMALE", email: "b@x.cd" }),
      "FEMALE",
      none,
    );
    expect(c).toEqual({ wouldLoad: 2, wouldRejoin: 0, blocked: 0 });
  });

  it("counts a returning student as a REJOIN and NOT also as a load", () => {
    // The defect this function exists for. Counted in both, the button offered
    // to load somebody twice and the result then disagreed with it.
    const c = countAgainstSection(
      rows({ gender: "FEMALE", email: "new@x.cd" }, { gender: "FEMALE", email: "old@x.cd" }),
      "FEMALE",
      (e) => e === "old@x.cd",
    );
    expect(c).toEqual({ wouldLoad: 1, wouldRejoin: 1, blocked: 0 });
  });

  it("counts a blocked student as NEITHER", () => {
    const c = countAgainstSection(
      rows({ gender: "FEMALE", email: "a@x.cd" }, { gender: "MALE", email: "b@x.cd" }),
      "FEMALE",
      none,
    );
    expect(c).toEqual({ wouldLoad: 1, wouldRejoin: 0, blocked: 1 });
  });

  it("counts a blocked RETURNING student as blocked, not as a rejoin", () => {
    // She is already here, but she still cannot join this section. Counting
    // her as a rejoin would promise something the restriction refuses.
    const c = countAgainstSection(
      rows({ gender: "MALE", email: "old@x.cd" }),
      "FEMALE",
      () => true,
    );
    expect(c).toEqual({ wouldLoad: 0, wouldRejoin: 0, blocked: 1 });
  });

  it("blocks nobody in a MIXED section", () => {
    const c = countAgainstSection(
      rows({ gender: "FEMALE", email: "a@x.cd" }, { gender: "MALE", email: "b@x.cd" }),
      "MIXED",
      none,
    );
    expect(c).toEqual({ wouldLoad: 2, wouldRejoin: 0, blocked: 0 });
  });

  it("the three ALWAYS add up to the rows given", () => {
    // The property that makes the button's number trustworthy.
    const all = rows(
      { gender: "FEMALE", email: "a@x.cd" },
      { gender: "MALE", email: "b@x.cd" },
      { gender: "FEMALE", email: "old@x.cd" },
      { gender: "MALE", email: "d@x.cd" },
    );
    for (const restriction of ["MIXED", "MALE", "FEMALE"]) {
      const c = countAgainstSection(all, restriction, (e) => e === "old@x.cd");
      expect(c.wouldLoad + c.wouldRejoin + c.blocked).toBe(all.length);
    }
  });

  it("counts nothing from an empty file", () => {
    expect(countAgainstSection([], "FEMALE", none)).toEqual({
      wouldLoad: 0,
      wouldRejoin: 0,
      blocked: 0,
    });
  });
});

describe("the template offered on the screen", () => {
  it("parses as a file this module accepts", () => {
    // A template that does not import is worse than none, because the operator
    // trusts it and edits from it.
    const p = planImport(templateCsv());
    expect(p.fileProblem).toBeNull();
    expect(p.rowProblems).toEqual([]);
    expect(p.rows).toHaveLength(1);
  });

  it("names every required column", () => {
    const header = templateCsv().split("\n")[0] ?? "";
    for (const c of ["fullName", "email", "gender", "phone"]) expect(header).toContain(c);
  });
});

/**
 * What the operator is told afterwards — FR-OPS-026.
 *
 * THE CLAIM THAT CANNOT BE CHECKED BY LOOKING. Whether a hundred students were
 * actually sent their passwords is invisible on the screen, so the sentence
 * has to be exact about it. An operator told "300 students loaded" closes the
 * page; if forty were never emailed, forty people hold an account they cannot
 * reach, and nobody finds out until the term starts.
 */
describe("the sentence the operator reads afterwards", () => {
  const msg = (o: Partial<Parameters<typeof importResultMessage>[0]>) =>
    importResultMessage({ loaded: 0, rejoined: 0, skipped: 0, emailed: 0, notEmailed: 0, ...o });

  it("says every student was emailed when every student was", () => {
    const m = msg({ loaded: 3, emailed: 3 });
    expect(m).toContain("3 new students loaded");
    expect(m).toMatch(/Every new student has been emailed/);
  });

  it("NAMES THE NUMBER that could not be reached rather than rounding it away", () => {
    // The defect this exists to prevent: a partial failure reported as a
    // success, because the sentence only mentioned how many were loaded.
    const m = msg({ loaded: 300, emailed: 260, notEmailed: 40 });
    expect(m).toContain("260 students were emailed");
    expect(m).toContain("40 could not be reached");
    expect(m).not.toMatch(/Every new student has been emailed/);
  });

  it("is unmistakable when email is off entirely", () => {
    // Not a footnote. If nothing was sent, relaying every password by hand is
    // the operator's next hour, and they have to know before they close it.
    const m = msg({ loaded: 12, emailed: 0, notEmailed: 12 });
    expect(m).toContain("NOBODY WAS EMAILED");
    expect(m).toMatch(/Integrations/);
  });

  it("says nothing about email when nothing new was created", () => {
    // A returning student's password was not touched, so there is nothing to
    // have sent and nothing to report.
    const m = msg({ rejoined: 4 });
    expect(m).toContain("4 existing students joined this section");
    expect(m).not.toMatch(/email/i);
  });

  it("counts one student in the singular", () => {
    expect(msg({ loaded: 1, emailed: 1 })).toContain("1 new student loaded");
    expect(msg({ loaded: 2, emailed: 1, notEmailed: 1 })).toContain("1 student was emailed");
  });

  it("does not pretend an empty file did something", () => {
    expect(msg({})).toBe("Nothing was loaded.");
  });

  it("still reports the skipped rows beside the delivery count", () => {
    // Both, always. "298 of 300 loaded" beside a tick is how somebody closes
    // the page believing all three hundred went in.
    const m = msg({ loaded: 298, skipped: 2, emailed: 298 });
    expect(m).toContain("2 skipped");
    expect(m).toMatch(/Every new student has been emailed/);
  });
});
