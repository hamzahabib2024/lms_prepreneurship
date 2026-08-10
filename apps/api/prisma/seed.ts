/**
 * Development seed — SRS TST-001.
 *
 * Deterministic: running it twice produces the same result, so a developer can
 * reset and re-seed without accumulating duplicates.
 *
 * TST-003 asks for boundary cases, and this includes two on purpose:
 *   - a section at exactly capacity, to exercise FR-REG-031
 *   - gender-restricted sections, to exercise the absolute rule FR-CRS-009
 *
 * TST-004: no real payment slips and no real identity numbers. Everything
 * here is synthetic.
 */

import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const db = new PrismaClient();

const hash = (plain: string): Promise<string> =>
  argon2.hash(plain, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });

async function main(): Promise<void> {
  console.log("Seeding…");

  // -- roles (§4.2) ---------------------------------------------------------
  const roleDefs = [
    { key: "super_admin", name: "Super Admin" },
    { key: "admin", name: "Administrator" },
    { key: "teacher", name: "Teacher" },
    { key: "student", name: "Student" },
  ];
  for (const r of roleDefs) {
    await db.role.upsert({
      where: { key: r.key },
      update: { name: r.name },
      create: { key: r.key, name: r.name, isSystem: true },
    });
  }
  const roles = Object.fromEntries(
    (await db.role.findMany()).map((r) => [r.key, r.id]),
  ) as Record<string, string>;
  console.log("  roles: 4");

  // -- people ---------------------------------------------------------------
  // BR-ACC-02 requires at least one active Super Admin at all times.
  const superAdmin = await db.user.upsert({
    where: { email: "superadmin@institute.local" },
    update: {},
    create: {
      email: "superadmin@institute.local",
      passwordHash: await hash("ChangeMe!SuperAdmin2026"),
      fullName: "System Owner",
      status: "ACTIVE",
      // Seeded accounts skip the forced change so `npm run dev` is usable
      // immediately. Production provisioning always sets this true
      // (FR-REG-040).
      mustChangePassword: false,
      roles: { create: { roleId: roles["super_admin"]! } },
    },
  });

  await db.user.upsert({
    where: { email: "admin@institute.local" },
    update: {},
    create: {
      email: "admin@institute.local",
      passwordHash: await hash("ChangeMe!Admin2026"),
      fullName: "Usman Admin",
      phone: "+923001234567",
      status: "ACTIVE",
      mustChangePassword: false,
      roles: {
        create: {
          roleId: roles["admin"]!,
          // §4.2.2 — sub-permissions are granted individually, not implied.
          subPermissions: ["financial_reporter", "bulk_operator", "certificate_issuer"],
        },
      },
    },
  });

  const teacherUser = await db.user.upsert({
    where: { email: "sana@institute.local" },
    update: {},
    create: {
      email: "sana@institute.local",
      passwordHash: await hash("ChangeMe!Teacher2026"),
      fullName: "Sana Ahmed",
      phone: "+923011234567",
      status: "ACTIVE",
      mustChangePassword: false,
      roles: { create: { roleId: roles["teacher"]! } },
    },
  });

  const teacher = await db.teacher.upsert({
    where: { userId: teacherUser.id },
    update: {},
    create: { userId: teacherUser.id, employeeCode: "T-001", joinedAt: new Date("2024-01-15") },
  });

  // A second teacher, so the ASSIGNED-scope tests have someone to be excluded
  // from. A scope test with only one teacher proves nothing.
  const otherTeacherUser = await db.user.upsert({
    where: { email: "imran@institute.local" },
    update: {},
    create: {
      email: "imran@institute.local",
      passwordHash: await hash("ChangeMe!Teacher2026"),
      fullName: "Imran Qureshi",
      status: "ACTIVE",
      mustChangePassword: false,
      roles: { create: { roleId: roles["teacher"]! } },
    },
  });
  const otherTeacher = await db.teacher.upsert({
    where: { userId: otherTeacherUser.id },
    update: {},
    create: { userId: otherTeacherUser.id, employeeCode: "T-002", joinedAt: new Date("2024-06-01") },
  });
  console.log("  users: 1 super admin, 1 admin, 2 teachers");

  // -- academic structure (§5.3) -------------------------------------------
  const programme = await db.programme.upsert({
    where: { code: "GD" },
    update: {},
    create: {
      code: "GD",
      name: "Diploma in Graphic Designing",
      description: "Six-month practical diploma.",
      durationWeeks: 26,
    },
  });

  const marketing = await db.programme.upsert({
    where: { code: "DM" },
    update: {},
    create: { code: "DM", name: "Diploma in Digital Marketing", durationWeeks: 26 },
  });

  const session = await db.academicSession.upsert({
    where: { programmeId_code: { programmeId: programme.id, code: "SP26" } },
    update: {},
    create: {
      programmeId: programme.id,
      code: "SP26",
      name: "Spring 2026",
      startDate: new Date("2026-02-01"),
      endDate: new Date("2026-07-31"),
      status: "ACTIVE",
    },
  });

  const dmSession = await db.academicSession.upsert({
    where: { programmeId_code: { programmeId: marketing.id, code: "SP26" } },
    update: {},
    create: {
      programmeId: marketing.id,
      code: "SP26",
      name: "Spring 2026",
      startDate: new Date("2026-02-01"),
      endDate: new Date("2026-07-31"),
      status: "ACTIVE",
    },
  });

  const morningBatch = await upsertBatch(session.id, "SP26 Morning", "MORNING");
  const eveningBatch = await upsertBatch(dmSession.id, "SP26 Evening", "EVENING");

  // FR-CRS-007 — the Institute's real structure: gendered and time-based
  // sections, expressed as configurable attributes rather than hard-coded.
  const gdFemale = await upsertSection({
    batchId: morningBatch.id,
    code: "SP26-GD-MOR-A",
    name: "Graphic Designing — Morning A (Female)",
    capacity: 40,
    genderRestriction: "FEMALE",
    shift: "MORNING",
  });

  const gdMale = await upsertSection({
    batchId: morningBatch.id,
    code: "SP26-GD-MOR-B",
    name: "Graphic Designing — Morning B (Male)",
    capacity: 40,
    genderRestriction: "MALE",
    shift: "MORNING",
  });

  // TST-003 boundary: a section already AT capacity, so FR-REG-031 can be
  // exercised without first enrolling forty students.
  const dmFull = await upsertSection({
    batchId: eveningBatch.id,
    code: "SP26-DM-EVE-A",
    name: "Digital Marketing — Evening A (Mixed)",
    capacity: 2,
    genderRestriction: "MIXED",
    shift: "EVENING",
    enrolledCount: 2,
  });

  const subjects = await Promise.all(
    [
      { code: "GD101", name: "Graphic Designing" },
      { code: "ENG101", name: "English" },
      { code: "DM101", name: "Digital Marketing" },
      { code: "WD101", name: "Web Development" },
    ].map((s) =>
      db.subject.upsert({ where: { code: s.code }, update: {}, create: { ...s, credits: 3 } }),
    ),
  );
  const [gd, eng, dm] = subjects;
  console.log("  structure: 2 programmes, 3 sections, 4 subjects");

  // -- offerings and assignments -------------------------------------------
  const gdFemaleGd = await offer(gdFemale.id, gd!.id, true);
  const gdFemaleEng = await offer(gdFemale.id, eng!.id, true);
  const gdMaleGd = await offer(gdMale.id, gd!.id, true);
  const dmFullDm = await offer(dmFull.id, dm!.id, true);

  // BR-ACC-04: Sana teaches Graphic Designing in the FEMALE section only.
  // Imran teaches the same subject in the MALE section. This pairing is what
  // makes the scope tests meaningful — Sana must not see Imran's students
  // even though they teach the same subject.
  await assign(teacher.id, gdFemaleGd.id);
  await assign(teacher.id, gdFemaleEng.id);
  await assign(otherTeacher.id, gdMaleGd.id);
  await assign(otherTeacher.id, dmFullDm.id);
  console.log("  offerings: 4, assignments: 4");

  // -- students, enrolments and sessions ------------------------------------
  // Without these every roster is empty, the teacher dashboard has nothing to
  // show, and the attendance register cannot be exercised at all.
  const cohort = [
    "Ayesha Siddiqui",
    "Hina Malik",
    "Zainab Raza",
    "Maryam Iqbal",
    "Fatima Noor",
    "Sana Javed",
    "Aliya Hassan",
    "Rabia Aslam",
  ];

  const studentPassword = await hash("ChangeMe!Student2026");
  let enrolled = 0;

  for (const [index, name] of cohort.entries()) {
    const roll = index + 1;
    const email = `${name.split(" ")[0]!.toLowerCase()}${roll}@student.local`;
    if (await db.user.findUnique({ where: { email } })) continue;

    const user = await db.user.create({
      data: {
        email,
        passwordHash: studentPassword,
        fullName: name,
        phone: `+9230012345${String(roll).padStart(2, "0")}`,
        status: "ACTIVE",
        mustChangePassword: false,
        roles: { create: { roleId: roles["student"]! } },
      },
    });

    const student = await db.student.create({
      data: {
        userId: user.id,
        // Mirrors the Appendix B format. Real numbers come from the atomic
        // series at approval (FR-REG-051); these are fixtures, not issued.
        registrationNo: `CIIT/SP26-GD-${String(roll).padStart(3, "0")}/ISB`,
        currentSectionId: gdFemale.id,
        currentRollNo: roll,
        nationalId: `61101${String(1000000 + roll)}${roll % 10}`,
        dateOfBirth: new Date("2006-06-15"),
        gender: "FEMALE",
        admissionDate: new Date("2026-02-01"),
      },
    });

    await db.enrolment.createMany({
      data: [gdFemaleGd.id, gdFemaleEng.id].map((sectionSubjectId) => ({
        studentId: student.id,
        sectionSubjectId,
        status: "ACTIVE" as const,
        rollNoAtEnrolment: roll,
      })),
      skipDuplicates: true,
    });
    enrolled += 1;
  }

  await db.section.update({
    where: { id: gdFemale.id },
    data: { enrolledCount: cohort.length },
  });
  console.log(`  students: ${enrolled} enrolled in ${gdFemale.code}`);

  // Sessions spanning past and future, so the register has something to mark
  // and the dashboard has a next class to show.
  const at = (dayOffset: number, hour: number): Date => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d;
  };

  const plan = [
    { offset: -3, title: "Colour theory in practice" },
    { offset: -2, title: "Typography fundamentals" },
    { offset: -1, title: "Grid systems" },
    { offset: 0, title: "Composition and balance" },
    { offset: 1, title: "Brand identity basics" },
  ];

  let sessions = 0;
  for (const item of plan) {
    const scheduledStart = at(item.offset, 9);
    const clash = await db.liveSession.findFirst({
      where: { sectionSubjectId: gdFemaleGd.id, scheduledStart },
    });
    if (clash) continue;

    await db.liveSession.create({
      data: {
        sectionSubjectId: gdFemaleGd.id,
        title: item.title,
        scheduledStart,
        scheduledEnd: new Date(scheduledStart.getTime() + 90 * 60_000),
        hostTeacherId: teacher.id,
        // Past sessions are ENDED so they show as work outstanding — which is
        // exactly what the teacher's action queue counts (FR-TCH-002).
        status: item.offset < 0 ? "ENDED" : "SCHEDULED",
        sessionType: "ONLINE",
      },
    });
    sessions += 1;
  }
  console.log(`  sessions: ${sessions} (3 past, 2 upcoming)`);

  // -- course content (§5.6, §5.7) -----------------------------------------
  // Without this a student logs in to an empty screen: the subject page has no
  // lectures, and the video component of progress has nothing to measure.
  //
  // TST-003 boundary: the last module is left DRAFT on purpose, so BR-CNT-01
  // can be exercised. A student must not see it in any list or count, and the
  // draft lecture inside it must not appear in their progress denominator.
  const gdModules = [
    {
      title: "Foundations of Design",
      status: "PUBLISHED" as const,
      lessons: [
        { title: "What design is for", minutes: 25, lectureMinutes: 22 },
        { title: "Colour theory", minutes: 40, lectureMinutes: 38 },
        { title: "Typography", minutes: 35, lectureMinutes: 31 },
      ],
    },
    {
      title: "Composition",
      status: "PUBLISHED" as const,
      lessons: [
        { title: "Grid systems", minutes: 30, lectureMinutes: 27 },
        { title: "Balance and hierarchy", minutes: 30, lectureMinutes: 29 },
      ],
    },
    {
      // Next term's material, still being prepared. Invisible to students.
      title: "Brand Identity",
      status: "DRAFT" as const,
      lessons: [{ title: "Logo construction", minutes: 45, lectureMinutes: 44 }],
    },
  ];

  let moduleCount = 0;
  let lectureCount = 0;

  for (const [moduleIndex, m] of gdModules.entries()) {
    const module = await upsertModule(gd!.id, m.title, moduleIndex + 1, m.status);
    moduleCount += 1;

    for (const [lessonIndex, l] of m.lessons.entries()) {
      const lesson = await upsertLesson({
        moduleId: module.id,
        title: l.title,
        displayOrder: lessonIndex + 1,
        estimatedMinutes: l.minutes,
        // A lesson is no more visible than the module containing it.
        publicationStatus: m.status,
      });

      const created = await upsertLecture({
        lessonId: lesson.id,
        sectionSubjectId: gdFemaleGd.id,
        title: l.title,
        durationSeconds: l.lectureMinutes * 60,
        teacherId: teacher.id,
        publicationStatus: m.status,
        recordedOn: at(-14 + lectureCount * 2, 9),
      });
      if (created) lectureCount += 1;
    }
  }

  // English gets one published module so the student home page shows two
  // subjects with genuinely different progress, not the same figure twice.
  const engModule = await upsertModule(eng!.id, "Professional Communication", 1, "PUBLISHED");
  const engLesson = await upsertLesson({
    moduleId: engModule.id,
    title: "Writing a brief",
    displayOrder: 1,
    estimatedMinutes: 20,
    publicationStatus: "PUBLISHED",
  });
  if (
    await upsertLecture({
      lessonId: engLesson.id,
      sectionSubjectId: gdFemaleEng.id,
      title: "Writing a brief",
      durationSeconds: 18 * 60,
      teacherId: teacher.id,
      publicationStatus: "PUBLISHED",
      recordedOn: at(-10, 11),
    })
  ) {
    lectureCount += 1;
  }
  console.log(`  content: ${moduleCount + 1} modules, ${lectureCount} lectures (1 module DRAFT)`);

  // -- assignments (§5.9) ---------------------------------------------------
  // Two, with different windows, because almost every rule in this module is
  // about WHEN something was handed in. One assignment can only ever exercise
  // one side of that.
  const assignmentPlan = [
    {
      title: "Colour palette for a local brand",
      instructions:
        "Choose a Pakistani brand and produce a five-colour palette with a short rationale. Submit as a PDF.",
      marksAvailable: 20,
      opensOffset: -7,
      dueOffset: 7,
      // Open now, due next week. The ordinary case.
      latePolicy: "PER_DAY_PERCENT" as const,
      latePenaltyValue: 10,
      latePenaltyFloor: 40,
      allowedFileTypes: ["pdf", "png", "jpg"],
      resubmissionPolicy: "UNLIMITED_UNTIL_DUE" as const,
    },
    {
      title: "Typography exercise",
      instructions:
        "Set the same paragraph in three typefaces and explain which you would use for a poster and why.",
      marksAvailable: 15,
      opensOffset: -14,
      dueOffset: -2,
      // Already overdue, and still accepting work: this is what makes the late
      // penalty and the isLate flag reachable without waiting a week.
      latePolicy: "FIXED_DEDUCTION" as const,
      latePenaltyValue: 3,
      latePenaltyFloor: null,
      allowedFileTypes: ["pdf", "docx"],
      resubmissionPolicy: "NONE" as const,
    },
  ];

  let assignmentCount = 0;
  for (const a of assignmentPlan) {
    const existing = await db.assignment.findFirst({
      where: { sectionSubjectId: gdFemaleGd.id, title: a.title },
    });
    if (existing) continue;

    await db.assignment.create({
      data: {
        sectionSubjectId: gdFemaleGd.id,
        title: a.title,
        instructions: a.instructions,
        marksAvailable: a.marksAvailable,
        opensAt: at(a.opensOffset, 9),
        dueAt: at(a.dueOffset, 23),
        // FR-ASG-002 — a week past the due date, so lateness is penalised but
        // not impossible. An assignment with no hard close can never be marked.
        hardCloseAt: at(a.dueOffset + 7, 23),
        latePolicy: a.latePolicy,
        latePenaltyValue: a.latePenaltyValue,
        latePenaltyFloor: a.latePenaltyFloor,
        submissionType: "BOTH",
        allowedFileTypes: a.allowedFileTypes,
        maxFileSizeMb: 10,
        maxFileCount: 3,
        resubmissionPolicy: a.resubmissionPolicy,
        publicationStatus: "PUBLISHED",
        createdBy: teacherUser.id,
      },
    });
    assignmentCount += 1;
  }
  console.log(`  assignments: ${assignmentCount} (1 open, 1 overdue but still accepting)`);

  // -- a quiz (§5.10) -------------------------------------------------------
  // Mixed question types on purpose. Auto-marked types and an ESSAY behave
  // differently at submission — one scores immediately, the other leaves the
  // attempt awaiting a human — and a quiz with only MCQs never exercises that.
  const existingQuiz = await db.quiz.findFirst({
    where: { sectionSubjectId: gdFemaleGd.id, title: "Colour and typography basics" },
  });

  if (!existingQuiz) {
    const bank = await db.questionBank.upsert({
      where: { id: "00000000-0000-4000-8000-000000000001" },
      update: {},
      create: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Graphic Designing — core",
        subjectId: gd!.id,
      },
    });

    const questionPlan = [
      {
        stem: "Which colour model is used for print?",
        questionType: "MCQ_SINGLE" as const,
        marks: 2,
        options: [
          { text: "CMYK", correct: true },
          { text: "RGB", correct: false },
          { text: "HSL", correct: false },
        ],
      },
      {
        stem: "A typeface with small strokes at the ends of letters is called a serif.",
        questionType: "TRUE_FALSE" as const,
        marks: 1,
        options: [
          { text: "True", correct: true },
          { text: "False", correct: false },
        ],
      },
      {
        stem: "Which of these improve readability in body text? Select all that apply.",
        questionType: "MCQ_MULTI" as const,
        marks: 3,
        options: [
          { text: "Generous line height", correct: true },
          { text: "Adequate contrast", correct: true },
          { text: "Setting everything in capitals", correct: false },
          { text: "Very long line lengths", correct: false },
        ],
      },
      {
        // Cannot be auto-marked, so the attempt lands AWAITING_MARKING and the
        // teacher's marking path becomes reachable (FR-QIZ-031).
        stem: "In two or three sentences, explain why you would choose a serif over a sans-serif for a printed book.",
        questionType: "ESSAY" as const,
        marks: 4,
        options: [],
      },
    ];

    const quiz = await db.quiz.create({
      data: {
        sectionSubjectId: gdFemaleGd.id,
        title: "Colour and typography basics",
        instructions: "Ten minutes. You may attempt this twice; the higher score counts.",
        totalMarks: questionPlan.reduce((sum, q) => sum + q.marks, 0),
        opensAt: at(-2, 9),
        closesAt: at(10, 23),
        timeLimitMinutes: 10,
        maxAttempts: 2,
        attemptScoring: "HIGHEST",
        shuffleQuestions: true,
        shuffleOptions: true,
        passingMarks: 5,
        presentation: "ALL_ON_PAGE",
        allowBackwardNavigation: true,
        publicationStatus: "PUBLISHED",
        createdBy: teacherUser.id,
      },
    });

    for (const [index, q] of questionPlan.entries()) {
      const question = await db.question.create({
        data: {
          questionBankId: bank.id,
          subjectId: gd!.id,
          stem: q.stem,
          questionType: q.questionType,
          defaultMarks: q.marks,
          options: {
            create: q.options.map((o, i) => ({
              optionText: o.text,
              isCorrect: o.correct,
              displayOrder: i + 1,
            })),
          },
        },
      });

      await db.quizQuestion.create({
        data: { quizId: quiz.id, questionId: question.id, marks: q.marks, displayOrder: index + 1 },
      });
    }
    console.log(`  quiz: 1 published, ${questionPlan.length} questions (1 essay, marked by hand)`);
  } else {
    console.log("  quiz: already present");
  }

  // -- attendance for the sessions that have already happened ---------------
  // Every ENDED session needs a marked register, or the attendance component
  // of progress has an empty denominator and every student silently reports
  // null. The pattern below is deterministic and deliberately uneven:
  //
  //   - roll 3 misses two of three classes, landing at 33 % — below the
  //     CRITICAL threshold, so the teacher's at-risk list (FR-ATT-020) has a
  //     genuine entry rather than being permanently empty
  //   - roll 5 is LATE once, exercising the late weighting (CFG-ATT-03)
  //   - roll 7 is EXCUSED once, which must leave the denominator entirely
  //     rather than counting as an absence (BR-ATT-06)
  const endedSessions = await db.liveSession.findMany({
    where: { sectionSubjectId: gdFemaleGd.id, status: "ENDED" },
    orderBy: { scheduledStart: "asc" },
  });
  const roster = await db.student.findMany({
    where: { enrolments: { some: { sectionSubjectId: gdFemaleGd.id } } },
    orderBy: { currentRollNo: "asc" },
  });

  // A register against a class that has not happened is meaningless, and a
  // developer poking at the API leaves exactly that behind. Clearing it keeps
  // the seeded figures reproducible — otherwise yesterday's experiment quietly
  // changes today's progress numbers and nothing explains why.
  const strays = await db.attendanceRecord.deleteMany({
    where: { liveSession: { status: { in: ["SCHEDULED", "CANCELLED"] } } },
  });
  if (strays.count > 0) {
    console.log(`  cleared ${strays.count} attendance marks on unheld sessions`);
  }

  const statusFor = (roll: number, sessionIndex: number) => {
    if (roll === 3) return sessionIndex === 1 ? "PRESENT" : "ABSENT";
    if (roll === 5 && sessionIndex === 1) return "LATE";
    if (roll === 7 && sessionIndex === 2) return "EXCUSED";
    return "PRESENT";
  };

  let marks = 0;
  for (const [sessionIndex, ls] of endedSessions.entries()) {
    for (const s of roster) {
      const existing = await db.attendanceRecord.findUnique({
        where: { liveSessionId_studentId: { liveSessionId: ls.id, studentId: s.id } },
      });
      const status = statusFor(s.currentRollNo ?? 0, sessionIndex) as
        | "PRESENT"
        | "ABSENT"
        | "LATE"
        | "EXCUSED";

      if (existing) {
        // Re-running the seed must converge on the seeded pattern. Without
        // this, a register marked by hand during testing keeps skewing every
        // progress figure afterwards, and nothing in the output says why.
        if (existing.status !== status) {
          await db.attendanceRecord.update({ where: { id: existing.id }, data: { status } });
          marks += 1;
        }
        continue;
      }

      await db.attendanceRecord.create({
        data: {
          liveSessionId: ls.id,
          studentId: s.id,
          status,
          markingSource: "MANUAL",
          markedBy: teacherUser.id,
          markedAt: new Date(ls.scheduledStart.getTime() + 10 * 60_000),
        },
      });
      marks += 1;
    }
  }
  console.log(`  attendance: ${marks} marks across ${endedSessions.length} ended sessions`);

  console.log("\nSeed complete.\n");
  console.log("  superadmin@institute.local  ChangeMe!SuperAdmin2026");
  console.log("  admin@institute.local       ChangeMe!Admin2026");
  console.log("  sana@institute.local        ChangeMe!Teacher2026   (GD + English, Female A)");
  console.log("  ayesha1@student.local       ChangeMe!Student2026   (and 7 more students)");
  console.log("  imran@institute.local       ChangeMe!Teacher2026   (GD Male B, DM Evening A)");
  console.log("\nThese are development credentials. SEC-CFG-002 forbids them in production.\n");

  void superAdmin;
}

