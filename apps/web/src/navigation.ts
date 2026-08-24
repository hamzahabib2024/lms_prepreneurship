import type { IconName } from "./components/Icon";

/**
 * WHERE THIS APPLICATION CAN GO — one list, read twice.
 *
 * The sidebar used to be twenty-four hand-written <NavLink>s wrapped in role
 * predicates, and that was fine while the sidebar was the only thing that
 * needed to know. It is not any more: the command palette searches the same
 * destinations, and a second hand-written copy of this list is a second place
 * for a role predicate to be wrong.
 *
 * THE PREDICATES HERE ARE THE ONES THAT WERE THERE. Nothing has been widened.
 * `roles` is a whitelist and an absent `roles` means everybody; both are
 * exactly as App.tsx expressed them before, with the reasoning kept beside
 * each one because the reasoning is the part that is hard to reconstruct.
 *
 * AND IT IS STILL NOT SECURITY (UI-002, ARC-003). Hiding a destination stops
 * the interface offering something that would be refused; the server is what
 * refuses it. Nothing in this file may be relied on to protect anything.
 */

export interface Destination {
  /** The address. Also the identity — two destinations never share one. */
  to: string;
  label: string;
  icon: IconName;
  /**
   * The heading it sits under, or null for the everyday block at the top.
   * Grouping is by WHAT YOU ARE DOING — teaching, money, running the place —
   * rather than by which permission happens to guard it.
   */
  group: string | null;
  /** Whitelist. Absent means every signed-in role. */
  roles?: readonly string[];
  /**
   * An ordinary <a> rather than a route: it leaves the application shell
   * entirely, which for the public page is the whole point — a preview inside
   * the sidebar would not be a preview of anything.
   */
  leavesApp?: boolean;
  /** Extra words the palette should match on, never rendered. */
  also?: readonly string[];
}

const STAFF = ["super_admin", "admin", "teacher"] as const;
const OFFICE = ["super_admin", "admin"] as const;

