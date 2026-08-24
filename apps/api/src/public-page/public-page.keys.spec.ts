import { can, type ActorPermissions, type Role } from "@lms/shared";
import { CATALOGUE } from "../settings/settings-catalogue";
import {
  PUBLIC_PAGE_GROUP,
  isPublicPageKey,
  parseFeatures,
  problemsWith,
  publicPageKeys,
} from "./public-page.keys";

const actor = (role: Role): ActorPermissions => ({ roles: [role], subPermissions: [] });

/**
 * The public page editor hands an ADMIN a write path into the settings table,
 * which §4.5 otherwise reserves to a Super Admin. Everything below exists to
 * prove that path is as narrow as it claims to be.
 *
 * These are the tests that would fail if somebody later filed a threshold under
 * the Public page group — which is the one mistake that turns this feature into
 * a privilege-escalation bug, and the one that would look completely innocent
 * in review: a single line moved between two arrays in a 900-line catalogue.
 */
describe("the door an Admin is given", () => {
  it("lets an Admin change the public page but not a setting", () => {
    expect(can(actor("admin"), "public_page", "configure")).toBe(true);
    // The thing this must not become. An Admin may READ institute policy and
    // may not change it, and the editor does not change that.
    expect(can(actor("admin"), "system_setting", "configure")).toBe(false);
  });

  it("is closed to a teacher and a student entirely", () => {
    for (const role of ["teacher", "student"] as const) {
      expect(can(actor(role), "public_page", "read")).toBe(false);
      expect(can(actor(role), "public_page", "configure")).toBe(false);
    }
  });
});

describe("what the editor is allowed to reach", () => {
  const group = CATALOGUE.filter((d) => d.group === PUBLIC_PAGE_GROUP);

  it("is not an empty set — the guard would pass forever", () => {
    expect(group.length).toBeGreaterThan(10);
    expect(publicPageKeys()).toEqual(group.map((d) => d.key));
  });

  it("holds nothing outside the public. namespace", () => {
    expect(group.filter((d) => !d.key.startsWith("public.")).map((d) => d.key)).toEqual([]);
  });

  it("holds no secret", () => {
    // A value served to strangers is by definition not a secret; one filed
    // here would be returned by the read route (SEC-CRY-010).
    expect(group.filter((d) => d.isSecret).map((d) => d.key)).toEqual([]);
  });

  /**
   * THE ONE THAT MATTERS MOST.
   *
   * Every dangerous setting in this System is a NUMBER, a PERCENT or a set of
   * WEIGHTS: the attendance threshold, the pass mark, the progress weighting,
   * the certificate criteria. Marketing copy is text, a list of text, or a
   * switch that shows a section.
   *
   * So the types allowed in this group are the types that cannot express a
   * threshold. It is a crude rule and that is its value — it holds without
   * anybody remembering it, and it fails loudly on the exact edit that would
   * otherwise slip through review.
   */
  it("holds nothing that could be a threshold, a weighting or a limit", () => {
    const numeric = group
      .filter((d) => d.type === "number" || d.type === "percent" || d.type === "weights")
      .map((d) => `${d.key} is a ${d.type}`);
    expect(numeric).toEqual([]);
  });

  it("can be overridden only for the whole Institute", () => {
    // A per-section headline is meaningless: there is one public page. An
    // overridable scope here would also be a second way to write a row.
    expect(group.filter((d) => (d.overridableAt ?? []).length > 0).map((d) => d.key)).toEqual([]);
  });
});

describe("isPublicPageKey", () => {
  it("accepts a real public page setting", () => {
    expect(isPublicPageKey("public.heroHeadline")).toBe(true);
    expect(isPublicPageKey("public.videoUrls")).toBe(true);
  });

  it("refuses a setting from any other group", () => {
    // Each of these is a real, writable setting — just not through this door.
    expect(isPublicPageKey("attendance.warningThreshold")).toBe(false);
    expect(isPublicPageKey("institute.name")).toBe(false);
    expect(isPublicPageKey("progress.weights")).toBe(false);
  });

  it("refuses a key that is not a setting at all", () => {
    expect(isPublicPageKey("public.notARealKey")).toBe(false);
    expect(isPublicPageKey("")).toBe(false);
    // Neither of these can reach a row, because the catalogue is consulted
    // first — but a lookup that answered "yes" to either would be alarming.
    expect(isPublicPageKey("__proto__")).toBe(false);
    expect(isPublicPageKey("constructor")).toBe(false);
  });
});