async function upsertBatch(academicSessionId: string, name: string, pattern: string) {
  const existing = await db.batch.findFirst({ where: { academicSessionId, name } });
  if (existing) return existing;
  return db.batch.create({ data: { academicSessionId, name, deliveryPattern: pattern } });
}

async function upsertSection(input: {
  batchId: string;
  code: string;
  name: string;
  capacity: number;
  genderRestriction: "MALE" | "FEMALE" | "MIXED";
  shift: "MORNING" | "AFTERNOON" | "EVENING" | "WEEKEND";
  enrolledCount?: number;
}) {
  return db.section.upsert({
    where: { code: input.code },
    update: {},
    create: {
      batchId: input.batchId,
      code: input.code,
      name: input.name,
      capacity: input.capacity,
      enrolledCount: input.enrolledCount ?? 0,
      genderRestriction: input.genderRestriction,
      shift: input.shift,
      deliveryMode: "ONLINE",
      status: "ACTIVE",
      whatsappChannelUrl: `https://whatsapp.com/channel/example-${input.code.toLowerCase()}`,
      whatsappGroupUrl: `https://chat.whatsapp.com/example-${input.code.toLowerCase()}`,
    },
  });
}

async function offer(sectionId: string, subjectId: string, isCompulsory: boolean) {
  return db.sectionSubject.upsert({
    where: { sectionId_subjectId: { sectionId, subjectId } },
    update: {},
    create: { sectionId, subjectId, isCompulsory, status: "ACTIVE" },
  });
}

