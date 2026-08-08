/**
 * The attendance denominator — SRS BR-ATT-06, BR-PRG-02.
 *
 * REGRESSION TEST for a bug found against real data: a student was marked
 * ABSENT from a class scheduled three days in the FUTURE, and it counted. Her
 * attendance read 25 % instead of 33 %, and because attendance feeds the
 * progress formula, a class nobody had taught yet was lowering her completion
 * standing.
 *
 * The defect was in the QUERY, not the arithmetic — percentageFor() selected
 * every attendance record for the student regardless of whether the session
 * had happened. No amount of testing the percentage maths would have found it,
 * which is why this test asserts the filter itself.
 */

import { ConfigService } from "@nestjs/config";
import { AttendanceService } from "./attendance.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";

describe("percentageFor counts only classes that have happened", () => {
  let capturedWhere: Record<string, any> | undefined;

  const makeService = (rows: Array<{ status: string }>) => {
    capturedWhere = undefined;
    const prisma = {
      scoped: {
        attendanceRecord: {
          findMany: jest.fn(async (args: { where: Record<string, any> }) => {
            capturedWhere = args.where;
            return rows;
          }),
        },
      },
    } as unknown as PrismaService;

    const config = {
      get: (_key: string, fallback: string) => fallback,
    } as unknown as ConfigService;

    return new AttendanceService(prisma, {} as AuditService, config);
  };

  it("restricts the query to ENDED sessions", async () => {
    const service = makeService([]);
    await service.percentageFor("student-1", "ss-1");

    // The invariant. A SCHEDULED session has no register worth counting, a
    // CANCELLED one was called off by the Institute, and a LIVE one is still
    // being taken.
    expect(capturedWhere?.["liveSession"]).toMatchObject({ status: "ENDED" });
  });

  it("still filters by subject when one is given", async () => {
    const service = makeService([]);
    await service.percentageFor("student-1", "ss-1");
    expect(capturedWhere?.["liveSession"]).toMatchObject({ sectionSubjectId: "ss-1" });
  });

  it("keeps the ENDED restriction when no subject is given", async () => {
    // The across-all-subjects path is the one used by the student's own
    // attendance summary, so it must not be the lenient one.
    const service = makeService([]);
    await service.percentageFor("student-1");
    expect(capturedWhere?.["liveSession"]).toEqual({ status: "ENDED" });
  });

  it("excludes EXCUSED from the denominator entirely (BR-ATT-06)", async () => {
    // Two attended, one excused. The excused class must vanish from both sides
    // of the fraction rather than count as an absence: 2/2, not 2/3.
    const service = makeService([
      { status: "PRESENT" },
      { status: "PRESENT" },
      { status: "EXCUSED" },
    ]);
    const result = await service.percentageFor("student-1", "ss-1");

    expect(result.sessionsInDenominator).toBe(2);
    expect(result.percentage).toBe(100);
  });

  it("reports null rather than zero when nothing has been marked", async () => {
    // Zero would read as "attended nothing" and drag progress down. A student
    // whose teacher has not yet taken a register has no attendance figure —
    // that is a different statement, and the formula treats it differently.
    const service = makeService([]);
    const result = await service.percentageFor("student-1", "ss-1");

    expect(result.percentage).toBeNull();
    expect(result.sessionsInDenominator).toBe(0);
  });

  it("counts an absence against the student", async () => {
    // The counterpart: a fix that excluded too much would pass every
    // assertion above while quietly giving absentees 100 %.
    const service = makeService([
      { status: "PRESENT" },
      { status: "ABSENT" },
      { status: "ABSENT" },
    ]);
    const result = await service.percentageFor("student-1", "ss-1");

    expect(result.sessionsInDenominator).toBe(3);
    expect(result.percentage).toBeCloseTo(33.3, 1);
  });
});
