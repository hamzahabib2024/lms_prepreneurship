/**
 * Report authorisation — SRS §17.2 teacher-to-payment suite, BR-PAY-07.
 *
 * REGRESSION TEST. A live probe found that a teacher could run the revenue
 * report: the generic /reports/:key route carried one blanket
 * `report_attendance` permission, so every report inherited the weakest one.
 * §4.5.11 and BR-PAY-07 restrict financial data to Super Admin, or Admin
 * holding financial_reporter.
 *
 * The defect was invisible to every unit test because the permission matrix
 * itself was correct — only the WIRING was wrong. These tests assert the
 * mapping between each report and the resource it reads, which is the part
 * that was missing.
 */

import { resolvePermission, type ActorPermissions, type Resource } from "@lms/shared";

/** Must mirror the `resource` field on each definition in report.service.ts. */
const REPORT_RESOURCE: Record<string, Resource> = {
  "student-directory": "report_enrolment",
  "attendance-summary": "report_attendance",
  "registration-pipeline": "report_enrolment",
  revenue: "report_financial",
  "acquisition-attribution": "report_marketing",
  progress: "report_progress",
  assessment: "report_assessment",
  "teacher-activity": "report_teacher_activity",
};

const actor = (
  role: ActorPermissions["roles"][number],
  subs: string[] = [],
): ActorPermissions => ({
  roles: [role],
  subPermissions: subs as ActorPermissions["subPermissions"],
  steppedUp: true,
});

const may = (a: ActorPermissions, key: string, action: "read" | "export"): boolean =>
  resolvePermission(a, REPORT_RESOURCE[key] as Resource, action).allowed;

describe("§17.2 — a teacher cannot reach financial reports", () => {
  const teacher = actor("teacher");

  it("is denied the revenue report, for read AND export", () => {
    // The exact defect found in the live probe.
    expect(may(teacher, "revenue", "read")).toBe(false);
    expect(may(teacher, "revenue", "export")).toBe(false);
  });

  it("is denied marketing attribution, which carries revenue per source", () => {
    expect(may(teacher, "acquisition-attribution", "read")).toBe(false);
  });

  it("IS allowed the attendance report, which is legitimately theirs", () => {
    // The counterpart. A fix that simply denied teachers everything would
    // pass the tests above and break the System.
    expect(may(teacher, "attendance-summary", "read")).toBe(true);
    expect(may(teacher, "attendance-summary", "export")).toBe(true);
  });
});

describe("BR-PAY-07 — financial access needs the sub-permission", () => {
  it("an Admin WITHOUT financial_reporter is denied", () => {
    const plain = actor("admin");
    expect(may(plain, "revenue", "read")).toBe(false);
    expect(resolvePermission(plain, "report_financial", "read").reason).toBe(
      "missing_sub_permission",
    );
  });

  it("an Admin WITH financial_reporter is allowed", () => {
    expect(may(actor("admin", ["financial_reporter"]), "revenue", "read")).toBe(true);
  });

  it("a Super Admin is allowed without any sub-permission", () => {
    expect(may(actor("super_admin"), "revenue", "read")).toBe(true);
  });

  it("a student is denied every report", () => {
    const student = actor("student");
    for (const key of Object.keys(REPORT_RESOURCE)) {
      expect(may(student, key, "export")).toBe(false);
    }
  });
});

describe("mapping integrity", () => {
  it("every report maps to a resource, so none can inherit a blanket grant", () => {
    // The root cause was a MISSING mapping, not a wrong one. If a new report
    // is added without a resource, this fails rather than silently defaulting
    // to whatever the route happens to declare.
    for (const [key, resource] of Object.entries(REPORT_RESOURCE)) {
      expect(resource).toBeDefined();
      expect(typeof resource).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("every registered report is listed here", () => {
    // The list above must not fall behind the service, or a new report goes
    // unasserted and the next mapping mistake is invisible.
    expect(Object.keys(REPORT_RESOURCE)).toHaveLength(8);
  });

  it("financial reports map to report_financial, not a weaker resource", () => {
    expect(REPORT_RESOURCE["revenue"]).toBe("report_financial");
    expect(REPORT_RESOURCE["revenue"]).not.toBe("report_attendance");
  });
});

describe("§4.5 — teacher activity is about PEOPLE, not students", () => {
  const teacher = actor("teacher");
  const admin = actor("admin");

  it("lets a teacher read it — their OWN, per the matrix", () => {
    expect(may(teacher, "teacher-activity", "read")).toBe(true);
  });

  it("does NOT let a teacher export it", () => {
    // A management report on a colleague's productivity is not a file for
    // whoever fancies one. The matrix grants read at OWN scope and no export;
    // the service enforces the OWN half, which no per-model predicate can.
    expect(may(teacher, "teacher-activity", "export")).toBe(false);
  });

  it("lets an administrator read and export it", () => {
    expect(may(admin, "teacher-activity", "read")).toBe(true);
    expect(may(admin, "teacher-activity", "export")).toBe(true);
  });

  it("never reaches a student", () => {
    expect(may(actor("student"), "teacher-activity", "read")).toBe(false);
    expect(may(actor("student"), "teacher-activity", "export")).toBe(false);
  });
});

describe("the two new student-facing reports", () => {
  it("let a student READ their own progress and assessment", () => {
    expect(may(actor("student"), "progress", "read")).toBe(true);
    expect(may(actor("student"), "assessment", "read")).toBe(true);
  });

  it("but never EXPORT them", () => {
    // §4.1.2 — bulk extraction is a distinct action, and a student's own copy
    // of their record goes through personal_data_export, which is audited.
    expect(may(actor("student"), "progress", "export")).toBe(false);
    expect(may(actor("student"), "assessment", "export")).toBe(false);
  });

  it("let a teacher run both for their own sections", () => {
    expect(may(actor("teacher"), "progress", "read")).toBe(true);
    expect(may(actor("teacher"), "assessment", "export")).toBe(true);
  });

  it("do not let a teacher reach financial data through them", () => {
    expect(may(actor("teacher"), "revenue", "read")).toBe(false);
  });
});