async function upsertModule(
  subjectId: string,
  title: string,
  displayOrder: number,
  publicationStatus: "DRAFT" | "PUBLISHED",
) {
  const existing = await db.module.findFirst({ where: { subjectId, title } });
  if (existing) return existing;
  return db.module.create({ data: { subjectId, title, displayOrder, publicationStatus } });
}

async function upsertLesson(input: {
  moduleId: string;
  title: string;
  displayOrder: number;
  estimatedMinutes: number;
  publicationStatus: "DRAFT" | "PUBLISHED";
}) {
  const existing = await db.lesson.findFirst({
    where: { moduleId: input.moduleId, title: input.title },
  });
  if (existing) return existing;
  return db.lesson.create({ data: input });
}

/**
 * Returns true if it created one, so the caller can count honestly on a re-run.
 *
 * TST-004: storageRef is synthetic. It is shaped like a Drive file id so the
 * column's length and opacity are exercised, but it resolves to nothing — the
 * availability sweep (ARC-045) will correctly mark these MISSING, which is the
 * accurate answer for a fixture.
 */
async function upsertLecture(input: {
  lessonId: string;
  sectionSubjectId: string;
  title: string;
  durationSeconds: number;
  teacherId: string;
  publicationStatus: "DRAFT" | "PUBLISHED";
  recordedOn: Date;
}): Promise<boolean> {
  const existing = await db.recordedLecture.findFirst({
    where: { lessonId: input.lessonId, title: input.title },
  });
  if (existing) return false;

  const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  await db.recordedLecture.create({
    data: {
      lessonId: input.lessonId,
      sectionSubjectId: input.sectionSubjectId,
      title: input.title,
      durationSeconds: input.durationSeconds,
      teacherId: input.teacherId,
      publicationStatus: input.publicationStatus,
      recordedOn: input.recordedOn,
      storageProvider: "google_drive",
      storageRef: `seed-fixture-${slug}`,
    },
  });
  return true;
}

async function assign(teacherId: string, sectionSubjectId: string) {
  const startDate = new Date("2026-02-01");
  const existing = await db.teacherAssignment.findFirst({
    where: { teacherId, sectionSubjectId },
  });
  if (existing) return existing;
  return db.teacherAssignment.create({
    data: { teacherId, sectionSubjectId, assignmentRole: "PRIMARY", startDate },
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