export const DESTINATIONS: readonly Destination[] = [
  // ------------------------------------------------------------ everyday --
  { to: "/", label: "Dashboard", icon: "dashboard", group: null, also: ["home", "overview"] },
  { to: "/timetable", label: "Timetable", icon: "calendar", group: null, also: ["schedule", "classes"] },
  { to: "/announcements", label: "Announcements", icon: "megaphone", group: null, also: ["notices"] },
  /*
   * Discussion has moved UP into the everyday block.
   *
   * It sat outside the student-only "Learning" group but after it, so a
   * student saw it under that heading and a teacher saw it under no heading at
   * all — floating between Announcements and Teaching, belonging to neither.
   * It is a thing both of them do most days, which is what the top block is.
   */
  { to: "/discussions", label: "Discussion", icon: "chat", group: null, roles: ["student", "teacher"] },

  // ------------------------------------------------------------ learning --
  { to: "/subjects", label: "My subjects", icon: "book", group: "Learning", roles: ["student"], also: ["progress", "courses", "grades"] },
  /* A STUDENT'S OWN, which is not the register on /certificates below. That
     one lists every holder in the Institute and is guarded by the issuing
     permission; this one is `certificate:read` at OWN scope. Two addresses
     because they are two different things, not one thing with a filter. */
  { to: "/my-certificates", label: "My certificates", icon: "award", group: "Learning", roles: ["student"], also: ["certificate", "award", "diploma", "verify", "download"] },

  // ------------------------------------------------------------ teaching --
  { to: "/attendance", label: "Attendance", icon: "check", group: "Teaching", roles: STAFF, also: ["register", "present", "absent"] },
  { to: "/marking", label: "Marking", icon: "pen", group: "Teaching", roles: STAFF, also: ["grading", "submissions"] },
  { to: "/rubrics", label: "Rubrics", icon: "clipboard", group: "Teaching", roles: STAFF },
  /*
   * Every class, with the two things visible nowhere else: which have
   * recordings waiting to be published, and which have no Drive folder
   * connected at all.
   *
   * section_subject:read is held by all four roles, each at its own scope, so
   * a teacher lands on their own classes rather than on a 403 — and the page
   * itself never tests a role.
   */
  { to: "/courses", label: "Courses", icon: "play", group: "Teaching", roles: STAFF, also: ["recordings", "lectures", "drive"] },
  { to: "/content", label: "Content", icon: "layers", group: "Teaching", roles: STAFF, also: ["modules", "lessons"] },

  // ------------------------------------------------------------ students --
  { to: "/admissions", label: "Admissions", icon: "clipboard", group: "Students", roles: OFFICE, also: ["applications", "registrations"] },
  { to: "/users", label: "People", icon: "users", group: "Students", roles: OFFICE, also: ["directory", "staff", "accounts"] },
  { to: "/certificates", label: "Certificates", icon: "award", group: "Students", roles: OFFICE, also: ["register", "issue", "revoke", "verification", "award"] },
  { to: "/import", label: "Import", icon: "upload", group: "Students", roles: OFFICE, also: ["cohort", "csv"] },
  { to: "/bulk", label: "Bulk changes", icon: "shuffle", group: "Students", roles: OFFICE },

  // ----------------------------------------------------------- institute --
  /*
   * Sections and Structure are STAFF ONLY now, and they were offered to
   * everybody.
   *
   * They are institute-configuration screens — the term, batch and section
   * shape of the whole place — and they were two of a student's eight
   * destinations. The server already scoped what they returned, so nothing
   * leaked; a quarter of the student's navigation simply pointed at somebody
   * else's job.
   *
   * THE ROUTES ARE UNCHANGED and still resolve for anyone who types the
   * address, exactly as before. This is the interface declining to offer
   * something, which is all it was ever able to do.
   */
  /* Creating the courses themselves — the level above Sections. OFFICE only:
     a teacher holds `programme:read` but no create on programme or subject, and
     nothing but read on fee_structure. */
  { to: "/courses-admin", label: "Courses & fees", icon: "book", group: "Institute", roles: OFFICE, also: ["programmes", "subjects", "fee", "fees", "price", "instalments", "thumbnail", "picture"] },
  { to: "/sections", label: "Sections", icon: "layers", group: "Institute", roles: STAFF, also: ["subjects", "classes"] },
  { to: "/structure", label: "Structure", icon: "calendar", group: "Institute", roles: STAFF, also: ["terms", "batches", "sessions"] },
  /* A TEACHER holds no `payment` grant at all (§4.5) — offering them the page
     would be offering a 403. */
  { to: "/fees", label: "Fees", icon: "money", group: "Institute", roles: ["super_admin", "admin", "student"], also: ["payments", "invoice", "balance", "receipt", "challan", "statement"] },
  /* SUBMITTING A PAYMENT IS ITS OWN DESTINATION, not a button found only after
     opening Fees. It is the single most common thing a student comes to this
     part of the System to do, and the command palette is how many of them
     navigate — so "easypaisa" and "slip" are search terms that must land
     somewhere. Students only: the form claims a payment as whoever is signed
     in, so it is not a screen an administrator has any use for. */
  { to: "/fees/submit", label: "Submit a fee payment", icon: "upload", group: "Institute", roles: ["student"], also: ["pay", "payment", "easypaisa", "jazzcash", "bank", "transfer", "slip", "proof", "receipt", "challan"] },
  /* The fee desk. Held apart from /fees because chasing debtors and checking
     bank slips are different jobs done by different people. */
  { to: "/fees/verification", label: "Payment verification", icon: "clipboard", group: "Institute", roles: OFFICE, also: ["verify", "approve", "pending", "slips", "proof", "easypaisa", "jazzcash", "challan", "receipts"] },
  { to: "/reports", label: "Reports", icon: "chart", group: "Institute", roles: STAFF, also: ["export", "analytics"] },
  /* A teacher holds provider_binding:read and needs it — whether a Meet link
     is created for them or they must paste one in changes what they do before
     class. A student holds no such grant. */
  { to: "/integrations", label: "Integrations", icon: "shuffle", group: "Institute", roles: STAFF, also: ["google", "meet", "drive", "gmail", "email"] },
  { to: "/home", label: "Public page", icon: "megaphone", group: "Institute", roles: OFFICE, leavesApp: true, also: ["landing", "website", "preview"] },

  // ------------------------------------------------------ administration --
  { to: "/settings", label: "Settings", icon: "settings", group: "Administration", roles: OFFICE, also: ["policy", "configuration"] },
  { to: "/messages", label: "Messages", icon: "bell", group: "Administration", roles: OFFICE, also: ["templates", "notifications", "email"] },
  { to: "/audit", label: "Audit", icon: "clipboard", group: "Administration", roles: OFFICE, also: ["log", "history"] },
  /* Super Admin ALONE (§4.5). Unlike the audit log there is no Admin tier:
     this log names who has been attacked and from where, and is as useful for
     investigating a colleague as for defending one. */
  { to: "/security", label: "Security", icon: "shield", group: "Administration", roles: ["super_admin"], also: ["threats", "sessions", "lockouts"] },
  /* `backup` and `restore` reach nobody else. */
  { to: "/backups", label: "Backups", icon: "database", group: "Administration", roles: ["super_admin"], also: ["restore", "snapshot"] },
];

/** The destinations this user is offered, in sidebar order. */
export function destinationsFor(hasRole: (...roles: string[]) => boolean): Destination[] {
  return DESTINATIONS.filter((d) => !d.roles || hasRole(...d.roles));
}

/**
 * Ranked matches for a typed query.
 *
 * A LABEL MATCH OUTRANKS A SYNONYM, and a match at the start outranks one in
 * the middle: somebody typing "se" wants Sections and Settings before Courses,
 * which contains "se" halfway through and would otherwise sort by accident.
 *
 * An empty query returns everything, because a palette that opens blank is a
 * palette that makes you type before it will admit what it knows.
 */
export function searchDestinations(all: Destination[], query: string): Destination[] {
  const q = query.trim().toLowerCase();
  if (!q) return all;

  const scored: Array<{ d: Destination; score: number }> = [];
  for (const d of all) {
    const label = d.label.toLowerCase();
    let score = -1;
    if (label.startsWith(q)) score = 0;
    else if (label.includes(q)) score = 1;
    else if (d.group?.toLowerCase().startsWith(q)) score = 2;
    else if (d.also?.some((w) => w.startsWith(q))) score = 3;
    else if (d.also?.some((w) => w.includes(q))) score = 4;
    if (score >= 0) scored.push({ d, score });
  }

  // Stable within a score band, so equal matches keep sidebar order rather
  // than reshuffling as somebody types.
  return scored.sort((a, b) => a.score - b.score).map((s) => s.d);
}
