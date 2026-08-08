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

  console.log("\nSeed complete.\n");
  console.log("  superadmin@institute.local  ChangeMe!SuperAdmin2026");
  console.log("  admin@institute.local       ChangeMe!Admin2026");
  console.log("  sana@institute.local        ChangeMe!Teacher2026   (GD + English, Female A)");
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