describe("problemsWith", () => {
  it("passes a set of legitimate changes", () => {
    expect(
      problemsWith({
        "public.heroHeadline": "Learn the craft.",
        "public.showStats": false,
        "public.videoUrls": ["https://youtu.be/abc"],
      }),
    ).toEqual([]);
  });

  it("refuses a key from another group, naming it", () => {
    const problems = problemsWith({ "attendance.warningThreshold": 10 });
    expect(problems).toHaveLength(1);
    expect(problems[0]!.key).toBe("attendance.warningThreshold");
    expect(problems[0]!.message).toContain("not part of the public page");
  });

  it("reports EVERY problem, not the first", () => {
    // Somebody who retyped six fields and pressed Save once is told about all
    // the mistakes at once. Being shown them one at a time is the behaviour
    // this function exists to avoid.
    const problems = problemsWith({
      "public.heroHeadline": 42,
      "public.showStats": "yes",
      "finance.receiptNote": "hello",
    });
    expect(problems.map((p) => p.key).sort()).toEqual([
      "finance.receiptNote",
      "public.heroHeadline",
      "public.showStats",
    ]);
  });

  it("enforces the length bound on text", () => {
    const problems = problemsWith({ "public.heroPill": "x".repeat(400) });
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("limit is 60");
  });

  it("enforces the length bound on one entry of a list", () => {
    const problems = problemsWith({ "public.features": ["calendar | Fine | ok", "x".repeat(500)] });
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("one entry");
  });

  it("treats null as remove-the-override, which is always legal", () => {
    expect(problemsWith({ "public.heroHeadline": null })).toEqual([]);
  });

  it("still refuses null for a key from another group", () => {
    // Clearing is a write. Allowing it through would let an Admin reset any
    // setting in the System to its default — quieter than changing one, and
    // just as much a change.
    expect(problemsWith({ "attendance.warningThreshold": null })).toHaveLength(1);
  });
});

describe("parseFeatures", () => {
  it("reads icon, title and body", () => {
    expect(parseFeatures(["calendar | A timetable | Every class, with the room."])).toEqual([
      { icon: "calendar", title: "A timetable", body: "Every class, with the room." },
    ]);
  });

  it("keeps a body that itself contains a pipe", () => {
    // Only the first two separators are structural; the rest is prose.
    expect(parseFeatures(["chart | Progress | watched | submitted"])[0]!.body).toBe(
      "watched | submitted",
    );
  });

  it("takes two fields as title and body, with a neutral icon", () => {
    expect(parseFeatures(["Fees without arguments | Receipts on the spot."])).toEqual([
      { icon: "layers", title: "Fees without arguments", body: "Receipts on the spot." },
    ]);
  });

  it("drops a blank line rather than rendering an empty card", () => {
    expect(parseFeatures(["", "   ", "| | ", "check | Real | Yes"])).toEqual([
      { icon: "check", title: "Real", body: "Yes" },
    ]);
  });

  it("accepts a title with no description", () => {
    expect(parseFeatures(["award | Certificates worth holding |"])).toEqual([
      { icon: "award", title: "Certificates worth holding", body: "" },
    ]);
  });

  it("splits one setting value that holds several lines", () => {
    expect(parseFeatures(["a | One | x\nb | Two | y"])).toHaveLength(2);
  });

  it("stops at twelve, so a paste cannot become a wall", () => {
    const many = Array.from({ length: 40 }, (_, i) => `check | Card ${i} | body`);
    expect(parseFeatures(many)).toHaveLength(12);
  });

  it("survives nothing at all", () => {
    expect(parseFeatures(undefined)).toEqual([]);
    expect(parseFeatures([])).toEqual([]);
  });
});
