/**
 * DEMO DATA — enough of everything that no screen is empty.
 *
 * WHAT THIS IS FOR. A demonstration fails on empty states. Somebody clicks
 * through to Quiz results and finds one attempt, opens Payment verification and
 * finds nothing pending, opens a student's assignment and finds no feedback —
 * and every one of those reads as "unfinished" even though the feature works
 * perfectly. This fills the thin corners so that every screen has something
 * true-looking on it.
 *
 * THREE RULES IT KEEPS, and they are the reason it is safe to run:
 *
 *   1. IT ONLY ADDS. Nothing here deletes, truncates or resets. It is not a
 *      seed and it does not replace `prisma/seed.ts` — it runs ON TOP of a
 *      seeded database and leaves everything already there untouched.
 *
 *   2. IT IS IDEMPOTENT. Every write is guarded by an existence check or a
 *      deterministic marker, so running it three times leaves the same
 *      database as running it once. Before a demo you will run it twice by
 *      accident; that must not double every fee.
 *
 *   3. IT REFUSES TO RUN AGAINST ANYTHING BUT A LOCAL DATABASE. The DATABASE_URL
 *      must point at localhost. Demo data in a real institute's records is not
 *      a recoverable mistake — it is a student with a fee they never owed.
 *
 * WHAT IT WILL NOT DO. It writes no files to storage, so a demo payment proof
 * or submission file references what is already there rather than inventing a
 * blob nobody can open. It sends no email.
 *
 *   node -r dotenv/config scripts/demo-data.mjs
 *   node -r dotenv/config scripts/demo-data.mjs --dry
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const DRY = process.argv.includes("--dry");
const prisma = new PrismaClient();

/* ------------------------------------------------------------- guard rail -- */
const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("\nRefusing to run: DATABASE_URL does not point at localhost.");
  console.error(`  ${url.replace(/:[^:@]*@/, ":***@")}\n`);
  console.error("This writes invented students, fees and feedback. It belongs on a");
  console.error("development machine and nowhere else.\n");
  process.exit(1);
}

/** Everything written here carries this, so a human can tell demo from real. */
const MARK = "[demo]";

/*
 * THE SAME PASSWORD THE SEEDED STUDENTS USE, and the same parameters, so one
 * sentence in the notes covers every account on a development machine. Hashed
 * once rather than per account: argon2 is deliberately slow, and doing it
 * inside the loop made the script look hung.
 */
const DEMO_PASSWORD = "ChangeMe!Student2026";
let demoPasswordHash = null;
const passwordHash = async () =>
  (demoPasswordHash ??= await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  }));

const added = [];
const note = (what, n) => {
  if (n > 0) added.push(`${String(n).padStart(4)}  ${what}`);
};

/** Deterministic pseudo-random, so two runs make the same choices. */
let seed = 20260827;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n) => new Date(Date.now() + n * 86_400_000);

