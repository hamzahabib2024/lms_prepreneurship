import {
  __testing,
  noticeFor,
  refuseForMaintenance,
  type MaintenanceState,
} from "./maintenance-rules";

const on = (over: Partial<MaintenanceState> = {}): MaintenanceState => ({
  enabled: true,
  message: "The System is down for scheduled maintenance.",
  expectedEndAt: null,
  ...over,
});

const ask = (path: string, roles: string[] = ["student"], state = on()) =>
  refuseForMaintenance(state, { path, roles });

describe("when maintenance is off", () => {
  it("refuses nothing", () => {
    const off: MaintenanceState = { enabled: false, message: "", expectedEndAt: null };
    for (const role of ["student", "teacher", "admin", "super_admin"]) {
      expect(refuseForMaintenance(off, { path: "/api/v1/anything", roles: [role] }).refused).toBe(
        false,
      );
    }
  });
});

describe("when maintenance is on", () => {
  it("refuses a student", () => {
    expect(ask("/api/v1/me/progress").refused).toBe(true);
  });

  it("refuses a teacher", () => {
    expect(ask("/api/v1/assignments", ["teacher"]).refused).toBe(true);
  });

  it("refuses an ADMIN", () => {
    // An Admin is not doing the maintenance. Letting them in during a schema
    // migration is how half-migrated data gets written.
    expect(ask("/api/v1/admin/users", ["admin"]).refused).toBe(true);
  });

  it("NEVER refuses a Super Admin", () => {
    // They are the ones doing the work and need to see whether it worked.
    expect(ask("/api/v1/anything/at/all", ["super_admin"]).refused).toBe(false);
  });

  it("does not refuse somebody who is also a Super Admin", () => {
    expect(ask("/api/v1/me/progress", ["teacher", "super_admin"]).refused).toBe(false);
  });

  it("passes the message and the expected end to whoever is refused", () => {
    const end = new Date("2026-08-11T22:00:00Z");
    const r = ask("/api/v1/me/progress", ["student"], on({ expectedEndAt: end }));
    expect(r.message).toContain("scheduled maintenance");
    expect(r.expectedEndAt).toEqual(end);
  });
});

describe("the paths that always work", () => {
  it("lets ANYBODY sign in", () => {
    // THE ONE THAT MATTERS. A Super Admin whose token expired during the work
    // cannot become a Super Admin again without this, and the remedy would be
    // editing the database at three in the morning.
    expect(ask("/api/v1/auth/login").refused).toBe(false);
  });

  it("lets anybody refresh a session", () => {
    expect(ask("/api/v1/auth/refresh").refused).toBe(false);
  });

  it("lets anybody sign out", () => {
    expect(ask("/api/v1/auth/logout").refused).toBe(false);
  });

  it("lets anybody read the maintenance notice", () => {
    // Otherwise the only way to learn why the System is refusing you is to be
    // told by somebody.
    expect(ask("/api/v1/maintenance").refused).toBe(false);
  });

  it("lets the health check through", () => {
    expect(ask("/api/v1/health").refused).toBe(false);
  });

  it("refuses everything else, including things that look like auth", () => {
    expect(ask("/api/v1/auth/password/change").refused).toBe(true);
    expect(ask("/api/v1/authorisation/whatever").refused).toBe(true);
  });

  it("gives every exemption a written reason", () => {
    // Each entry is a hole in the maintenance window. One that nobody can
    // justify should not be there.
    for (const entry of __testing.ALWAYS_AVAILABLE) {
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });

  it("keeps the list short", () => {
    expect(__testing.ALWAYS_AVAILABLE.length).toBeLessThanOrEqual(6);
  });
});

describe("path normalisation", () => {
  it("strips the version prefix", () => {
    expect(__testing.normalise("/api/v1/auth/login")).toBe("/auth/login");
    expect(__testing.normalise("/api/v2/auth/login")).toBe("/auth/login");
  });

  it("strips a query string", () => {
    // Otherwise /maintenance?x=1 is not /maintenance and the notice is refused.
    expect(__testing.normalise("/api/v1/maintenance?verbose=1")).toBe("/maintenance");
  });

  it("leaves an unversioned path alone", () => {
    expect(__testing.normalise("/health")).toBe("/health");
  });

  it("does not exempt a path that merely CONTAINS an exempt one", () => {
    // /api/v1/courses/auth/login is not the login route.
    expect(ask("/api/v1/courses/auth/login").refused).toBe(true);
  });
});

describe("the notice", () => {
  it("is the message alone when no end time was given", () => {
    expect(noticeFor(on())).toBe("The System is down for scheduled maintenance.");
  });

  it("includes when it is expected back", () => {
    // Whether to wait ten minutes or give up for the evening is the actual
    // question, and only this answers it.
    const notice = noticeFor(on({ expectedEndAt: new Date("2026-08-11T22:00:00Z") }));
    expect(notice).toContain("Expected back at");
    expect(notice).toContain("2026-08-11T22:00:00");
  });
});