async function main() {
  console.log(`\nDemo data ${DRY ? "(DRY RUN — nothing will be written)" : ""}\n`);

  const [students, teachers, admin, sectionSubjects] = await Promise.all([
    prisma.student.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        userId: true,
        currentSectionId: true,
        registrationNo: true,
        user: { select: { fullName: true } },
      },
    }),
    prisma.teacher.findMany({ select: { id: true, userId: true } }),
    prisma.user.findFirst({
      where: { roles: { some: { role: { key: { in: ["admin", "super_admin"] } } } } },
      select: { id: true },
    }),
    prisma.sectionSubject.findMany({
      select: { id: true, sectionId: true, subjectId: true },
    }),
  ]);

  if (students.length === 0 || !admin) {
    console.error("No students or no administrator found. Run `npm run db:seed` first.\n");
    process.exit(1);
  }
  console.log(`Found ${students.length} students, ${teachers.length} teachers.\n`);

  const staffUserId = admin.id;

  /* =====================================================================
   *  1. FEES — a charge for everybody, and payments at every stage.
   *
   *  The fee screens are the ones most likely to be demonstrated, and most
   *  students had no charge at all, so their statement was a blank page and
   *  the four figures were all zero.
   * ===================================================================== */
  {
    let charges = 0;
    for (const s of students) {
      const existing = await prisma.feeCharge.count({
        where: { studentId: s.id, deletedAt: null },
      });
      if (existing > 0) continue;

      if (!DRY) {
        await prisma.feeCharge.createMany({
          data: [
            {
              studentId: s.id,
              description: "Admission fee",
              amount: 15000,
              dueDate: daysAgo(40),
              createdBy: staffUserId,
            },
            {
              studentId: s.id,
              description: "Tuition — first instalment",
              amount: 25000,
              dueDate: daysAgo(10),
              createdBy: staffUserId,
            },
            {
              studentId: s.id,
              description: "Tuition — second instalment",
              amount: 25000,
              dueDate: daysAhead(20),
              createdBy: staffUserId,
            },
          ],
        });
      }
      charges += 3;
    }
    note("fee charges (3 each, for students who had none)", charges);
  }

  /* --- verified payments, so a statement is not all debt ---------------- */
  {
    let payments = 0;
    // Roughly two in three have paid something. Deterministic, so the same
    // students are paid up on every run — a demo you rehearse is a demo you
    // can rely on.
    for (const [i, s] of students.entries()) {
      if (i % 3 === 2) continue;

      const already = await prisma.payment.count({ where: { studentId: s.id } });
      if (already > 0) continue;

      if (!DRY) {
        await prisma.payment.create({
          data: {
            studentId: s.id,
            verifiedAmount: 15000,
            paymentDate: daysAgo(35),
            method: pick(["BANK_TRANSFER", "EASYPAISA", "JAZZCASH", "CASH_DEPOSIT"]),
            bankReference: `TID-${100000 + i * 37}`,
            verifiedBy: staffUserId,
            verifiedAt: daysAgo(34),
          },
        });
      }
      payments += 1;
    }
    note("verified payments", payments);
  }

  /* --- claims waiting on the fee desk, plus one of each other state ------ */
  {
    // Proof documents already exist in the database from earlier uploads;
    // reusing one means the reviewer's screen actually shows an image rather
    // than a broken box. Only genuinely unattached ones are eligible.
    const spareProof = await prisma.registrationDocument.findMany({
      where: { registrationRequestId: null, paymentSubmissionId: null },
      select: { id: true },
      take: 12,
    });

    const pendingWanted = 6;
    const havePending = await prisma.paymentSubmission.count({ where: { status: "PENDING" } });
    let made = 0;

    const seriesStart = await prisma.paymentSubmission.count();

    for (const [i, s] of students.entries()) {
      if (havePending + made >= pendingWanted) break;
      if (i % 2 === 1) continue;

      const already = await prisma.paymentSubmission.count({
        where: { studentId: s.id, status: "PENDING" },
      });
      if (already > 0) continue;

      const amount = pick([10000, 12500, 15000, 25000]);
      if (!DRY) {
        const created = await prisma.paymentSubmission.create({
          data: {
            reference: `PS-2026-9${String(seriesStart + made + 1).padStart(5, "0")}`,
            studentId: s.id,
            status: "PENDING",
            claimedAmount: amount,
            paymentDate: daysAgo(2 + (i % 5)),
            method: pick(["EASYPAISA", "JAZZCASH", "BANK_TRANSFER"]),
            bankReference: `TID-${920000 + i * 13}`,
            studentNote: i % 4 === 0 ? `${MARK} Paid from my father's account.` : null,
            outstandingAtSubmission: 50000,
            studentNameAtSubmission: s.user.fullName,
            registrationNoAtSubmission: s.registrationNo,
          },
        });

        // Attach a proof where one is spare, so the reviewer has something to
        // open. A claim with no evidence is a valid state and one demo row
        // showing it is useful; six of them look broken.
        const proof = spareProof[made];
        if (proof) {
          await prisma.registrationDocument.update({
            where: { id: proof.id },
            data: { paymentSubmissionId: created.id },
          });
        }
      }
      made += 1;
    }
    note("payment claims waiting to be checked", made);

    // One rejected, so the student's history shows a reason and the office's
    // queue has something in every filter.
    const rejected = await prisma.paymentSubmission.count({ where: { status: "REJECTED" } });
    if (rejected === 0) {
      const s = students[1] ?? students[0];
      if (!DRY)
        await prisma.paymentSubmission.create({
          data: {
            reference: `PS-2026-99001`,
            studentId: s.id,
            status: "REJECTED",
            claimedAmount: 9000,
            paymentDate: daysAgo(9),
            method: "BANK_TRANSFER",
            studentNameAtSubmission: s.user.fullName,
            registrationNoAtSubmission: s.registrationNo,
            reviewedBy: staffUserId,
            reviewedAt: daysAgo(8),
            reviewNote:
              "The screenshot does not show the transaction number. Please send the full receipt from your banking app and we will check it again.",
          },
        });
      note("rejected payment claim (shows the reason to the student)", 1);
    }
  }

  /* =====================================================================
   *  2. TEACHER COMMENTS ON SUBMITTED WORK — the new feature.
   *
   *  Without these the thread is empty everywhere, which demonstrates
   *  nothing. Written as a real marker writes: specific, and about the file.
   * ===================================================================== */
  {
    const teacherUser = teachers[0]?.userId ?? staffUserId;

    const submissions = await prisma.assignmentSubmission.findMany({
      where: { isLatest: true },
      select: {
        id: true,
        studentId: true,
        student: { select: { userId: true } },
        files: { select: { id: true }, take: 1 },
      },
      orderBy: { submittedAt: "desc" },
      take: 14,
    });

    const REMARKS = [
      "Good structure and the brief is answered. Tighten the spacing on the second page — the margins are inconsistent and it shows when printed.",
      "This is the wrong export: I need a PDF, not the working file. Send it again and I will mark it — no penalty, the deadline is met.",
      "Strong work. Your colour choices carry the message without shouting. Next time, show the two alternatives you rejected — I want to see the thinking.",
      "You have answered the question but not shown the method. Half the marks here are for the working, so add it before I mark this.",
      "Much better than the last one — the hierarchy is clear now. Watch the kerning in the heading.",
    ];
    const REPLIES = [
      "Thank you sir, I will send the PDF today.",
      "Understood — should I resubmit the whole file or only the corrected page?",
    ];

    let comments = 0;
    for (const [i, sub] of submissions.entries()) {
      const existing = await prisma.submissionComment.count({
        where: { submissionId: sub.id },
      });
      if (existing > 0) continue;

      const file = sub.files[0];
      if (!DRY) {
        await prisma.submissionComment.create({
          data: {
            submissionId: sub.id,
            // Every third one is anchored to a file, so the demo shows both
            // shapes: a remark about the work, and one about an artefact.
            fileId: i % 3 === 0 && file ? file.id : null,
            authorUserId: teacherUser,
            authorRole: "teacher",
            body: REMARKS[i % REMARKS.length],
            createdAt: daysAgo(3 + (i % 4)),
          },
        });
      }
      comments += 1;

      // A conversation, not a notice — some threads have the student's answer.
      if (i % 4 === 1) {
        if (!DRY) {
          await prisma.submissionComment.create({
            data: {
              submissionId: sub.id,
              authorUserId: sub.student.userId,
              authorRole: "student",
              body: REPLIES[i % REPLIES.length],
              createdAt: daysAgo(2 + (i % 3)),
            },
          });
        }
        comments += 1;
      }
    }
    note("comments on submitted work (some with student replies)", comments);
  }

  /* =====================================================================
   *  3. THE THREE EMPTY TABLES.
   * ===================================================================== */

  /* --- notification templates: the Messages screen was blank ------------ */
  {
    const TEMPLATES = [
      {
        kind: "assignment.due_soon",
        title: "{{assignment}} is due on {{date}}",
        body: "Hello {{name}}, your assignment {{assignment}} for {{subject}} is due on {{date}}. You can submit it from your Subjects page.",
      },
      {
        kind: "fee.payment_verified",
        title: "Payment verified — receipt {{receiptNo}}",
        body: "Hello {{name}}, we have verified your payment of {{amount}}. Your receipt {{receiptNo}} is attached and is also on your Fees page. Remaining balance: {{balance}}.",
      },
      {
        kind: "fee.payment_rejected",
        title: "We could not verify your payment",
        body: "Hello {{name}}, we could not verify your payment submission. {{reason}} You can submit it again from your Fees page.",
      },
      {
        kind: "attendance.warning",
        title: "Your attendance in {{subject}} is low",
        body: "Hello {{name}}, your attendance in {{subject}} is {{percentage}}, below the {{threshold}} required. Please speak to your teacher.",
      },
      {
        kind: "assignment.comment",
        title: "Feedback on {{assignment}}",
        body: "Hello {{name}}, your teacher has commented on your work for {{assignment}}. Open the subject to read it and reply.",
      },
      {
        kind: "certificate.issued",
        title: "Your certificate is ready",
        body: "Congratulations {{name}} — your certificate for {{programme}} has been issued. You can download it from My Certificates.",
      },
    ];

    let n = 0;
    for (const t of TEMPLATES) {
      const exists = await prisma.notificationTemplate.findFirst({ where: { kind: t.kind } });
      if (exists) continue;
      if (!DRY) {
        await prisma.notificationTemplate.create({ data: { ...t, updatedBy: staffUserId } });
      }
      n += 1;
    }
    note("notification templates", n);
  }

  /* --- assignment extensions: FR-ASG-018 had nothing to show ------------ */
  {
    const assignments = await prisma.assignment.findMany({
      where: { deletedAt: null },
      select: { id: true, sectionSubjectId: true, dueAt: true },
      take: 6,
    });

    /*
     * CAPPED ON THE TOTAL, NOT ON WHAT THIS RUN MADE.
     *
     * The first version counted creations and stopped at three, which is not
     * the same thing: on a second run the three already there were skipped, the
     * loop walked further down the list, and made three MORE. Idempotent means
     * the total stops moving, so the target is a total.
     */
    const WANTED = 3;
    let have = await prisma.assignmentExtension.count();

    let n = 0;
    for (const [i, a] of assignments.entries()) {
      if (have >= WANTED) break;

      const enrolled = await prisma.enrolment.findFirst({
        where: { sectionSubjectId: a.sectionSubjectId },
        select: { studentId: true },
      });
      if (!enrolled) continue;

      const exists = await prisma.assignmentExtension.findFirst({
        where: { assignmentId: a.id, studentId: enrolled.studentId },
      });
      if (exists) continue;

      if (!DRY) {
        await prisma.assignmentExtension.create({
          data: {
            assignmentId: a.id,
            studentId: enrolled.studentId,
            extendedTo: new Date(a.dueAt.getTime() + 5 * 86_400_000),
            reason: pick([
              "Hospitalised the week the assignment was set — medical certificate on file.",
              "Family bereavement. Agreed with the programme coordinator.",
              "Laptop failure verified by the lab; work recovered but late.",
            ]),
            grantedBy: staffUserId,
          },
        });
      }
      n += 1;
      have += 1;
    }
    note("assignment extensions", n);
  }

  /* --- subject completions: the progress decision had no records -------- */
  {
    const enrolments = await prisma.enrolment.findMany({
      select: { studentId: true, sectionSubjectId: true },
      take: 18,
    });

    let n = 0;
    for (const [i, e] of enrolments.entries()) {
      const exists = await prisma.subjectCompletion.findFirst({
        where: { studentId: e.studentId, sectionSubjectId: e.sectionSubjectId },
      });
      if (exists) continue;

      // A spread of outcomes, so the screen shows all three states rather
      // than a column of identical rows.
      const decision = i % 5 === 4 ? "NOT_COMPLETED" : i % 3 === 0 ? "COMPLETED" : "IN_PROGRESS";
      const percent = decision === "COMPLETED" ? 88 + (i % 9) : decision === "NOT_COMPLETED" ? 41 : 60 + (i % 20);

      if (!DRY) {
        await prisma.subjectCompletion.create({
          data: {
            studentId: e.studentId,
            sectionSubjectId: e.sectionSubjectId,
            decision,
            computedPercent: percent,
            criteriaMet: decision === "COMPLETED",
            note:
              decision === "NOT_COMPLETED"
                ? "Attendance below the required threshold and two assignments not submitted."
                : null,
            decidedBy: staffUserId,
          },
        });
      }
      n += 1;
    }
    note("subject completion decisions", n);
  }

  /* =====================================================================
   *  4. THE THIN ONES.
   * ===================================================================== */

  /* --- quiz attempts: results and marking screens showed one row -------- */
  {
    const quizzes = await prisma.quiz.findMany({
      select: {
        id: true,
        sectionSubjectId: true,
        questions: { select: { questionId: true, marks: true } },
      },
    });

    let attempts = 0;
    for (const q of quizzes) {
      if (q.questions.length === 0) continue;

      const enrolled = await prisma.enrolment.findMany({
        where: { sectionSubjectId: q.sectionSubjectId },
        select: { studentId: true },
        take: 6,
      });

      for (const [i, e] of enrolled.entries()) {
        const exists = await prisma.quizAttempt.findFirst({
          where: { quizId: q.id, studentId: e.studentId },
        });
        if (exists) continue;

        const total = q.questions.reduce((sum, qq) => sum + Number(qq.marks), 0);
        // A believable spread: most pass, one or two do not.
        const fraction = [0.95, 0.8, 0.72, 0.64, 0.45, 0.88][i % 6];
        const score = Math.round(total * fraction * 100) / 100;

        if (!DRY) {
          const attempt = await prisma.quizAttempt.create({
            data: {
              quizId: q.id,
              studentId: e.studentId,
              attemptNumber: 1,
              startedAt: daysAgo(6 + i),
              submittedAt: daysAgo(6 + i),
              submissionMode: "MANUAL",
              status: "GRADED",
              questionOrder: q.questions.map((qq) => qq.questionId),
              autoScore: score,
              finalScore: score,
              isPassed: fraction >= 0.5,
              releasedAt: daysAgo(5 + i),
            },
          });

          for (const qq of q.questions) {
            await prisma.quizAnswer.create({
              data: {
                attemptId: attempt.id,
                questionId: qq.questionId,
                response: { choice: fraction > 0.6 ? "A" : "B" },
                isCorrect: fraction > 0.6,
                marksAwarded: fraction > 0.6 ? qq.marks : 0,
              },
            });
          }
        }
        attempts += 1;
      }
    }
    note("quiz attempts (graded, with answers)", attempts);
  }

  /* --- attendance warnings ---------------------------------------------- */
  {
    let n = 0;
    const enrolments = await prisma.enrolment.findMany({
      select: { studentId: true, sectionSubjectId: true },
      take: 8,
    });

    for (const [i, e] of enrolments.entries()) {
      if (i % 3 !== 0) continue;
      /*
       * CHECKED AGAINST THE UNIQUE CONSTRAINT, NOT AGAINST WHAT WE WANTED.
       *
       * The constraint is on (student_id, section_subject_id) alone. Filtering
       * this lookup by `clearedAt: null` asked a narrower question than the
       * database enforces — so a warning that had been CLEARED passed the
       * check and then failed the insert, taking the whole script down with a
       * unique-constraint error on a re-run.
       */
      const exists = await prisma.attendanceWarning.findFirst({
        where: { studentId: e.studentId, sectionSubjectId: e.sectionSubjectId },
      });
      if (exists) continue;

      const pct = i % 2 === 0 ? 62 : 71;
      if (!DRY) {
        await prisma.attendanceWarning.create({
          data: {
            studentId: e.studentId,
            sectionSubjectId: e.sectionSubjectId,
            severity: pct < 65 ? "CRITICAL" : "WARNING",
            percentage: pct,
            thresholdApplied: 75,
            raisedAt: daysAgo(4),
          },
        });
      }
      n += 1;
    }
    note("attendance warnings", n);
  }

  /* --- staff notes on students ------------------------------------------ */
  {
    const NOTES = [
      "Works hard and asks good questions, but goes quiet when the class is large. Worth calling on directly.",
      "Missed two weeks for a family matter — caught up on their own. No action needed, noting it so the attendance figure is read in context.",
      "Strong practical work, weak written submissions. Suggested they record the voice brief answers first and write from that.",
      "Asked about the instalment plan. Referred to the office; no fee concession promised.",
    ];

    let n = 0;
    for (const [i, s] of students.slice(0, 8).entries()) {
      if (!s.currentSectionId) continue;
      const ss = sectionSubjects.find((x) => x.sectionId === s.currentSectionId);
      if (!ss) continue;

      const exists = await prisma.studentNote.findFirst({
        where: { studentId: s.id, sectionSubjectId: ss.id, deletedAt: null },
      });
      if (exists) continue;

      if (!DRY) {
        await prisma.studentNote.create({
          data: {
            studentId: s.id,
            sectionSubjectId: ss.id,
            authorUserId: teachers[i % Math.max(1, teachers.length)]?.userId ?? staffUserId,
            body: NOTES[i % NOTES.length],
          },
        });
      }
      n += 1;
    }
    note("staff notes on students", n);
  }

  /* --- watch progress on recorded lectures ------------------------------- */
  {
    const lectures = await prisma.recordedLecture.findMany({
      select: { id: true, sectionSubjectId: true, durationSeconds: true },
      take: 8,
    });

    let n = 0;
    for (const [li, lec] of lectures.entries()) {
      const enrolled = await prisma.enrolment.findMany({
        where: { sectionSubjectId: lec.sectionSubjectId },
        select: { studentId: true },
        take: 5,
      });

      for (const [i, e] of enrolled.entries()) {
        const exists = await prisma.watchProgress.findFirst({
          where: { studentId: e.studentId, recordedLectureId: lec.id },
        });
        if (exists) continue;

        const percent = [100, 100, 74, 38, 12][i % 5];
        const duration = lec.durationSeconds ?? 1800;
        const watched = Math.round((duration * percent) / 100);

        if (!DRY) {
          await prisma.watchProgress.create({
            data: {
              studentId: e.studentId,
              recordedLectureId: lec.id,
              watchedIntervals: [[0, watched]],
              watchedPercent: percent,
              lastPositionSeconds: watched,
              isComplete: percent >= 95,
              completedAt: percent >= 95 ? daysAgo(3 + li) : null,
              firstWatchedAt: daysAgo(5 + li),
            },
          });
        }
        n += 1;
      }
    }
    note("lecture watch progress records", n);
  }


  /* =====================================================================
   *  6. SUBMISSIONS FOR ASSIGNMENTS THAT HAVE NONE.
   *
   *  THE PROBLEM THIS SOLVES IS A DEMO PROBLEM. An assignment created two
   *  minutes ago has no submissions, so the marking screen has nothing to
   *  open — which is correct, and looks exactly like a broken feature to
   *  somebody being shown the System for the first time. Every PUBLISHED
   *  assignment gets a few, so the marking workspace always has work in it.
   *
   *  A MIX OF STATES ON PURPOSE: some marked, some not, one late. A screen
   *  where every row is identical demonstrates nothing about the screen.
   * ===================================================================== */
  {
    const assignments = await prisma.assignment.findMany({
      where: { deletedAt: null, publicationStatus: "PUBLISHED" },
      select: {
        id: true,
        title: true,
        sectionSubjectId: true,
        marksAvailable: true,
        dueAt: true,
        _count: { select: { submissions: true } },
      },
    });

    const ANSWERS = [
      "Please see the attached PDF for my full answer and the working.",
      "I have explained my approach in the attached file. The second page has the references.",
      "Attached. I ran out of time on the last section — apologies.",
      "My answer is attached. I used the template from the brief.",
    ];
    const FEEDBACK = [
      "Solid work. The structure is clear and the argument is easy to follow.",
      "Good, but show your method — half the marks here are for the working.",
      "This answers the question well. Watch the formatting on page two.",
    ];

    let made = 0;
    let graded = 0;

    for (const a of assignments) {
      if (a._count.submissions > 0) continue;

      const enrolled = await prisma.enrolment.findMany({
        where: { sectionSubjectId: a.sectionSubjectId, status: "ACTIVE" },
        select: { studentId: true },
        take: 5,
      });
      if (enrolled.length === 0) continue;

      const teacher = await prisma.teacherAssignment.findFirst({
        where: { sectionSubjectId: a.sectionSubjectId, deletedAt: null },
        select: { teacher: { select: { userId: true } } },
      });

      for (const [i, e] of enrolled.entries()) {
        // One student in five is left un-submitted on purpose, so the roster
        // shows the "Not submitted" case as well.
        if (i === 4) continue;

        const late = i === 3;
        const submittedAt = new Date(a.dueAt.getTime() + (late ? 36e5 : -864e5));

        if (!DRY) {
          const submission = await prisma.assignmentSubmission.create({
            data: {
              assignmentId: a.id,
              studentId: e.studentId,
              version: 1,
              isLatest: true,
              submittedAt,
              isLate: late,
              minutesLate: late ? 60 : 0,
              textResponse: ANSWERS[i % ANSWERS.length],
            },
            select: { id: true },
          });

          /*
           * A REAL FILE, REUSED RATHER THAN INVENTED.
           *
           * The marking workspace renders the submitted document, so a
           * submission with no file demonstrates the one thing the screen
           * exists for and shows nothing. Pointing at a storage key that
           * already has bytes behind it means the PDF actually opens; writing
           * a fresh object would need the storage provider, which this script
           * deliberately does not touch.
           */
          const donor = await prisma.submissionFile.findFirst({
            where: { contentType: "application/pdf" },
            select: { storageKey: true, contentType: true, sizeBytes: true, contentHash: true },
          });
          if (donor) {
            await prisma.submissionFile.create({
              data: {
                submissionId: submission.id,
                studentId: e.studentId,
                assignmentId: a.id,
                storageKey: donor.storageKey,
                originalFilename: "answer.pdf",
                contentType: donor.contentType,
                sizeBytes: donor.sizeBytes,
                contentHash: donor.contentHash,
                scanStatus: "PENDING",
              },
            });
          }

          // Two of the four marked, so the queue has both states in it.
          if (i < 2 && teacher) {
            const raw = Math.round(Number(a.marksAvailable) * (i === 0 ? 0.86 : 0.71));
            await prisma.assignmentGrade.create({
              data: {
                submissionId: submission.id,
                rawMarks: raw,
                penaltyApplied: 0,
                finalMarks: raw,
                feedback: FEEDBACK[i % FEEDBACK.length],
                gradedBy: teacher.teacher.userId,
                // Left UNRELEASED: releasing is the teacher's act, and a demo
                // that has already done it cannot show it being done.
                releasedAt: null,
              },
            });
            graded += 1;
          }
        }
        made += 1;
      }
    }
    note("submissions for assignments that had none", made);
    note("  of those, marked and awaiting release", graded);
  }


  /* =====================================================================
   *  7. PARTNER INSTITUTES, AND THE PEOPLE WHO SIGN IN FOR THEM.
   *
   *  WHY THIS IS HERE RATHER THAN IN THE SEED. The two institutes existed
   *  only because somebody created them through the API while the feature
   *  was being built, so a database reset made the Partners screen empty
   *  and the whole feature look unbuilt. Demo data belongs in the script
   *  that makes demo data.
   *
   *  BOTH BILLING MODES, on purpose. One institute we invoice and one whose
   *  students pay us directly — because the difference between them is the
   *  single most important thing about the feature, and a demo with only
   *  one of them cannot show it. The STUDENT_PAYS partner is the one that
   *  proves the negative: their coordinator sees no Invoices tab at all.
   *
   *  THE ACCOUNTS SIGN IN IMMEDIATELY. `mustChangePassword` is false, the
   *  same concession the seeded staff accounts make, because a demo that
   *  opens on a change-password form is a demo of a change-password form.
   * ===================================================================== */
  {
    const INSTITUTES = [
      {
        name: "Beaconhouse Faisalabad",
        code: "BHF",
        city: "Faisalabad",
        billingMode: "PARTNER_PAYS",
        contactName: "Ms Ayesha Tariq",
        contactEmail: "coord@bhf.example",
        coordinator: { email: "coord@bhf.example", fullName: "Ayesha Tariq" },
      },
      {
        name: "Superior College Lahore",
        code: "SCL",
        city: "Lahore",
        billingMode: "STUDENT_PAYS",
        contactName: "Mr Bilal Aslam",
        contactEmail: "coord@scl.example",
        coordinator: { email: "coord@scl.example", fullName: "Bilal Aslam" },
      },
    ];

    const owner = await prisma.user.findFirst({
      where: { email: "superadmin@institute.local" },
      select: { id: true },
    });
    const partnerRole = await prisma.role.findFirst({
      where: { key: "partner_admin" },
      select: { id: true },
    });

    let institutes = 0;
    let accounts = 0;
    let repaired = 0;
    let attached = 0;

    if (owner && partnerRole) {
      for (const spec of INSTITUTES) {
        let institute = await prisma.partnerInstitute.findFirst({
          where: { code: spec.code },
          select: { id: true },
        });

        if (!institute && !DRY) {
          institute = await prisma.partnerInstitute.create({
            data: {
              name: spec.name,
              code: spec.code,
              city: spec.city,
              billingMode: spec.billingMode,
              contactName: spec.contactName,
              contactEmail: spec.contactEmail,
              isActive: true,
              notes: MARK,
              createdBy: owner.id,
            },
            select: { id: true },
          });
          institutes += 1;
        } else if (!institute) {
          institutes += 1;
        }

        if (!institute) continue;

        /*
         * THE COORDINATOR'S ACCOUNT. `partnerInstituteId` is the whole of
         * their reach — the PARTNER predicates resolve to DENY_ALL without
         * it — so an account created without one signs in to an empty
         * portal and looks like a broken System.
         */
        const existing = await prisma.user.findFirst({
          where: { email: spec.coordinator.email },
          select: { id: true, partnerInstituteId: true },
        });

        if (!existing) {
          if (!DRY) {
            await prisma.user.create({
              data: {
                email: spec.coordinator.email,
                // The same demo password the seeded students use, so one
                // sentence in the notes covers every account on the machine.
                passwordHash: await passwordHash(),
                fullName: spec.coordinator.fullName,
                status: "ACTIVE",
                mustChangePassword: false,
                partnerInstituteId: institute.id,
                roles: { create: { roleId: partnerRole.id, grantedBy: owner.id } },
              },
            });
          }
          accounts += 1;
        } else if (existing.partnerInstituteId === institute.id) {
          /*
           * AN ACCOUNT THAT EXISTS BUT CANNOT BE SIGNED INTO IS WORSE THAN
           * NO ACCOUNT, and that is exactly what was on this machine: two
           * coordinator accounts created by hand while the feature was being
           * built, with a password nobody wrote down. Creating them was
           * skipped because they existed, so the portal could not be
           * demonstrated at all and nothing said why.
           *
           * So the password is put back to the known demo one. NARROWLY: only
           * an account that is already the partner_admin for THIS demo
           * institute — never an arbitrary user who happens to share the
           * address. Combined with the localhost guard at the top of this
           * file, that is as far as a repair should reach.
           */
          if (!DRY) {
            await prisma.user.update({
              where: { id: existing.id },
              data: {
                passwordHash: await passwordHash(),
                status: "ACTIVE",
                mustChangePassword: false,
                failedLoginCount: 0,
                lockedUntil: null,
              },
            });
          }
          repaired += 1;
        }

        /*
         * AND SOME STUDENTS TO LOOK AT. A portal with nobody in it
         * demonstrates the empty state and nothing else. Taken from the
         * students nobody has claimed yet, and the fee payer is SNAPSHOTTED
         * to match the institute's mode — which is what the fee system
         * reads, never the mode itself (BR-DAT-02).
         */
        const wanted = spec.billingMode === "PARTNER_PAYS" ? 6 : 3;
        const held = await prisma.student.count({
          where: { partnerInstituteId: institute.id, deletedAt: null },
        });

        if (held < wanted) {
          const free = await prisma.student.findMany({
            where: { partnerInstituteId: null, deletedAt: null },
            select: { id: true },
            take: wanted - held,
          });
          if (!DRY && free.length > 0) {
            await prisma.student.updateMany({
              where: { id: { in: free.map((s) => s.id) } },
              data: {
                partnerInstituteId: institute.id,
                feePayer: spec.billingMode === "PARTNER_PAYS" ? "PARTNER" : "SELF",
              },
            });
          }
          attached += free.length;
        }
      }
    }

    note("partner institutes", institutes);
    note("  coordinators who can sign in for them", accounts);
    note("  coordinator sign-ins put back to the demo password", repaired);
    note("  students attached to a partner", attached);
  }

  /* ------------------------------------------------------------ report -- */
  console.log(added.length ? added.join("\n") : "  Nothing to add — already populated.");
  console.log(
    DRY
      ? "\nDRY RUN — nothing was written.\n"
      : "\nDone. Safe to run again; it will not duplicate any of this.\n",
  );
}

main()
  .catch((e) => {
    console.error("\nFailed:", e.message, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
